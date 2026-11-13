/** Development-only page that drives the REAL Locker preview (src/ui/CosmeticPreview.ts) for tools/review-weapon-angles.mjs.
 * No inventory, no network: any catalog item can be opened. Not imported by the game. */
import '@babylonjs/loaders/glTF';
import { Matrix, Mesh, ShaderMaterial, Vector3 } from '@babylonjs/core';
import { CosmeticPreview } from '../src/ui/CosmeticPreview';
import { cosmetic } from '../shared/cosmetics';

const host = document.querySelector<HTMLElement>('#host')!;
const preview = new CosmeticPreview();
const pixels = (canvas: HTMLCanvasElement) => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; const g = c.getContext('2d')!; g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
const settle = async () => { const s = preview.debug.scene!; await s.whenReadyAsync(); s.render(); await new Promise((r) => setTimeout(r, 40)); s.render(); };

/** One flat, unlit colour per drawn mesh: the picture is an id map, so culling-dependent differences are attributable to a mesh. */
function idPalette(meshes: AbstractMesh[]) {
  return meshes.map((_, i) => { const h = (i * 0.61803398875) % 1, s = .85, v = i % 2 ? .95 : .7; const k = Math.floor(h * 6), f = h * 6 - k, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][k % 6]; return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]; });
}

(window as unknown as { __previewLab: unknown }).__previewLab = {
  async open(id: string) {
    const item = cosmetic(id);
    if (!item) throw Error('Unknown cosmetic ' + id);
    await preview.open(host, item);
    await new Promise((r) => setTimeout(r, 150));
    return preview.inspect();
  },
  /** One frame from an azimuth/elevation. With `diagnose` the weapon is also drawn as an id map with back-face culling on and then off:
   * on a correct closed model a back face is always hidden behind its own front face, so any pixel that changes marks a missing or
   * flipped face (red in the sheet), and `meshes` lists which meshes gain or lose pixels. */
  async shot(az: number, el: number, diagnose = false, probes: [number, number][] = []) {
    preview.setAngles(az, el);
    const canvas = preview.debug.canvas!;
    await settle();
    // Saved over the Locker's dark panel colour: the canvas is transparent and white parts (Frosted's snow) vanish on a white image viewer.
    const flat = document.createElement('canvas'); flat.width = canvas.width; flat.height = canvas.height;
    const fg = flat.getContext('2d')!; fg.fillStyle = '#1c2330'; fg.fillRect(0, 0, flat.width, flat.height); fg.drawImage(canvas, 0, 0);
    const normal = flat.toDataURL('image/png');
    if (!diagnose) return { image: normal };
    // Triangle-id map: every drawn triangle of every mesh gets a unique flat colour (unindexed clones, an unlit shader), rendered twice.
    const scene = preview.debug.scene!, sources = scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.isEnabled() && m.getTotalVertices() > 0 && m.isVisible);
    const hidden = sources.map((m) => m.isVisible); sources.forEach((m) => { m.isVisible = false; });
    const mat = new ShaderMaterial('tri-id', scene, { vertexSource: 'attribute vec3 position;attribute vec4 color;uniform mat4 worldViewProjection;varying vec4 vC;void main(){vC=color;gl_Position=worldViewProjection*vec4(position,1.);}',
      fragmentSource: 'precision highp float;varying vec4 vC;void main(){gl_FragColor=vec4(vC.rgb,1.);}' }, { attributes: ['position', 'color'], uniforms: ['worldViewProjection'] });
    const clones = sources.map((m, i) => {
      const c = m.clone('tri-id-' + i, m.parent) as Mesh; c.convertToUnIndexedMesh(); c.material = mat; c.isVisible = true;
      const n = c.getTotalVertices(), colors = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) { const t = Math.floor(v / 3); colors[v * 4] = (i + 1) / 255; colors[v * 4 + 1] = (t >> 8) / 255; colors[v * 4 + 2] = (t & 255) / 255; colors[v * 4 + 3] = 1; }
      c.setVerticesData('color', colors, false, 4);
      return c;
    });
    const clear = scene.clearColor.clone(); scene.clearColor.set(0, 0, 0, 0);
    const render = async (cull: boolean) => { mat.backFaceCulling = cull; await settle(); return pixels(canvas); };
    const on = await render(true), off = await render(false);
    const decode = (d: Uint8ClampedArray, o: number) => (d[o] === 0 || d[o + 3] < 255) ? -1 : (d[o] - 1) * 65536 + d[o + 1] * 256 + d[o + 2];
    const stats = new Map<number, { on: number; off: number; under: Map<number, number> }>(), out = new ImageData(on.width, on.height);
    let changed = 0;
    for (let o = 0; o < on.data.length; o += 4) {
      const a = decode(on.data, o), b = decode(off.data, o);
      if (a !== b) { changed++; out.data[o] = 255; out.data[o + 1] = 40; out.data[o + 2] = 40; const entry = (k: number) => stats.get(k) ?? stats.set(k, { on: 0, off: 0, under: new Map() }).get(k)!; if (b >= 0) { const e = entry(b); e.off++; e.under.set(a, (e.under.get(a) ?? 0) + 1); } if (a >= 0) entry(a).on++; }
      else if (a >= 0) { const hue = (a * 2654435761) >>> 0; out.data[o] = 60 + (hue & 127); out.data[o + 1] = 60 + ((hue >> 8) & 127); out.data[o + 2] = 60 + ((hue >> 16) & 127); }
      else out.data[o] = out.data[o + 1] = out.data[o + 2] = 18;
      out.data[o + 3] = 255;
    }
    // triangles that only show when culling is off (their back side wins the depth test), with where they are
    const tris: { under: string; mesh: string; tri: number; pixels: number; centre: number[]; normal: number[] }[] = [];
    for (const [id, st] of stats) {
      if (st.off < 6 || st.off <= st.on) continue;
      const mi = Math.floor(id / 65536) % 256 || 0, ti = id % 65536, src = sources[(id >> 16) & 255] ?? sources[mi]; if (!src) continue;
      const pos = clones[(id >> 16) & 255].getVerticesData('position')!, a = ti * 9;
      const p0 = new Vector3(pos[a], pos[a + 1], pos[a + 2]), p1 = new Vector3(pos[a + 3], pos[a + 4], pos[a + 5]), p2 = new Vector3(pos[a + 6], pos[a + 7], pos[a + 8]);
      const n = p1.subtract(p0).cross(p2.subtract(p0)).normalize();
      const top = [...st.under].sort((x, y) => y[1] - x[1])[0], underId = top ? top[0] : -1;
      const under = underId < 0 ? 'background' : `${sources[(underId >> 16) & 255]?.name}#${underId % 65536}`;
      tris.push({ under, mesh: src.name, tri: ti, pixels: st.off, centre: p0.add(p1).add(p2).scale(1 / 3).asArray().map((v) => +v.toFixed(4)), normal: n.asArray().map((v) => +v.toFixed(2)) });
    }
    tris.sort((x, y) => y.pixels - x.pixels);
    const byMesh = new Map<string, number>(); for (const t of tris) byMesh.set(t.mesh, (byMesh.get(t.mesh) ?? 0) + t.pixels);
    clones.forEach((c) => c.dispose()); mat.dispose(); sources.forEach((m, i) => { m.isVisible = hidden[i]; });
    scene.clearColor.copyFrom(clear);
    await settle();
    const c = document.createElement('canvas'); c.width = on.width; c.height = on.height; c.getContext('2d')!.putImageData(out, 0, 0);
    return { image: normal, diff: c.toDataURL('image/png'), changed, total: on.width * on.height, meshes: [...byMesh].map(([name, px]) => ({ name, pixels: px })), tris: tris.slice(0, 40) };
  },
  /** What the camera sees at a canvas pixel: the picked mesh, its material and the face's triangle index. */
  pick(x: number, y: number) {
    // front-facing triangles only, like a culled render: the first hit is what the camera shows at this pixel
    const scene = preview.debug.scene!, hit = scene.pick(x, y, (m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0, false, null, (p0, p1, p2, ray) => { const n = p1.subtract(p0).cross(p2.subtract(p0)); return n.x * ray.direction.x + n.y * ray.direction.y + n.z * ray.direction.z < 0; });
    return hit?.hit ? { mesh: hit.pickedMesh!.name, material: hit.pickedMesh!.material?.name, face: hit.faceId, point: hit.pickedPoint!.asArray() } : null;
  },
  /** Draw only the named meshes (null: all of them again) and return the frame: isolates which mesh a visual defect belongs to. */
  async only(names: string[] | null, az: number, el: number) {
    const scene = preview.debug.scene!;
    for (const m of scene.meshes) if (m.getTotalVertices() > 0) m.setEnabled(names === null || names.includes(m.name));
    preview.setAngles(az, el);
    await settle();
    return preview.debug.canvas!.toDataURL('image/png');
  },
  /** Render state of every drawn mesh: material, culling, alpha, depth flags, rendering group (transparency and depth audits). */
  state() {
    return preview.debug.scene!.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => { const x = m.material as unknown as Record<string, unknown> | null;
      return { mesh: m.name, material: m.material?.name, cull: x?.backFaceCulling, alpha: x?.alpha, mode: x?.transparencyMode, blend: m.material?.needAlphaBlending(), test: m.material?.needAlphaTesting(),
        depthPre: x?.needDepthPrePass, noDepthWrite: x?.disableDepthWrite, depthFunc: x?.depthFunction, zOffset: x?.zOffset, group: m.renderingGroupId, alphaIndex: m.alphaIndex, sides: m.sideOrientation, plugins: (m.material as unknown as { pluginManager?: { _plugins: { name: string }[] } })?.pluginManager?._plugins.map((q) => q.name) }; });
  },
  /** Canvas pixel of a model-space point (where a part appears on screen). */
  project(x: number, y: number, z: number) {
    const scene = preview.debug.scene!, cam = preview.debug.camera!, e = scene.getEngine(), v = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(), cam.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
    return [Math.round(v.x), Math.round(v.y), +v.z.toFixed(5)];
  },
  /** Raw access for one-off experiments from the browser console. */
  get debug() { return preview.debug; },
  close() { preview.close(); },
  inspect: () => preview.inspect(),
  /** Names, visibility and bounds of every mesh and node in the open preview (visibility and transform audits). */
  nodes() {
    const d = preview.debug.container;
    return d ? [...d.meshes, ...d.transformNodes].map((n) => ({ name: n.name, enabled: n.isEnabled(), visible: 'isVisible' in n ? (n as { isVisible: boolean }).isVisible : true, material: 'material' in n ? ((n as { material?: { name: string } }).material?.name ?? null) : null,
      vertices: 'getTotalVertices' in n ? (n as { getTotalVertices(): number }).getTotalVertices() : 0, position: (n as { position: { asArray(): number[] } }).position.asArray(), scaling: (n as { scaling: { asArray(): number[] } }).scaling.asArray() })) : [];
  },
};
