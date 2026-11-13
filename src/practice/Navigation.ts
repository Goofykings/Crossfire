import {MOVEMENT} from '../config/constants';
import type {MapLayout} from '../maps/types';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {Vec3} from '../player/PlayerController';
export interface NavNode extends Vec3 {id:number;edges:number[];component:number}
const gap=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Rebuilds from the same current solids as movement, including stacked floors and
 * underground openings. Edges sample the controller's step/snap/body clearance,
 * rather than connecting rooms through ceilings or stairwell voids. */
export class PracticeNavigation {
 readonly nodes:NavNode[]=[];readonly spacing=.8;readonly buildMs:number;
 private readonly cells=new Map<string,NavNode[]>();
 constructor(readonly world:CollisionWorld,readonly layout:MapLayout){
  const started=performance.now(),r=MOVEMENT.radius+.035,[x0,z0,x1,z1]=layout.playArea;
  const lowest=Math.min(layout.ground.baseHeight,...(layout.underground??[]).map(p=>p.floor))-1;
  for(let ix=Math.ceil((x0+r)/this.spacing);ix*this.spacing<x1-r;ix++)for(let iz=Math.ceil((z0+r)/this.spacing);iz*this.spacing<z1-r;iz++){
   const x=ix*this.spacing,z=iz*this.spacing,candidates=new Set<number>();
   // Copy heights before nested queries reuse the collision world's scratch list.
   for(const c of world.query(x-r,lowest,z-r,x+r,12,z+r))if(c.solid&&(c.hx>.10&&c.hz>.10||c.tag.includes(':roof:')))candidates.add(Math.round(c.maxY*10000)/10000);
   const found:NavNode[]=[];
   for(const y0 of candidates){
    const y=world.groundHeight(x,z,MOVEMENT.radius,y0+.015,y0-.02);
    if(!Number.isFinite(y)||found.some(n=>Math.abs(n.y-y)<.1)||world.overlapsCylinder(x,z,r,y+MOVEMENT.stepHeight+.015,y+MOVEMENT.standHeight+.02))continue;
    const n={id:this.nodes.length,x,y,z,edges:[],component:-1};this.nodes.push(n);found.push(n);
   }
   if(found.length)this.cells.set(`${ix},${iz}`,found);
  }
  for(const n of this.nodes){const ix=Math.round(n.x/this.spacing),iz=Math.round(n.z/this.spacing);
   for(const [dx,dz]of [[1,0],[0,1],[1,1],[1,-1]])for(const other of this.cells.get(`${ix+dx},${iz+dz}`)??[]){
    if(Math.abs(other.y-n.y)>1.5||!this.walkable(n,other)||!this.walkable(other,n))continue;n.edges.push(other.id);other.edges.push(n.id);
   }
  }
  let component=0;for(const n of this.nodes)if(n.component<0){n.component=component;const queue=[n];for(let i=0;i<queue.length;i++)for(const id of queue[i].edges)if(this.nodes[id].component<0){this.nodes[id].component=component;queue.push(this.nodes[id]);}component++;}
  this.buildMs=performance.now()-started;
 }
 walkable(a:Vec3,b:Vec3):boolean{
  const length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(length/.10));let y=a.y;
  for(let i=1;i<=steps;i++){const t=i/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
   const next=this.world.groundHeight(x,z,MOVEMENT.radius,y+MOVEMENT.stepHeight+.015,y-MOVEMENT.snapDown-.015);
   if(!Number.isFinite(next)||this.world.overlapsCylinder(x,z,MOVEMENT.radius+.02,next+MOVEMENT.stepHeight+.015,next+MOVEMENT.standHeight+.01))return false;y=next;
  }
  return Math.abs(y-b.y)<.18;
 }
 nearest(p:Vec3,component?:number):NavNode|undefined{
  let best:NavNode|undefined,cost=Infinity;
  for(const n of this.nodes){if(component!==undefined&&n.component!==component||Math.abs(n.y-p.y)>1.5)continue;const d=gap(p,n);if(d<cost){best=n;cost=d;}}return best;
 }
 path(from:Vec3,to:Vec3):NavNode[]{
  const a=this.nearest(from),b=this.nearest(to,a?.component);if(!a||!b)return [];
  const cost=new Float64Array(this.nodes.length).fill(Infinity),came=new Int32Array(this.nodes.length).fill(-1),open=new Set<number>([a.id]);cost[a.id]=0;
  for(let visited=0;open.size&&visited<this.nodes.length;visited++){
   let id=-1,rank=Infinity;for(const v of open){const f=cost[v]+gap(this.nodes[v],b);if(f<rank){rank=f;id=v;}}if(id<0)break;
   if(id===b.id){const path:NavNode[]=[];for(let n=id;n>=0;n=came[n])path.push(this.nodes[n]);return path.reverse();}
   open.delete(id);for(const next of this.nodes[id].edges){const distance=cost[id]+gap(this.nodes[id],this.nodes[next]);if(distance<cost[next]){cost[next]=distance;came[next]=id;open.add(next);}}
  }
  return [];
 }
 reachable(from:Vec3):NavNode[]{const n=this.nearest(from);return n?this.nodes.filter(v=>v.component===n.component&&v.edges.length>0):[];}
 inspect(){return {nodes:this.nodes.length,edges:this.nodes.reduce((n,v)=>n+v.edges.length,0)/2,buildMs:this.buildMs,components:new Set(this.nodes.map(n=>n.component)).size};}
}
