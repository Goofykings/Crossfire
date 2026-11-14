import {MOVEMENT} from '../config/constants';
import type {MapLayout} from '../maps/types';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {Vec3} from '../player/PlayerController';
import {NavFrontier} from './NavFrontier';
export interface NavNode extends Vec3 {id:number;edges:number[];component:number}
const gap=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Rebuilds from the same current solids as movement, including stacked floors and
 * underground openings. Edges sample the controller's step/snap/body clearance,
 * rather than connecting rooms through ceilings or stairwell voids. */
export class PracticeNavigation {
 readonly nodes:NavNode[]=[];readonly spacing=.8;readonly buildMs:number;
 private readonly cells=new Map<string,NavNode[]>();
 private minCellX=Infinity;private maxCellX=-Infinity;private minCellZ=Infinity;private maxCellZ=-Infinity;
 private componentCount=0;
 private readonly componentNodes=new Map<number,NavNode[]>();
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
   if(found.length){this.cells.set(`${ix},${iz}`,found);this.minCellX=Math.min(this.minCellX,ix);this.maxCellX=Math.max(this.maxCellX,ix);this.minCellZ=Math.min(this.minCellZ,iz);this.maxCellZ=Math.max(this.maxCellZ,iz);}
  }
  for(const n of this.nodes){const ix=Math.round(n.x/this.spacing),iz=Math.round(n.z/this.spacing);
   for(const [dx,dz]of [[1,0],[0,1],[1,1],[1,-1]])for(const other of this.cells.get(`${ix+dx},${iz+dz}`)??[]){
    if(Math.abs(other.y-n.y)>1.5||!this.walkable(n,other)||!this.walkable(other,n))continue;n.edges.push(other.id);other.edges.push(n.id);
   }
  }
  let component=0;for(const n of this.nodes)if(n.component<0){n.component=component;const queue=[n];for(let i=0;i<queue.length;i++)for(const id of queue[i].edges)if(this.nodes[id].component<0){this.nodes[id].component=component;queue.push(this.nodes[id]);}component++;}
  this.componentCount=component;for(const n of this.nodes){const group=this.componentNodes.get(n.component)??[];group.push(n);this.componentNodes.set(n.component,group);}this.buildMs=performance.now()-started;
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
  if(component!==undefined&&(!Number.isInteger(component)||component<0||component>=this.componentCount))return undefined;
  let best:NavNode|undefined,cost=Infinity;
  const candidates=component===undefined?this.nodes:this.componentNodes.get(component)!;
  const consider=(n:NavNode)=>{if(component!==undefined&&n.component!==component||Math.abs(n.y-p.y)>1.5)return;const d=gap(p,n);if(d<cost||best&&d===cost&&n.id<best.id){best=n;cost=d;}};
  const x=Math.round(p.x/this.spacing),z=Math.round(p.z/this.spacing);
  // Far outside / invalid queries retain the bounded full-scan behavior rather
  // than traversing an arbitrarily large empty grid. Normal actors are in-map.
  if(candidates.length<128||!Number.isFinite(x+z)||x<this.minCellX-1||x>this.maxCellX+1||z<this.minCellZ-1||z>this.maxCellZ+1){for(const n of candidates)consider(n);return best;}
  const visit=(ix:number,iz:number)=>{for(const n of this.cells.get(`${ix},${iz}`)??[])consider(n);};
  const radius=Math.max(x-this.minCellX,this.maxCellX-x,z-this.minCellZ,this.maxCellZ-z);
  for(let r=0;r<=radius;r++){
   if(r===0)visit(x,z);
   else{
    for(let ix=x-r;ix<=x+r;ix++){visit(ix,z-r);visit(ix,z+r);}
    for(let iz=z-r+1;iz<z+r;iz++){visit(x-r,iz);visit(x+r,iz);}
   }
   // Every unvisited node is at least this far horizontally. Strict comparison
   // plus a rounding margin retains exact global node-id ties at cell borders.
   const outside=Math.min(p.x-(x-r-1)*this.spacing,(x+r+1)*this.spacing-p.x,p.z-(z-r-1)*this.spacing,(z+r+1)*this.spacing-p.z);
   if(best&&cost+1e-8<outside)break;
   // A distant component or unsupported height can have no nearby candidates.
   // Bound empty-cell work; the exact component scan is cheaper in that case.
   if(r===4){for(const n of candidates)consider(n);break;}
  }return best;
 }
 path(from:Vec3,to:Vec3):NavNode[]{
  const a=this.nearest(from),b=this.nearest(to,a?.component);if(!a||!b)return [];
  const cost=new Float64Array(this.nodes.length).fill(Infinity),came=new Int32Array(this.nodes.length).fill(-1),open=new NavFrontier(this.nodes.length);cost[a.id]=0;open.set(a.id,gap(a,b));
  for(let visited=0;open.size&&visited<this.nodes.length;visited++){
   const id=open.pop();
   if(id===b.id){const path:NavNode[]=[];for(let n=id;n>=0;n=came[n])path.push(this.nodes[n]);return path.reverse();}
   for(const next of this.nodes[id].edges){const distance=cost[id]+gap(this.nodes[id],this.nodes[next]);if(distance<cost[next]){cost[next]=distance;came[next]=id;open.set(next,distance+gap(this.nodes[next],b));}}
  }
  return [];
 }
 reachable(from:Vec3):NavNode[]{const n=this.nearest(from);return n?this.nodes.filter(v=>v.component===n.component&&v.edges.length>0):[];}
 inspect(){return {nodes:this.nodes.length,edges:this.nodes.reduce((n,v)=>n+v.edges.length,0)/2,buildMs:this.buildMs,components:new Set(this.nodes.map(n=>n.component)).size};}
}
