import { Color3, Color4, MeshBuilder, SolidParticleSystem, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';
import type { ShotResult } from '../../shared/protocol';

/** One depth-tested draw call, bounded slots, no physics or damage prediction. */
export class BulletTrails {
  private readonly batch: SolidParticleSystem;
  private readonly born = new Float64Array(128).fill(-Infinity);
  private cursor = 0;
  private budget = 128;
  private readonly material: StandardMaterial;
  constructor(scene: Scene) {
    this.material = new StandardMaterial('bullet-air', scene);
    this.material.disableLighting = true; this.material.emissiveColor = new Color3(.72,.75,.78);
    this.material.disableDepthWrite = true; this.material.backFaceCulling = false;
    const shape = MeshBuilder.CreateBox('bullet-air-source', {size:1}, scene);
    this.batch = new SolidParticleSystem('bullet-air-trails', scene, {updatable:true});
    this.batch.addShape(shape,128); shape.dispose();
    const mesh = this.batch.buildMesh(); mesh.material=this.material; mesh.hasVertexAlpha=true;
    mesh.isPickable=false; mesh.alwaysSelectAsActiveMesh=true;
    this.clear();
  }
  setReduced(value: boolean): void { this.budget=value?32:128; }
  shot(shot: Pick<ShotResult,'traces'>, now=performance.now()): void {
    for(const ray of shot.traces??[]) {
      const from=new Vector3(ray.from.x,ray.from.y,ray.from.z), to=new Vector3(ray.to.x,ray.to.y,ray.to.z);
      const d=to.subtract(from), length=d.length(); if(length<.9)continue;
      d.scaleInPlace(1/length); from.addInPlace(d.scale(.8)); // keep the shooter's reticle clear
      const i=this.cursor++%this.budget,p=this.batch.particles[i];this.born[i]=now;
      p.position.copyFrom(from.add(to).scale(.5)); p.scaling.set(.006,.006,length-.8);
      p.rotation.set(-Math.atan2(d.y,Math.hypot(d.x,d.z)),Math.atan2(d.x,d.z),0);
      p.color=new Color4(.72,.75,.78,.12);
    }
    this.update(now);
  }
  update(now=performance.now()): void {
    let active=0;
    this.batch.particles.forEach((p,i)=>{const t=(now-this.born[i])/220;
      if(t<0||t>=1||i>=this.budget){p.scaling.setAll(0);p.color!.a=0;return;}
      p.color!.a=.12*(1-t)**2;active++;
    });
    this.batch.mesh.setEnabled(active>0); if(active)this.batch.setParticles();
  }
  clear(): void {this.born.fill(-Infinity);for(const p of this.batch.particles){p.scaling.setAll(0);p.color=new Color4(0,0,0,0);}this.batch.mesh.setEnabled(false);}
  inspect(){return {active:this.batch.particles.filter(p=>p.color!.a>0).length,budget:this.budget,drawCalls:this.batch.mesh.isEnabled()?1:0};}
  dispose():void {this.batch.dispose();this.material.dispose();}
}
