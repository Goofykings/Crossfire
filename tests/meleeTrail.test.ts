import { describe, expect, it } from 'vitest';
import { Mesh, NullEngine, Scene, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';
import { MeleeTrails, resetTrailMaterials, trailPlan } from '../src/game/melee/MeleeTrail';

function setup(reduced = false) {
  resetTrailMaterials();
  const engine = new NullEngine(), scene = new Scene(engine);
  const parent = new TransformNode('rig', scene);
  const trails = new MeleeTrails(scene, 'test', { parent, renderingGroupId: 1 });
  trails.setReduced(reduced);
  return { engine, scene, trails, parent };
}
const meshes = (scene: Scene) => scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith('test:trail'));
/** An arc of tip samples sampled every 4 ms (like the first-person slices). */
function sweep(trails: MeleeTrails, side: 0 | 1, finisher: boolean, steps: number) {
  for (let i = 0; i < steps; i++) {
    trails.tick(.004);
    const a = i / (steps - 1), tip = new Vector3(.3 - a * .6, .1 - a * .3 - Math.sin(a * Math.PI) * .04, -.45);
    trails.push(side, finisher, tip, tip.add(new Vector3(.02, .12, 0)), 1);
  }
}

describe('melee blade trails', () => {
  it('maps attacks to hands: right for attack 1, left for attack 2, both (dramatic) for the finisher', () => {
    expect(trailPlan('attack_cross')).toEqual({ sides: [true, false], finisher: false });
    expect(trailPlan('attack_forward')).toEqual({ sides: [false, true], finisher: false });
    expect(trailPlan('attack_finisher')).toEqual({ sides: [true, true], finisher: true });
    expect(trailPlan('idle')).toBeNull(); expect(trailPlan('flourish_r')).toBeNull(); expect(trailPlan(null)).toBeNull();
  });

  it('draws nothing until a blade moves, builds a smooth strip along the tip path, and hides when it fades', () => {
    const { engine, scene, trails } = setup();
    const [right, left] = meshes(scene);
    expect(right.isEnabled()).toBe(false); expect(trails.inspect().drawCalls).toBe(0);
    sweep(trails, 0, false, 30); trails.flush();
    expect(right.isEnabled()).toBe(true); expect(left.isEnabled()).toBe(false);
    expect(trails.inspect()).toMatchObject({ live: 30, drawCalls: 1, layers: 2 });
    const pos = right.getVerticesData(VertexBuffer.PositionKind)!, col = right.getVerticesData(VertexBuffer.ColorKind)!;
    expect([...pos].every(Number.isFinite)).toBe(true);
    // The newest cross-section's centre vertex sits on the sampled path (tip plus a little of the blade).
    expect(pos[3]).toBeCloseTo(-.3 + .02 * .12, 3); expect(pos[4]).toBeCloseTo(-.2 + .12 * .12, 1);
    // Bright and opaque at the head, transparent at the strip edges and far tail.
    expect(col[7]).toBeGreaterThan(.4); expect(col[3]).toBe(0); expect(col[11]).toBe(0);
    const points = trails.inspect().vertices / 2 / 3;
    expect(col[(points - 1) * 12 + 7]).toBeLessThan(col[7] * .5);
    // The strip stays thin and faces the viewer: lateral half width is below 3 cm.
    for (let p = 0; p < points; p++) expect(Math.hypot(pos[p * 9] - pos[p * 9 + 3], pos[p * 9 + 1] - pos[p * 9 + 4], pos[p * 9 + 2] - pos[p * 9 + 5])).toBeLessThan(.03);
    // It fades out within the longest life (0.32 s) and the mesh switches off.
    for (let i = 0; i < 90; i++) trails.tick(.004);
    trails.flush();
    expect(right.isEnabled()).toBe(false); expect(trails.live).toBe(0); expect(trails.inspect().drawCalls).toBe(0);
    scene.dispose(); engine.dispose();
  });

  it('the finisher is a longer, wider, brighter and warmer layered trail than a slash', () => {
    const slash = setup(), finisher = setup();
    sweep(slash.trails, 0, false, 30); sweep(finisher.trails, 0, true, 30);
    slash.trails.flush(); finisher.trails.flush();
    const a = meshes(slash.scene)[0].getVerticesData(VertexBuffer.ColorKind)!, b = meshes(finisher.scene)[0].getVerticesData(VertexBuffer.ColorKind)!;
    expect(b[7]).toBeGreaterThan(a[7]);      // head alpha
    expect(b[6]).toBeLessThan(a[6]);         // warmer: less blue than the cool slash
    const half = (m: Mesh) => { const p = m.getVerticesData(VertexBuffer.PositionKind)!; return Math.hypot(p[0] - p[3], p[1] - p[4], p[2] - p[5]); };
    expect(half(meshes(finisher.scene)[0])).toBeGreaterThan(half(meshes(slash.scene)[0]));
    // After 0.25 s the finisher's halo is still alive while the slash has almost gone.
    for (const t of [slash, finisher]) { for (let i = 0; i < 62; i++) t.trails.tick(.004); t.trails.flush(); }
    const maxAlpha = (m: Mesh) => { const c = m.getVerticesData(VertexBuffer.ColorKind)!; let best = 0; for (let i = 3; i < c.length; i += 4) best = Math.max(best, c[i]); return best; };
    expect(maxAlpha(meshes(slash.scene)[0])).toBeLessThan(.02); expect(maxAlpha(meshes(finisher.scene)[0])).toBeGreaterThan(.02);
    for (const t of [slash, finisher]) { t.scene.dispose(); t.engine.dispose(); }
  });

  it('uses one layer and no extra smoothing in Chromebook mode, and never exceeds its bounded buffers', () => {
    const full = setup(false), reduced = setup(true);
    sweep(full.trails, 0, true, 40); sweep(reduced.trails, 0, true, 40);
    full.trails.flush(); reduced.trails.flush();
    expect(reduced.trails.inspect().layers).toBe(1); expect(full.trails.inspect().layers).toBe(2);
    expect(reduced.trails.inspect().vertices).toBeLessThan(full.trails.inspect().vertices / 3);
    // A very long continuous sweep wraps the ring instead of growing it.
    const long = setup();
    sweep(long.trails, 0, false, 500); long.trails.flush();
    expect(long.trails.live).toBeLessThanOrEqual(56);
    expect(meshes(long.scene)[0].getTotalVertices()).toBeLessThan(1100);
    for (const t of [full, reduced, long]) { t.scene.dispose(); t.engine.dispose(); }
  });

  it('puts the newest sample exactly on the blade after the arm IK (head correction) and clears on demand', () => {
    const { engine, scene, trails } = setup();
    sweep(trails, 1, false, 12);
    const tip = new Vector3(-.05, -.1, -.4), guard = tip.add(new Vector3(0, .15, 0));
    trails.head(1, tip, guard); trails.flush();
    const pos = meshes(scene)[1].getVerticesData(VertexBuffer.PositionKind)!;
    expect(pos[3]).toBeCloseTo(tip.x, 4); expect(pos[4]).toBeCloseTo(tip.y + .15 * .12, 3); expect(pos[5]).toBeCloseTo(tip.z, 4);
    trails.clear();
    expect(trails.live).toBe(0); expect(meshes(scene)[1].isEnabled()).toBe(false);
    scene.dispose(); engine.dispose();
  });
});
