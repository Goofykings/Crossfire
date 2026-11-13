import fs from 'node:fs';
import assert from 'node:assert/strict';
import {COSMETICS,COLLECTIONS,EXTRA_COLLECTIONS,COSMETICS_API_VERSION,CRATE} from '../shared/cosmetics.ts';
const manifest={version:COSMETICS_API_VERSION,items:COSMETICS,collections:COLLECTIONS.map(({id,name,rarity,killEffect})=>({id,name,rarity,...(killEffect?{killEffect}:{})})),
 // Newer skins; the ones flagged `crate` (the Epic families) are in the crate pool, the rest are not granted by it (see EXTRA_COLLECTIONS).
 extraCollections:EXTRA_COLLECTIONS.map(({id,name,rarity,fireEffect,icicles,weapons,crate,killEffect})=>({id,name,rarity,...(killEffect?{killEffect}:{}),...(fireEffect?{fireEffect}:{}),...(icicles?{icicles}:{}),...(weapons?{weapons}:{}),...(crate?{crate}:{})})),crate:{...CRATE,model:'assets/cosmetics/crate/reward-crate/model.glb',preview:'assets/cosmetics/crate/reward-crate/thumbnail.png'}};
if(process.argv.includes('--check'))assert.deepEqual(JSON.parse(fs.readFileSync('public/assets/cosmetics/catalog.json','utf8')),manifest,'Regenerate cosmetic manifest: node tools/export-cosmetics.mjs');
else fs.writeFileSync('public/assets/cosmetics/catalog.json',JSON.stringify(manifest,null,2)+'\n');
