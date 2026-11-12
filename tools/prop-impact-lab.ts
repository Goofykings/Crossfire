import {Engine,Scene,ArcRotateCamera,Vector3,Color4,HemisphericLight,LoadAssetContainerAsync,TransformNode,Quaternion,Ray,MeshBuilder,StandardMaterial,Color3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import type {BulletCatalog} from '../src/physics/BulletMesh';
import {Effects} from '../src/weapons/Effects';
const engine=new Engine(document.querySelector<HTMLCanvasElement>('#view')!,true),scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.12,.15,.19,1);
const camera=new ArcRotateCamera('review',-Math.PI/2,1.1,8,Vector3.Zero(),scene);camera.attachControl();new HemisphericLight('sky',new Vector3(.2,1,.4),scene).intensity=1.5;
const ground=MeshBuilder.CreateGround('ground',{width:20,height:15},scene),material=new StandardMaterial('ground',scene);material.diffuseColor=new Color3(.27,.29,.31);ground.material=material;ground.position.y=-.005;
const data:BulletCatalog=await fetch('/assets/models/shared/props/bullet-surfaces.json').then(r=>r.json()),catalog=await fetch('/assets/models/shared/props/props.json').then(r=>r.json());
const effects=new Effects(scene),world=new CollisionWorld(),reports:{type:string;compared:number;hits:number;misses:number;maxError:number}[]=[];
for(const [i,type] of ['barrel','pipe_bundle','crate','bench','dumpster','electrical_cabinet'].entries()){
 const c=await LoadAssetContainerAsync('/assets/models/shared/props/'+catalog.props[type].file,scene);c.addAllToScene();const root=new TransformNode(type,scene),position=[(i%3-1)*3,0,Math.floor(i/3)*3-1.5],yaw=.35;
 for(const n of c.rootNodes)n.parent=root;root.position.set(...position as [number,number,number]);root.rotationQuaternion=Quaternion.RotationAxis(Vector3.Up(),yaw);scene.render();
 const own=new Set(root.getChildMeshes()),mesh=data.meshes[type],box=world.add({c:[position[0],.5,position[2]],h:[1,1,1]});world.addBulletSurface(mesh,position,yaw,type,[box]);
 const report={type,compared:0,hits:0,misses:0,maxError:0};
 for(let j=0;j<50;j++){
  const angle=(j%5)*Math.PI/2.3,at=new Vector3(position[0]+Math.sin(angle)*5,mesh.center[1]+(j%3-1)*mesh.half[1]*.65,position[2]+Math.cos(angle)*5),target=new Vector3(position[0]+((j%7)-3)*mesh.half[0]*.32,mesh.center[1]+(j%3-1)*mesh.half[1]*.65,position[2]);
  const d=target.subtract(at).normalize(),actual=world.raycastBullet(at.x,at.y,at.z,d.x,d.y,d.z,20,c=>c.tag===type),pick=scene.pickWithRay(new Ray(at,d,20),m=>own.has(m));report.compared++;
  if(!!actual!==!!pick?.hit)throw Error(type+' hit/miss mismatch '+j);
  if(actual&&pick?.pickedPoint){report.hits++;const error=Vector3.Distance(new Vector3(...Object.values(actual.point) as [number,number,number]),pick.pickedPoint);report.maxError=Math.max(report.maxError,error);if(error>.0001)throw Error(type+' intersection error '+error);if(j%4===0)effects.impact(pick.pickedPoint,new Vector3(actual.normal.x,actual.normal.y,actual.normal.z),false,actual);}else report.misses++;
 }reports.push(report);
}
scene.render();engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());
Object.assign(window,{__propReview:{reports,world,scene,effects,camera,engine,focus:(index:number)=>{camera.setTarget(new Vector3((index%3-1)*3,.5,Math.floor(index/3)*3-1.5));camera.radius=2.3;},reduced:(value:boolean)=>effects.setReduced(value)}});
