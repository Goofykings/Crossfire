import {afterEach,expect,it,vi} from 'vitest';
import {saleWindow,CrateSales} from '../server/src/crateSales';
import {cratePrice,validCrateOffer,SALE_DURATION,SALE_HOUR} from '../shared/crateSales';
import {normalizeInventory,defaultEquipment,cosmetic,validCosmeticReference,killEffect,CRATE} from '../shared/cosmetics';
import {isDeveloper,developerAccounts} from '../server/src/developers';
import {eliminationEffect} from '../shared/eliminationCosmetics';
import {LegendaryEffects} from '../src/game/LegendaryEffects';
import type {Elimination} from '../shared/protocol';
import {parseClientMessage,PROTOCOL_VERSION} from '../shared/protocol';
afterEach(()=>vi.restoreAllMocks());
it('sale windows cover ten minutes, start within minutes 0..50 and favor higher prices',()=>{
 let seed=12345;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;let total=0;
 for(let i=0;i<20000;i++){const w=saleWindow(i*SALE_HOUR,rng);expect(w.startsAt).toBeGreaterThanOrEqual(w.hour);expect(w.startsAt).toBeLessThanOrEqual(w.hour+3000000);expect(w.endsAt-w.startsAt).toBe(SALE_DURATION);expect(w.price).toBeGreaterThanOrEqual(100);expect(w.price).toBeLessThanOrEqual(200);total+=w.price;}
 expect(total/20000).toBeGreaterThan(166);expect(total/20000).toBeLessThan(168);
 expect(saleWindow(0,()=>0)).toEqual({hour:0,startsAt:0,endsAt:600000,price:100});
});
it('persisted canonical offers survive another adapter, restart and hour rollover; expiry is exclusive',async()=>{
 const records=new Map<string,unknown>(),storage={get:async(k:string)=>structuredClone(records.get(k)),put:async(k:string,v:unknown)=>{records.set(k,structuredClone(v));}} as ConstructorParameters<typeof CrateSales>[0];
 const a=new CrateSales(storage),offer=await a.offer(100000);expect(validCrateOffer(offer)).toBe(true);expect(await new CrateSales(storage).offer(100000)).toEqual(offer);
 const w=offer.windows[0];expect(cratePrice(offer,w.startsAt-1)).toBe(CRATE.price);expect(cratePrice(offer,w.startsAt)).toBe(w.price);expect(cratePrice(offer,w.endsAt-1)).toBe(w.price);expect(cratePrice(offer,w.endsAt)).toBe(250);
 expect((await a.offer(SALE_HOUR+10)).windows[0]).toEqual(offer.windows[1]);expect(records.size).toBe(1);
 expect(validCrateOffer({...offer,windows:[{...w,endsAt:w.endsAt+1},offer.windows[1]]})).toBe(false);
});
it('Darkness migration removes only retired ownership/equipment, retains revised rarities and all unrelated inventory',()=>{
 const inventory=normalizeInventory({revision:7,owned:['darkness-rifle','darkness-melee','blossom-rifle','rainbow-glow-melee'],equipped:{...defaultEquipment(),rifle:'darkness-rifle',melee:'rainbow-glow-melee'}});
 expect(inventory.revision).toBe(7);expect(inventory.owned).not.toContain('darkness-rifle');expect(inventory.owned).toContain('blossom-rifle');expect(inventory.equipped.rifle).toBe('default-rifle');expect(inventory.equipped.melee).toBe('rainbow-glow-melee');
 expect(cosmetic('darkness-melee')).toBeUndefined();expect(validCosmeticReference('darkness-rifle','rifle')).toBe(false);expect(killEffect('blossom-rifle')).toBe('blossom-flower-burst');expect(killEffect('frosted-rifle')).toBe('frosted-blizzard');
});
it('developer designation accepts configured verified hashes only; no join message can claim a badge',()=>{
 const id='a'.repeat(64);expect(developerAccounts(`${id},Name,not-a-hash,${id}`)).toEqual([id]);expect(isDeveloper(id,id)).toBe(true);expect(isDeveloper(id)).toBe(false);expect(isDeveloper('Name',id)).toBe(false);
 expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'join',name:'Developer',developer:true}))).toBeNull();
});
it('kill effects capture equipped attack cosmetics/position and deduplicate confirmed Legendary dispatch',()=>{
 const equipment={...defaultEquipment(),rifle:'blossom-rifle',melee:'rich-melee'},position={x:1,y:2,z:3};const effect=eliminationEffect(equipment,'rifle',position)!;position.x=99;
 expect(effect).toEqual({effect:'blossom-flower-burst',cosmeticId:'blossom-rifle',position:{x:1,y:2,z:3}});equipment.rifle='frosted-rifle';expect(effect.effect).toBe('blossom-flower-burst');
 expect(eliminationEffect(equipment,'grenade',position)).toBeUndefined();expect(eliminationEffect({...equipment,rifle:'blossom-smg'},'rifle',position)).toBeUndefined();
 const dispatcher=new LegendaryEffects(),play=vi.fn();dispatcher.onEffect=play;const event={id:'confirmed',cosmeticEffect:effect} as Elimination;dispatcher.accept(event);dispatcher.accept(structuredClone(event));expect(play).toHaveBeenCalledTimes(1);
});
