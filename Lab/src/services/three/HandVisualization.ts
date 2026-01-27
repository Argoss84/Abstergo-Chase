import * as THREE from 'three';
import type { HandData, HandJoint } from '../../types/handTracking';
import { MEDIAPIPE_BONE_CONNECTIONS } from '../../types/handTracking';

/**
 * Visualisation 3D des mains (sphères aux articulations, lignes pour les os).
 * Les groupes sont attachés à la caméra pour rester devant l’utilisateur en AR.
 */
export class HandVisualization {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private leftHandGroup: THREE.Group | null = null;
  private rightHandGroup: THREE.Group | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  private createJointMesh(radius: number): THREE.Mesh {
    const r = Math.max(radius, 0.02);
    const geometry = new THREE.SphereGeometry(r, 12, 12);
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
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.Line(geometry, material);
  }

  private removeFromParent(group: THREE.Group): void {
    if (group.parent) group.parent.remove(group);
  }

  private updateHandGroup(
    handData: HandData | null,
    handGroup: THREE.Group | null,
    handedness: 'left' | 'right'
  ): THREE.Group | null {
    if (!handData) {
      if (handGroup) {
        this.removeFromParent(handGroup);
        this.disposeGroup(handGroup);
      }
      return null;
    }

    let group = handGroup;
    if (!group) {
      group = new THREE.Group();
      group.name = `${handedness}Hand`;
      this.camera.add(group);
    }

    const { x, y, z } = handData.groupPosition;
    group.position.set(x, y, z);

    group.clear();
    const jointPositions = new Map<string, THREE.Vector3>();

    handData.joints.forEach((joint: HandJoint, name: string) => {
      const pos = new THREE.Vector3(
        joint.position.x,
        joint.position.y,
        joint.position.z
      );
      jointPositions.set(name, pos);
      const mesh = this.createJointMesh(joint.radius);
      mesh.position.copy(pos);
      mesh.name = `${handedness}-${name}`;
      group!.add(mesh);
    });

    MEDIAPIPE_BONE_CONNECTIONS.forEach(([a, b]) => {
      const start = jointPositions.get(a);
      const end = jointPositions.get(b);
      if (start && end) {
        const line = this.createBoneLine(start, end);
        line.name = `${handedness}-${a}-${b}`;
        group!.add(line);
      }
    });

    return group;
  }

  updateHands(leftHand: HandData | null, rightHand: HandData | null): void {
    this.leftHandGroup = this.updateHandGroup(
      leftHand,
      this.leftHandGroup,
      'left'
    );
    this.rightHandGroup = this.updateHandGroup(
      rightHand,
      this.rightHandGroup,
      'right'
    );
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

  cleanup(): void {
    if (this.leftHandGroup) {
      this.removeFromParent(this.leftHandGroup);
      this.disposeGroup(this.leftHandGroup);
      this.leftHandGroup = null;
    }
    if (this.rightHandGroup) {
      this.removeFromParent(this.rightHandGroup);
      this.disposeGroup(this.rightHandGroup);
      this.rightHandGroup = null;
    }
  }
}
