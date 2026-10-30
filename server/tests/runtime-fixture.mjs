// Local-test entry only. Production Wrangler always bundles src/index.ts.
// Seed one real client's motion below the world to exercise the existing fall
// boundary without adding a cheat/kill command to the public protocol.
import { PublicRoom as ProductionRoom } from '../dist/index.js';
export { default } from '../dist/index.js';
export class PublicRoom extends ProductionRoom {
  async healthForTest(id) {
    const e = this.players.get(id);
    if (!e) throw new Error('Requires a real joined session');
    return { health: e.session.health, regenAt: e.session.regenAt, now: Date.now() };
  }
  async dropSocketForTest(id) {
    const e = this.players.get(id);
    if (!e?.socket) throw new Error('Requires a connected real session');
    e.socket.close(1012, 'test_transport_drop');
  }
  async directionalArenaForTest() {
    const w = this.activeMap.world;
    const clear = ([x, y, z]) => Number.isFinite(y) && !w.overlapsCylinder(x, z, .34, y + .42, y + 1.8);
    for (let x = -12; x <= 12; x += 2) for (let z = -12; z <= 12; z += 2) {
      const y = w.groundHeight(x, z, .24, 3), center = [x, y, z];
      const sources = { front: [x, y, z - 2.2], left: [x - 2.2, y, z], right: [x + 2.2, y, z], behind: [x, y, z + 2.2] };
      const observer = [x + 1.8, y, z + 1.8];
      if (![center, observer, ...Object.values(sources)].every(clear)) continue;
      if ([observer, ...Object.values(sources)].some((p) => {
        const delta = [x - p[0], -.5, z - p[2]], length = Math.hypot(...delta);
        return w.raycast(p[0], y + 1.64, p[2], ...delta.map((v) => v / length), length - .4);
      })) continue;
      return { center, sources, observer };
    }
    throw new Error('No clear four-direction sightline in actual map geometry');
  }
  async placeForCombatTest(id, pos, heading = 0) {
    const e = this.players.get(id);
    if (!e?.session.alive) throw new Error('Requires a real, server-spawned WebSocket session');
    const [x, y, z] = pos;
    if (this.activeMap.world.overlapsCylinder(x, z, .34, y + .42, y + 1.8)) throw new Error('Arena position intersects map solids');
    e.controller.teleport({ x, y, z }, heading);
    this.attach(e);
    this.broadcast();
    return this.snapshot();
  }
  async wallArenaForTest() {
    const world = this.activeMap.world;
    let fallback = null;
    for (const c of world.colliders.values()) {
      if (!c.tag.startsWith('wall:') || c.hy < 1) continue;
      const alongX = c.hx < c.hz;
      const nx = alongX ? c.cos : c.sin, nz = alongX ? -c.sin : c.cos;
      const gap = (alongX ? c.hx : c.hz) + 1.2;
      const pair = [-1, 1].map((s) => {
        const x = c.cx + nx * gap * s, z = c.cz + nz * gap * s;
        return [x, world.groundHeight(x, z, .24, 3), z];
      });
      if (pair.every(([x, y, z]) => Number.isFinite(y) && !world.overlapsCylinder(x, z, .34, y + .42, y + 1.8))) {
        const tangent = alongX ? [c.sin, c.cos] : [c.cos, -c.sin];
        const shift = (alongX ? c.hz : c.hx) - .08;
        const edgePair = pair.map(([x, , z]) => {
          x += tangent[0] * shift; z += tangent[1] * shift;
          return [x, world.groundHeight(x, z, .24, 3), z];
        });
        const result = { pair, wall: c.tag, edgePair: null };
        if (edgePair.every(([x, y, z]) => Number.isFinite(y) && !world.overlapsCylinder(x, z, .34, y + .42, y + 1.8))) {
          result.edgePair = edgePair;
          return result;
        }
        fallback ??= result;
      }
    }
    if (fallback) return fallback;
    throw new Error('No clear opposite sides of a real map wall');
  }
  async distantArenaForTest() {
    const world = this.activeMap.world;
    for (const a of this.activeMap.layout.spawns) for (const b of this.activeMap.layout.spawns) {
      const delta = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
      const distance = Math.hypot(...delta);
      if (distance < 20 || distance > 45) continue;
      if (!world.raycast(a.pos[0], a.pos[1] + 1.64, a.pos[2], delta[0] / distance, delta[1] / distance, delta[2] / distance, distance - .4)) {
        return { pair: [a.pos, b.pos], distance };
      }
    }
    throw new Error('No distant clear sightline between actual map spawns');
  }
  async advanceMapForTest() {
    this.schedule.epoch -= 600000;
    await this.ctx.storage.put('map-schedule', this.schedule);
    this.ensureRound();
    return this.snapshot();
  }
  async fallForTest(id) {
    const entry = this.players.get(id);
    if (!entry?.session.alive) throw new Error('Test requires a spawned real session');
    entry.controller.position.y = -30;
    entry.controller.grounded = false;
    this.start();
  }
}
