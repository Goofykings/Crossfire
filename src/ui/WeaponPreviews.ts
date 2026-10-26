import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, LoadAssetContainerAsync, Scene, Vector3 } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { RIG_CONFIGS } from '../weapons/WeaponView';
import type { WeaponId } from '../weapons/Weapon';

/** Render the existing assets once, then release the preview GPU resources. */
export async function weaponPreviews(onPreview: (id: WeaponId, url: string) => void): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 460;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 0);
  const camera = new ArcRotateCamera('preview-camera', 0.22, 1.28, 2, Vector3.Zero(), scene);
  camera.fov = 0.55;
  camera.minZ = 0.01;
  const fill = new HemisphericLight('preview-fill', new Vector3(0, 1, 0), scene);
  fill.intensity = 1.7;
  fill.groundColor = new Color3(0.45, 0.5, 0.6);
  const key = new DirectionalLight('preview-key', new Vector3(-1, -2, -1), scene);
  key.intensity = 2;
  const materials = new MaterialLibrary(scene);
  try {
    await materials.load();
    for (const cfg of Object.values(RIG_CONFIGS)) {
      const container = await LoadAssetContainerAsync(assetUrl(cfg.file), scene);
      container.addAllToScene();
      for (const mesh of container.meshes) {
        if (mesh.material) mesh.material = materials.get(mesh.material.name);
        mesh.computeWorldMatrix(true);
      }
      const bounds = container.rootNodes[0].getHierarchyBoundingVectors(true);
      const size = bounds.max.subtract(bounds.min);
      camera.setTarget(bounds.min.add(bounds.max).scale(0.5));
      camera.radius = Math.max(size.y, size.z / engine.getAspectRatio(camera), size.x / engine.getAspectRatio(camera)) / (2 * Math.tan(camera.fov / 2)) * 1.6;
      await scene.whenReadyAsync();
      scene.render();
      onPreview(cfg.id, canvas.toDataURL('image/png'));
      container.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
}
