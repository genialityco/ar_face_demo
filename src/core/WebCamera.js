/**
 * WebCamera - Webカメラ映像の取得と管理
 */
export class WebCamera {
  constructor() {
    this.video = null;
    this.stream = null;
  }

  /**
   * カメラを初期化して映像取得を開始
   */
  async init() {
    // video要素を作成
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('muted', '');

    // カメラストリームを取得
    const constraints = {
      video: {
        facingMode: 'user',  // 前面カメラ
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();

      console.log(`Camera ready: ${this.video.videoWidth}x${this.video.videoHeight}`);
    } catch (error) {
      console.error('Camera init failed:', error);
      throw error;
    }
  }

  /**
   * video要素を取得
   */
  getVideo() {
    return this.video;
  }

  /**
   * 映像サイズを取得
   */
  getSize() {
    if (!this.video) return { width: 0, height: 0 };
    return {
      width: this.video.videoWidth,
      height: this.video.videoHeight
    };
  }

  /**
   * リソース解放
   */
  dispose() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
