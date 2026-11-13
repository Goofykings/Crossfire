import type {Elimination} from '../../shared/protocol';
/** Integration seam for the forthcoming particle renderers. No fabricated VFX.
 * One confirmed event dispatch per ID, even if a consumer receives it twice. */
export class LegendaryEffects {
 private seen=new Set<string>();
 onEffect:(effect:NonNullable<Elimination['cosmeticEffect']>,event:Elimination)=>void=()=>{};
 accept(event:Elimination):void{
  if(!event.cosmeticEffect||event.cosmeticEffect.effect==='money'||this.seen.has(event.id))return;
  this.seen.add(event.id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value!);this.onEffect(event.cosmeticEffect,event);
 }
}
