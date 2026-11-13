/** Server-issued windows; clients only count down against the supplied server clock. */
export const SALE_HOUR=3600000, SALE_DURATION=600000;
export interface SaleWindow {hour:number;startsAt:number;endsAt:number;price:number}
export interface CrateOffer {version:1;serverTime:number;regularPrice:250;windows:SaleWindow[]}
export const cratePrice=(offer:CrateOffer,now:number):number=>offer.windows.find(w=>now>=w.startsAt&&now<w.endsAt)?.price??offer.regularPrice;
export function validCrateOffer(value:unknown):value is CrateOffer {
 const o=value as CrateOffer;
 return !!o&&o.version===1&&Number.isSafeInteger(o.serverTime)&&o.serverTime>=0&&o.regularPrice===250&&Array.isArray(o.windows)&&o.windows.length===2&&o.windows.every((w,i)=>
  !!w&&Number.isSafeInteger(w.hour)&&w.hour===Math.floor(o.serverTime/SALE_HOUR)*SALE_HOUR+i*SALE_HOUR&&Number.isSafeInteger(w.startsAt)&&w.startsAt>=w.hour&&w.startsAt<=w.hour+SALE_HOUR-SALE_DURATION&&w.endsAt===w.startsAt+SALE_DURATION&&Number.isInteger(w.price)&&w.price>=100&&w.price<=200);
}
