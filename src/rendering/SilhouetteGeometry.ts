import {AbstractMesh,Mesh,VertexData,type Material,type Scene} from '@babylonjs/core';
import {finalizeStatic} from './StaticBatcher';

/** The outline mask already draws static surfaces with ONE unlit black material.
 * Combine those identical draws per cell, retaining exact positions/indices.
 * Never merge live props, weapons, skeletons or the toggled foliage LOD sets. */
export function batchSilhouetteGeometry(scene:Scene,sources:readonly AbstractMesh[],material:Material):{meshes:Mesh[];sources:Set<AbstractMesh>}{
 const groups=new Map<string,Mesh[]>(),used=new Set<AbstractMesh>();
 for(const source of sources){
  const canonical=source.metadata?.canonical as string|undefined;
  if(!(source instanceof Mesh)||!source.name.startsWith('batch:')||!source.isWorldMatrixFrozen||!source.getWorldMatrix().isIdentity()
   ||source.skeleton||source.morphTargetManager||!source.isEnabled()||!source.isVisible||/^leaf_(bush|ivy)/.test(canonical??''))continue;
  const key=source.name.split('|').slice(1,3).join('|'),group=groups.get(key)??[];group.push(source);groups.set(key,group);
 }
 const meshes:Mesh[]=[];
 for(const [key,group]of groups){
  // No benefit from copying a singleton. Null/missing CPU buffers stay on the
  // original path rather than silently dropping an occluder.
  const entries=group.map(mesh=>({mesh,p:mesh.getVerticesData('position'),i:mesh.getIndices()}));
  if(entries.length<2||entries.some(e=>!e.p||!e.i))continue;
  const positions=new Float32Array(entries.reduce((n,e)=>n+e.p!.length,0)),indices=new Uint32Array(entries.reduce((n,e)=>n+e.i!.length,0));
  let vo=0,io=0;
  for(const e of entries){positions.set(e.p!,vo);for(let k=0;k<e.i!.length;k++)indices[io++]=e.i![k]+vo/3;vo+=e.p!.length;used.add(e.mesh);}
  const mesh=new Mesh('silhouette:static:'+key,scene),data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);
  mesh.material=material;mesh.isPickable=false;
  // Explicit RTT lists ignore layer masks by default. The normal camera never
  // draws this proxy; it has no canonical metadata, shadows or gameplay role.
  mesh.layerMask=0;finalizeStatic(mesh);meshes.push(mesh);
 }
 return {meshes,sources:used};
}
