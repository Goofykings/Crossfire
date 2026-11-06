import fs from 'node:fs';
import assert from 'node:assert/strict';
import {COSMETICS,COSMETICS_API_VERSION,FUTURE_CRATE} from '../shared/cosmetics.ts';
const manifest={version:COSMETICS_API_VERSION,items:COSMETICS,crate:{...FUTURE_CRATE,preview:'assets/cosmetics/crate/preview.svg'}};
if(process.argv.includes('--check'))assert.deepEqual(JSON.parse(fs.readFileSync('public/assets/cosmetics/catalog.json','utf8')),manifest,'Regenerate cosmetic manifest: node tools/export-cosmetics.mjs');
else fs.writeFileSync('public/assets/cosmetics/catalog.json',JSON.stringify(manifest,null,2)+'\n');
