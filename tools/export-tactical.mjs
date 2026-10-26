/**
 * Export each map's tactical (Tab) map as data and as a picture.
 *
 *   node tools/export-tactical.mjs [--map industrial-complex,modern-city] [--out docs/tactical] [--scale 10]
 *
 * Writes <out>/<id>.json (TacticalMapData, exactly what the overlay draws) and <out>/<id>.svg (north-up plan in the
 * overlay's colours, `scale` px per metre). The data is derived from layout.json by src/maps/tactical.ts, the same code
 * the game runs, loaded through Vite so the map definitions (and their landmark names) import as they do in the app.
 *
 * The runtime derives the map itself. A map whose layout is not data-driven can instead ship such a JSON file next to
 * its models and name it in map-assets.json (`"tactical": "tactical.json"`); MapManager then loads it as is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = path.resolve(root, opt('out', 'docs/tactical'));
const S = Number(opt('scale', 10));

// the same colours as src/ui/TacticalMap.ts
const C = {
  offMap: '#121418', building: '#3d4149', buildingEdge: '#24272c', backdrop: '#30333a', ground: '#c9c4b7',
  square: '#d3cebf', raised: '#dcd6c6', covered: '#a7a194', hatch: 'rgba(60, 56, 48, 0.28)', ledge: '#6c665a',
  stairs: '#ebe5d5', stairLine: '#8c8578', obstacle: '#5c6068', obstacleEdge: '#3b3e45', label: '#3a3d44',
};

const { module: registry } = await runnerImport(path.join(root, 'src/maps/registry.ts'));
const { module: tactical } = await runnerImport(path.join(root, 'src/maps/tactical.ts'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/models/shared/props/props.json'), 'utf8'));
const wanted = opt('map', registry.MAPS.map((m) => m.id).join(',')).split(',');
fs.mkdirSync(out, { recursive: true });

for (const id of wanted) {
  const def = registry.MAPS.find((m) => m.id === id);
  if (!def) {
    console.error(`unknown map "${id}" (known: ${registry.MAPS.map((m) => m.id).join(', ')})`);
    process.exit(2);
  }
  const data = tactical.deriveTacticalMap(def.layout, catalog, def.tactical);
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(data));
  fs.writeFileSync(path.join(out, `${id}.svg`), svg(data, def.name));
  console.log(`${id}: ${data.buildings.length} buildings, ${data.ground.length} ground areas, ${data.covered.length} covered, ` +
    `${data.obstacles.length} obstacles, ${data.stairs.length} stairs -> ${path.relative(root, out)}/${id}.{json,svg}`);
}

function svg(d, name) {
  const [bx0, bz0, bx1, bz1] = d.bounds;
  const W = (bx1 - bx0) * S, H = (bz1 - bz0) * S;
  // north-up: +x right, +z down, so the projection is a scale and an offset
  const X = (x) => ((x - bx0) * S).toFixed(1);
  const Y = (z) => ((z - bz0) * S).toFixed(1);
  const rect = (r, attrs) => `<rect x="${X(r[0])}" y="${Y(r[1])}" width="${((r[2] - r[0]) * S).toFixed(1)}" height="${((r[3] - r[1]) * S).toFixed(1)}" ${attrs}/>`;
  const poly = (pts, attrs) => `<polygon points="${pts.map(([x, z]) => `${X(x)},${Y(z)}`).join(' ')}" ${attrs}/>`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = (s, x, z, strong) =>
    `<text x="${X(x)}" y="${Y(z)}" ${strong ? `class="zone"` : `class="lm"`}>${esc(s)}</text>`;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  o.push(`<title>${esc(name)}: tactical map (north up, ${S} px per metre)</title>`);
  o.push('<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6 L6 0" stroke="' + C.hatch + '" stroke-width="1"/></pattern>');
  o.push(`<style>text{font:600 ${S * 1.05}px "Segoe UI",system-ui,sans-serif;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke-width:3px}` +
    `.lm{fill:${C.label};stroke:rgba(220,215,202,0.85)}.zone{font-weight:700;fill:#fff;stroke:rgba(14,16,21,0.75)}</style></defs>`);
  o.push(`<rect width="${W}" height="${H}" fill="${C.offMap}"/>`);
  o.push(rect(d.playArea, `fill="${C.ground}"`));
  for (const b of d.buildings) o.push(poly(b.poly, `fill="${b.backdrop ? C.backdrop : C.building}" stroke="${C.buildingEdge}" stroke-linejoin="round"`));
  for (const w of d.walls) o.push(poly(w.poly, `fill="${C.building}" stroke="${C.buildingEdge}" stroke-linejoin="round"`));
  for (const g of d.ground) {
    const fill = g.height > 0.05 ? C.raised : g.kind === 'plaza' || g.kind === 'court' || g.kind === 'yard' ? C.square : C.ground;
    o.push(rect(g.rect, `fill="${fill}"`));
  }
  for (const c of d.covered) o.push(poly(c.poly, `fill="${C.covered}"`), poly(c.poly, 'fill="url(#hatch)"'));
  for (const r of d.ledges) o.push(rect(r, `fill="none" stroke="${C.ledge}" stroke-width="1.6"`));
  for (const s of d.stairs) {
    const [x0, z0, x1, z1] = s.rect;
    o.push(`<rect x="${(Number(X(x0)) - 1).toFixed(1)}" y="${(Number(Y(z0)) - 1).toFixed(1)}" width="${((x1 - x0) * S + 2).toFixed(1)}" height="${((z1 - z0) * S + 2).toFixed(1)}" fill="${C.stairs}"/>`);
    const lines = [];
    for (let i = 1; i < s.steps; i++) {
      const t = i / s.steps;
      if (s.side === 'n' || s.side === 's') lines.push(`M${X(x0)} ${Y(z0 + (z1 - z0) * t)}H${X(x1)}`);
      else lines.push(`M${X(x0 + (x1 - x0) * t)} ${Y(z0)}V${Y(z1)}`);
    }
    if (lines.length) o.push(`<path d="${lines.join('')}" stroke="${C.stairLine}" fill="none"/>`);
  }
  for (const ob of d.obstacles) o.push(poly(ob.poly, `fill="${C.obstacle}" stroke="${C.obstacleEdge}"`));
  for (const l of d.landmarks) o.push(text(l.name, l.pos[0], l.pos[1], false));
  o.push('</svg>');
  return o.join('\n') + '\n';
}
