import {SALE_HOUR,SALE_DURATION,type SaleWindow,type CrateOffer} from '../../shared/crateSales';
const random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/2**32;
export function saleWindow(hour:number,rng:()=>number=random):SaleWindow {
 const startsAt=hour+Math.floor(rng()*(SALE_HOUR-SALE_DURATION+1));
 return {hour,startsAt,endsAt:startsAt+SALE_DURATION,price:100+Math.round(100*Math.sqrt(rng()))};
}
/** Used only inside the canonical room's concurrency gate. Persist before publishing.
 * Two windows bound storage and let an open Shop cross the hour without a reroll. */
export class CrateSales {
 constructor(private storage:{get<T>(key:string):Promise<T|undefined>;put<T>(key:string,value:T):Promise<void>}){}
 async offer(now=Date.now()):Promise<CrateOffer>{
  const hour=Math.floor(now/SALE_HOUR)*SALE_HOUR,saved=await this.storage.get<SaleWindow[]>('crate-sales')??[];
  const windows=[hour,hour+SALE_HOUR].map(h=>saved.find(w=>w.hour===h)??saleWindow(h));
  if(JSON.stringify(saved)!==JSON.stringify(windows))await this.storage.put('crate-sales',windows);
  return {version:1,serverTime:now,regularPrice:250,windows};
 }
}
