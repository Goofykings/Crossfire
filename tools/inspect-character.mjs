/** Audit the actual exported bytes; no model or animation metadata is assumed. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const file = process.argv[2] ?? 'public/assets/characters/player.glb';
const bytes = fs.readFileSync(file);
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const length = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + length));
const binary = bytes.subarray(28 + length);
function data(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const types = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array };
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const Type = types[a.componentType];
  assert.ok(Type && width && !view.byteStride, 'Auditor expects packed exported attributes');
  const chunk = binary.subarray((view.byteOffset ?? 0) + (a.byteOffset ?? 0));
  return new Type(chunk.buffer, chunk.byteOffset, a.count * width);
}
const primitives = gltf.meshes.flatMap((m) => m.primitives);
assert.equal(gltf.skins.length, 1);
assert.equal(primitives.length, 3);
let vertices = 0, triangles = 0;
for (const p of primitives) {
  vertices += gltf.accessors[p.attributes.POSITION].count;
  triangles += gltf.accessors[p.indices].count / 3;
  const joints = data(p.attributes.JOINTS_0), weights = data(p.attributes.WEIGHTS_0);
  assert.ok(joints.every((v) => v < gltf.skins[0].joints.length));
  for (let i = 0; i < weights.length; i += 4) assert.ok(Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 1e-5);
}
assert.ok(triangles < 12000 && vertices < 15000 && bytes.length < 800000, 'Chromebook asset budget');
const clips = gltf.animations.map((a) => {
  const duration = Math.max(...a.samplers.map((s) => gltf.accessors[s.input].max[0]));
  let changing = 0;
  for (const c of a.channels) {
    const values = data(a.samplers[c.sampler].output);
    const width = c.target.path === 'rotation' ? 4 : 3;
    if (values.some((v, i) => Math.abs(v - values[i % width]) > 1e-5)) changing++;
    if (gltf.nodes[c.target.node].name === 'root' && c.target.path === 'translation') assert.ok(values.every((v) => Math.abs(v) < 1e-6), 'No root travel');
  }
  assert.ok(changing >= 2, `${a.name} must contain actual animated transforms`);
  return { name: a.name, duration, tracks: a.channels.length, changing };
});
assert.deepEqual(clips.map((c) => c.name).sort(), ['IDLE', 'JUMP_LAND', 'JUMP_LOOP', 'JUMP_START', 'RUN', 'SLIDE']);
assert.ok(gltf.images.every((image) => image.bufferView !== undefined && !image.uri), 'Self-contained embedded textures');
console.log(JSON.stringify({ file, bytes: bytes.length, vertices, triangles,
  joints: gltf.skins[0].joints.map((i) => gltf.nodes[i].name), materials: gltf.materials.map((m) => m.name),
  meshNodes: gltf.nodes.filter((n) => n.mesh !== undefined || n.name === 'PlayerRig' || n.name === 'root'),
  bounds: primitives.map((p) => { const a = gltf.accessors[p.attributes.POSITION]; return { min: a.min, max: a.max }; }), clips }, null, 2));
