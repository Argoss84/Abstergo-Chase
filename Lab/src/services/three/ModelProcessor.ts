import * as THREE from 'three';

export const processModel = (model: THREE.Group, maxSize: number = 2): THREE.Group => {
  const processedModel = model.clone();

  const box = new THREE.Box3().setFromObject(processedModel);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  processedModel.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > maxSize) {
    const scale = maxSize / maxDimension;
    processedModel.scale.set(scale, scale, scale);
  }

  return processedModel;
};
