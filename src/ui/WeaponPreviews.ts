import { meshesReady } from '../core/assetReadiness';
import { abortable } from '../core/cancellation';
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { COSMETICS, type CosmeticDefinition } from '../../shared/cosmetics';
import { loadCosmeticAsset } from '../rendering/CosmeticAssets';
import { studioEnvironment } from '../rendering/StudioEnvironment';
import type { WeaponId } from '../weapons/Weapon';

const cached=new Map<string,string>();
export async function weaponPreviews(onPreview:(id:WeaponId,url:string)=>Promise<void>,signal?:AbortSignal):Promise<void>{
  return cosmeticThumbnails(COSMETICS.filter(c=>c.ownership==='starter'),(item,url)=>onPreview(item.weapon,url),signal);
}
/** Render actual owned assets; successful snapshots are shared with loadout cards. */
export async function cosmeticThumbnails(items:readonly CosmeticDefinition[],onPreview:(item:CosmeticDefinition,url:string)=>Promise<void>,signal?:AbortSignal): Promise<void> {
  for(const item of items)if(cached.has(item.id))await abortable(onPreview(item,cached.get(item.id)!),signal);
  const missing=items.filter(item=>!cached.has(item.id));if(!missing.length)return;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 460;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.imageProcessingConfiguration.exposure = 1.2;
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
    await Promise.all([materials.load(undefined, signal), studioEnvironment(scene, .9, signal)]);
    for (const item of missing) {
      const container = await loadCosmeticAsset(item,scene,materials,signal);
      container.addAllToScene();
      for (const mesh of container.meshes) {
        mesh.computeWorldMatrix(true);
      }
      const bounds = container.rootNodes[0].getHierarchyBoundingVectors(true);
      const size = bounds.max.subtract(bounds.min);
      camera.setTarget(bounds.min.add(bounds.max).scale(0.5));
      camera.radius = Math.max(size.y, size.z / engine.getAspectRatio(camera), size.x / engine.getAspectRatio(camera)) / (2 * Math.tan(camera.fov / 2)) * 1.3;
      await materials.ready(signal);
      await meshesReady(container.meshes, signal);
      // Per-mesh precompilation does not cover the first frame's scene state: the first capture
      // of a fresh engine came out empty (Default AR in the Locker). Let the scene confirm
      // readiness and render a warm-up frame before capturing.
      await abortable(scene.whenReadyAsync(), signal);
      signal?.throwIfAborted();
      scene.render();
      scene.render();
      const url=canvas.toDataURL('image/png');cached.set(item.id,url);await abortable(onPreview(item,url),signal);
      container.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
}
