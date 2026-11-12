import type {AbstractMesh,BaseTexture,Material,Scene} from '@babylonjs/core';
import {visualCosmetic,patchCosmetic} from './CosmeticAssets';
import type {CosmeticCategory} from '../../shared/cosmetics';
import type {MaterialLibrary} from './MaterialLibrary';
/** A material-only variant cache. Build off-mesh so stale async loads cannot overwrite a newer skin. */
export class CosmeticMaterials {
 private readonly variants=new Map<string,{slots:{material:Material|null}[];materials:Material[];textures:BaseTexture[];ready:Promise<void>}>();
 private readonly base:{material:Material|null}[];
 private wanted='';private disposed=false;
 constructor(private meshes:readonly AbstractMesh[],private scene:Scene,private library:MaterialLibrary,private category:CosmeticCategory){
  this.base=meshes.map(m=>({material:m.material}));
 }
 async apply(id?:string):Promise<void>{
  if(this.disposed)return;
  const item=visualCosmetic(this.category,id);this.wanted=item.id;
  let variant=this.variants.get(item.id);
  if(!variant){
   const slots=this.base.map(m=>({...m})),materials:Material[]=[],textures:BaseTexture[]=[];
   const ready=patchCosmetic({meshes:slots,materials,textures},item,this.scene,this.library);
   variant={slots,materials,textures,ready};this.variants.set(item.id,variant);
  }
  try{await variant.ready;}catch(error){
   if(this.variants.get(item.id)===variant){this.variants.delete(item.id);variant.materials.forEach(m=>m.dispose());variant.textures.forEach(t=>t.dispose());}
   throw error;
  }
  if(!this.disposed&&this.wanted===item.id)this.meshes.forEach((mesh,i)=>{mesh.material=variant.slots[i].material;});
 }
 get size():number{return this.variants.size;}
 dispose():void {this.disposed=true;for(const v of this.variants.values()){v.materials.forEach(m=>m.dispose());v.textures.forEach(t=>t.dispose());}this.variants.clear();}
}
