import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { BLAZEPOSE_BONE_CONNECTIONS } from '../types/bodyTracking';
import { MEDIAPIPE_BONE_CONNECTIONS } from '../types/handTracking';

export interface BodyKeypoint {
  name: string;
  x: number;
  y: number;
  score?: number;
}

export interface FullBodyTracking2DCallbacks {
  onStatusChange?: (isActive: boolean) => void;
  onError?: (message: string) => void;
  /** Called when video is ready (after play), e.g. for AR texture. */
  onVideoReady?: (video: HTMLVideoElement) => void;
  /** All body keypoints in viewport coords (name, x, y). */
  onKeypoints?: (keypoints: BodyKeypoint[]) => void;
  /** Index-finger–like points for raycast: [left_index, right_index] in viewport coords (backward compat). */
  onFingerTips?: (tips: Array<{ x: number; y: number }>) => void;
}

export interface FullBodyTracking2DOptions extends FullBodyTracking2DCallbacks {
  /** Draw video on canvas (false = transparent for AR overlay). Default: true. */
  drawVideo?: boolean;
  /** Scale canvas to viewport and scale pose to viewport. Default: false. */
  scalePoseToViewport?: boolean;
}

/**
 * Full-body pose detection in 2D: getUserMedia + MediaPipe BlazePose,
 * draws keypoints and skeleton on canvas. No WebXR nor Three.js.
 */
export class FullBodyTracking2D {
  private callbacks: FullBodyTracking2DCallbacks;
  private drawVideo: boolean;
  private scalePoseToViewport: boolean;
  private detector: poseDetection.PoseDetector | null = null;
  private handDetector: handPoseDetection.HandDetector | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private isRunning = false;
  private hasDetectedPose = false;
  private flipHorizontal = false;

  constructor(callbacks: FullBodyTracking2DOptions = {}) {
    this.callbacks = callbacks;
    this.drawVideo = callbacks.drawVideo !== false;
    this.scalePoseToViewport = callbacks.scalePoseToViewport === true;
  }

  async start(
    container: HTMLElement,
    deviceId?: string,
    opts?: { videoContainer?: HTMLElement }
  ): Promise<boolean> {
    if (this.isRunning) return true;

    this.container = container;
    const videoParent = opts?.videoContainer ?? container;
    const showVideoAsLayer = !this.drawVideo && this.scalePoseToViewport && !!opts?.videoContainer;

    try {
      this.detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        {
          runtime: 'mediapipe',
          modelType: 'full',
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
        }
      );
    } catch (err) {
      const msg = `Full-body tracking: failed to load MediaPipe Pose. ${err instanceof Error ? err.message : String(err)}`;
      this.callbacks.onError?.(msg);
      return false;
    }

    try {
      this.handDetector = await handPoseDetection.createDetector(
        handPoseDetection.SupportedModels.MediaPipeHands,
        {
          runtime: 'mediapipe',
          modelType: 'full',
          maxHands: 2,
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
        }
      );
    } catch (err) {
      const msg = `Hand tracking: failed to load MediaPipe Hands. ${err instanceof Error ? err.message : String(err)}`;
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
      const msg = 'Full-body tracking: camera access denied or unavailable.';
      this.callbacks.onError?.(msg);
      this.cleanup();
      return false;
    }

    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (e) {
      const msg = `Full-body tracking: video failed to start. ${e instanceof Error ? e.message : String(e)}`;
      this.callbacks.onError?.(msg);
      this.cleanup();
      return false;
    }

    this.callbacks.onVideoReady?.(this.video);

    this.canvas = document.createElement('canvas');
    if (this.scalePoseToViewport) {
      this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none;';
    } else {
      this.canvas.style.cssText = 'max-width:100%; height:auto; display:block; background:#000;';
    }
    container.appendChild(this.canvas);

    this.isRunning = true;
    this.hasDetectedPose = false;
    this.detectLoop();
    return true;
  }

  private detectLoop = (): void => {
    if (!this.isRunning || !this.detector || !this.handDetector || !this.video || !this.canvas) return;

    if (this.video.readyState < 2 || this.video.videoWidth === 0) {
      this.rafId = requestAnimationFrame(this.detectLoop);
      return;
    }

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    let w: number;
    let h: number;
    if (this.scalePoseToViewport && this.container) {
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
    const sx = this.scalePoseToViewport ? w / vw : 1;
    const sy = this.scalePoseToViewport ? h / vh : 1;

    const video = this.video;
    const flipH = this.flipHorizontal;

    Promise.all([
      this.detector.estimatePoses(video, { flipHorizontal: flipH }),
      this.handDetector.estimateHands(video, { flipHorizontal: flipH, staticImageMode: false }),
    ])
      .then(([poses, hands]) => {
        const ctx = this.canvas!.getContext('2d');
        if (!ctx) return;

        if (this.drawVideo) {
          ctx.drawImage(this.video!, 0, 0);
        } else {
          ctx.clearRect(0, 0, w, h);
        }

        const keypointsScaled: BodyKeypoint[] = [];
        const fingerTips: Array<{ x: number; y: number }> = [];
        const minScoreFingerTips = 0.4;
        /** Seuil de confiance pour afficher points et os (évite les points intempestifs). */
        const minScoreDraw = 0.45;
        const minScoreHandDraw = 0.4;

        const pose = poses[0];
        if (pose?.keypoints) {
          const byName = new Map<string, { x: number; y: number; score?: number }>();
          for (const kp of pose.keypoints) {
            const name = (kp.name ?? '').replace(/-/g, '_').toLowerCase();
            if (name && typeof kp.x === 'number' && typeof kp.y === 'number') {
              const score = typeof kp.score === 'number' ? kp.score : 1;
              byName.set(name, { x: kp.x, y: kp.y, score });
              if (score >= minScoreDraw) {
                keypointsScaled.push({
                  name,
                  x: kp.x * sx,
                  y: kp.y * sy,
                  score: kp.score,
                });
              }
            }
          }

          if (hands.length === 0) {
            const leftIndex = byName.get('left_index');
            const rightIndex = byName.get('right_index');
            if (leftIndex && (leftIndex.score ?? 1) >= minScoreFingerTips) fingerTips.push({ x: leftIndex.x * sx, y: leftIndex.y * sy });
            if (rightIndex && (rightIndex.score ?? 1) >= minScoreFingerTips) fingerTips.push({ x: rightIndex.x * sx, y: rightIndex.y * sy });
          }

          ctx.strokeStyle = '#0af';
          ctx.lineWidth = 2;
          for (const [a, b] of BLAZEPOSE_BONE_CONNECTIONS) {
            const pa = byName.get(a);
            const pb = byName.get(b);
            if (pa && pb && (pa.score ?? 0) >= minScoreDraw && (pb.score ?? 0) >= minScoreDraw) {
              ctx.beginPath();
              ctx.moveTo(pa.x * sx, pa.y * sy);
              ctx.lineTo(pb.x * sx, pb.y * sy);
              ctx.stroke();
            }
          }

          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          for (const [name, p] of byName) {
            const score = p.score ?? 0;
            if (score < minScoreDraw) continue;
            const radius = score >= 0.5 ? 5 : score >= 0.2 ? 4 : 3;
            ctx.globalAlpha = 0.5 + Math.min(0.5, score);
            ctx.fillStyle = '#0af';
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(name.replace(/_/g, ' '), p.x * sx, p.y * sy + radius + 2);
            ctx.globalAlpha = 1;
          }
        }

        for (const hand of hands) {
          const kps = hand.keypoints ?? [];
          if (kps.length === 0) continue;

          const byName = new Map<string, { x: number; y: number; score?: number }>();
          for (const k of kps) {
            const name = (k.name ?? '').replace(/-/g, '_').toLowerCase();
            if (name && typeof k.x === 'number' && typeof k.y === 'number') {
              const score = typeof k.score === 'number' ? k.score : 1;
              byName.set(name, { x: k.x, y: k.y, score });
            }
          }
          const idxTip = byName.get('index_finger_tip');
          if (idxTip && (idxTip.score ?? 1) >= minScoreHandDraw) fingerTips.push({ x: idxTip.x * sx, y: idxTip.y * sy });

          ctx.strokeStyle = hand.handedness === 'Left' ? '#0af' : '#fa0';
          ctx.lineWidth = 2;
          for (const [a, b] of MEDIAPIPE_BONE_CONNECTIONS) {
            const pa = byName.get(a);
            const pb = byName.get(b);
            if (pa && pb && (pa.score ?? 1) >= minScoreHandDraw && (pb.score ?? 1) >= minScoreHandDraw) {
              ctx.beginPath();
              ctx.moveTo(pa.x * sx, pa.y * sy);
              ctx.lineTo(pb.x * sx, pb.y * sy);
              ctx.stroke();
            }
          }
          ctx.fillStyle = hand.handedness === 'Left' ? '#0af' : '#fa0';
          for (const [, p] of byName) {
            if ((p.score ?? 1) < minScoreHandDraw) continue;
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        const hasAny = keypointsScaled.length > 0 || hands.length > 0;
        if (hasAny && !this.hasDetectedPose) {
          this.hasDetectedPose = true;
          this.callbacks.onStatusChange?.(true);
        } else if (!hasAny && this.hasDetectedPose) {
          this.hasDetectedPose = false;
          this.callbacks.onStatusChange?.(false);
        }
        this.callbacks.onKeypoints?.(keypointsScaled);
        this.callbacks.onFingerTips?.(fingerTips);
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
    this.handDetector?.dispose?.();
    this.handDetector = null;
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
