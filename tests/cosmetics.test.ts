import { visualCosmetic } from '../src/rendering/CosmeticAssets';
import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import {COSMETICS,WEAPON_CATEGORIES,defaultCosmetic,defaultEquipment,normalizeInventory,validInventory,compatibleCosmetic,validCosmeticReference,RARITIES,CRATE} from '../shared/cosmetics';
import {CosmeticsClient} from '../src/network/CosmeticsClient';
import type {CareerClient} from '../src/network/CareerClient';
const view=()=>({...normalizeInventory(),version:1,serverTime:Date.now()});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('catalog keeps five gun starters and the paired Common Default Daggers starter, with separate weapon categories and original GLBs',()=>{
 const starters=COSMETICS.filter(c=>c.ownership==='starter');expect(starters).toHaveLength(WEAPON_CATEGORIES.length);expect(new Set(COSMETICS.map(c=>c.id)).size).toBe(COSMETICS.length);
 for(const w of WEAPON_CATEGORIES){const c=COSMETICS.find(c=>c.id===defaultCosmetic(w))!;expect(c).toMatchObject({weapon:w,name:w==='melee'?'Default Daggers':'Default',rarity:'common',ownership:'starter',compatibleWith:[w]});expect(c.asset.model).toBe(w==='melee'?'assets/models/shared/melee/dagger_r.glb':`assets/models/shared/weapons/${w==='semi-sniper'?'semi_sniper':w}.glb`);expect(fs.existsSync('public/'+c.asset.model)).toBe(true);}
});
it('restores missing starters, repairs cross-category equipment, and separates inventory from money and combat',()=>{
 const p=normalizeInventory({owned:[],equipped:{...defaultEquipment(),rifle:'default-sniper'},revision:8});expect(p.owned).toHaveLength(WEAPON_CATEGORIES.length);expect(p.equipped).toEqual(defaultEquipment());expect(p.revision).toBe(8);
 expect(Object.keys(p).sort()).toEqual(['equipped','owned','revision']);expect(compatibleCosmetic('default-shotgun','rifle')).toBe(false);expect(compatibleCosmetic('unowned-gold','rifle')).toBe(false);
});
it('validates bounded inventories, ownership, exact fields and matching equipment',()=>{
 expect(validInventory(view())).toBe(true);
 for(const patch of [{version:2},{gems:300},{owned:[]},{revision:-1},{equipped:{...defaultEquipment(),sniper:'default-rifle'}},{owned:[...view().owned,'unowned']},{owned:[...view().owned,'default-rifle']}])expect(validInventory({...view(),...patch})).toBe(false);
});
it('rarities have explicit presentation colors and the crate odds cover the live pool at 100%',()=>{
 expect(Object.keys(RARITIES)).toEqual(['common','uncommon','rare','epic','legendary']);expect(RARITIES.epic.color).toBe('#ed7b82');expect(RARITIES.legendary.color).toBe('#eac567');
 expect(CRATE).toMatchObject({available:true,price:300});expect(CRATE.distribution.map(d=>d.rarity)).toEqual(['uncommon','rare','legendary']);expect(CRATE.distribution.reduce((n,d)=>n+d.percent,0)).toBe(100);
 expect(JSON.parse(fs.readFileSync('public/assets/cosmetics/catalog.json','utf8')).items).toEqual(COSMETICS);
});
it('fetches server inventory using the existing capability, never browser ownership or gem claims',async()=>{
 const fetch=vi.fn().mockImplementation(async()=>Response.json(view()));vi.stubGlobal('fetch',fetch);const career={ensure:vi.fn(async()=>{}),joinCredential:()=> 'a'.repeat(64)} as unknown as CareerClient;
 const client=new CosmeticsClient('wss://backend.example/ws',career),signal=new AbortController().signal;await client.load(signal);await client.equip('default-rifle',signal);
 expect(String(fetch.mock.calls[0][0])).toBe('https://backend.example/cosmetics');expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer '+'a'.repeat(64));expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({version:1,id:'default-rifle'});
 expect(String(fetch.mock.calls[1][0])).not.toContain('a'.repeat(64));
});
it('rejects invalid or unowned equipment responses and keeps the last server inventory on failure',async()=>{
 const fetch=vi.fn().mockImplementation(async()=>Response.json(view()));vi.stubGlobal('fetch',fetch);const career={ensure:async()=>{},joinCredential:()=> 'a'.repeat(64)} as unknown as CareerClient,client=new CosmeticsClient('ws://localhost/ws',career),signal=new AbortController().signal;
 await client.load(signal);const old=client.view;fetch.mockResolvedValue(Response.json({error:'You do not own this cosmetic'},{status:403}));await expect(client.equip('unowned',signal)).rejects.toThrow('do not own');expect(client.view).toBe(old);
 fetch.mockResolvedValue(Response.json({...view(),owned:[]}));await expect(client.load(signal)).rejects.toThrow('incompatible');
});

it('unknown future visual references fall back to Default while known incompatible equipment stays invalid',()=>{
 expect(validCosmeticReference('future-rifle','rifle')).toBe(true);expect(visualCosmetic('rifle','future-rifle').id).toBe('default-rifle');expect(validCosmeticReference('default-sniper','rifle')).toBe(false);
 expect(validCosmeticReference('../rifle','rifle')).toBe(false);expect(validCosmeticReference('future-rifle',null)).toBe(false);
});

it('retries ambiguous crate transport and server failures with the same receipt, then starts a fresh purchase',async()=>{
 const inventory={...view(),owned:[...view().owned,'rich-melee']},result={version:1,item:'rich-melee',gems:0,inventory};
 const fetch=vi.fn().mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce(Response.json({error:'Response lost after commit'},{status:502})).mockImplementation(async()=>Response.json(result));
 vi.stubGlobal('fetch',fetch);const career={ensure:async()=>{},joinCredential:()=> 'a'.repeat(64)} as unknown as CareerClient,client=new CosmeticsClient('ws://localhost/ws',career),signal=new AbortController().signal;
 await expect(client.openCrate(signal)).rejects.toThrow('connection lost');await expect(client.openCrate(signal)).rejects.toThrow('after commit');await expect(client.openCrate(signal)).resolves.toMatchObject({item:'rich-melee'});
 const requests=()=>fetch.mock.calls.map(c=>JSON.parse(c[1].body));expect(requests()[0].requestId).toBeTruthy();expect(requests()[1]).toEqual(requests()[0]);expect(requests()[2]).toEqual(requests()[0]);
 await client.openCrate(signal);expect(requests()[3].requestId).not.toBe(requests()[0].requestId);
});
