import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const modelAssets = import.meta.glob('../objects/*.{glb,gltf}', {
  eager: false,
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export const useModelLoader = () => {
  const [customModel, setCustomModel] = useState<THREE.Group | null>(null);
  const [modelFileName, setModelFileName] = useState<string>('');
  const [modelLoadError, setModelLoadError] = useState<string>('');
  const loaderRef = useRef<GLTFLoader | null>(null);

  const loadModelFromObjects = useCallback((modelPath: string) => {
    if (!loaderRef.current) {
      loaderRef.current = new GLTFLoader();
    }

    const loader = loaderRef.current;
    setModelLoadError('');

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene.clone();

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        model.position.sub(center);

        const maxSize = 2;
        const maxDimension = Math.max(size.x, size.y, size.z);
        if (maxDimension > maxSize) {
          const scale = maxSize / maxDimension;
          model.scale.set(scale, scale, scale);
        }

        setCustomModel(model);
        const fileName = modelPath.split('/').pop() || modelPath;
        setModelFileName(fileName);
        setModelLoadError('');
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total) * 100;
          setModelLoadError(`Chargement... ${percent.toFixed(0)}%`);
        }
      },
      (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Format non supporté';
        setModelLoadError(`Erreur de chargement: ${errorMessage}`);
      }
    );
  }, []);

  useEffect(() => {
    const tryLoadModel = async () => {
      const modelPaths = Object.keys(modelAssets);

      const priorityOrder = (path: string) => {
        if (path.includes('model.glb')) return 1;
        if (path.includes('model.gltf')) return 2;
        if (path.includes('default.glb')) return 3;
        if (path.includes('default.gltf')) return 4;
        return 5;
      };

      const sortedPaths = modelPaths.sort((a, b) => priorityOrder(a) - priorityOrder(b));

      for (const path of sortedPaths) {
        try {
          const getUrl = modelAssets[path];
          if (getUrl) {
            const url = await getUrl();
            loadModelFromObjects(url);
            return;
          }
        } catch (error) {
          continue;
        }
      }
      setModelLoadError('');
    };

    tryLoadModel();
  }, [loadModelFromObjects]);

  return {
    customModel,
    modelFileName,
    modelLoadError,
  };
};
