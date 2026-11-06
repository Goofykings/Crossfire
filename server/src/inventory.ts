import { COSMETICS_API_VERSION, cosmetic, normalizeInventory, type CosmeticInventory, type InventoryView } from '../../shared/cosmetics';
import { careerIdentity, validCareerCredential } from './careers';
/** Separate KV records: cosmetic writes cannot overwrite gems/challenges/statistics. */
export class Inventory {
  constructor(private storage:DurableObjectStorage,private exists:(id:string)=>Promise<unknown>){}
  async get(identity:string):Promise<InventoryView>{
    if(!await this.exists(identity))throw new Error('Guest profile unavailable.');
    const saved=await this.storage.get<CosmeticInventory>('inventory:'+identity),inventory=normalizeInventory(saved);
    if(JSON.stringify(saved)!==JSON.stringify(inventory))await this.storage.put('inventory:'+identity,inventory);
    return {...inventory,version:COSMETICS_API_VERSION,serverTime:Date.now()};
  }
  async http(request:Request):Promise<{response:Response;identity?:string;view?:InventoryView}>{
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
    if(!validCareerCredential(token))return {response:Response.json({error:'A valid guest credential is required.'},{status:401})};
    const identity=await careerIdentity(token);if(!await this.exists(identity))return {response:Response.json({error:'Guest profile not found.'},{status:401})};
    const view=await this.get(identity);
    if(request.method==='GET')return {response:Response.json(view)};
    const body=await request.json() as Record<string,unknown>;
    if(!body||Object.keys(body).some(k=>!['version','id'].includes(k))||body.version!==COSMETICS_API_VERSION||typeof body.id!=='string')
      return {response:Response.json({error:'Invalid equipment request.'},{status:400})};
    const item=cosmetic(body.id);
    if(!item||!view.owned.includes(item.id)||!item.compatibleWith.includes(item.weapon))return {response:Response.json({error:'You do not own this compatible cosmetic.'},{status:403})};
    if(view.equipped[item.weapon]===item.id)return {response:Response.json(view)};
    view.equipped[item.weapon]=item.id;view.revision++;
    await this.storage.put('inventory:'+identity,{revision:view.revision,owned:view.owned,equipped:view.equipped});
    return {response:Response.json(view),identity,view};
  }
}
