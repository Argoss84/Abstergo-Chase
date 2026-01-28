import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import { MEDIAPIPE_BONE_CONNECTIONS } from '../types/handTracking';

export interface HandTracking2DCallbacks {
  onStatusChange?: (isActive: boolean) => void;
  onError?: (message: string) => void;
  /** Appelé quand la vidéo est prête (après play), pour l’utiliser en texture AR par ex. */
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export interface HandTracking2DOptions extends HandTracking2DCallbacks {
  /** Dessiner la vidéo sur le canvas (false = fond transparent, pour overlay AR). Défaut: true. */
  drawVideo?: boolean;
  /** Adapter le canvas au viewport et mettre à l’échelle les mains (pour overlay AR). Défaut: false. */
  scaleHandsToViewport?: boolean;
}

/**
 * Détection des mains en 2D : getUserMedia + MediaPipe, dessin des keypoints
 * et des os sur un canvas. Aucun WebXR ni Three.js.
 */
export class HandTracking2D {
  private callbacks: HandTracking2DCallbacks;
  private drawVideo: boolean;
  private scaleHandsToViewport: boolean;
  private detector: handPoseDetection.HandDetector | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private isRunning = false;
  private hasDetectedHands = false;
  /** false pour caméra arrière (environment, image non miroir) ; true pour caméra frontale (selfie) */
  private flipHorizontal = false;

  constructor(callbacks: HandTracking2DOptions = {}) {
    this.callbacks = callbacks;
    this.drawVideo = callbacks.drawVideo !== false;
    this.scaleHandsToViewport = callbacks.scaleHandsToViewport === true;
  }

  async start(
    container: HTMLElement,
    deviceId?: string,
    opts?: { videoContainer?: HTMLElement }
  ): Promise<boolean> {
    if (this.isRunning) return true;

    this.container = container;
    const videoParent = opts?.videoContainer ?? container;
    const showVideoAsLayer = !this.drawVideo && this.scaleHandsToViewport && !!opts?.videoContainer;

    try {
      this.detector = await handPoseDetection.createDetector(
        handPoseDetection.SupportedModels.MediaPipeHands,
        {
          runtime: 'mediapipe',
          modelType: 'full',
          maxHands: 2,
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
        }
      );
    } catch (err) {
      const msg = `Hand tracking: échec chargement MediaPipe. ${err instanceof Error ? err.message : String(err)}`;
      this.callbacks.onError?.(msg);
      return false;
    }

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('playsinline', 'true');
    if (showVideoAsLayer) {
      this.video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
    } else {
      this.video.style.cssText = 'display:none;';
    }
    videoParent.appendChild(this.video);

    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
      : { facingMode: 'environment', width: 640, height: 480 };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
      });
    } catch (e) {
      const msg = 'Hand tracking: accès à la caméra refusé ou indisponible.';
      this.callbacks.onError?.(msg);
      this.cleanup();
      return false;
    }

    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (e) {
      const msg = `Hand tracking: la vidéo ne démarre pas. ${e instanceof Error ? e.message : String(e)}`;
      this.callbacks.onError?.(msg);
      this.cleanup();
      return false;
    }

    this.callbacks.onVideoReady?.(this.video);

    this.canvas = document.createElement('canvas');
    if (this.scaleHandsToViewport) {
      this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none;';
    } else {
      this.canvas.style.cssText = 'max-width:100%; height:auto; display:block; background:#000;';
    }
    container.appendChild(this.canvas);

    this.isRunning = true;
    this.hasDetectedHands = false;
    this.detectLoop();
    return true;
  }

  private detectLoop = (): void => {
    if (!this.isRunning || !this.detector || !this.video || !this.canvas) return;

    if (this.video.readyState < 2 || this.video.videoWidth === 0) {
      this.rafId = requestAnimationFrame(this.detectLoop);
      return;
    }

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    let w: number;
    let h: number;
    if (this.scaleHandsToViewport && this.container) {
      w = Math.max(1, this.container.clientWidth);
      h = Math.max(1, this.container.clientHeight);
    } else {
      w = vw;
      h = vh;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const sx = this.scaleHandsToViewport ? w / vw : 1;
    const sy = this.scaleHandsToViewport ? h / vh : 1;

    this.detector
      .estimateHands(this.video, { flipHorizontal: this.flipHorizontal, staticImageMode: false })
      .then((hands) => {
        const ctx = this.canvas!.getContext('2d');
        if (!ctx) return;

        if (this.drawVideo) {
          ctx.drawImage(this.video!, 0, 0);
        } else {
          ctx.clearRect(0, 0, w, h);
        }
        let hasAny = false;

        for (const hand of hands) {
          const kps = hand.keypoints ?? [];
          if (kps.length === 0) continue;

          const byName = new Map<string, { x: number; y: number }>();
          for (const k of kps) {
            const name = (k.name ?? '').replace(/-/g, '_').toLowerCase();
            if (name && typeof k.x === 'number' && typeof k.y === 'number') {
              byName.set(name, { x: k.x, y: k.y });
            }
          }
          if (byName.size === 0) continue;
          hasAny = true;

          ctx.strokeStyle = hand.handedness === 'Left' ? '#0af' : '#fa0';
          ctx.lineWidth = 2;
          for (const [a, b] of MEDIAPIPE_BONE_CONNECTIONS) {
            const pa = byName.get(a);
            const pb = byName.get(b);
            if (pa && pb) {
              ctx.beginPath();
              ctx.moveTo(pa.x * sx, pa.y * sy);
              ctx.lineTo(pb.x * sx, pb.y * sy);
              ctx.stroke();
            }
          }

          ctx.fillStyle = hand.handedness === 'Left' ? '#0af' : '#fa0';
          for (const [, p] of byName) {
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (hasAny && !this.hasDetectedHands) {
          this.hasDetectedHands = true;
          this.callbacks.onStatusChange?.(true);
        } else if (!hasAny && this.hasDetectedHands) {
          this.hasDetectedHands = false;
          this.callbacks.onStatusChange?.(false);
        }
      })
      .catch(() => {});

    this.rafId = requestAnimationFrame(this.detectLoop);
  };

  stop(): void {
    this.isRunning = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  cleanup(): void {
    this.stop();
    this.detector?.dispose?.();
    this.detector = null;
    this.container = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.callbacks.onStatusChange?.(false);
  }
}
