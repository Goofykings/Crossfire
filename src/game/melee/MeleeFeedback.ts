import {MELEE} from '../../../shared/melee';
import type {MeleeResult} from '../../../shared/protocol';
/** Per-session presentation guard; the transport also deduplicates authoritative events. */
export class MeleeFeedback {
 private readonly seen=new Set<string>();
 accept(event:MeleeResult,now:number):boolean {
  if(this.seen.has(event.id))return false;this.seen.add(event.id);
  if(this.seen.size>256)this.seen.delete(this.seen.values().next().value!);
  const meta=MELEE.attacks[event.stage-1];
  return now-event.at>=-50&&now-event.at<=meta.duration-meta.contact;
 }
}
