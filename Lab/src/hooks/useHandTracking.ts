import { useEffect, useState } from 'react';

export interface HandJoint {
  position: { x: number; y: number; z: number };
  radius: number;
}

export interface HandData {
  joints: Map<XRHandJoint, HandJoint>;
  handedness: XRHandedness;
}

export interface HandTrackingState {
  leftHand: HandData | null;
  rightHand: HandData | null;
  isSupported: boolean | null;
  isActive: boolean;
}

export const useHandTracking = (session: XRSession | null) => {
  const [handTrackingState, setHandTrackingState] = useState<HandTrackingState>({
    leftHand: null,
    rightHand: null,
    isSupported: null,
    isActive: false,
  });

  useEffect(() => {
    if (!session) {
      setHandTrackingState({
        leftHand: null,
        rightHand: null,
        isSupported: false,
        isActive: false,
      });
      return;
    }

    const checkSupport = () => {
      // Check if hand tracking is supported by checking if the session was created with hand-tracking feature
      const hasHandTrackingFeature = session.enabledFeatures?.includes('hand-tracking') ?? false;
      // Check if any input sources have hand property (convert XRInputSourceArray to array)
      let hasHandInputSources = false;
      for (let i = 0; i < session.inputSources.length; i++) {
        if (session.inputSources[i]?.hand !== undefined) {
          hasHandInputSources = true;
          break;
        }
      }
      const isSupported = hasHandTrackingFeature || hasHandInputSources;
      
      setHandTrackingState((prev) => ({
        ...prev,
        isSupported,
      }));
    };

    checkSupport();

    const updateHands = (frame: XRFrame) => {
      const hands: HandTrackingState = {
        leftHand: null,
        rightHand: null,
        isSupported: handTrackingState.isSupported,
        isActive: false,
      };

      if (frame.session && 'requestAnimationFrame' in frame.session) {
        const inputSources = frame.session.inputSources;
        
        for (let i = 0; i < inputSources.length; i++) {
          const inputSource = inputSources[i];
          if (inputSource?.hand) {
            const hand = inputSource.hand;
            const handedness = inputSource.handedness;
            const joints = new Map<XRHandJoint, HandJoint>();

            for (const [jointName, joint] of hand.entries()) {
              try {
                if (frame.getJointPose) {
                  // Use the session's reference space for joint poses
                  // viewerSpace may not be in TypeScript types but exists at runtime
                  const referenceSpace = (frame.session as any).viewerSpace;
                  if (referenceSpace) {
                    const jointPose = frame.getJointPose(joint, referenceSpace);
                    if (jointPose) {
                      joints.set(jointName, {
                        position: {
                          x: jointPose.transform.position.x,
                          y: jointPose.transform.position.y,
                          z: jointPose.transform.position.z,
                        },
                        radius: jointPose.radius || 0.01,
                      });
                    }
                  }
                }
              } catch (error) {
                // Joint might not be available, skip it
              }
            }

            const handData: HandData = {
              joints,
              handedness,
            };

            if (handedness === 'left') {
              hands.leftHand = handData;
            } else if (handedness === 'right') {
              hands.rightHand = handData;
            }

            hands.isActive = true;
          }
        }
      }

      setHandTrackingState(hands);
    };

    const animationFrame = (time: number, frame: XRFrame) => {
      if (frame) {
        updateHands(frame);
      }
    };

    session.requestAnimationFrame(animationFrame);

    return () => {
      setHandTrackingState({
        leftHand: null,
        rightHand: null,
        isSupported: handTrackingState.isSupported,
        isActive: false,
      });
    };
  }, [session]);

  return handTrackingState;
};
