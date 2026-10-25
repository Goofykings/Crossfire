import { Camera, Color4, Engine, FreeCamera, Quaternion, Scene, Vector3 } from '@babylonjs/core';

/** Engine, scene and the first-person camera. The scene uses glTF's right-handed convention. */
export class RenderContext {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: FreeCamera;
  private resolutionScale = 1;

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

    window.addEventListener('resize', () => this.engine.resize());
  }

  /** Render at a fraction of the display's device-pixel resolution (1 = native). */
  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / (dpr * scale));
  }

  get renderScale(): number {
    return this.resolutionScale;
  }

  /** Set horizontal field of view in degrees. */
  setFov(deg: number): void {
    this.camera.fov = (deg * Math.PI) / 180;
  }
}
