import { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
const materials = new WeakMap<Scene,StandardMaterial>();
/** Crossed emissive quads, attached to the model's authored muzzle anchor. No lights/shadows. */
export class RemoteMuzzleFlash {
  readonly root:TransformNode;
  private until=-Infinity;
  constructor(scene:Scene,parent:TransformNode,muzzle:Vector3){
    let mat=materials.get(scene);
    if(!mat){mat=new StandardMaterial('remote-muzzle',scene);const texture=new Texture(assetUrl('assets/textures/shared/fx/glow.png'),scene);texture.hasAlpha=true;
      mat.diffuseTexture=texture;mat.useAlphaFromDiffuseTexture=true;mat.disableLighting=true;mat.emissiveColor=new Color3(1,.56,.08);
      mat.backFaceCulling=false;mat.disableDepthWrite=true;materials.set(scene,mat);}
    this.root=new TransformNode('remote-muzzle',scene);this.root.parent=parent;this.root.position.copyFrom(muzzle);
    for(let i=0;i<3;i++){const plane=MeshBuilder.CreatePlane('remote-muzzle-flash',{width:.14,height:.22,sideOrientation:Mesh.DOUBLESIDE},scene);
      plane.parent=this.root;plane.material=mat;plane.rotation.y=i*Math.PI/3;plane.rotation.x=i===2?Math.PI/2:0;plane.isPickable=false;}
    this.root.setEnabled(false);
  }
  fire(now=performance.now()):void {this.until=now+55;this.root.setEnabled(true);}
  update(now=performance.now()):void {this.root.setEnabled(now<this.until);}
  inspect(){return {active:this.root.isEnabled(),position:this.root.getAbsolutePosition().asArray()};}
  dispose(){this.root.dispose();}
}
