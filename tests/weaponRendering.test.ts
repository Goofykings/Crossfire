import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Mesh,NullEngine,PBRMaterial,Scene,type AbstractMesh,type AssetContainer} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {COSMETICS,WEAPON_CATEGORIES,type CosmeticDefinition} from '../shared/cosmetics';
import {ANIMATION_ONLY_NODES,loadCosmeticAsset,normalizeWeaponMeshes} from '../src/rendering/CosmeticAssets';
import type {MaterialLibrary} from '../src/rendering/MaterialLibrary';

/** Weapon rendering integrity (docs/WEAPON_RENDERING.md). Loads every cosmetic through the real shared loader, which is the path of the
 * first-person view, third-person characters, Locker, Shop reveal and thumbnails. Tools: tools/review-weapon-angles.mjs (in-engine
 * multi-angle sheets), tools/weapon_face_classes.py (face orientation of every generated solid). */
const ANCHORS:Record<string,string[]>={
  rifle:['muzzle','sight','eject','grip_r','grip_l','mag','mag_grip'], smg:['muzzle','sight','eject','grip_r','grip_l','mag','mag_grip'],
  sniper:['muzzle','sight','eject','grip_r','grip_l','mag','mag_grip','bolt','bolt_grip'], 'semi-sniper':['muzzle','sight','eject','grip_r','grip_l','mag','mag_grip'],
  shotgun:['muzzle','sight','eject','grip_r','grip_l','pump','port','shell'],
  melee:['dagger_r_mesh','guard_r','pommel_r','tip_r','dagger_l_mesh','guard_l','pommel_l','tip_l'],
};
/** Materials that are meant to be see-through; everything else must render in the opaque (depth-writing) pass. */
const TRANSLUCENT=new Set(['gun_glass','reticle_holo','gun_lens','scope_glass']);

let engine:NullEngine,scene:Scene;
const containers=new Map<string,AssetContainer>();
// Stands in for MaterialLibrary: one named PBR material per request, like the real library (translucent ones get their alpha).
const shared=()=>{const made=new Map<string,PBRMaterial>();return {get:(name:string)=>{let m=made.get(name);if(!m){m=new PBRMaterial(`lib:${name}`,scene);if(TRANSLUCENT.has(name)){m.alpha=.16;m.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;}made.set(name,m);}return m;},ready:async()=>{}} as unknown as MaterialLibrary;};
beforeAll(async()=>{
  vi.stubGlobal('fetch',async(url:string)=>new Response(await readFile(`public/${url.replace(/^.*?assets\//,'assets/')}`)));
  engine=new NullEngine();scene=new Scene(engine);const materials=shared(),signal=new AbortController().signal;
  // Every default plus one family per effect type: plain colour, scrolling emissive, flow shader, frost + icicles, shade shader, daggers.
  const ids=new Set(COSMETICS.filter(c=>c.id.startsWith('default-')||/^(green-camo|rich|darkness|hydro-nebula|frosted)-/.test(c.id)).map(c=>c.id));
  for(const item of COSMETICS.filter(c=>ids.has(c.id)))containers.set(item.id,await loadCosmeticAsset(item,scene,materials,signal));
},300000);
afterAll(()=>{for(const c of containers.values())c.dispose();scene.dispose();engine.dispose();vi.unstubAllGlobals();});

const drawn=(c:AssetContainer)=>c.meshes.filter((m):m is Mesh=>m.getTotalVertices()>0);
const finite=(a:ArrayLike<number>|null)=>!!a&&Array.from(a).every(Number.isFinite);

it('no firearm part is drawn through the transparent queue (the cause of parts showing through each other)',()=>{
  for(const [id,c] of containers){
    for(const m of drawn(c)){
      // The glTF loader turns the exporter's RGBA vertex colours (alpha 1) into hasVertexAlpha, which alpha-blends the mesh without depth
      // writes; normalizeWeaponMeshes must have removed it, so only genuinely translucent materials are blended.
      expect(m.hasVertexAlpha,`${id}:${m.name}`).toBe(false);
      const blended=m.material!.needAlphaBlendingForMesh(m);
      const name=m.material!.name.replace(/^lib:|^cosmetic:[^:]*:/,'');
      expect(blended&&!TRANSLUCENT.has(name),`${id}:${m.name} (${name}) is alpha blended`).toBe(false);
    }
  }
});

it('normalizeWeaponMeshes drops only vertex alpha that is 1 everywhere and hides animation-only parts',()=>{
  const e=new NullEngine(),s=new Scene(e);
  try{
    const box=(name:string)=>{const m=new Mesh(name,s);m.setVerticesData('position',[0,0,0,1,0,0,0,1,0],false);m.setIndices([0,1,2]);return m;};
    const opaque=box('opaque'),translucent=box('translucent');
    opaque.setVerticesData('color',[1,1,1,1,1,1,1,1,1,1,1,1]);opaque.hasVertexAlpha=true;
    translucent.setVerticesData('color',[1,1,1,1,1,1,1,.4,1,1,1,1]);translucent.hasVertexAlpha=true;
    const shell=box('shell');
    normalizeWeaponMeshes({meshes:[opaque,translucent,shell],transformNodes:[]});
    expect(opaque.hasVertexAlpha).toBe(false);expect(translucent.hasVertexAlpha).toBe(true);
    expect(shell.isEnabled()).toBe(false);expect(ANIMATION_ONLY_NODES).toContain('shell');
  }finally{s.dispose();e.dispose();}
});

it('the shotgun loading shell is hidden in static views and its parts stay in the model',()=>{
  const c=containers.get('default-shotgun')!;
  const shell=c.transformNodes.find(n=>n.name==='shell')!;
  expect(shell,'shell node').toBeDefined();expect(shell.isEnabled()).toBe(false);
  for(const m of c.meshes.filter(q=>q.getTotalVertices()>0&&q.parent===shell))expect(m.isEnabled()).toBe(false);
  // The visible gun itself is intact: the receiver meshes are enabled.
  expect(c.meshes.filter(m=>m.getTotalVertices()>0&&m.isEnabled()).length).toBeGreaterThan(5);
  for(const [id,other] of containers)if(id.endsWith('-shotgun'))expect(other.transformNodes.find(n=>n.name==='shell')?.isEnabled()).toBe(false);
});

it('every loaded model has valid meshes, materials, indices and finite transforms',()=>{
  for(const [id,c] of containers){
    const meshes=drawn(c);expect(meshes.length,id).toBeGreaterThan(3);
    for(const m of meshes){
      expect(m.material,`${id}:${m.name} material`).toBeTruthy();
      const pos=m.getVerticesData('position'),idx=m.getIndices(),n=m.getTotalVertices();
      expect(finite(pos),`${id}:${m.name} positions`).toBe(true);expect(finite(m.getVerticesData('normal')),`${id}:${m.name} normals`).toBe(true);
      expect(idx&&idx.length%3===0&&idx.length>0,`${id}:${m.name} index count`).toBe(true);
      expect(Array.from(idx!).every(i=>i>=0&&i<n),`${id}:${m.name} index range`).toBe(true);
      const bb=m.getBoundingInfo().boundingBox;expect(finite(bb.minimum.asArray())&&finite(bb.maximum.asArray()),`${id}:${m.name} bounds`).toBe(true);
    }
    for(const n of [...c.transformNodes,...c.meshes] as (AbstractMesh)[]){
      const t=n as unknown as {position:{asArray():number[]};scaling:{asArray():number[]}};
      expect(finite(t.position.asArray())&&finite(t.scaling.asArray()),`${id}:${n.name} transform`).toBe(true);
      expect(t.scaling.asArray().every(v=>v!==0),`${id}:${n.name} scale`).toBe(true);
    }
  }
});

it('every weapon keeps its anchors and moving parts, and its optics',()=>{
  for(const [id,c] of containers){
    const item=COSMETICS.find(x=>x.id===id)!,names=new Set([...c.transformNodes,...c.meshes].map(n=>n.name));
    for(const a of ANCHORS[item.weapon])expect(names.has(a),`${id} lacks ${a}`).toBe(true);
    const mats=new Set(drawn(c).map(m=>m.material!.name.replace(/^lib:|^cosmetic:[^:]*:/,'')));
    if(item.weapon==='rifle'||item.weapon==='semi-sniper'){expect(mats.has('gun_glass'),`${id} sight window`).toBe(true);expect(mats.has('reticle_holo'),`${id} reticle`).toBe(true);}
    if(item.weapon==='sniper')expect(mats.has('gun_lens'),`${id} scope lens`).toBe(true);
  }
});

it('optic windows are visible from both sides',()=>{
  for(const id of ['default-rifle','default-semi-sniper']){
    const glass=drawn(containers.get(id)!).filter(m=>m.material!.name==='lib:gun_glass');expect(glass.length,id).toBeGreaterThan(0);
    const signs=new Set<number>();
    for(const m of glass){const p=m.getVerticesData('position')!,ix=m.getIndices()!;
      for(let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,d=ix[t+2]*3;
        const nz=(p[b]-p[a])*(p[d+1]-p[a+1])-(p[b+1]-p[a+1])*(p[d]-p[a]);if(Math.abs(nz)>1e-9)signs.add(Math.sign(nz));}}
    expect([...signs].sort(),`${id} glass faces toward +z and -z`).toEqual([-1,1]);
  }
});

it('every generated solid is wound outward (python face audit)',()=>{
  const run=spawnSync('python',['-B','-I','tools/weapon_face_classes.py'],{encoding:'utf8'});
  if(run.error){console.warn('python not available, skipping the face audit');return;}
  expect(run.stdout+run.stderr).toContain('FLIPPED FACES 0');expect(run.status).toBe(0);
},120000);

it('the Shop shows the crate preview and the odds only (no contents list)',()=>{
  const source=fs.readFileSync('src/ui/CosmeticsPages.ts','utf8'),css=fs.readFileSync('src/styles.css','utf8');
  expect(source).not.toMatch(/crate-contents|crate-collection|CRATE CONTENTS/i);expect(css).not.toMatch(/\.crate-contents|\.crate-collection/);
  expect(source).toContain('CRATE.distribution');expect(source).toContain('shop-crate');expect(source).toContain('crate-distribution');
  expect(WEAPON_CATEGORIES.length).toBe(6);
});

it('the Locker preview keeps its own tight depth range and cleans up',()=>{
  const source=fs.readFileSync('src/ui/CosmeticPreview.ts','utf8');
  expect(source).toMatch(/camera\.minZ=camera\.radius\*\.05/);expect(source).toMatch(/camera\.maxZ=camera\.radius\*30/);
  expect(source).toMatch(/close\(\)\{[^}]*scene\?\.dispose\(\)[^}]*engine\?\.dispose\(\)/);
});

it('the catalog references only existing models for every cosmetic',()=>{
  for(const item of COSMETICS as readonly CosmeticDefinition[]){
    expect(fs.existsSync('public/'+item.asset.model),item.id).toBe(true);
    if(item.asset.secondaryModel)expect(fs.existsSync('public/'+item.asset.secondaryModel),item.id).toBe(true);
  }
});
