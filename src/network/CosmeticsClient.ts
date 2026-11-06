import { COSMETICS_API_VERSION, validCrateResult, validInventory, type CrateResult, type InventoryView } from '../../shared/cosmetics';
import type { CareerClient } from './CareerClient';
import { presenceEndpoint } from './endpoint';
export class CosmeticsClient {
  view:InventoryView|null=null;
  onChange:()=>void=()=>{};
  constructor(private endpoint:string,private career:CareerClient){}
  private async request(signal:AbortSignal,id?:string):Promise<InventoryView>{
    if(!this.career.joinCredential())await this.career.ensure();signal.throwIfAborted();const token=this.career.joinCredential();
    if(!token)throw Error('Guest inventory unavailable. Please retry.');
    const url=presenceEndpoint(this.endpoint);url.pathname=id?'/cosmetics/equip':'/cosmetics';
    const response=await fetch(url,{method:id?'POST':'GET',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
      headers:{Authorization:`Bearer ${token}`,...(id?{'Content-Type':'application/json'}:{})},...(id?{body:JSON.stringify({version:COSMETICS_API_VERSION,id})}:{})});
    const data=await response.json().catch(()=>null);if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'Inventory unavailable. Update the multiplayer server and retry.');
    if(!validInventory(data))throw Error('Inventory response is incompatible. Refresh after the server update.');
    if(!this.view||data.revision>=this.view.revision){this.view=data;this.onChange();}return this.view!;
  }
  /** Server-authoritative crate: the server spends gems and picks the item. */
  async openCrate(signal:AbortSignal):Promise<CrateResult>{
    if(!this.career.joinCredential())await this.career.ensure();signal.throwIfAborted();const token=this.career.joinCredential();
    if(!token)throw Error('Guest inventory unavailable. Please retry.');
    const url=presenceEndpoint(this.endpoint);url.pathname='/cosmetics/open';
    // No client timeout abort here: a purchase in flight must report its real outcome.
    const response=await fetch(url,{method:'POST',cache:'no-store',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({version:COSMETICS_API_VERSION})});
    const data=await response.json().catch(()=>null);if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'Crate unavailable. Update the multiplayer server and retry.');
    if(!validCrateResult(data))throw Error('Crate response is incompatible. Refresh after the server update.');
    if(!this.view||data.inventory.revision>=this.view.revision){this.view=data.inventory;this.onChange();}return data;
  }
  load(signal:AbortSignal){return this.request(signal);}
  equip(id:string,signal:AbortSignal){return this.request(signal,id);}
}
