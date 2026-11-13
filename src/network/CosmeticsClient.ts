import { COSMETICS_API_VERSION, validCrateResult, validInventory, type CrateResult, type InventoryView } from '../../shared/cosmetics';
import type { CareerClient } from './CareerClient';
import { presenceEndpoint } from './endpoint';
import {validCrateOffer,type CrateOffer} from '../../shared/crateSales';
export class CosmeticsClient {
  view:InventoryView|null=null;
  private crateRequestId:string|null=null;
  private crateExpectedPrice:number|undefined;
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
  async openCrate(signal:AbortSignal,expectedPrice?:number):Promise<CrateResult>{
    if(!this.career.joinCredential())await this.career.ensure();signal.throwIfAborted();const token=this.career.joinCredential();
    if(!token)throw Error('Guest inventory unavailable. Please retry.');
    const url=presenceEndpoint(this.endpoint);url.pathname='/cosmetics/open';
    if(!this.crateRequestId){this.crateRequestId=crypto.randomUUID();this.crateExpectedPrice=expectedPrice;}
    const requestId=this.crateRequestId;
    // No client timeout abort here: a purchase in flight must report its real outcome.
    const response=await fetch(url,{method:'POST',cache:'no-store',signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({version:COSMETICS_API_VERSION,requestId,...(this.crateExpectedPrice===undefined?{}:{expectedPrice:this.crateExpectedPrice})})});
    // A 5xx can arrive after a committed purchase. Preserve its receipt ID just
    // as for a lost connection; only a definite client rejection starts fresh.
    const data=await response.json().catch(()=>null);if(!response.ok){if(response.status<500)this.crateRequestId=null;throw Error(typeof data?.error==='string'?data.error:'Crate unavailable. Update the multiplayer server and retry.');}
    if(!validCrateResult(data))throw Error('Crate response is incompatible. Refresh after the server update.');
    this.crateRequestId=null;
    if(!this.view||data.inventory.revision>=this.view.revision){this.view=data.inventory;this.onChange();}return data;
  }
  load(signal:AbortSignal){return this.request(signal);}
  async offer(signal:AbortSignal):Promise<CrateOffer>{
    const url=presenceEndpoint(this.endpoint);url.pathname='/cosmetics/offer';
    const response=await fetch(url,{signal,cache:'no-store'}),data=await response.json();
    if(!response.ok||!validCrateOffer(data))throw Error('Crate pricing unavailable. Refresh after the server update.');return data;
  }
  equip(id:string,signal:AbortSignal){return this.request(signal,id);}
}
