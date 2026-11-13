import { ArcRotateCamera, Axis, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3, type AssetContainer } from '@babylonjs/core';
import type { CosmeticDefinition } from '../../shared/cosmetics';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { loadCosmeticAsset } from '../rendering/CosmeticAssets';
import { meshesReady } from '../core/assetReadiness';
import { studioEnvironment } from '../rendering/StudioEnvironment';

/** One lazy scene for the visible item only; disposed on Back/navigation. */
export class CosmeticPreview {
  private engine:Engine|null=null;private scene:Scene|null=null;private abort:AbortController|null=null;
  private canvas:HTMLCanvasElement|null=null;private container:AssetContainer|null=null;private camera:ArcRotateCamera|null=null;
  private resize=()=>this.engine?.resize();
  async open(host:HTMLElement,item:CosmeticDefinition):Promise<void>{
    this.close();const abort=new AbortController();this.abort=abort;const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`${item.name} ${item.weapon} 3D preview`);host.replaceChildren(canvas);this.canvas=canvas;
    const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.5));this.engine=engine;
    const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(0,0,0,0);scene.imageProcessingConfiguration.exposure=1.15;this.scene=scene;
    const camera=new ArcRotateCamera('cosmetic-camera',.22,1.28,2,Vector3.Zero(),scene);camera.fov=.55;camera.minZ=.01;camera.attachControl(canvas,true);camera.wheelPrecision=100;this.camera=camera;
    const fill=new HemisphericLight('cosmetic-fill',new Vector3(0,1,0),scene);fill.intensity=1.5;fill.groundColor=new Color3(.45,.5,.6);
    const key=new DirectionalLight('cosmetic-key',new Vector3(-1,-2,-1),scene);key.intensity=2;
    // The key light travels with the camera (from above and to the left of the viewer), so every angle of the drag-rotation is lit the
    // way the default view is; a light fixed in the world leaves the far side of the weapon in the dark and makes it look wrong from there.
    scene.onBeforeRenderObservable.add(()=>{
      const f=camera.getForwardRay().direction,r=camera.getDirection(Axis.X);
      key.direction.set(f.x+r.x*.55,f.y+r.y*.55-.85,f.z+r.z*.55).normalize();
    });
    const materials=new MaterialLibrary(scene);
    try{
      await Promise.all([materials.load(undefined,abort.signal),studioEnvironment(scene,.9,abort.signal)]);const c=await loadCosmeticAsset(item,scene,materials,abort.signal);this.container=c;c.addAllToScene();
      for(const m of c.meshes)m.computeWorldMatrix(true);const bounds=c.rootNodes[0].getHierarchyBoundingVectors(true),size=bounds.max.subtract(bounds.min),target=bounds.min.add(bounds.max).scale(.5);
      camera.setTarget(target);const fit=()=>{engine.resize();camera.radius=Math.max(size.y,size.z/engine.getAspectRatio(camera),size.x/engine.getAspectRatio(camera))/(2*Math.tan(camera.fov/2))*1.5;camera.lowerRadiusLimit=camera.radius*.75;camera.upperRadiusLimit=camera.radius*2;
        // Depth precision: planes hugging the model (the default 0.01 to 10000 spends the 24-bit buffer on empty space, which lets nearly coplanar details fight).
        camera.minZ=camera.radius*.05;camera.maxZ=camera.radius*30;};
      fit();this.resize=fit;window.addEventListener('resize',fit);await meshesReady(c.meshes,abort.signal);abort.signal.throwIfAborted();
      engine.runRenderLoop(()=>{if(!document.hidden)scene.render();});
    }catch(error){if(!abort.signal.aborted){this.close();throw error;}}
  }
  close(){this.abort?.abort();this.abort=null;window.removeEventListener('resize',this.resize);this.engine?.stopRenderLoop();this.container=null;this.scene?.dispose();this.scene=null;this.engine?.dispose();this.engine=null;this.canvas?.remove();this.canvas=null;}
  inspect(){return {active:!!this.engine,meshes:this.container?.meshes.filter(m=>m.getTotalVertices()>0).length??0};}
  /** Review hooks (tools/review-weapon-angles.mjs): orbit to an azimuth/elevation in degrees (0, 0 = from the right side, +x) and render one frame. */
  setAngles(azimuthDeg:number,elevationDeg:number):void{
    if(!this.camera||!this.scene)return;
    this.camera.alpha=azimuthDeg*Math.PI/180;this.camera.beta=Math.PI/2-elevationDeg*Math.PI/180;this.scene.render();
  }
  get debug(){return {canvas:this.canvas,scene:this.scene,camera:this.camera,container:this.container};}
}
