/**
 * Regenerate every Blender-made asset (npm run assets).
 *
 *   npm run assets                      # all stages
 *   npm run assets -- --only town       # one or more stages: materials,props,weapon,library,kit,town,previews
 *   npm run assets -- --previews        # also render docs/previews/*.png
 *
 * Blender is located via the BLENDER_PATH environment variable, then common install locations.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findBlender() {
  if (process.env.BLENDER_PATH && fs.existsSync(process.env.BLENDER_PATH)) return process.env.BLENDER_PATH;
  const candidates = [];
  if (process.platform === 'win32') {
    const base = 'C:/Program Files/Blender Foundation';
    if (fs.existsSync(base)) {
      for (const d of fs.readdirSync(base).sort().reverse()) candidates.push(path.join(base, d, 'blender.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  } else {
    candidates.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender');
  }
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  if (which.status === 0) return which.stdout.split(/\r?\n/)[0].trim();
  return null;
}

const blender = findBlender();
if (!blender) {
  console.error('Blender not found. Install Blender 4.2+ (tested with 5.2) or set BLENDER_PATH to blender(.exe).');
  process.exit(1);
}
const args = process.argv.slice(2);
console.log(`Using ${blender}`);
// procedural textures + audio are plain Python and feed the Blender materials
const py = process.platform === 'win32' ? 'python' : 'python3';
for (const script of ['tools/make_procedural_textures.py', 'tools/make_audio.py']) {
  const r = spawnSync(py, ['-I', script], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) console.warn(`warning: ${script} failed (is Python 3 with Pillow installed?)`);
}
const r = spawnSync(blender, ['-b', '--factory-startup', '-P', 'blender/scripts/generate_all.py', '--', ...args], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
