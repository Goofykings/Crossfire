import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3, type AssetContainer } from '@babylonjs/core';
import type { CosmeticDefinition } from '../../shared/cosmetics';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { loadCosmeticAsset } from '../rendering/CosmeticAssets';
import { meshesReady } from '../core/assetReadiness';
import { studioEnvironment } from '../rendering/StudioEnvironment';

/** One lazy scene for the visible item only; disposed on Back/navigation. */
export class CosmeticPreview {
  private engine:Engine|null=null;private scene:Scene|null=null;private abort:AbortController|null=null;
  private canvas:HTMLCanvasElement|null=null;private container:AssetContainer|null=null;
  private resize=()=>this.engine?.resize();
  async open(host:HTMLElement,item:CosmeticDefinition):Promise<void>{
    this.close();const abort=new AbortController();this.abort=abort;const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`${item.name} ${item.weapon} 3D preview`);host.replaceChildren(canvas);this.canvas=canvas;
    const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.5));this.engine=engine;
    const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(0,0,0,0);scene.imageProcessingConfiguration.exposure=1.15;this.scene=scene;
    const camera=new ArcRotateCamera('cosmetic-camera',.22,1.28,2,Vector3.Zero(),scene);camera.fov=.55;camera.minZ=.01;camera.attachControl(canvas,true);camera.wheelPrecision=100;
    const fill=new HemisphericLight('cosmetic-fill',new Vector3(0,1,0),scene);fill.intensity=1.5;fill.groundColor=new Color3(.45,.5,.6);
    const key=new DirectionalLight('cosmetic-key',new Vector3(-1,-2,-1),scene);key.intensity=2;
    const materials=new MaterialLibrary(scene);
    try{
      await Promise.all([materials.load(undefined,abort.signal),studioEnvironment(scene,.9,abort.signal)]);const c=await loadCosmeticAsset(item,scene,materials,abort.signal);this.container=c;c.addAllToScene();
      for(const m of c.meshes)m.computeWorldMatrix(true);const bounds=c.rootNodes[0].getHierarchyBoundingVectors(true),size=bounds.max.subtract(bounds.min),target=bounds.min.add(bounds.max).scale(.5);
      camera.setTarget(target);const fit=()=>{engine.resize();camera.radius=Math.max(size.y,size.z/engine.getAspectRatio(camera),size.x/engine.getAspectRatio(camera))/(2*Math.tan(camera.fov/2))*1.5;camera.lowerRadiusLimit=camera.radius*.75;camera.upperRadiusLimit=camera.radius*2;};
      fit();this.resize=fit;window.addEventListener('resize',fit);await meshesReady(c.meshes,abort.signal);abort.signal.throwIfAborted();
      engine.runRenderLoop(()=>{if(!document.hidden)scene.render();});
    }catch(error){if(!abort.signal.aborted){this.close();throw error;}}
  }
  close(){this.abort?.abort();this.abort=null;window.removeEventListener('resize',this.resize);this.engine?.stopRenderLoop();this.container=null;this.scene?.dispose();this.scene=null;this.engine?.dispose();this.engine=null;this.canvas?.remove();this.canvas=null;}
  inspect(){return {active:!!this.engine,meshes:this.container?.meshes.filter(m=>m.getTotalVertices()>0).length??0};}
}
