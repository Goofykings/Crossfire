// Local-test entry only. Production Wrangler always bundles src/index.ts.
// Seed one real client's motion below the world to exercise the existing fall
// boundary without adding a cheat/kill command to the public protocol.
import { PublicRoom as ProductionRoom } from '../dist/index.js';
export { default } from '../dist/index.js';
export class PublicRoom extends ProductionRoom {
  async fallForTest(id) {
    const entry = this.players.get(id);
    if (!entry?.session.alive) throw new Error('Test requires a spawned real session');
    entry.controller.position.y = -30;
    entry.controller.grounded = false;
    this.start();
  }
}
