/** Controlled historical comparison without modifying working sources.
 * baseline: prewarm off / original 40 m batching. pass1: prewarm on / 40 m.
 * current: current production sources. Only loading/batching differ; current
 * networking, simulation, diagnostics, assets and combat rules are shared. */
import {build} from 'vite';
const variant=process.argv[2]??'current';
if(!['baseline','pass1','current'].includes(variant))throw Error('Unknown frame variant');
let stripped=false;
await build({build:{outDir:`.cache/frame-${variant}`,copyPublicDir:false},plugins:[{
 name:'historical-frame-comparison',enforce:'pre',transform(code,id){
  if(process.argv.includes('--scene')&&id.replaceAll('\\','/').endsWith('/src/game/Game.ts'))return code.replace('import.meta.env.DEV ? this.ctx.scene : null','this.ctx.scene');
  if(variant==='baseline'&&id.replaceAll('\\','/').endsWith('/src/maps/MapManager.ts')){
   const line='await prepareBulletWorld(world,active);';if(!code.includes(line))throw Error('Historical prewarm comparison is stale');stripped=true;return code.replace(line,'');
  }
  if(variant!=='current'&&id.replaceAll('\\','/').endsWith('/src/rendering/quality.ts'))return code.replace(/batchCell:64/g,'batchCell:40');
 }
}]});
if(variant==='baseline'&&!stripped)throw Error('Baseline fixture was not applied');
console.log('Built controlled frame variant:',variant);
