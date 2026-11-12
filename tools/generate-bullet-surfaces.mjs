/** Bake reusable bullet-only surfaces from the exact shipped GLBs. No Blender or runtime renderer required. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pngAlpha} from './png-alpha.mjs';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'public/assets/models/shared/props');
const catalog=JSON.parse(fs.readFileSync(path.join(directory,'props.json'),'utf8'));
export function extractBulletMesh(bytes,materials={},sourceHashes={}){
 if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2)throw Error('Expected glTF 2 GLB');
 const length=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const read=id=>{const a=g.accessors[id],b=g.bufferViews[a.bufferView];if(a.sparse||b.buffer!==0)throw Error('Unsupported sparse/external accessor');const dims={SCALAR:1,VEC2:2,VEC3:3}[a.type],sizes={5121:1,5123:2,5125:4,5126:4},size=sizes[a.componentType];if(!dims||!size)throw Error('Unsupported accessor');return Array.from({length:a.count},(_,i)=>Array.from({length:dims},(_,k)=>{const offset=(b.byteOffset??0)+(a.byteOffset??0)+i*(b.byteStride??dims*size)+k*size;return a.componentType===5126?view.getFloat32(offset,true):a.componentType===5125?view.getUint32(offset,true):a.componentType===5123?view.getUint16(offset,true):view.getUint8(offset);}));};
 const vertices=[],indices=[],unique=new Map(),masked={},masks=[],maskNames=new Map();
 const vertex=p=>{const v=p.map(x=>Math.round(x*1e6)/1e6);if(!v.every(Number.isFinite))throw Error('Invalid vertex');const key=v.join(',');if(!unique.has(key)){unique.set(key,vertices.length/3);vertices.push(...v);}return unique.get(key);};
 function visit(id,parent){const node=g.nodes[id];if(node.skin!==undefined)throw Error('Static props cannot be skinned');const local=node.matrix?Matrix.FromArray(node.matrix):Matrix.Compose(Vector3.FromArray(node.scale??[1,1,1]),Quaternion.FromArray(node.rotation??[0,0,0,1]),Vector3.FromArray(node.translation??[0,0,0]));const transform=local.multiply(parent);
  if(node.mesh!==undefined)for(const primitive of g.meshes[node.mesh].primitives){if((primitive.mode??4)!==4)throw Error('Expected triangles');const material=g.materials?.[primitive.material],definition=materials[material?.name];
   if((['MASK','BLEND'].includes(material?.alphaMode)&&/foliage|leaf|leaves|bush|flowers/i.test(material?.name??'')))continue;
   let mask;
   if(definition?.alpha_cutoff){
    if(primitive.attributes.TEXCOORD_0===undefined)throw Error('Masked surface needs UVs');
    if(!maskNames.has(material.name)){const texture=fs.readFileSync(path.join(root,'public',definition.albedo));sourceHashes[definition.albedo]=createHash('sha256').update(texture).digest('hex');const {width,height,alpha}=pngAlpha(texture),bits=Buffer.alloc(Math.ceil(width*height/8));for(let i=0;i<alpha.length;i++)if(alpha[i]/255>=definition.alpha_cutoff)bits[i>>3]|=1<<(i&7);maskNames.set(material.name,masks.length);masks.push({width,height,bits:bits.toString('base64'),tile:definition.tile||1,flipY:!definition.atlas});}
    mask=maskNames.get(material.name);
   }
   const uv=mask===undefined?null:read(primitive.attributes.TEXCOORD_0);const points=read(primitive.attributes.POSITION).map(p=>{const v=Vector3.TransformCoordinates(Vector3.FromArray(p),transform);return [v.x,v.y,v.z];});const order=primitive.indices===undefined?points.map((_,i)=>i):read(primitive.indices).flat();for(let i=0;i<order.length;i+=3){const ids=order.slice(i,i+3).map(i=>vertex(points[i]));if(new Set(ids).size===3){if(mask!==undefined)masked[indices.length/3]={mask,uv:order.slice(i,i+3).flatMap(i=>uv[i])};indices.push(...ids);}}}
  for(const child of node.children??[])visit(child,transform);
 }
 for(const id of g.scenes[g.scene??0].nodes)visit(id,Matrix.Identity());
 if(!indices.length)return {center:[0,0,0],half:[.001,.001,.001],vertices:[],indices:[]};
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vertices.length;i++) {min[i%3]=Math.min(min[i%3],vertices[i]);max[i%3]=Math.max(max[i%3],vertices[i]);}
 const center=min.map((v,i)=>(v+max[i])/2),half=min.map((v,i)=>Math.max(.00001,(max[i]-v)/2));for(let i=0;i<vertices.length;i++)vertices[i]=Math.round((vertices[i]-center[i%3])*1e6)/1e6;
 return {center,half,vertices,indices,...(masks.length?{masks,masked}:{})};
}
export function generate(){const meshes={},sources={},bytes=fs.readFileSync(path.join(root,'public/assets/materials.json')),materials=JSON.parse(bytes).materials;for(const [type,entry] of Object.entries(catalog.props)){if(!entry.collider)continue;const bytes=fs.readFileSync(path.join(directory,entry.file));sources[entry.file]=createHash('sha256').update(bytes).digest('hex');meshes[type]=extractBulletMesh(bytes,materials,sources);}return {version:1,sources,meshes};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=path.join(directory,'bullet-surfaces.json'),data=JSON.stringify(generate());
 if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8').trim()!==data)throw Error('Bullet surfaces are stale. Run npm run assets:bullets after changing prop GLBs.');console.log('Bullet surfaces match all solid prop GLBs.');}
 else {fs.writeFileSync(output,data+'\n');console.log(`Baked ${Object.keys(JSON.parse(data).meshes).length} shared prop surfaces (${Math.round(data.length/1024)} KiB)`);}
}
