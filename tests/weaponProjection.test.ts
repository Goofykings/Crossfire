import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, MeshBuilder, NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { VIEWMODEL_FOV, WeaponView } from '../src/weapons/WeaponView';
import { SETTING_LIMITS, DEFAULT_SETTINGS } from '../src/config/settings';
import { Weapon, WEAPONS } from '../src/weapons/Weapon';
import type { RenderContext } from '../src/rendering/RenderContext';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { defaultEquipment } from '../shared/cosmetics';

afterEach(()=>vi.unstubAllGlobals());
it('preserves all five real weapon rigs and isolates close weapon depth from world projection',async()=>{
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
    const fill=scene.getLightByName('viewmodel-fill')!;
    const wall=MeshBuilder.CreateBox('unrelated-world',{},scene);
    expect(fill.canAffectMesh(wall)).toBe(false);
    expect(view.meshes.every(m=>fill.canAffectMesh(m))).toBe(true);
    camera.rotation.y=Math.PI/2;
    view.update(1/60,new Weapon(WEAPONS[0]),{speed:0,grounded:true,sliding:false,crouch:0,sprinting:false});
    const direction=(fill as import('@babylonjs/core').HemisphericLight).direction;
    expect(Vector3.Distance(direction,camera.getDirection(new Vector3(-.4,.8,.35)))).toBeLessThan(.00001);
    camera.rotation.y=0;
    expect(requested.filter(url=>url.endsWith('.glb'))).toHaveLength(WEAPONS.length);
    for(const stats of WEAPONS){
      view.select(stats.id);const w=new Weapon(stats);
      view.update(1/60,w,{speed:0,grounded:true,sliding:false,crouch:0,sprinting:false});
      const enabled=view.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()>0&&!m.name.includes('flash'));
      expect(enabled.length).toBeGreaterThan(3);expect(enabled.some(m=>m.name.includes(stats.id==='semi-sniper'?'semi_sniper':stats.id))).toBe(true);
      expect(enabled.every(m=>m.renderingGroupId===1&&m.alwaysSelectAsActiveMesh)).toBe(true);
      w.ads=1;
      for(const lean of [-1,1]){
        for(let i=0;i<60;i++)view.update(1/60,w,{speed:0,grounded:true,sliding:false,crouch:0,sprinting:false,lean});
        const sight=scene.transformNodes.find(n=>n.name==='sight'&&n.isEnabled())!;
        sight.computeWorldMatrix(true);const at=sight.getAbsolutePosition();
        if(stats.id!=='shotgun'){
          expect(at.x).toBeCloseTo(0,5);expect(at.y).toBeCloseTo(0,5);
        }else{
          // The exported shotgun sight is intentionally above the barrels;
          // the viewmodel now aims over the receiver rather than along it.
          const muzzle=scene.transformNodes.find(n=>n.name==='muzzle'&&n.isEnabled())!;
          const aim=sight.position.clone();aim.y=muzzle.position.y+.040;
          const world=Vector3.TransformCoordinates(aim,sight.parent!.getWorldMatrix());
          expect(world.x).toBeCloseTo(0,5);expect(world.y).toBeCloseTo(0,5);
        }
      }
      if(stats.id==='shotgun'){
        view.update(1,w,{speed:0,grounded:true,sliding:false,crouch:0,sprinting:false,lean:0});
        const muzzle=scene.transformNodes.find(n=>n.name==='muzzle'&&n.isEnabled())!;
        const matrix=muzzle.parent!.computeWorldMatrix(true);
        const bore=Vector3.TransformNormal(new Vector3(0,0,-1),matrix).normalize();
        expect(bore.x).toBeCloseTo(0,5);expect(bore.y).toBeCloseTo(0,5);expect(bore.z).toBeCloseTo(-1,5);
        const top=muzzle.position.clone();top.y+=.0085;
        const worldTop=Vector3.TransformCoordinates(top,matrix);
        expect(worldTop.x).toBeCloseTo(0,5);
        expect(worldTop.y).toBeCloseTo(-.0315,5);
        expect(worldTop.z).toBeCloseTo(-.808,5);
        // Receiver clears the eye line, while the two level barrel tops sit
        // just below center. World FOV never changes their screen alignment.
        for(const aspect of [4/3,16/9,21/9]){
          vi.spyOn(engine,'getAspectRatio').mockReturnValue(aspect);
          let projected:Vector3|undefined;
          for(const degrees of [70,90,110]){
            camera.fov=degrees*Math.PI/180;
            const info={renderingGroupId:1} as Parameters<typeof scene.onBeforeRenderingGroupObservable.notifyObservers>[0];
            scene.activeCamera=camera;
            scene.onBeforeRenderingGroupObservable.notifyObservers(info);
            const point=Vector3.TransformCoordinates(worldTop,scene.getProjectionMatrix());
            expect(Math.abs(point.x)).toBeLessThan(.00001);
            expect(Math.abs(point.y)).toBeLessThan(.10);
            if(projected)expect(Vector3.Distance(point,projected)).toBeLessThan(.00001);
            projected=point;
            scene.onAfterRenderingGroupObservable.notifyObservers(info);
          }
        }
        vi.restoreAllMocks();
      }
      w.ads=0;
      let fixed: number[] | undefined;
      for (const degrees of [SETTING_LIMITS.fov[0], DEFAULT_SETTINGS.fov, SETTING_LIMITS.fov[1], 90*.22]) {
        camera.fov=degrees*Math.PI/180;
        const before=camera.getProjectionMatrix(true).clone(),position=view.root.position.clone();
        // Same notifications as RenderingManager; no lowering of the world's near plane.
        const info={renderingGroupId:1} as Parameters<typeof scene.onBeforeRenderingGroupObservable.notifyObservers>[0];
        scene.onBeforeRenderingGroupObservable.notifyObservers(info);
        expect(camera.minZ).toBe(.012);expect(camera.getProjectionMatrix().equals(before)).toBe(false);
        const projection=Array.from(scene.getProjectionMatrix().m);
        if(fixed)expect(projection).toEqual(fixed);else fixed=projection;
        expect(projection[0]).toBeCloseTo(1/Math.tan(VIEWMODEL_FOV/2));
        expect(scene.getViewMatrix().equals(camera.getViewMatrix())).toBe(true);
        expect(view.root.position.equals(position)).toBe(true);
        expect(camera.fov).toBe(degrees*Math.PI/180);
        scene.onAfterRenderingGroupObservable.notifyObservers(info);
        expect(camera.minZ).toBe(.1);expect(camera.getProjectionMatrix().equals(before)).toBe(true);
        expect(scene.getProjectionMatrix().equals(before)).toBe(true);
      }
    }
  }finally{view.dispose();scene.dispose();engine.dispose();}
});
