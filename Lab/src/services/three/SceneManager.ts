import * as THREE from 'three';
import { HandTrackingManager } from './HandTrackingManager';

export interface SceneManagerCallbacks {
  onCubeColorChange?: (color: number) => void;
  onCubeRotationChange?: (rotation: { x: number; y: number }) => void;
  onHandTrackingStatusChange?: (isActive: boolean) => void;
  onHandTrackingError?: (message: string) => void;
  enableHandTracking?: boolean;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private object: THREE.Object3D | null = null;
  private raycaster: THREE.Raycaster | null = null;
  private controller: THREE.XRTargetRaySpace | null = null;
  private resizeHandler: (() => void) | null = null;
  private container: HTMLElement | null = null;
  private session: XRSession | null = null;
  private handTrackingManager: HandTrackingManager | null = null;

  private targetOffset = new THREE.Vector3(0, 0, -2);
  private smoothedPosition = new THREE.Vector3(0, 0, -2);
  private cubeRotation = { x: 0, y: 0 };
  private cubeColor = 0x2dd36f;
  private lastCalculatedPosition = new THREE.Vector3(0, 0, -2);

  private callbacks: SceneManagerCallbacks;

  constructor(callbacks: SceneManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  init(
    session: XRSession,
    container: HTMLElement,
    customModel: THREE.Group | null,
    initialTargetOffset: THREE.Vector3
  ): void {
    this.container = container;
    this.session = session;
    this.targetOffset.copy(initialTargetOffset);
    this.smoothedPosition.copy(initialTargetOffset);
    this.lastCalculatedPosition.copy(initialTargetOffset);

    this.cubeRotation = { x: 0, y: 0 };
    this.cubeColor = 0x2dd36f;
    this.callbacks.onCubeColorChange?.(this.cubeColor);
    this.callbacks.onCubeRotationChange?.(this.cubeRotation);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.xr.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.01,
      2000
    );

    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(light);

    let object3D: THREE.Object3D;

    if (customModel) {
      object3D = customModel.clone();
      object3D.position.copy(this.targetOffset);
    } else {
      const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const material = new THREE.MeshStandardMaterial({ color: this.cubeColor });
      object3D = new THREE.Mesh(geometry, material);
      object3D.position.copy(this.targetOffset);
    }

    this.smoothedPosition.copy(this.targetOffset);
    scene.add(object3D);

    const raycaster = new THREE.Raycaster();
    this.raycaster = raycaster;

    const controller = renderer.xr.getController(0);
    const handleSelect = () => {
      if (!this.object || !this.raycaster) return;

      const obj = this.object;
      const raycaster = this.raycaster;

      const position = new THREE.Vector3();
      const direction = new THREE.Vector3();
      position.setFromMatrixPosition(controller.matrixWorld);
      direction.set(0, 0, -1).applyMatrix4(controller.matrixWorld).sub(position).normalize();

      raycaster.set(position, direction);

      const intersections =
        obj instanceof THREE.Group
          ? raycaster.intersectObjects(obj.children, true)
          : raycaster.intersectObject(obj);

      if (intersections.length > 0) {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          const newColor = Math.random() * 0xffffff;
          this.cubeColor = newColor;
          this.callbacks.onCubeColorChange?.(newColor);
          obj.material.color.setHex(newColor);
        }

        this.cubeRotation = {
          x: this.cubeRotation.x + Math.PI / 4,
          y: this.cubeRotation.y + Math.PI / 4,
        };
        this.callbacks.onCubeRotationChange?.(this.cubeRotation);
      }
    };

    controller.addEventListener('selectstart', handleSelect);
    this.controller = controller;
    scene.add(controller);

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.object = object3D;
    this.resizeHandler = handleResize;

    this.smoothedPosition.copy(this.targetOffset);

    renderer.xr.setSession(session);

    if (this.callbacks.enableHandTracking !== false) {
      this.handTrackingManager = new HandTrackingManager(scene, camera, {
        onStatusChange: (isActive) =>
          this.callbacks.onHandTrackingStatusChange?.(isActive),
        onError: (msg) => this.callbacks.onHandTrackingError?.(msg),
      });
      void this.handTrackingManager.start(container);
    }

    renderer.setAnimationLoop((time: number) => {
      if (this.object && this.camera) {
        const cube = this.object;

        const smoothingFactor = 0.05;
        const distanceToTarget = this.smoothedPosition.distanceTo(this.targetOffset);

        if (distanceToTarget > 0.1) {
          this.smoothedPosition.lerp(this.targetOffset, smoothingFactor);
        } else {
          this.smoothedPosition.lerp(this.targetOffset, 0.3);
        }

        cube.position.copy(this.smoothedPosition);

        cube.rotation.x = this.cubeRotation.x + time * 0.0005;
        cube.rotation.y = this.cubeRotation.y + time * 0.001;

        if (cube instanceof THREE.Mesh && cube.material instanceof THREE.MeshStandardMaterial) {
          const material = cube.material;
          if (material.color.getHex() !== this.cubeColor) {
            material.color.setHex(this.cubeColor);
          }
        }
      }
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    });
  }

  updatePosition(position: THREE.Vector3): void {
    const positionChange = this.lastCalculatedPosition.distanceTo(position);
    const minChangeThreshold = 0.5;

    const isInitialPosition =
      this.lastCalculatedPosition.z === -2 &&
      this.lastCalculatedPosition.x === 0 &&
      this.lastCalculatedPosition.y === 0;

    if (positionChange > minChangeThreshold || isInitialPosition) {
      this.targetOffset.copy(position);
      this.lastCalculatedPosition.copy(position);
    }
  }

  cleanup(): void {
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    if (this.renderer && this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }

    if (this.object) {
      const obj = this.object;
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      } else {
        obj.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    }

    this.raycaster = null;
    this.controller = null;

    if (this.handTrackingManager) {
      this.handTrackingManager.cleanup();
      this.handTrackingManager = null;
    }

    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.object = null;
    this.resizeHandler = null;
    this.container = null;
    this.session = null;
  }
}
