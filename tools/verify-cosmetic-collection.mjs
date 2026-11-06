/** Validate staged art independently of the four-item live catalog. No grants or registration. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('public/assets/cosmetics/foundry-collection.json','utf8'));
const publicFile=p=>{assert.match(p,/^assets\/[a-zA-Z0-9_./-]+$/);assert.ok(!p.split('/').includes('..'));const full=path.resolve('public',p);assert.ok(full.startsWith(path.resolve('public')+path.sep));assert.ok(fs.existsSync(full),p);return full;};
function load(file){
 const b=fs.readFileSync(publicFile(file));assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);assert.equal(b.readUInt32LE(16),0x4e4f534a);
 const len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len).toString('utf8'));assert.equal(b.readUInt32LE(24+len),0x004e4942);const bin=b.subarray(28+len);
 for(const v of j.buffers??[])assert.ok(!v.uri,'GLB must be self-contained');for(const v of j.images??[])assert.ok(v.bufferView!==undefined&&!v.uri,'Textures must be embedded');
 const dims={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},bytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
 function accessor(id){const a=j.accessors[id],v=j.bufferViews[a.bufferView],d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),n=dims[a.type],size=bytes[a.componentType];return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,k)=>{const off=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??n*size)+k*size;switch(a.componentType){case 5126:return d.getFloat32(off,true);case 5125:return d.getUint32(off,true);case 5123:return d.getUint16(off,true);case 5121:return d.getUint8(off);default:throw Error('Unsupported accessor');}}));}
 const matrices=new Map();function walk(id,parent=Matrix.Identity()) {const node=j.nodes[id],local=node.matrix?Matrix.FromArray(node.matrix):Matrix.Compose(Vector3.FromArray(node.scale??[1,1,1]),Quaternion.FromArray(node.rotation??[0,0,0,1]),Vector3.FromArray(node.translation??[0,0,0])),world=local.multiply(parent);matrices.set(id,world);for(const c of node.children??[])walk(c,world);}
 for(const id of j.scenes[j.scene??0].nodes)walk(id);
 let triangles=0,degenerate=0,primitives=0;const points=[];
 for(const [id,node]of j.nodes.entries())if(node.mesh!==undefined){for(const p of j.meshes[node.mesh].primitives){primitives++;assert.equal(p.mode??4,4);assert.ok(p.attributes.NORMAL!==undefined&&p.attributes.TEXCOORD_0!==undefined,'Normals/UVs required');const vertices=accessor(p.attributes.POSITION),indices=p.indices===undefined?vertices.map((_,i)=>[i]):accessor(p.indices),normals=accessor(p.attributes.NORMAL);for(const v of vertices){assert.ok(v.every(Number.isFinite));points.push(Vector3.TransformCoordinates(Vector3.FromArray(v),matrices.get(id)));}for(const n of normals)assert.ok(n.every(Number.isFinite)&&Math.hypot(...n)>.9,'Valid unit normals');for(const uv of accessor(p.attributes.TEXCOORD_0))assert.ok(uv.every(Number.isFinite));
   for(let i=0;i<indices.length;i+=3){triangles++;const [a,b,c]=[0,1,2].map(k=>Vector3.FromArray(vertices[indices[i+k][0]]));if(Vector3.Cross(b.subtract(a),c.subtract(a)).lengthSquared()<1e-20)degenerate++;}
 }}
 const bounds={min:[0,1,2].map(a=>Math.min(...points.map(p=>p.asArray()[a]))),max:[0,1,2].map(a=>Math.max(...points.map(p=>p.asArray()[a])))};
 return {j,matrices,bounds,triangles,degenerate,primitives,bytes:b.length,textureCount:j.images?.length??0};
}
const reports=[];assert.equal(manifest.version,1);assert.equal(manifest.items.length,4);assert.deepEqual(manifest.items.map(i=>[i.catalogEntry.weapon,i.catalogEntry.rarity]),[['rifle','uncommon'],['smg','rare'],['shotgun','epic'],['sniper','legendary']]);
for(const entry of manifest.items){
 const c=entry.catalogEntry;assert.match(c.id,/^[a-z0-9][a-z0-9-]{0,63}$/);assert.equal(c.ownership,'grant');assert.equal(c.asset.binding,'embedded');assert.deepEqual(c.compatibleWith,[c.weapon]);
 const base=load(entry.baseModel),art=load(c.asset.model);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(publicFile(entry.baseModel))).digest('hex'),entry.baseSha256,'Original default asset changed');
 for(const name of [c.weapon,'grip_r','grip_l','muzzle','sight','eject','mag_grip','port','bolt_grip','mag','pump','bolt','shell']){
  const b=base.j.nodes.findIndex(n=>n.name===name);if(b<0)continue;const a=art.j.nodes.findIndex(n=>n.name===name);assert.ok(a>=0,c.id+' missing '+name);
  const before=base.matrices.get(b).asArray(),after=art.matrices.get(a).asArray();assert.ok(before.every((n,i)=>Math.abs(n-after[i])<1e-5),c.id+' world anchor/part changed '+name);
  for(const key of ['translation','scale','rotation']){const fallback=key==='scale'?[1,1,1]:key==='rotation'?[0,0,0,1]:[0,0,0];assert.ok((base.j.nodes[b][key]??fallback).every((n,i)=>Math.abs(n-(art.j.nodes[a][key]??fallback)[i])<1e-5),c.id+' local frame '+name);}
 }
 for(let a=0;a<3;a++){assert.ok(art.bounds.min[a]>=base.bounds.min[a]-.0001,c.id+' enlarged lower envelope');assert.ok(art.bounds.max[a]<=base.bounds.max[a]+.0001,c.id+' enlarged upper envelope');}
 assert.ok(art.degenerate<=base.degenerate,c.id+' introduced degenerate faces');assert.ok(art.triangles<5000);assert.ok(art.primitives<=14);assert.ok(art.bytes<1_500_000);assert.ok(art.textureCount>=3);
 assert.ok(art.j.materials.some(m=>m.normalTexture),'Missing tangent normal map');assert.ok(art.j.materials.some(m=>m.pbrMetallicRoughness?.metallicRoughnessTexture),'Missing PBR map');
 for(const tex of entry.textures)publicFile(tex);assert.match(c.preview,/\.png$/);publicFile(c.preview);
 const src=path.resolve(root,entry.source);assert.ok(src.startsWith(path.join(root,'blender','source','cosmetics')+path.sep));let blend=fs.readFileSync(src);if(blend.readUInt32LE(0)===0xfd2fb528)blend=zstdDecompressSync(blend);assert.equal(blend.subarray(0,7).toString(),'BLENDER');
 const {j,matrices,...stats}=art;reports.push({id:c.id,...stats,baseTriangles:base.triangles,basePrimitives:base.primitives});console.log('PASS '+c.id+' '+stats.triangles+' triangles, '+stats.primitives+' primitives, '+(stats.bytes/1024).toFixed(0)+' KiB; all frames/envelope retained');
}
assert.equal(manifest.crate.functional,false);const crate=load(manifest.crate.model);assert.ok(crate.triangles<12000);assert.ok(crate.primitives<=5);assert.equal(crate.degenerate,0);publicFile(manifest.crate.preview);assert.ok(fs.existsSync(manifest.crate.source));const {j,matrices,...stats}=crate;reports.push({id:manifest.crate.id,...stats});
fs.mkdirSync('test-results/cosmetic-collection',{recursive:true});fs.writeFileSync('test-results/cosmetic-collection/assets.json',JSON.stringify(reports,null,2));console.log('PASS foundry-crate: '+crate.triangles+' triangles, '+crate.primitives+' primitives; no functional behavior');
