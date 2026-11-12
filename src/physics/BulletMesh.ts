/** Reusable static triangle BVHs, independent of Babylon/graphics quality. */
export interface AlphaMask {width:number;height:number;bits:string;tile:number;flipY:boolean}
export interface BulletMesh {center:number[];half:number[];vertices:number[];indices:number[];masks?:AlphaMask[];masked?:Record<number,{mask:number;uv:number[]}>}
export interface BulletCatalog {version:number;sources:Record<string,string>;meshes:Record<string,BulletMesh>}
export interface SurfaceContact {distance:number;normal:{x:number;y:number;z:number};triangle:number;masked?:boolean}
const alphaCache=new WeakMap<AlphaMask,Uint8Array>();
export function opaqueAt(mesh:BulletMesh,triangle:number,u:number,v:number):boolean {
 const surface=mesh.masked?.[triangle];if(!surface)return true;
 const mask=mesh.masks![surface.mask];let bits=alphaCache.get(mask);if(!bits){bits=Uint8Array.from(atob(mask.bits),c=>c.charCodeAt(0));alphaCache.set(mask,bits);}
 const uv=surface.uv,s=(uv[0]*(1-u-v)+uv[2]*u+uv[4]*v)/mask.tile,t=(uv[1]*(1-u-v)+uv[3]*u+uv[5]*v)/mask.tile,wrap=(x:number)=>x-Math.floor(x);
 const x=Math.min(mask.width-1,Math.floor(wrap(s)*mask.width)),y=Math.min(mask.height-1,Math.floor((mask.flipY?1-wrap(t):wrap(t))*mask.height)),i=y*mask.width+x;
 return !!(bits[i>>3]&(1<<(i&7)));
}
type Node={min:number[];max:number[];left?:Node;right?:Node;triangles?:number[]};
const cache=new WeakMap<BulletMesh,Node>();
const point=(mesh:BulletMesh,triangle:number,corner:number)=>mesh.indices[triangle*3+corner]*3;
function tree(mesh:BulletMesh):Node {
 let root=cache.get(mesh);if(root)return root;
 const build=(triangles:number[]):Node=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const t of triangles)for(let k=0;k<3;k++){const i=point(mesh,t,k);for(let a=0;a<3;a++){min[a]=Math.min(min[a],mesh.vertices[i+a]);max[a]=Math.max(max[a],mesh.vertices[i+a]);}}
  if(triangles.length<=8)return {min,max,triangles};const spans=max.map((v,i)=>v-min[i]),axis=spans.indexOf(Math.max(...spans));const center=(t:number)=>[0,1,2].reduce((n,k)=>n+mesh.vertices[point(mesh,t,k)+axis],0);triangles.sort((a,b)=>center(a)-center(b));const mid=triangles.length>>1;return {min,max,left:build(triangles.slice(0,mid)),right:build(triangles.slice(mid))};};
 root=build(Array.from({length:mesh.indices.length/3},(_,i)=>i));cache.set(mesh,root);return root;
}
function bounds(node:Node,o:readonly number[],d:readonly number[],limit:number):boolean {let near=0,far=limit;for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-12){if(o[a]<node.min[a]-1e-7||o[a]>node.max[a]+1e-7)return false;}else {const p=(node.min[a]-o[a])/d[a],q=(node.max[a]-o[a])/d[a];near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));if(near>far+1e-7)return false;}}return true;}
/** Two-sided surfaces: correct exit hits even when the ray starts inside a prop. */
export function rayBulletMesh(mesh:BulletMesh,o:readonly number[],d:readonly number[],limit:number):SurfaceContact|null {
 if(!mesh.indices.length)return null;let best:SurfaceContact|null=null;const v=mesh.vertices;
 const visit=(node:Node)=>{if(!bounds(node,o,d,best?.distance??limit))return;if(node.left){visit(node.left);visit(node.right!);return;}
  for(const t of node.triangles!){const a=point(mesh,t,0),b=point(mesh,t,1),c=point(mesh,t,2),e=[v[b]-v[a],v[b+1]-v[a+1],v[b+2]-v[a+2]],f=[v[c]-v[a],v[c+1]-v[a+1],v[c+2]-v[a+2]];
   const p=[d[1]*f[2]-d[2]*f[1],d[2]*f[0]-d[0]*f[2],d[0]*f[1]-d[1]*f[0]],det=e[0]*p[0]+e[1]*p[1]+e[2]*p[2];if(Math.abs(det)<1e-12)continue;
   const s=[o[0]-v[a],o[1]-v[a+1],o[2]-v[a+2]],u=(s[0]*p[0]+s[1]*p[1]+s[2]*p[2])/det;if(u< -1e-7||u>1+1e-7)continue;
   const q=[s[1]*e[2]-s[2]*e[1],s[2]*e[0]-s[0]*e[2],s[0]*e[1]-s[1]*e[0]],w=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;if(w< -1e-7||u+w>1+1e-7)continue;
   const distance=(f[0]*q[0]+f[1]*q[1]+f[2]*q[2])/det;if(distance<1e-6||distance>(best?.distance??limit)+1e-8||!opaqueAt(mesh,t,u,w))continue;
   let nx=e[1]*f[2]-e[2]*f[1],ny=e[2]*f[0]-e[0]*f[2],nz=e[0]*f[1]-e[1]*f[0];let n=Math.hypot(nx,ny,nz);if(!n)continue;if(nx*d[0]+ny*d[1]+nz*d[2]>0)n=-n;nx/=n;ny/=n;nz/=n;best={distance,normal:{x:nx,y:ny,z:nz},triangle:t,masked:!!mesh.masked?.[t]};
  }
 };visit(tree(mesh));return best;
}
/** BVH query for decal clipping. No scan of the whole map or asset per impact. */
export function surfaceTriangles(mesh:BulletMesh,min:readonly number[],max:readonly number[]):number[]{const out:number[]=[];if(!mesh.indices.length)return out;const visit=(n:Node)=>{if(n.min.some((v,i)=>v>max[i]||n.max[i]<min[i]))return;if(n.triangles)out.push(...n.triangles);else{visit(n.left!);visit(n.right!);}};visit(tree(mesh));return out;}
