/**
 * Verify generated assets (npm run assets:verify). Exits non-zero on problems.
 *  - every file listed in public/assets/asset-manifest.json exists and is not empty
 *  - every GLB parses, has meshes, and only references materials defined in materials.json
 *  - every model in each map-assets.json exists; every prop used by a layout exists in props.json
 *  - every texture referenced by materials.json exists
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const problems = [];
const ok = [];

export function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

const manifest = JSON.parse(fs.readFileSync(path.join(pub, 'assets/asset-manifest.json'), 'utf8'));
const materials = JSON.parse(fs.readFileSync(path.join(pub, 'assets/materials.json'), 'utf8')).materials;

for (const a of manifest.assets) {
  const p = a.path.startsWith('blender/') || a.path.startsWith('docs/') ? path.join(root, a.path) : path.join(pub, a.path);
  if (!fs.existsSync(p)) {
    problems.push(`missing: ${a.path}`);
    continue;
  }
  const size = fs.statSync(p).size;
  if (size === 0) problems.push(`empty: ${a.path}`);
  if (p.endsWith('.glb')) {
    try {
      const j = readGlbJson(p);
      if (!j.meshes?.length) problems.push(`no meshes: ${a.path}`);
      for (const m of j.materials ?? []) {
        const name = m.name.replace(/\.\d{3}$/, '');
        if (!(name in materials)) problems.push(`${a.path}: material "${m.name}" not in materials.json`);
      }
    } catch (e) {
      problems.push(`${a.path}: ${e.message}`);
    }
  }
}
ok.push(`${manifest.assets.length} manifest entries checked`);

for (const [name, def] of Object.entries(materials)) {
  for (const k of ['albedo', 'normal', 'orm']) {
    if (def[k] && !fs.existsSync(path.join(pub, def[k]))) problems.push(`material ${name}: missing texture ${def[k]}`);
  }
}
ok.push(`${Object.keys(materials).length} materials checked`);

const props = JSON.parse(fs.readFileSync(path.join(pub, 'assets/models/shared/props/props.json'), 'utf8')).props;
for (const dir of fs.readdirSync(path.join(root, 'src/maps'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const layoutFile = path.join(root, 'src/maps', dir.name, 'layout.json');
  if (!fs.existsSync(layoutFile)) continue;
  const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
  const idx = path.join(pub, 'assets/models', dir.name, 'map-assets.json');
  if (!fs.existsSync(idx)) {
    problems.push(`${dir.name}: missing map-assets.json`);
    continue;
  }
  const index = JSON.parse(fs.readFileSync(idx, 'utf8'));
  for (const f of [...index.models, index.collision]) {
    const p = path.join(pub, 'assets/models', dir.name, f);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) problems.push(`${dir.name}: missing or empty ${f}`);
  }
  const used = new Set([...layout.props, ...layout.obstacles].map((p) => p.type));
  for (const t of used) if (!props[t]) problems.push(`${dir.name}: prop type "${t}" not in props.json`);
  ok.push(`${dir.name}: ${index.models.length} models, ${used.size} prop types`);
}

for (const l of ok) console.log(`ok   ${l}`);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall assets verified');
process.exit(problems.length ? 1 : 0);
