import { Quaternion, TransformNode, Vector3, type AssetContainer, type Scene } from '@babylonjs/core';
import { loadContainer } from '../core/loadContainer';
import { assetUrl } from '../core/assets';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { EnvironmentSimulation, type EnvironmentDefinition, type EnvironmentFrame, type PropState } from '../../shared/environment';

/** Shared meshes/materials with independent small poses; no client-generated multiplayer forces. */
export class EnvironmentProps {
  private readonly containers:AssetContainer[]=[];
  private readonly objects=new Map<string,{root:TransformNode;previous:PropState;next:PropState;from:number;to:number;progress:number}>();
  readonly practice:EnvironmentSimulation;
  private seq=-1;
  constructor(private readonly scene:Scene,readonly definition:EnvironmentDefinition,world:CollisionWorld) {
    this.practice=new EnvironmentSimulation(definition,world);
  }
  async load(materials:MaterialLibrary,signal?:AbortSignal):Promise<void> {
    const assets=new Map<string,AssetContainer>();
    try {
      for(const name of new Set([...this.definition.bodies,...this.definition.signs].map(d=>d.asset))) {
        const container=await loadContainer(assetUrl(`assets/models/shared/environment/${name}.glb`),this.scene,signal);
        this.containers.push(container);for(const mesh of container.meshes)if(mesh.material)mesh.material=materials.get(mesh.material.name);
        assets.set(name,container);
      }
      const states=this.practice.capture();
      for(const d of [...this.definition.bodies,...this.definition.signs]) {
        const entries=assets.get(d.asset)!.instantiateModelsToScene(name=>`environment:${d.id}:${name}`,false);
        const root=new TransformNode(`environment:${d.id}`,this.scene);
        for(const node of entries.rootNodes){node.parent=root;const body=this.definition.bodies.find(b=>b.id===d.id);if(body&&d.asset!=='apple'&&node instanceof TransformNode)node.position.y-=body.halfHeight;}
        for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}
        const state=states.find(s=>s.id===d.id)!;
        this.objects.set(d.id,{root,previous:state,next:state,from:0,to:0,progress:1});this.pose(root,state);
      }
    } catch(error){this.dispose();throw error;}
  }
  sync(frame:EnvironmentFrame):void {
    if(frame.seq<=this.seq)return;this.seq=frame.seq;
    for(const state of frame.states) {
      const object=this.objects.get(state.id);if(!object)continue;
      object.previous=object.next;object.from=object.to;object.next=state;object.to=frame.at;object.progress=-1;
      if(frame.full){object.previous=state;object.from=frame.at;object.progress=1;this.pose(object.root,state);}
    }
  }
  private pose(root:TransformNode,state:PropState):void {
    root.position.set(state.position.x,state.position.y,state.position.z);
    root.rotationQuaternion=Quaternion.RotationAxis(Vector3.Up(),state.yaw).multiply(Quaternion.RotationAxis(Vector3.Forward(),state.angle));
  }
  update(dt:number,serverTime:number,practice:boolean):void {
    if(practice){this.practice.advance(dt);for(const state of this.practice.takeChanges()){
      const object=this.objects.get(state.id)!;object.next=state;this.pose(object.root,state);
    }return;}
    for(const object of this.objects.values()) {
      const a=object.previous,b=object.next,k=object.to>object.from?Math.max(0,Math.min(1,(serverTime-100-object.from)/(object.to-object.from))):1;
      if(k===object.progress)continue;object.progress=k;
      this.pose(object.root,{...b,position:{x:a.position.x+(b.position.x-a.position.x)*k,y:a.position.y+(b.position.y-a.position.y)*k,z:a.position.z+(b.position.z-a.position.z)*k},
        yaw:a.yaw+(b.yaw-a.yaw)*k,angle:a.angle+(b.angle-a.angle)*k});
    }
  }
  inspect(){return {count:this.objects.size,seq:this.seq,states:[...this.objects].map(([id,o])=>({id,position:o.root.position.asArray(),angle:o.next.angle,asleep:o.next.asleep,
    meshes:o.root.getChildMeshes().length})),active:[...this.objects.values()].filter(o=>!o.next.asleep).length};}
  dispose():void{for(const o of this.objects.values())o.root.dispose();this.objects.clear();for(const c of this.containers)c.dispose();this.containers.length=0;}
}
