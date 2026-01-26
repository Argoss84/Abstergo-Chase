import * as THREE from 'three';
import type { HandData, HandJoint } from '../../hooks/useHandTracking';

export class HandVisualization {
  private scene: THREE.Scene;
  private leftHandGroup: THREE.Group | null = null;
  private rightHandGroup: THREE.Group | null = null;
  private jointMeshes: Map<XRHandJoint, THREE.Mesh> = new Map();
  private boneLines: THREE.Line[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private createJointMesh(radius: number): THREE.Mesh {
    // Ensure minimum visible size (at least 2cm)
    const visibleRadius = Math.max(radius, 0.02);
    const geometry = new THREE.SphereGeometry(visibleRadius, 12, 12);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createBoneLine(start: THREE.Vector3, end: THREE.Vector3): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 3,
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.Line(geometry, material);
  }

  private updateHandGroup(
    handData: HandData | null,
    handGroup: THREE.Group | null,
    handedness: 'left' | 'right'
  ): THREE.Group | null {
    if (!handData) {
      if (handGroup) {
        this.scene.remove(handGroup);
        handGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
          if (child instanceof THREE.Line) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
      }
      return null;
    }

    let group = handGroup;
    if (!group) {
      group = new THREE.Group();
      group.name = `${handedness}Hand`;
      this.scene.add(group);
    }

    group.clear();

    const jointPositions = new Map<XRHandJoint, THREE.Vector3>();

    handData.joints.forEach((joint: HandJoint, jointName: XRHandJoint) => {
      const position = new THREE.Vector3(
        joint.position.x,
        joint.position.y,
        joint.position.z
      );
      jointPositions.set(jointName, position);

      const mesh = this.createJointMesh(joint.radius);
      mesh.position.copy(position);
      mesh.name = `${handedness}-${jointName}`;
      group.add(mesh);
      
      // Debug: log wrist position only once per hand update
      if (jointName === 'wrist' && !handGroup) {
        console.log(`${handedness} wrist at:`, position);
      }
    });

    this.createBoneConnections(group, jointPositions, handedness);

    return group;
  }

  private createBoneConnections(
    group: THREE.Group,
    jointPositions: Map<XRHandJoint, THREE.Vector3>,
    handedness: 'left' | 'right'
  ): void {
    const connections: Array<[XRHandJoint, XRHandJoint]> = [
      ['wrist', 'thumb-metacarpal'],
      ['thumb-metacarpal', 'thumb-phalanx-proximal'],
      ['thumb-phalanx-proximal', 'thumb-phalanx-distal'],
      ['thumb-phalanx-distal', 'thumb-tip'],
      ['wrist', 'index-finger-metacarpal'],
      ['index-finger-metacarpal', 'index-finger-phalanx-proximal'],
      ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate'],
      ['index-finger-phalanx-intermediate', 'index-finger-phalanx-distal'],
      ['index-finger-phalanx-distal', 'index-finger-tip'],
      ['wrist', 'middle-finger-metacarpal'],
      ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal'],
      ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate'],
      ['middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal'],
      ['middle-finger-phalanx-distal', 'middle-finger-tip'],
      ['wrist', 'ring-finger-metacarpal'],
      ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal'],
      ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate'],
      ['ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal'],
      ['ring-finger-phalanx-distal', 'ring-finger-tip'],
      ['wrist', 'pinky-finger-metacarpal'],
      ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal'],
      ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate'],
      ['pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal'],
      ['pinky-finger-phalanx-distal', 'pinky-finger-tip'],
    ];

    connections.forEach(([startJoint, endJoint]) => {
      const startPos = jointPositions.get(startJoint);
      const endPos = jointPositions.get(endJoint);

      if (startPos && endPos) {
        const line = this.createBoneLine(startPos, endPos);
        line.name = `${handedness}-${startJoint}-${endJoint}`;
        group.add(line);
      }
    });
  }

  updateHands(leftHand: HandData | null, rightHand: HandData | null): void {
    const hadLeft = !!this.leftHandGroup;
    const hadRight = !!this.rightHandGroup;
    
    this.leftHandGroup = this.updateHandGroup(leftHand, this.leftHandGroup, 'left');
    this.rightHandGroup = this.updateHandGroup(rightHand, this.rightHandGroup, 'right');
    
    const hasLeft = !!this.leftHandGroup;
    const hasRight = !!this.rightHandGroup;
    
    if (hasLeft && !hadLeft) {
      console.log('Left hand visualization added to scene');
    }
    if (hasRight && !hadRight) {
      console.log('Right hand visualization added to scene');
    }
    
    if (hasLeft || hasRight) {
      // Log joint positions for debugging
      if (leftHand && leftHand.joints.size > 0) {
        const wrist = leftHand.joints.get('wrist');
        if (wrist) {
          console.debug('Left wrist position:', wrist.position);
        }
      }
      if (rightHand && rightHand.joints.size > 0) {
        const wrist = rightHand.joints.get('wrist');
        if (wrist) {
          console.debug('Right wrist position:', wrist.position);
        }
      }
    }
  }

  cleanup(): void {
    if (this.leftHandGroup) {
      this.scene.remove(this.leftHandGroup);
      this.disposeGroup(this.leftHandGroup);
      this.leftHandGroup = null;
    }

    if (this.rightHandGroup) {
      this.scene.remove(this.rightHandGroup);
      this.disposeGroup(this.rightHandGroup);
      this.rightHandGroup = null;
    }

    this.jointMeshes.clear();
    this.boneLines.forEach((line) => {
      line.geometry.dispose();
      if (line.material instanceof THREE.Material) {
        line.material.dispose();
      }
    });
    this.boneLines = [];
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
