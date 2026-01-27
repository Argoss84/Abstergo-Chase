import * as THREE from 'three';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import { HandVisualization } from './HandVisualization';
import type { HandData, HandJoint } from '../../types/handTracking';

export interface HandTrackingCallbacks {
  onStatusChange?: (isActive: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * Hand tracking via MediaPipe + TensorFlow.js (hand-pose-detection).
 * En AR, la caméra arrière est souvent utilisée par WebXR : on tente d’abord
 * "environment", puis en repli "user" (frontale) pour la détection.
 * @see https://blog.tensorflow.org/2021/11/3D-handpose.html
 */
export class HandTrackingManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private handVisualization: HandVisualization;
  private callbacks: HandTrackingCallbacks;
  private detector: handPoseDetection.HandDetector | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private isRunning = false;
  private hasDetectedHands = false;
  private detectLoopErrorCount = 0;

  /** Distance de la main devant la caméra (espace caméra, -Z = devant) */
  private readonly handBaseZ = -1.2;
  private readonly scale = 1.0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    callbacks: HandTrackingCallbacks = {}
  ) {
    this.scene = scene;
    this.camera = camera;
    this.callbacks = callbacks;
    this.handVisualization = new HandVisualization(scene, camera);
  }

  async start(container: HTMLElement): Promise<boolean> {
    if (this.isRunning) return true;

    try {
      console.log('[HandTracking] Chargement MediaPipe…');
      this.detector = await handPoseDetection.createDetector(
        handPoseDetection.SupportedModels.MediaPipeHands,
        {
          runtime: 'mediapipe',
          modelType: 'full',
          maxHands: 2,
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
        }
      );
      console.log('[HandTracking] MediaPipe OK');
    } catch (err) {
      const msg = `Hand tracking: échec chargement MediaPipe. ${err instanceof Error ? err.message : String(err)}`;
      console.error('[HandTracking]', msg);
      this.callbacks.onError?.(msg);
      return false;
    }

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('playsinline', 'true');
    this.video.style.cssText =
      'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;';
    container.appendChild(this.video);

    try {
      console.log('[HandTracking] Accès caméra (environment, arrière)…');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      });
      console.log('[HandTracking] Caméra arrière OK');
    } catch {
      try {
        console.log('[HandTracking] Caméra arrière indisponible, essai caméra frontale (user)…');
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 },
        });
        console.log('[HandTracking] Caméra frontale OK');
      } catch (e2) {
        const msg =
          'Hand tracking: caméra indisponible (souvent utilisée par la réalité augmentée). Essayez de présenter la main devant la caméra frontale.';
        console.warn('[HandTracking]', msg, e2);
        this.callbacks.onError?.(msg);
        this.cleanup();
        return false;
      }
    }

    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (e) {
      const msg = `Hand tracking: la vidéo ne démarre pas. ${e instanceof Error ? e.message : String(e)}`;
      console.warn('[HandTracking]', msg);
      this.callbacks.onError?.(msg);
      this.cleanup();
      return false;
    }

    this.isRunning = true;
    this.detectLoopErrorCount = 0;
    this.detectLoop();
    console.log('[HandTracking] Boucle de détection démarrée');
    return true;
  }

  private detectLoop = (): void => {
    if (!this.isRunning || !this.detector || !this.video) return;

    if (this.video.readyState < 2 || this.video.videoWidth === 0) {
      this.rafId = requestAnimationFrame(this.detectLoop);
      return;
    }

    this.detector
      .estimateHands(this.video, { flipHorizontal: false, staticImageMode: false })
      .then((hands) => {
        let leftHand: HandData | null = null;
        let rightHand: HandData | null = null;

        for (const h of hands) {
          const kp3 = h.keypoints3D ?? h.keypoints;
          if (!kp3 || kp3.length === 0) continue;

          const handedness = h.handedness === 'Left' ? 'left' : 'right';
          const baseX = handedness === 'left' ? -0.2 : 0.2;

          const joints = new Map<string, HandJoint>();
          for (let i = 0; i < kp3.length; i++) {
            const k = kp3[i];
            const name = (k.name ?? `keypoint_${i}`).replace(/-/g, '_').toLowerCase();
            const x = typeof k.x === 'number' ? k.x : 0;
            const y = typeof k.y === 'number' ? k.y : 0;
            const z = typeof k.z === 'number' ? k.z : 0;
            // Coordonnées locales au groupe main (MediaPipe 3D en mètres)
            const px = this.scale * x;
            const py = this.scale * z;
            const pz = this.scale * -y;
            joints.set(name, { position: { x: px, y: py, z: pz }, radius: 0.015 });
          }

          const handData: HandData = {
            joints,
            handedness,
            groupPosition: { x: baseX, y: 0, z: this.handBaseZ },
          };
          if (handedness === 'left') leftHand = handData;
          else rightHand = handData;
        }

        const hasHands = !!(leftHand?.joints.size || rightHand?.joints.size);
        this.handVisualization.updateHands(leftHand, rightHand);

        if (hasHands && !this.hasDetectedHands) {
          this.hasDetectedHands = true;
          this.callbacks.onStatusChange?.(true);
        } else if (!hasHands && this.hasDetectedHands) {
          this.hasDetectedHands = false;
          this.callbacks.onStatusChange?.(false);
        }
      })
      .catch((e) => {
        this.detectLoopErrorCount += 1;
        if (this.detectLoopErrorCount <= 5) {
          console.warn('[HandTracking] detectLoop:', e);
        }
      });

    this.rafId = requestAnimationFrame(this.detectLoop);
  };

  stop(): void {
    this.isRunning = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.handVisualization.cleanup();
  }

  cleanup(): void {
    this.stop();
    this.detector?.dispose?.();
    this.detector = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    this.callbacks.onStatusChange?.(false);
  }
}
