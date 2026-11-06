import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {COSMETICS,defaultCosmetic,cosmetic,RARITIES,FUTURE_CRATE} from '../shared/cosmetics.ts';
const expected=JSON.parse(fs.readFileSync('public/assets/cosmetics/catalog.json','utf8'));assert.deepEqual(expected.crate,{...FUTURE_CRATE,preview:'assets/cosmetics/crate/preview.svg'});assert.deepEqual(expected.items,JSON.parse(JSON.stringify(COSMETICS)),'Regenerate cosmetics manifest with node tools/export-cosmetics.mjs');
const local=file=>{assert.match(file,/^assets\/(?:cosmetics|models\/shared\/weapons)\/[a-zA-Z0-9_./-]+$/);assert.ok(!file.split('/').includes('..'));const p=path.resolve('public',file);assert.ok(p.startsWith(path.resolve('public')+path.sep));assert.ok(fs.existsSync(p),'Missing cosmetic asset '+file);return p;};
const glb=file=>{const b=fs.readFileSync(local(file));assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(16),0x4e4f534a);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString('utf8').trim());};
const ids=new Set();
for(const item of COSMETICS){
 assert.match(item.id,/^[a-z0-9][a-z0-9-]{0,63}$/);assert.ok(RARITIES[item.rarity]);assert.ok(['starter','grant'].includes(item.ownership));assert.ok(['shared','embedded'].includes(item.asset.binding));
 assert.ok(!ids.has(item.id));ids.add(item.id);assert.ok(item.compatibleWith.includes(item.weapon));const model=glb(item.asset.model),base=glb(cosmetic(defaultCosmetic(item.weapon)).asset.model);
 for(const name of ['grip_r','grip_l','muzzle','sight','eject','mag_grip','port','bolt_grip']){
  const ref=base.nodes.find(n=>n.name===name);if(!ref)continue;const anchor=model.nodes.find(n=>n.name===name);assert.ok(anchor,item.id+' missing '+name);
  for(const field of ['translation','rotation','scale']){const fallback=field==='rotation'?[0,0,0,1]:field==='scale'?[1,1,1]:[0,0,0],a=anchor[field]??fallback,b=ref[field]??fallback;assert.ok(a.every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<.003),item.id+' incompatible '+name+' '+field);}
 }
 for(const name of ['mag','pump','bolt','shell'])if(base.nodes.some(n=>n.name===name))assert.ok(model.nodes.some(n=>n.name===name),item.id+' missing animated '+name);
 for(const [name,patch]of Object.entries(item.asset.materials??{})){assert.ok(model.materials?.some(m=>m.name===name),'Unknown material '+name);for(const key of ['roughness','metallic'])if(patch[key]!==undefined)assert.ok(Number.isFinite(patch[key])&&patch[key]>=0&&patch[key]<=1);if(patch.color)assert.match(patch.color,/^#[a-fA-F0-9]{6}$/);}
 if(item.preview)local(item.preview);for(const patch of Object.values(item.asset.materials??{}))for(const key of ['albedo','normal','orm'])if(patch[key])local(patch[key]);
}
console.log('Cosmetics verified: '+COSMETICS.length+' catalog items, compatible anchors, models and textures.');
if(fs.existsSync('public/assets/cosmetics/foundry-collection.json'))await import('./verify-cosmetic-collection.mjs');
