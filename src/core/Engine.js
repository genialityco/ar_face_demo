/**
 * Engine - Inicialización de WebGPURenderer y gestión del loop principal
 */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { Bloom } from '../effects/screen/Bloom.js';
import { MetaballEffect } from '../effects/raymarching/MetaballEffect.js';
import { VendettaMask } from '../effects/face/VendettaMask.js';
import { VikingHelmet } from '../effects/face/VikingHelmet.js';
import { HeadOccluder } from '../effects/face/HeadOccluder.js';
import { FlowerFace } from '../effects/face/FlowerFace.js';
import { RaccoonFace } from '../effects/face/RaccoonFace.js';
import { HoloScan } from '../effects/face/HoloScan.js';
import { EyeGlow } from '../effects/face/EyeGlow.js';
import { FaceWarp } from '../effects/face/FaceWarp.js';
import { HamburgerFeast } from '../effects/face/HamburgerFeast.js';
import { MoneyRain } from '../effects/face/MoneyRain.js';
import { MoodWarp } from '../effects/face/MoodWarp.js';
import { WeightRack } from '../effects/face/WeightRack.js';
import { EffortFace } from '../effects/face/EffortFace.js';
import { AgingFace } from '../effects/face/AgingFace.js';

// FOV vertical de la cámara virtual que asume el facialTransformationMatrix de MediaPipe
const FACE_MATRIX_FOV = 63;

// Distancia de profundidad (unidades del maskScene) usada al proyectar la posición de la mano
const HAND_HOLD_DEPTH = 30;

// Distancia normalizada (0-1, espacio de imagen) entre mano y rostro para permitir "sacarse" el accesorio
const GRAB_PROXIMITY_THRESHOLD = 0.35;

// Cuánto se infla la cara (bulgeAmount de FaceWarp) cuando se comieron todas las hamburguesas
const HAMBURGER_MAX_BULGE = 0.14;

export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.videoTexture = null;
    this.isRunning = false;

    // Para el mapa de entorno
    this.cubeRenderTarget = null;
    this.cubeCamera = null;
    this.envScene = null;

    // Objeto transparente de prueba
    this.glassSphere = null;
    this.targetPosition = new THREE.Vector3();
    this.smoothingFactor = 0.55;  // Suavizado del seguimiento (0-1, mayor = sigue más rápido)

    // Para el seguimiento de manos
    this.leftHandTarget = new THREE.Vector3(-100, 0, 0);
    this.rightHandTarget = new THREE.Vector3(100, 0, 0);
    this.leftHandCurrent = new THREE.Vector3(-100, 0, 0);
    this.rightHandCurrent = new THREE.Vector3(100, 0, 0);
    this.handSphereRadius = 0.96;  // Tamaño de la esfera de la mano (0.8 × 1.2)

    // Efecto de metaballs
    this.metaballEffect = null;

    // Filtro seleccionado ('metaball' | 'vendetta' | 'viking' | 'flower' | 'raccoon' | 'holoscan' | 'eyeglow' | 'facewarp' | 'hamburger' | 'money' | 'gym' | 'aging')
    this.currentFilter = 'metaball';

    // Assets 3D que siguen al rostro (máscara Vendetta, casco vikingo, cara de flores, mapache)
    this.vendettaMask = null;
    this.vikingHelmet = null;
    this.flowerFace = null;
    this.raccoonFace = null;
    this.headOccluder = null;
    this.maskScene = null;
    this.maskCamera = null;

    // Efecto de escaneo holográfico (usa landmarks 2D, se renderiza en la escena principal)
    this.holoScan = null;

    // Fuego/destellos en los ojos según expresión (usa landmarks 2D + blendshapes)
    this.eyeGlow = null;

    // Deformación del rostro en el video en vivo (reemplaza el fondo mientras está activo)
    this.faceWarp = null;

    // Hamburguesas agarrables que aumentan progresivamente el FaceWarp al comerlas
    this.hamburgerFeast = null;

    // Lluvia de billetes agarrables: la expresión (boca/cejas deformadas en el video) pasa de triste a feliz
    this.moneyRain = null;
    this.moodWarp = null;
    // Switch de debug: fuerza la expresión feliz, ignorando el progreso real
    this.debugMoodHappy = false;
    // Switch de debug: fuerza el filtro de hamburguesas al 100% (obesidad máxima)
    this.debugHamburgerMax = false;

    // Mancuernas agarrables en el suelo (de menor a mayor peso): al levantarlas
    // muestran esfuerzo (enrojecimiento + gesto) en el rostro, según el peso
    this.weightRack = null;
    this.effortFace = null;
    // Switch de debug: fuerza el esfuerzo al máximo, ignorando el levantamiento real
    this.debugGymMax = false;

    // Envejecimiento del rostro (todavía sin mecánica/historia asociada)
    this.agingFace = null;
    // Switch de debug: alterna entre sin envejecer (0) y envejecimiento máximo (1)
    this.debugAgingMax = false;

    // Estado de "puesto" / "sujeto con la mano" para los accesorios que se pueden agarrar
    this.wearState = {
      vendetta: { worn: true, heldBy: null, heldDepth: HAND_HOLD_DEPTH },
      viking: { worn: true, heldBy: null, heldDepth: HAND_HOLD_DEPTH }
    };
    this.prevPinch = { Left: false, Right: false };
    // Última profundidad real del rostro (según facialTransformationMatrix), para
    // que al agarrar el accesorio mantenga el mismo tamaño que tenía puesto
    this.lastFaceDepth = { vendetta: HAND_HOLD_DEPTH, viking: HAND_HOLD_DEPTH };

    // Parámetros para la transformación de coordenadas
    this.distance = 5;  // Distancia de referencia desde la cámara

    // Contador de frames
    this.frameCount = 0;

    // Post-procesado
    this.postProcessing = null;
    this.chromaticOffset = null;
  }

  /**
   * Inicializa el engine
   * @param {HTMLVideoElement} video - Elemento video con la imagen de la cámara
   */
  async init(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const aspect = width / height;

    // Inicializar WebGPURenderer
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    // Tercer argumento false: no fija el style inline del canvas (el tamaño visible lo controla el CSS)
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Obligatorio: inicialización asíncrona de WebGPU
    await this.renderer.init();

    this.container.appendChild(this.renderer.domElement);

    // Crear escena
    this.scene = new THREE.Scene();

    // Crear cámara (perspectiva)
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.01, 1000);
    this.camera.position.z = 5;

    // Crear VideoTexture
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;

    // Establecer como fondo
    this.scene.background = this.videoTexture;

    // Configurar el mapa de entorno (para transmission)
    this.setupEnvironmentMap();

    // Configurar las luces
    this.setupLights();

    // Configurar el efecto de metaballs (filtro por defecto)
    this.setupMetaball();

    // Configurar la escena/cámara para los assets 3D que siguen al rostro
    this.setupFaceAssets(aspect);

    // Configurar el efecto de escaneo holográfico
    this.holoScan = new HoloScan();
    this.holoScan.addToScene(this.scene);

    // Configurar el efecto de fuego/destellos en los ojos
    this.eyeGlow = new EyeGlow();
    this.eyeGlow.addToScene(this.scene);

    // Configurar el efecto de deformación del rostro
    this.faceWarp = new FaceWarp();
    this.faceWarp.setBackgroundTexture(this.videoTexture);

    // Configurar las hamburguesas agarrables
    this.hamburgerFeast = new HamburgerFeast();
    this.hamburgerFeast.addToScene(this.scene);

    // Configurar la lluvia de billetes
    this.moneyRain = new MoneyRain();
    this.moneyRain.addToScene(this.scene);

    // Configurar la deformación de expresión (triste a feliz)
    this.moodWarp = new MoodWarp();
    this.moodWarp.setBackgroundTexture(this.videoTexture);

    // Configurar las mancuernas agarrables
    this.weightRack = new WeightRack();
    this.weightRack.addToScene(this.scene);

    // Configurar el efecto de esfuerzo (enrojecimiento + gesto)
    this.effortFace = new EffortFace();
    this.effortFace.setBackgroundTexture(this.videoTexture);

    // Configurar el efecto de envejecimiento
    this.agingFace = new AgingFace();
    this.agingFace.setBackgroundTexture(this.videoTexture);

    // Configurar el post-procesado
    this.setupPostProcessing();

    // Soporte para resize
    window.addEventListener('resize', () => this.handleResize(video));

    console.log('Engine initialized with WebGPU');
  }

  /**
   * Configura el mapa de entorno (para la refracción de transmission)
   */
  setupEnvironmentMap() {
    // Crear CubeRenderTarget (resolución reducida a 512 para pruebas)
    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      colorSpace: THREE.SRGBColorSpace
    });

    // Crear CubeCamera
    this.cubeCamera = new THREE.CubeCamera(0.1, 100, this.cubeRenderTarget);

    // Escena para el mapa de entorno (esfera con el videoTexture pegado por dentro)
    this.envScene = new THREE.Scene();
    const envMaterial = new THREE.MeshBasicMaterial({
      map: this.videoTexture,
      side: THREE.BackSide
    });
    const envSphere = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 32),
      envMaterial
    );
    this.envScene.add(envSphere);
  }

  /**
   * Configura el efecto de metaballs
   */
  setupMetaball() {
    this.metaballEffect = new MetaballEffect({
      blendFactor: 0.4,
      ior: 1.45,           // Índice de refracción del vidrio
      dispersion: 0.08,    // Intensidad de la aberración cromática
      fresnelStrength: 0.9, // Intensidad del reflejo (subida)
      refractionStrength: 0.1
    });

    // Establecer la textura de fondo (imagen de la cámara)
    this.metaballEffect.setBackgroundTexture(this.videoTexture);

    // Establecer el mapa de entorno (CubeMap)
    this.metaballEffect.setEnvMapTexture(this.cubeRenderTarget.texture);

    // Crear el quad de pantalla completa (no se agrega a la escena)
    this.metaballEffect.createFullscreenQuad();

    // Establecer los parámetros de la cámara
    this.metaballEffect.updateCamera(this.camera);

    // Posiciones iniciales (esfera principal + esferas que orbitan) - tamaño x2.25 (1.5 x 1.5)
    this.metaballEffect.setSpherePosition(0, new THREE.Vector3(0, 0, 0), 1.125);
    this.metaballEffect.setSpherePosition(1, new THREE.Vector3(0.8, 0.3, 0), 0.5625);
    this.metaballEffect.setSpherePosition(2, new THREE.Vector3(-0.6, -0.2, 0.3), 0.45);
    this.metaballEffect.setSpherePosition(3, new THREE.Vector3(0.2, -0.5, -0.2), 0.45);

    console.log('Metaball effect initialized with refraction');
  }

  /**
   * Configura la escena/cámara para los assets 3D que siguen al rostro
   * (máscara Vendetta, casco vikingo, cara de flores).
   * Como el facialTransformationMatrix de MediaPipe asume la cámara en el origen,
   * se renderiza con una cámara dedicada distinta de la cámara principal (z=5)
   */
  setupFaceAssets(aspect) {
    this.maskScene = new THREE.Scene();
    this.maskCamera = new THREE.PerspectiveCamera(FACE_MATRIX_FOV, aspect, 0.01, 5000);
    this.maskCamera.position.set(0, 0, 0);

    // Luces propias del maskScene: es una escena separada de this.scene, así
    // que las luces de setupLights() no la afectan. VendettaMask usa un matcap
    // (se ilumina solo) y VikingHelmet usa el cubemap como envMap, pero
    // FlowerFace/RaccoonFace usan MeshStandardMaterial normal y sin esto se
    // ven negros (sin luces ni envMap, no hay nada que iluminarlos)
    const maskAmbient = new THREE.AmbientLight(0xffffff, 0.7);
    this.maskScene.add(maskAmbient);
    const maskDirectional = new THREE.DirectionalLight(0xffffff, 1.0);
    maskDirectional.position.set(0, 1, 1);
    this.maskScene.add(maskDirectional);

    // El oclusor de profundidad se agrega primero (con renderOrder escribe su profundidad antes que el resto)
    this.headOccluder = new HeadOccluder();
    this.headOccluder.addToScene(this.maskScene);

    this.vendettaMask = new VendettaMask();
    this.vendettaMask.addToScene(this.maskScene);

    this.vikingHelmet = new VikingHelmet();
    this.vikingHelmet.addToScene(this.maskScene);

    this.flowerFace = new FlowerFace();
    this.flowerFace.addToScene(this.maskScene);

    this.raccoonFace = new RaccoonFace();
    this.raccoonFace.addToScene(this.maskScene);
  }

  /**
   * Cambia el filtro activo
   * @param {'metaball'|'vendetta'|'viking'|'flower'|'holoscan'|'eyeglow'|'facewarp'|'hamburger'|'money'} filter
   */
  async setFilter(filter) {
    if (filter === this.currentFilter) return;

    // Al salir de un filtro con accesorio agarrable, reiniciar su estado (vuelve "puesto")
    if (this.wearState[this.currentFilter]) {
      this.wearState[this.currentFilter].worn = true;
      this.wearState[this.currentFilter].heldBy = null;
    }

    if (filter === 'vendetta') {
      await this.vendettaMask.load();
    } else if (filter === 'viking') {
      await this.vikingHelmet.load(this.cubeRenderTarget.texture);
    } else if (filter === 'flower') {
      await this.flowerFace.load();
    } else if (filter === 'raccoon') {
      await this.raccoonFace.load();
    } else if (filter === 'hamburger') {
      await this.hamburgerFeast.load();
    } else if (filter === 'money') {
      await this.moneyRain.load();
    } else if (filter === 'gym') {
      await this.weightRack.load();
    }

    this.currentFilter = filter;
    this.vendettaMask.setVisible(filter === 'vendetta');
    this.vikingHelmet.setVisible(filter === 'viking');
    this.flowerFace.setVisible(filter === 'flower');
    this.raccoonFace.setVisible(filter === 'raccoon');
    this.holoScan.setVisible(filter === 'holoscan');
    this.eyeGlow.setVisible(filter === 'eyeglow');
    this.hamburgerFeast.setVisible(filter === 'hamburger');
    this.moneyRain.setVisible(filter === 'money');
    this.weightRack.setVisible(filter === 'gym');
    const isFaceAsset = filter === 'vendetta' || filter === 'viking' || filter === 'flower' || filter === 'raccoon';
    this.headOccluder.setVisible(isFaceAsset);

    if (filter === 'hamburger') {
      // Siempre empieza sin ningún efecto aplicado y con el switch de debug apagado
      this.hamburgerFeast.reset();
      this.faceWarp.bulgeAmount = 0;
      this.debugHamburgerMax = false;
    } else if (filter === 'money') {
      // Siempre empieza triste (sin billetes guardados) y con el switch de debug apagado
      this.moneyRain.reset();
      this.debugMoodHappy = false;
    } else if (filter === 'gym') {
      // Siempre empieza sin esfuerzo y con el switch de debug apagado
      this.weightRack.reset();
      this.debugGymMax = false;
    } else if (filter === 'aging') {
      // Siempre empieza sin envejecer y con el switch de debug apagado
      this.agingFace.intensity = 0;
      this.debugAgingMax = false;
    }
  }

  /**
   * Configura las luces
   */
  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);

    const rimLight = new THREE.DirectionalLight(0x88ccff, 0.4);
    rimLight.position.set(-5, 5, -5);
    this.scene.add(rimLight);
  }

  /**
   * Configura el post-procesado (Bloom)
   */
  setupPostProcessing() {
    // Crear el pass de la escena
    const scenePass = pass(this.scene, this.camera);

    // Obtener el texture node del scenePass
    const scenePassColor = scenePass.getTextureNode('output');

    // Crear y aplicar el efecto de Bloom
    this.bloomEffect = new Bloom({
      strength: 0.6,    // Intensidad de la luz
      radius: 0.4,      // Extensión del desenfoque (0-1)
      threshold: 0.7    // Umbral de brillo a partir del cual empieza a brillar
    });
    const finalPass = this.bloomEffect.apply(scenePassColor);

    // Crear el PostProcessing
    this.postProcessing = new THREE.PostProcessing(this.renderer);
    this.postProcessing.outputNode = finalPass;
  }

  /**
   * Crea la esfera transparente de prueba
   */
  createGlassSphere() {
    const geometry = new THREE.SphereGeometry(1.2, 64, 64);
    const material = new THREE.MeshPhysicalMaterial({
      transmission: 1,
      thickness: 0.6,
      roughness: 0.05,
      metalness: 0,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0,
      envMap: this.cubeRenderTarget.texture,
      envMapIntensity: 1.2,
      attenuationDistance: 2,
      attenuationColor: new THREE.Color(0.9, 0.95, 1.0),
      dispersion: 8,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide
    });

    this.glassSphere = new THREE.Mesh(geometry, material);
    this.glassSphere.position.set(0, 0, 0);
    this.scene.add(this.glassSphere);
  }

  /**
   * Inicia el loop principal
   */
  start() {
    this.isRunning = true;
    this.animate();
  }

  /**
   * Detiene el loop principal
   */
  stop() {
    this.isRunning = false;
  }

  /**
   * Loop de animación
   */
  animate() {
    if (!this.isRunning) return;

    requestAnimationFrame(() => this.animate());
    this.update();
    this.render();
  }

  /**
   * Procesamiento de actualización
   */
  update() {
    if (this.currentFilter === 'metaball' && this.metaballEffect) {
      // Modo metaball: la esfera principal sigue al rostro, las pequeñas orbitan
      const time = performance.now() * 0.001;

      // La esfera principal (índice 0) sigue la posición del rostro
      // Sigue targetPosition suavemente
      if (!this.currentPosition) {
        this.currentPosition = new THREE.Vector3();
      }
      this.currentPosition.lerp(this.targetPosition, this.smoothingFactor);
      this.metaballEffect.setSpherePosition(0, this.currentPosition, 1.125);

      // Hacer que las esferas pequeñas orbiten
      const orbitRadius = 0.8;
      for (let i = 1; i < 4; i++) {
        const angle = time * (1.5 - i * 0.3) + (i * Math.PI * 2 / 3);
        const offsetX = Math.cos(angle) * orbitRadius;
        const offsetY = Math.sin(angle * 0.7) * 0.3;
        const offsetZ = Math.sin(angle) * orbitRadius * 0.5;

        const pos = this.currentPosition.clone().add(
          new THREE.Vector3(offsetX, offsetY, offsetZ)
        );
        this.metaballEffect.setSpherePosition(i, pos, 0.45 + i * 0.1125);
      }

      // Actualizar las esferas de las manos (índice 4: mano izquierda, 5: mano derecha)
      this.leftHandCurrent.lerp(this.leftHandTarget, this.smoothingFactor);
      this.rightHandCurrent.lerp(this.rightHandTarget, this.smoothingFactor);
      this.metaballEffect.setSpherePosition(4, this.leftHandCurrent, this.handSphereRadius);
      this.metaballEffect.setSpherePosition(5, this.rightHandCurrent, this.handSphereRadius);
    } else if (this.glassSphere) {
      // Modo esfera de vidrio
      this.glassSphere.rotation.y += 0.01;
      this.glassSphere.position.lerp(this.targetPosition, this.smoothingFactor);
    }
  }

  /**
   * Convierte coordenadas normalizadas de MediaPipe a coordenadas 3D de Three.js
   * @param {number} x - Coordenada X normalizada (0-1)
   * @param {number} y - Coordenada Y normalizada (0-1)
   * @param {number} z - Coordenada Z relativa
   */
  projectToWorld(x, y, z = 0) {
    // Convertir a coordenadas NDC (-1 a 1)
    // No se invierte X (el video ya está en espejo)
    const ndcX = (x - 0.5) * 2;
    const ndcY = -(y - 0.5) * 2;

    // Convertir de NDC a coordenadas de mundo
    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(this.camera);

    // Calcular la dirección desde la cámara
    const dir = vector.sub(this.camera.position).normalize();

    // Distancia considerando el valor de Z
    const dist = this.distance - z * 3;

    // Calcular la posición final
    return this.camera.position.clone().add(dir.multiplyScalar(dist));
  }

  /**
   * Convierte coordenadas normalizadas de MediaPipe a coordenadas de mundo del maskScene.
   * El maskCamera está en el origen (no en z=5 como la cámara principal), por eso
   * se necesita esta proyección separada para ubicar objetos ahí (ej: accesorio en la mano)
   * @param {number} x - Coordenada X normalizada (0-1)
   * @param {number} y - Coordenada Y normalizada (0-1)
   * @param {number} depth - Distancia a lo largo del rayo de la cámara
   */
  projectToMaskWorld(x, y, depth = HAND_HOLD_DEPTH) {
    const ndcX = (x - 0.5) * 2;
    const ndcY = -(y - 0.5) * 2;

    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(this.maskCamera);

    const dir = vector.sub(this.maskCamera.position).normalize();

    return this.maskCamera.position.clone().add(dir.multiplyScalar(depth));
  }

  /**
   * Actualiza la posición de la esfera según los landmarks del rostro
   * @param {Object} landmark - {x, y, z}
   */
  updateFacePosition(landmark) {
    if (!landmark) {
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);

    // Offset: x=derecha, y=arriba, z=hacia adelante
    worldPos.x += 0;    // Desplazar a la derecha
    worldPos.y += 0.5;  // Desplazar hacia arriba (esfera sobre el rostro)
    worldPos.z += 0;    // Desplazar hacia adelante

    this.targetPosition.copy(worldPos);
  }

  /**
   * Actualiza la transformación de los assets 3D que siguen al rostro
   * @param {Float32Array|number[]|null} matrixData - facialTransformationMatrixes[0].data
   */
  updateFaceTransform(matrixData) {
    if (this.currentFilter === 'vendetta' && this.vendettaMask) {
      if (this.wearState.vendetta.worn) {
        this.vendettaMask.updateTransform(matrixData);
        if (matrixData) this.lastFaceDepth.vendetta = -matrixData[14];
      }
      this.headOccluder.updateTransform(matrixData);
    } else if (this.currentFilter === 'viking' && this.vikingHelmet) {
      if (this.wearState.viking.worn) {
        this.vikingHelmet.updateTransform(matrixData);
        if (matrixData) this.lastFaceDepth.viking = -matrixData[14];
      }
      this.headOccluder.updateTransform(matrixData);
    } else if (this.currentFilter === 'flower' && this.flowerFace) {
      this.flowerFace.updateTransform(matrixData);
      this.headOccluder.updateTransform(matrixData);
    } else if (this.currentFilter === 'raccoon' && this.raccoonFace) {
      this.raccoonFace.updateTransform(matrixData);
      this.headOccluder.updateTransform(matrixData);
    }
  }

  /**
   * Aplica las expresiones (blendshapes) reales del rostro a los morph
   * targets del mapache (parpadeo, sonrisa, boca abierta, cejas, etc.)
   * @param {Object|null} blendshapes
   */
  updateRaccoonExpression(blendshapes) {
    if (this.currentFilter !== 'raccoon' || !this.raccoonFace) return;
    this.raccoonFace.updateBlendshapes(blendshapes);
  }

  /**
   * Actualiza el efecto de escaneo holográfico con los landmarks del rostro
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   */
  updateFaceLandmarks(landmarks) {
    if (this.currentFilter !== 'holoscan' || !this.holoScan) return;
    this.holoScan.update(landmarks, (x, y, z) => this.projectToWorld(x, y, z));
  }

  /**
   * Actualiza el efecto de fuego/destellos en los ojos según la expresión facial
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   * @param {Object|null} blendshapes
   */
  updateFaceExpression(landmarks, blendshapes) {
    if (this.currentFilter !== 'eyeglow' || !this.eyeGlow) return;
    this.eyeGlow.update(landmarks, blendshapes, (x, y, z) => this.projectToWorld(x, y, z), this.camera);
  }

  /**
   * Actualiza la deformación del rostro en el video en vivo
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   */
  updateFaceWarp(landmarks) {
    if ((this.currentFilter !== 'facewarp' && this.currentFilter !== 'hamburger') || !this.faceWarp) return;
    this.faceWarp.update(landmarks);
  }

  /**
   * Actualiza las hamburguesas agarrables y, según cuántas se hayan comido,
   * aumenta progresivamente el bulgeAmount de FaceWarp
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   * @param {Object|null} blendshapes
   * @param {{Left:{palm:Object|null,landmarks:Array|null,isPincerGrab:boolean}, Right:{palm:Object|null,landmarks:Array|null,isPincerGrab:boolean}}} hands
   */
  updateHamburgerFeast(landmarks, blendshapes, hands) {
    if (this.currentFilter !== 'hamburger' || !this.hamburgerFeast) return;

    this.hamburgerFeast.update({
      landmarks,
      blendshapes,
      hands,
      projectFn: (x, y, z) => this.projectToWorld(x, y, z),
      time: performance.now() * 0.001
    });

    // El switch de debug fuerza el 100% (obesidad máxima) ignorando el progreso real
    this.faceWarp.bulgeAmount = this.debugHamburgerMax
      ? HAMBURGER_MAX_BULGE
      : this.hamburgerFeast.getProgress() * HAMBURGER_MAX_BULGE;
  }

  /**
   * Activa/desactiva el switch de debug que fuerza el filtro de hamburguesas al 100%
   * @param {boolean} isMax
   */
  setDebugHamburgerMax(isMax) {
    this.debugHamburgerMax = isMax;
  }

  /**
   * Actualiza la lluvia de billetes y la deformación de expresión (triste a feliz)
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   * @param {{Left:{landmarks:Array|null,isPincerGrab:boolean}, Right:{landmarks:Array|null,isPincerGrab:boolean}}} hands
   */
  updateMoneyRain(landmarks, hands) {
    if (this.currentFilter !== 'money' || !this.moneyRain) return;

    this.moneyRain.update({
      hands,
      projectFn: (x, y, z) => this.projectToWorld(x, y, z),
      time: performance.now() * 0.001
    });

    // El switch de debug fuerza feliz (1) ignorando el progreso real; si no está
    // activado, usa el progreso real de la lluvia de billetes
    this.moodWarp.progress = this.debugMoodHappy ? 1 : this.moneyRain.getProgress();
    this.moodWarp.update(landmarks);
  }

  /**
   * Activa/desactiva el switch de debug que fuerza la expresión feliz,
   * sin depender del progreso real de la lluvia de billetes
   * @param {boolean} isHappy
   */
  setDebugMoodHappy(isHappy) {
    this.debugMoodHappy = isHappy;
  }

  /**
   * Actualiza las mancuernas agarrables y, según cuánto se esté levantando,
   * el enrojecimiento/gesto de esfuerzo en el rostro (EffortFace)
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   * @param {{Left:{landmarks:Array|null,isPincerGrab:boolean}, Right:{landmarks:Array|null,isPincerGrab:boolean}}} hands
   */
  updateWeightRack(landmarks, hands) {
    if (this.currentFilter !== 'gym' || !this.weightRack) return;

    this.weightRack.update({
      hands,
      projectFn: (x, y, z) => this.projectToWorld(x, y, z),
      time: performance.now() * 0.001
    });

    // El switch de debug fuerza el esfuerzo máximo ignorando el levantamiento real
    this.effortFace.intensity = this.debugGymMax ? 1 : this.weightRack.getEffort();
    this.effortFace.update(landmarks);
  }

  /**
   * Activa/desactiva el switch de debug que fuerza el esfuerzo al máximo
   * @param {boolean} isMax
   */
  setDebugGymMax(isMax) {
    this.debugGymMax = isMax;
  }

  /**
   * Actualiza el efecto de envejecimiento. Todavía no tiene una mecánica que
   * controle el progreso, así que el switch de debug alterna entre sin
   * envejecer (0) y envejecimiento máximo (1) mientras se define la historia
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks
   */
  updateAgingFace(landmarks) {
    if (this.currentFilter !== 'aging' || !this.agingFace) return;

    this.agingFace.intensity = this.debugAgingMax ? 1 : 0;
    this.agingFace.update(landmarks);
  }

  /**
   * Activa/desactiva el switch de debug que fuerza el envejecimiento al máximo
   * @param {boolean} isMax
   */
  setDebugAgingMax(isMax) {
    this.debugAgingMax = isMax;
  }

  /**
   * Texto de debug para el filtro actual (ej. progreso de felicidad), o null si no aplica
   */
  getDebugText() {
    if (this.currentFilter === 'money' && this.moneyRain) {
      return `Felicidad: ${Math.round(this.moneyRain.getProgress() * 100)}%`;
    }
    if (this.currentFilter === 'hamburger' && this.hamburgerFeast) {
      return `Peso: ${Math.round(this.hamburgerFeast.getProgress() * 100)}%`;
    }
    if (this.currentFilter === 'gym' && this.weightRack) {
      return `Esfuerzo: ${Math.round(this.weightRack.getEffort() * 100)}%`;
    }
    if (this.currentFilter === 'aging' && this.agingFace) {
      return `Edad: ${Math.round(this.agingFace.intensity * 100)}%`;
    }
    return null;
  }

  /**
   * Devuelve y limpia el mensaje flotante pendiente (ej. "¡Bajaste de peso!"), o null
   */
  consumePendingMessage() {
    if (this.currentFilter !== 'hamburger' || !this.hamburgerFeast) return null;
    return this.hamburgerFeast.consumePendingMessage();
  }

  /**
   * Procesa el gesto de pinza de una mano para agarrar/soltar el accesorio facial actual.
   * Si está puesto y se pellizca cerca del rostro, pasa a "sujeto con la mano".
   * Si está sujeto y la misma mano vuelve a pellizcar, se lo vuelve a poner.
   * @param {'Left'|'Right'} handedness
   * @param {{x:number,y:number,z:number}|null} palm - Centro de la palma (coordenadas normalizadas)
   * @param {boolean} isPinching
   * @param {{x:number,y:number}|null} facePoint - Punto de referencia del rostro (coordenadas normalizadas)
   */
  updateHandGrab(handedness, palm, isPinching, facePoint) {
    const wasPinching = this.prevPinch[handedness];
    this.prevPinch[handedness] = isPinching;
    const pinchStarted = isPinching && !wasPinching;

    const accessory = this.currentFilter === 'vendetta' ? this.vendettaMask
      : this.currentFilter === 'viking' ? this.vikingHelmet
      : null;
    const state = this.wearState[this.currentFilter];

    if (!accessory || !state) return;

    // Mientras está sujeto por esta mano, seguir su posición cada frame
    // (a la misma profundidad que tenía puesto, para que no cambie de tamaño)
    if (!state.worn && state.heldBy === handedness) {
      if (palm) {
        const worldPos = this.projectToMaskWorld(palm.x, palm.y, state.heldDepth);
        accessory.setHeldPosition(worldPos);
      } else {
        // Se perdió el seguimiento de la mano que lo sostenía: vuelve a su posición en el rostro
        state.worn = true;
        state.heldBy = null;
      }
    }

    if (!pinchStarted || !palm) return;

    if (state.worn) {
      // Pellizco cerca del rostro: sacarlo y dejarlo en la mano
      if (facePoint) {
        const dx = palm.x - facePoint.x;
        const dy = palm.y - facePoint.y;
        if (Math.sqrt(dx * dx + dy * dy) < GRAB_PROXIMITY_THRESHOLD) {
          // Fija la profundidad actual del rostro para mantener el mismo tamaño mientras se sostiene
          state.heldDepth = this.lastFaceDepth[this.currentFilter];
          state.worn = false;
          state.heldBy = handedness;
        }
      }
    } else if (state.heldBy === handedness) {
      // La misma mano que lo sostiene pellizca de nuevo: ponerlo de vuelta
      state.worn = true;
      state.heldBy = null;
    }
  }

  /**
   * Actualiza la posición de la mano izquierda
   * @param {Object|null} landmark - {x, y, z} or null
   */
  updateLeftHandPosition(landmark) {
    if (!landmark) {
      // Si no se detecta la mano, la manda fuera de pantalla
      this.leftHandTarget.set(-100, 0, 0);
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);
    this.leftHandTarget.copy(worldPos);
  }

  /**
   * Actualiza la posición de la mano derecha
   * @param {Object|null} landmark - {x, y, z} or null
   */
  updateRightHandPosition(landmark) {
    if (!landmark) {
      // Si no se detecta la mano, la manda fuera de pantalla
      this.rightHandTarget.set(100, 0, 0);
      return;
    }

    const worldPos = this.projectToWorld(landmark.x, landmark.y, landmark.z);
    this.rightHandTarget.copy(worldPos);
  }

  /**
   * Renderizado
   */
  render() {
    this.frameCount++;

    // Actualizar el mapa de entorno (cada 2 frames)
    if (this.frameCount % 2 === 0) {
      this.cubeCamera.update(this.renderer, this.envScene);
    }

    if (this.currentFilter === 'metaball' && this.metaballEffect) {
      // Modo metaball: renderiza el fondo y luego superpone el metaball
      this.renderer.render(this.scene, this.camera);
      this.metaballEffect.render(this.renderer);
    } else if (this.currentFilter === 'vendetta' || this.currentFilter === 'viking' || this.currentFilter === 'flower' || this.currentFilter === 'raccoon') {
      // Modo asset 3D que sigue al rostro: renderiza el fondo y luego superpone el asset
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.render(this.maskScene, this.maskCamera);
      this.renderer.autoClear = true;
    } else if (this.currentFilter === 'holoscan' || this.currentFilter === 'eyeglow') {
      // Modo escaneo holográfico / fuego-destellos en los ojos: ya están en this.scene
      this.renderer.render(this.scene, this.camera);
    } else if (this.currentFilter === 'facewarp') {
      // Modo cara deformada: reemplaza el fondo por el video deformado (sin overlay)
      this.faceWarp.render(this.renderer);
    } else if (this.currentFilter === 'hamburger') {
      // Modo hamburguesas: fondo deformado (progresivo) + hamburguesas superpuestas
      this.scene.background = null;
      this.faceWarp.render(this.renderer);
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
      this.scene.background = this.videoTexture;
    } else if (this.currentFilter === 'money') {
      // Modo lluvia de billetes: fondo con boca/cejas deformadas + billetes superpuestos
      this.scene.background = null;
      this.moodWarp.render(this.renderer);
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
      this.scene.background = this.videoTexture;
    } else if (this.currentFilter === 'gym') {
      // Modo levantamiento de pesas: fondo con esfuerzo/enrojecimiento + mancuernas superpuestas
      this.scene.background = null;
      this.effortFace.render(this.renderer);
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
      this.scene.background = this.videoTexture;
    } else if (this.currentFilter === 'aging') {
      // Modo envejecimiento: reemplaza el fondo por el video envejecido (sin overlay, todavía sin mecánica)
      this.agingFace.render(this.renderer);
    } else if (this.glassSphere) {
      // Modo esfera de vidrio: renderiza con PostProcessing (Bloom aplicado)
      this.postProcessing.render();
    }
  }

  /**
   * Procesamiento de resize
   */
  handleResize(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (this.maskCamera) {
      this.maskCamera.aspect = width / height;
      this.maskCamera.updateProjectionMatrix();
    }

    this.renderer.setSize(width, height, false);
  }

  /**
   * Libera los recursos
   */
  dispose() {
    this.stop();
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
