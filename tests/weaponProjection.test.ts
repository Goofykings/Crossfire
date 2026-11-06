import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { WeaponView } from '../src/weapons/WeaponView';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import type { RenderContext } from '../src/rendering/RenderContext';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { defaultEquipment } from '../shared/cosmetics';

afterEach(()=>vi.unstubAllGlobals());
it('preserves all four real weapon rigs and isolates close weapon depth from world projection',async()=>{
  const requested:string[]=[];
  vi.stubGlobal('fetch',async(url:string)=>{requested.push(url);return new Response(await readFile(`public/${url.replace(/^.*?assets\//,'assets/')}`));});
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const camera=new FreeCamera('view',Vector3.Zero(),scene);camera.minZ=.1;camera.maxZ=900;camera.fov=1.57;
  const material=new StandardMaterial('fixture',scene);
  const view=new WeaponView({scene,camera} as RenderContext,{get:()=>material,ready:async()=>{}} as unknown as MaterialLibrary,null);
  try{
    // An HTTP inventory response may arrive while game assets are still loading.
    await view.setCosmetics(defaultEquipment());
    await view.load(new AbortController().signal);
    expect(requested.filter(url=>url.endsWith('.glb'))).toHaveLength(4);
    for(const stats of WEAPONS){
      view.select(stats.id);const w=new Weapon(stats);
      view.update(1/60,w,{speed:0,grounded:true,sliding:false,crouch:0,sprinting:false});
      const enabled=view.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()>0&&!m.name.includes('flash'));
      expect(enabled.length).toBeGreaterThan(3);expect(enabled.some(m=>m.name.includes(stats.id))).toBe(true);
      expect(enabled.every(m=>m.renderingGroupId===1&&m.alwaysSelectAsActiveMesh)).toBe(true);
      const before=camera.getProjectionMatrix(true).clone();
      // Same notifications as RenderingManager; no lowering of the world's near plane.
      const info={renderingGroupId:1} as Parameters<typeof scene.onBeforeRenderingGroupObservable.notifyObservers>[0];
      scene.onBeforeRenderingGroupObservable.notifyObservers(info);
      expect(camera.minZ).toBe(.012);expect(camera.getProjectionMatrix().equals(before)).toBe(false);
      scene.onAfterRenderingGroupObservable.notifyObservers(info);
      expect(camera.minZ).toBe(.1);expect(camera.getProjectionMatrix().equals(before)).toBe(true);
    }
  }finally{view.dispose();scene.dispose();engine.dispose();}
});
