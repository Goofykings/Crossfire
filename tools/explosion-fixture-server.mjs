/** Bundle the isolated fixture to avoid dev-server dependency transforms during QA. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build,stop} from '../server-dedicated/node_modules/esbuild/lib/main.js';
const root=path.resolve('test-results/explosion-fixture'),publicRoot=path.resolve('public');
const source=fs.readFileSync('tools/explosion-lab.html','utf8');
const code=source.match(/<script type="module">([\s\S]+)<\/script>/)[1];
await build({stdin:{contents:code,resolveDir:path.resolve('tools'),loader:'ts'},bundle:true,minify:true,
  format:'esm',platform:'browser',target:'es2022',outfile:path.join(root,'assets/lab.js'),
  define:{'import.meta.env.BASE_URL':'"/"'}});
stop();
const html=source.replace(/<script type="module">[\s\S]+<\/script>/,'<script type="module" src="/assets/lab.js"></script>');
http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
  const base=pathname==='/assets/lab.js'?root:publicRoot, file=path.resolve(base,`.${decodeURIComponent(pathname)}`);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4201,'127.0.0.1',()=>console.log('Bundled explosion fixture: http://127.0.0.1:4201/'));
