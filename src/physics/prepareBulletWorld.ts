import type {CollisionWorld} from './CollisionWorld';
import {prepareBulletMesh,type BulletMesh} from './BulletMesh';

/** Selected-map loading work, shared across all placements of each geometry.
 * Yield between assets so loading/cancel UI can run; never warm during combat. */
export async function prepareBulletWorld(world:CollisionWorld,signal?:AbortSignal):Promise<number>{
 const meshes=new Set<BulletMesh>();
 for(const collider of world.all())if(collider.bulletMesh)meshes.add(collider.bulletMesh);
 let since=performance.now();
 for(const mesh of meshes){
  signal?.throwIfAborted();prepareBulletMesh(mesh);
  if(performance.now()-since>=8){await new Promise(resolve=>setTimeout(resolve,0));since=performance.now();}
 }
 signal?.throwIfAborted();return meshes.size;
}
