import { COSMETICS_API_VERSION, validInventory, type InventoryView } from '../../shared/cosmetics';
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
  load(signal:AbortSignal){return this.request(signal);}
  equip(id:string,signal:AbortSignal){return this.request(signal,id);}
}
