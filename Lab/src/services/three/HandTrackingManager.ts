import * as THREE from 'three';
import { HandVisualization } from './HandVisualization';
import type { HandData } from '../../hooks/useHandTracking';

export class HandTrackingManager {
  private session: XRSession;
  private scene: THREE.Scene;
  private handVisualization: HandVisualization;
  private animationFrameId: number | null = null;
  private isActive = false;
  private referenceSpace: XRReferenceSpace | null = null;
  private hasDetectedHands = false;
  private onStatusChange?: (isActive: boolean) => void;

  constructor(session: XRSession, scene: THREE.Scene, onStatusChange?: (isActive: boolean) => void) {
    this.session = session;
    this.scene = scene;
    this.handVisualization = new HandVisualization(scene);
    this.onStatusChange = onStatusChange;
  }

  async start(): Promise<boolean> {
    try {
      // Request local reference space (better for AR than viewer)
      // Local space is relative to the initial position, which works better for AR
      try {
        this.referenceSpace = await this.session.requestReferenceSpace('local');
        console.log('Using local reference space for hand tracking');
      } catch (error) {
        console.warn('Could not get local reference space:', error);
        // Try viewer space as fallback
        try {
          this.referenceSpace = await this.session.requestReferenceSpace('viewer');
          console.log('Using viewer reference space for hand tracking');
        } catch (e) {
          console.warn('Could not get viewer reference space:', e);
          return false;
        }
      }

      // Start checking for hands - they may not be available immediately
      this.isActive = true;
      this.updateHands();
      return true;
    } catch (error) {
      console.warn('Hand tracking initialization error:', error);
      return false;
    }
  }

  private updateHands(): void {
    if (!this.isActive) return;

    this.session.requestAnimationFrame((time: number, frame: XRFrame) => {
      if (!frame || !this.isActive) {
        this.updateHands();
        return;
      }

      let leftHand: HandData | null = null;
      let rightHand: HandData | null = null;
      let hasHands = false;

      const inputSources = this.session.inputSources;

      for (let i = 0; i < inputSources.length; i++) {
        const inputSource = inputSources[i];
        if (inputSource?.hand) {
          hasHands = true;
          const hand = inputSource.hand;
          const handedness = inputSource.handedness;
          const joints = new Map();
          
          console.debug(`Processing ${handedness} hand with ${hand.size} joints`);

          console.debug(`Processing ${handedness} hand with ${hand.size} joints`);

          const handData: HandData = {
            joints,
            handedness,
          };

          if (handedness === 'left') {
            leftHand = handData;
          } else if (handedness === 'right') {
            rightHand = handData;
          }
        }
      }

      // Update visualization if we have hands or clear if we don't
      if (hasHands || leftHand || rightHand) {
        this.handVisualization.updateHands(leftHand, rightHand);
        if (!this.hasDetectedHands) {
          this.hasDetectedHands = true;
          console.log('Hands detected!', { leftHand: !!leftHand, rightHand: !!rightHand });
          this.onStatusChange?.(true);
        }
      } else if (this.hasDetectedHands) {
        // Hands were lost
        this.hasDetectedHands = false;
        this.onStatusChange?.(false);
      }

      this.updateHands();
    });
  }

  stop(): void {
    this.isActive = false;
    this.handVisualization.cleanup();
  }

  cleanup(): void {
    this.stop();
  }
}
