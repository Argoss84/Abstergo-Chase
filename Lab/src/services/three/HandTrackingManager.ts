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
      // Check if hand-tracking feature is enabled in the session
      const hasHandTracking = this.session.enabledFeatures?.includes('hand-tracking') ?? false;
      console.log('=== Hand Tracking Debug ===');
      console.log('Session enabled features:', this.session.enabledFeatures);
      console.log('Hand tracking enabled:', hasHandTracking);
      
      if (!hasHandTracking) {
        console.warn('⚠️ Hand tracking not enabled in session. Make sure "hand-tracking" is in optionalFeatures.');
        console.warn('This may be normal on some Samsung devices - continuing anyway...');
      }

      // On Samsung devices, wait longer for input sources to be available
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Request local reference space (better for AR than viewer)
      // Local space is relative to the initial position, which works better for AR
      try {
        this.referenceSpace = await this.session.requestReferenceSpace('local');
        console.log('✓ Using local reference space for hand tracking');
      } catch (error) {
        console.warn('Could not get local reference space:', error);
        // Try viewer space as fallback
        try {
          this.referenceSpace = await this.session.requestReferenceSpace('viewer');
          console.log('✓ Using viewer reference space for hand tracking');
        } catch (e) {
          console.warn('Could not get viewer reference space:', e);
          return false;
        }
      }

      // Listen for input source changes (important on Samsung devices)
      this.session.addEventListener('inputsourceschange', (event) => {
        console.log('Input sources changed:', {
          added: event.added.length,
          removed: event.removed.length,
          total: this.session.inputSources.length
        });
        
        // Check for hand input sources
        for (let i = 0; i < event.added.length; i++) {
          const source = event.added[i];
          if (source.hand) {
            console.log('🎉 Hand input source added!', source.handedness);
          }
        }
      });

      // Check if we have any hand input sources available
      let hasHandInputSources = false;
      for (let i = 0; i < this.session.inputSources.length; i++) {
        if (this.session.inputSources[i]?.hand !== undefined) {
          hasHandInputSources = true;
          console.log('✓ Found hand input source:', this.session.inputSources[i].handedness);
          break;
        }
      }
      console.log('Initial hand input sources:', hasHandInputSources, 'Total input sources:', this.session.inputSources.length);

      // Start checking for hands - they may not be available immediately on Samsung devices
      this.isActive = true;
      this.updateHands();
      return true;
    } catch (error) {
      console.error('❌ Hand tracking initialization error:', error);
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

      // On mobile, input sources may be added dynamically
      // Listen for input source changes
      if (this.session.inputSources.length === 0 && !this.hasDetectedHands) {
        // Keep checking - hands may appear later on mobile
        this.updateHands();
        return;
      }

      for (let i = 0; i < inputSources.length; i++) {
        const inputSource = inputSources[i];
        if (inputSource?.hand) {
          hasHands = true;
          const hand = inputSource.hand;
          const handedness = inputSource.handedness;
          const joints = new Map();
          
          console.debug(`Processing ${handedness} hand with ${hand.size} joints`);

          for (const [jointName, joint] of hand.entries()) {
            try {
              if (frame.getJointPose && this.referenceSpace) {
                const jointPose = frame.getJointPose(joint, this.referenceSpace);
                if (jointPose) {
                  // Transform the joint position using the transform matrix
                  const transform = jointPose.transform;
                  const position = {
                    x: transform.position.x,
                    y: transform.position.y,
                    z: transform.position.z,
                  };
                  
                  // Log first joint position for debugging (wrist)
                  if (jointName === 'wrist' && joints.size === 0) {
                    console.log(`${handedness} wrist position:`, position, 'radius:', jointPose.radius);
                  }
                  
                  joints.set(jointName, {
                    position,
                    radius: Math.max(jointPose.radius || 0.01, 0.015), // Minimum 1.5cm for visibility
                  });
                } else {
                  // Joint pose not available - this is normal for some joints
                  if (jointName === 'wrist') {
                    console.warn(`⚠️ ${handedness} wrist pose not available`);
                  }
                }
              } else {
                if (jointName === 'wrist') {
                  console.warn(`⚠️ Cannot get ${handedness} wrist pose:`, {
                    hasGetJointPose: !!frame.getJointPose,
                    hasReferenceSpace: !!this.referenceSpace
                  });
                }
              }
            } catch (error) {
              // Joint might not be available, skip it
              if (jointName === 'wrist') {
                console.error(`❌ Error getting ${handedness} wrist:`, error);
              }
            }
          }
          
          // Log if we got joints
          if (joints.size === 0) {
            console.warn(`⚠️ No joints detected for ${handedness} hand (hand.size = ${hand.size})`);
          } else {
            console.debug(`✓ ${handedness} hand: ${joints.size} joints detected`);
          }

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
        // Only update if we have joints data
        const leftHasJoints = leftHand && leftHand.joints.size > 0;
        const rightHasJoints = rightHand && rightHand.joints.size > 0;
        
        if (leftHasJoints || rightHasJoints) {
          this.handVisualization.updateHands(leftHand, rightHand);
          if (!this.hasDetectedHands) {
            this.hasDetectedHands = true;
            console.log('🎉 Hands detected!', { 
              leftHand: !!leftHand && leftHand.joints.size > 0, 
              rightHand: !!rightHand && rightHand.joints.size > 0,
              leftJoints: leftHand?.joints.size || 0,
              rightJoints: rightHand?.joints.size || 0
            });
            this.onStatusChange?.(true);
          }
        }
      } else if (this.hasDetectedHands) {
        // Hands were lost
        this.hasDetectedHands = false;
        console.log('Hands lost');
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
