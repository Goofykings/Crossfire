import { Camera, Color4, Engine, FreeCamera, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import {AdaptiveResolution,renderPixelRatio} from './AdaptiveResolution';

/** Engine, scene and the first-person camera. The scene uses glTF's right-handed convention. */
export class RenderContext {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: FreeCamera;
  private resolutionScale = 1;
  private chromebook=false;
  private readonly adaptive=new AdaptiveResolution();

  constructor(readonly canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.engine = new Engine(
      canvas,
      true,
      {
        stencil: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
        audioEngine: false,
        antialias: true,
      },
      false,
    );
    this.engine.enableOfflineSupport = false;
    const scene = new Scene(this.engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.62, 0.7, 0.8, 1);
    scene.skipPointerMovePicking = true;
    scene.skipPointerDownPicking = true;
    scene.skipPointerUpPicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    this.scene = scene;

    const cam = new FreeCamera('fp-camera', new Vector3(0, 1.7, 0), scene);
    cam.inputs.clear();
    // 24-bit depth: resolution at distance d is about d^2 / (minZ * 2^24), so 0.1 halves the depth error of 0.05
    // (about 1 mm at 40 m). The player's body radius is 0.34 m, so geometry never gets closer than this plane.
    cam.minZ = 0.1;
    cam.maxZ = 900;
    cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    cam.rotationQuaternion = Quaternion.Identity();
    this.camera = cam;
    scene.activeCamera = cam;

    window.addEventListener('resize', () => this.applyRenderSize());
  }

  /** Render at a fraction of the display's device-pixel resolution (1 = native). */
  setResolutionScale(scale: number,chromebook=false): void {
    this.resolutionScale = scale;
    this.chromebook=chromebook;this.adaptive.reset();
    this.applyRenderSize();
  }

  private applyRenderSize():void {
    const scale=this.chromebook?this.adaptive.scale:this.resolutionScale;
    const ratio=renderPixelRatio(this.canvas.clientWidth,this.canvas.clientHeight,window.devicePixelRatio||1,scale,this.chromebook);
    this.engine.setHardwareScalingLevel(1/ratio);
  }

  updateResolution(dt:number,playing:boolean):void {
    if(this.chromebook&&playing&&this.adaptive.sample(dt))this.applyRenderSize();
  }

  resolutionStats(){
    return {adaptive:this.chromebook,scale:this.chromebook?this.adaptive.scale:this.resolutionScale,
      width:this.engine.getRenderWidth(),height:this.engine.getRenderHeight(),pixelBudget:this.chromebook?1280*720:null};
  }

  get renderScale(): number {
    return this.resolutionScale;
  }

  /** Set horizontal field of view in degrees. */
  setFov(deg: number): void {
    this.camera.fov = (deg * Math.PI) / 180;
  }
}
