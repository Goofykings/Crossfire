/** Serve a generated benchmark bundle plus unchanged public assets. Local only. */
import {createServer} from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function serveFrames(variant,port){
if(!['baseline','pass1','current','online','mask'].includes(variant))throw Error('Unknown frame variant');
const roots=[path.resolve(`.cache/frame-${variant}`),path.resolve('public')];
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ogg':'audio/ogg','.wav':'audio/wav'};
return createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';
  const file=roots.map(root=>{const p=path.resolve(root,name);return p.startsWith(root+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()?p:null;}).find(Boolean);
  if(!file){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Content-Length':fs.statSync(file).size,'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);
 }catch{res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log('Local frame variant',variant,port));
}
if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url))serveFrames(process.argv[2]??'current',Number(process.argv[3]??4237));
