import type {RayHit} from './CollisionWorld';
import {surfaceTriangles} from './BulletMesh';
export const MARK_VERTICES=192;
export const MARK_OFFSET=.001;
export interface SurfaceMark {positions:number[];uvs:number[];normals:number[]}
/** Clip the original prop triangles into a small decal volume. Marks conform to
 * curves and stop exactly at mesh silhouettes/gaps, including sharp corners. */
export function propImpactMark(hit:RayHit,size=.1,angle=0):SurfaceMark|null {
 const c=hit.collider,mesh=c.bulletMesh;if(!mesh)return null;
 const n=[hit.normal.x,hit.normal.y,hit.normal.z],seed=Math.abs(n[1])>.95?[0,0,1]:[0,1,0];
 const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a:number[],b:number[])=>a.reduce((v,x,i)=>v+x*b[i],0);
 const norm=(a:number[])=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
 const right=norm(cross(seed,n)),up=cross(n,right),co=Math.cos(angle),si=Math.sin(angle),u=right.map((v,i)=>v*co+up[i]*si),v=up.map((x,i)=>x*co-right[i]*si);
 const p=[hit.point.x,hit.point.y,hit.point.z],radius=size*.8+.025;
 const local=[(p[0]-c.cx)*c.cos-(p[2]-c.cz)*c.sin,p[1]-c.cy,(p[0]-c.cx)*c.sin+(p[2]-c.cz)*c.cos];
 const triangles=surfaceTriangles(mesh,local.map(x=>x-radius),local.map(x=>x+radius)),positions:number[]=[],uvs:number[]=[],normals:number[]=[];
 for(const t of triangles){
  if(mesh.masked?.[t])continue;
  const original=[0,1,2].map(k=>{const i=mesh.indices[t*3+k]*3,x=mesh.vertices[i],y=mesh.vertices[i+1],z=mesh.vertices[i+2];return [x*c.cos+z*c.sin+c.cx,y+c.cy,-x*c.sin+z*c.cos+c.cz];});
  let normal=norm(cross(original[1].map((x,i)=>x-original[0][i]),original[2].map((x,i)=>x-original[0][i])));const facing=dot(normal,n);if(Math.abs(facing)<.2||!Number.isFinite(facing))continue;if(facing<0)normal=normal.map(x=>-x);
  let polygon=original.map(q=>{const d=q.map((x,i)=>x-p[i]);return [dot(d,u),dot(d,v),dot(d,n)];});
  for(const [axis,sign,limit]of [[0,1,size/2],[0,-1,size/2],[1,1,size/2],[1,-1,size/2],[2,1,.02],[2,-1,.02]]){
   const clipped:number[][]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=limit-sign*a[axis],db=limit-sign*b[axis];if(da>=0)clipped.push(a);if((da>=0)!==(db>=0)){const f=da/(da-db);clipped.push(a.map((x,k)=>x+(b[k]-x)*f));}}polygon=clipped;if(polygon.length<3)break;
  }
  for(let k=1;k+1<polygon.length&&positions.length/3+3<=MARK_VERTICES;k++)for(const q of [polygon[0],polygon[k],polygon[k+1]]){positions.push(...p.map((x,i)=>x+u[i]*q[0]+v[i]*q[1]+n[i]*q[2]+normal[i]*MARK_OFFSET));uvs.push(q[0]/size+.5,q[1]/size+.5);normals.push(...normal);}
 }
 return {positions,uvs,normals};
}
