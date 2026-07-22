/**
 * MetaballEffect - Metaballs mediante raymarching con TSL (soporta refracción + dispersión)
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  Loop,
  If,
  Break,
  uv,
  uniform,
  texture,
  cubeTexture,
  normalize,
  length,
  max,
  abs,
  mix,
  clamp,
  dot,
  reflect,
  refract
} from 'three/tsl';

export class MetaballEffect {
  constructor(options = {}) {
    // Uniform: posición y radio de las esferas (vec4: x, y, z, radius)
    // 0: rostro principal, 1-3: orbitan el rostro, 4-5: mano izquierda/derecha
    this.sphere0 = uniform(new THREE.Vector4(0, 0, 0, 0.5));
    this.sphere1 = uniform(new THREE.Vector4(0.8, 0.3, 0, 0.25));
    this.sphere2 = uniform(new THREE.Vector4(-0.6, -0.2, 0.3, 0.2));
    this.sphere3 = uniform(new THREE.Vector4(0.2, -0.5, -0.2, 0.2));
    this.sphere4 = uniform(new THREE.Vector4(-100, 0, 0, 0));  // Mano izquierda (fuera de pantalla al inicio)
    this.sphere5 = uniform(new THREE.Vector4(100, 0, 0, 0));   // Mano derecha (fuera de pantalla al inicio)

    // Uniform: coeficiente de mezcla de los metaballs
    this.blendK = uniform(options.blendFactor ?? 0.4);

    // Uniform: parámetros de la cámara
    this.cameraAspect = uniform(16 / 9);

    // Uniform: índice de refracción (IOR)
    this.ior = uniform(options.ior ?? 1.45);

    // Uniform: Dispersion (intensidad de la aberración cromática)
    this.dispersion = uniform(options.dispersion ?? 0.03);

    // Uniform: intensidad del Fresnel
    this.fresnelStrength = uniform(options.fresnelStrength ?? 0.5);

    // Uniform: intensidad de la distorsión por refracción (equivalente a thickness)
    this.refractionStrength = uniform(options.refractionStrength ?? 0.15);

    // Textura de fondo (se establece después)
    this.backgroundTexture = null;
    this.bgTextureUniform = null;

    // Mapa de entorno (CubeMap)
    this.envMapTexture = null;

    // Mesh y material
    this.mesh = null;
    this.material = null;
  }

  /**
   * Establece la textura de fondo
   */
  setBackgroundTexture(tex) {
    this.backgroundTexture = tex;
  }

  /**
   * Establece el mapa de entorno (CubeMap)
   */
  setEnvMapTexture(tex) {
    this.envMapTexture = tex;
  }

  /**
   * Crea el material para el quad de pantalla completa
   */
  createMaterial() {
    const sphere0 = this.sphere0;
    const sphere1 = this.sphere1;
    const sphere2 = this.sphere2;
    const sphere3 = this.sphere3;
    const sphere4 = this.sphere4;
    const sphere5 = this.sphere5;
    const blendK = this.blendK;
    const cameraAspect = this.cameraAspect;
    const ior = this.ior;
    const dispersion = this.dispersion;
    const fresnelStrength = this.fresnelStrength;
    const refractionStrength = this.refractionStrength;
    const bgTex = this.backgroundTexture;
    const envTex = this.envMapTexture;

    // Función smooth minimum
    const smin = (a, b, k) => {
      const h = clamp(float(0.5).add(float(0.5).mul(b.sub(a)).div(k)), 0.0, 1.0);
      return mix(b, a, h).sub(k.mul(h).mul(float(1.0).sub(h)));
    };

    // SDF de la esfera
    const sphereSDF = (pos, sphereData) => {
      return length(pos.sub(sphereData.xyz)).sub(sphereData.w);
    };

    // SDF de toda la escena (4 del rostro + 2 de las manos = 6)
    const sceneSDF = Fn(([pos]) => {
      const d0 = sphereSDF(pos, sphere0);
      const d1 = sphereSDF(pos, sphere1);
      const d2 = sphereSDF(pos, sphere2);
      const d3 = sphereSDF(pos, sphere3);
      const d4 = sphereSDF(pos, sphere4);
      const d5 = sphereSDF(pos, sphere5);

      const m01 = smin(d0, d1, blendK);
      const m012 = smin(m01, d2, blendK);
      const m0123 = smin(m012, d3, blendK);
      const m01234 = smin(m0123, d4, blendK);
      const m012345 = smin(m01234, d5, blendK);

      return m012345;
    });

    // Cálculo de la normal
    const calcNormal = Fn(([pos]) => {
      const eps = float(0.001);
      const dx = sceneSDF(pos.add(vec3(eps, 0, 0))).sub(sceneSDF(pos.sub(vec3(eps, 0, 0))));
      const dy = sceneSDF(pos.add(vec3(0, eps, 0))).sub(sceneSDF(pos.sub(vec3(0, eps, 0))));
      const dz = sceneSDF(pos.add(vec3(0, 0, eps))).sub(sceneSDF(pos.sub(vec3(0, 0, eps))));
      return normalize(vec3(dx, dy, dz));
    });

    // Fragment shader
    const fragmentNode = Fn(() => {
      // Convertir las coordenadas UV a -1~1
      const screenUV = uv().sub(0.5).mul(2);
      const originalUV = uv();

      // Origen y dirección del rayo
      const ro = vec3(0, 0, 5);
      const rd = normalize(
        vec3(
          screenUV.x.mul(cameraAspect),
          screenUV.y,
          float(-1.5)
        )
      );

      // Raymarching
      const t = float(0).toVar();
      const hit = float(0).toVar();

      Loop(48, () => {
        const pos = ro.add(rd.mul(t));
        const d = sceneSDF(pos);

        If(d.lessThan(0.002), () => {
          hit.assign(1);
          Break();
        });

        If(t.greaterThan(15.0), () => {
          Break();
        });

        t.addAssign(d);
      });

      // Color resultante
      const finalColor = vec3(0, 0, 0).toVar();
      const alpha = float(0).toVar();

      If(hit.greaterThan(0.5), () => {
        const hitPos = ro.add(rd.mul(t));
        const normal = calcNormal(hitPos);

        // Coseno del ángulo de incidencia
        const cosTheta = dot(normal, rd.negate());

        // Efecto Fresnel
        const fresnel = float(1.0).sub(abs(cosTheta)).pow(3).mul(fresnelStrength);

        // === Cálculo de refracción (Dispersion: distinto IOR por canal RGB) ===
        const eta = float(1.0).div(ior);

        // Desplazar el índice de refracción de cada canal de color
        const etaR = eta.sub(dispersion);
        const etaG = eta;
        const etaB = eta.add(dispersion);

        // Calcular la dirección de refracción
        const refractDirR = refract(rd, normal, etaR);
        const refractDirG = refract(rd, normal, etaG);
        const refractDirB = refract(rd, normal, etaB);

        // Calcular el offset de UV a partir de la dirección de refracción
        // Se usan las componentes XY del vector de refracción como offset de UV (refractionStrength = equivalente a thickness)

        // Efecto de lente cóncava: invertir el offset de UV
        const uvOffsetR = vec2(refractDirR.x, refractDirR.y.negate()).mul(refractionStrength).negate();
        const uvOffsetG = vec2(refractDirG.x, refractDirG.y.negate()).mul(refractionStrength).negate();
        const uvOffsetB = vec2(refractDirB.x, refractDirB.y.negate()).mul(refractionStrength).negate();

        // Muestrear el fondo (UV distinta para cada color)
        const bgR = texture(bgTex, originalUV.add(uvOffsetR)).r;
        const bgG = texture(bgTex, originalUV.add(uvOffsetG)).g;
        const bgB = texture(bgTex, originalUV.add(uvOffsetB)).b;

        const refractedColor = vec3(bgR, bgG, bgB);

        // Calcular la dirección de reflexión
        const reflectDir = reflect(rd, normal);

        // Reflejo de entorno: usa el CubeMap si existe, si no un reflejo simulado
        const envColor = envTex
          ? cubeTexture(envTex, reflectDir)
          : texture(bgTex, clamp(originalUV.add(vec2(reflectDir.x, reflectDir.y.negate()).mul(0.3)), 0.0, 1.0));

        // Highlight especular
        const specular = max(dot(reflectDir, normalize(vec3(1, 1, 1))), 0.0).pow(32);

        // Color final: refracción + reflejo Fresnel (entorno) + especular
        const baseColor = refractedColor.mul(float(1.0).sub(fresnel));
        const reflectColor = envColor.rgb.mul(fresnel).mul(0.8);
        const specColor = vec3(1.0, 1.0, 1.0).mul(specular.mul(0.3));

        finalColor.assign(baseColor.add(reflectColor).add(specColor));
        alpha.assign(1.0);
      });

      // Si no hubo hit, queda completamente transparente
      return vec4(finalColor, alpha);
    });

    // Crear el NodeMaterial
    this.material = new THREE.NodeMaterial();
    this.material.fragmentNode = fragmentNode();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = false;
    this.material.side = THREE.DoubleSide;

    return this.material;
  }

  /**
   * Crea la escena y cámara para el quad de pantalla completa
   */
  createFullscreenQuad() {
    if (!this.material) {
      this.createMaterial();
    }

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(3, 3);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.quadScene.add(this.mesh);

    return { scene: this.quadScene, camera: this.quadCamera };
  }

  /**
   * Renderizado
   */
  render(renderer) {
    if (this.quadScene && this.quadCamera) {
      renderer.autoClear = false;
      renderer.render(this.quadScene, this.quadCamera);
      renderer.autoClear = true;
    }
  }

  /**
   * Actualiza la posición de una esfera
   */
  setSpherePosition(index, position, radius = 0.3) {
    const spheres = [
      this.sphere0, this.sphere1, this.sphere2, this.sphere3,
      this.sphere4, this.sphere5
    ];
    if (index >= 0 && index < 6) {
      spheres[index].value.set(position.x, position.y, position.z, radius);
    }
  }

  /**
   * Actualiza los parámetros de la cámara
   */
  updateCamera(camera) {
    this.cameraAspect.value = camera.aspect;
  }

  /**
   * Establece el coeficiente de mezcla
   */
  setBlendFactor(value) {
    this.blendK.value = value;
  }

  /**
   * Establece el IOR (índice de refracción)
   */
  setIOR(value) {
    this.ior.value = value;
  }

  /**
   * Establece la Dispersion (aberración cromática)
   */
  setDispersion(value) {
    this.dispersion.value = value;
  }

  /**
   * Establece la intensidad del Fresnel
   */
  setFresnelStrength(value) {
    this.fresnelStrength.value = value;
  }

  /**
   * Establece la intensidad de la distorsión por refracción (equivalente a thickness)
   * Valores de referencia: entre 0.05 y 0.3 aprox.
   */
  setRefractionStrength(value) {
    this.refractionStrength.value = value;
  }
}
