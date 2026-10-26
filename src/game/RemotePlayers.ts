import { Color3, MeshBuilder, StandardMaterial, TransformNode, type Scene } from '@babylonjs/core';
import type { PlayerState, Snapshot } from '../../shared/protocol';

interface Sample { at: number; player: PlayerState }
interface Avatar { root: TransformNode; look: TransformNode; samples: Sample[]; seen: number }

/** Stage 2 bodies represent actual connected sessions; team presentation is a later stage. */
export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();
  private readonly material: StandardMaterial;
  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial('remote-player', scene);
    this.material.diffuseColor = new Color3(0.65, 0.5, 0.28);
    this.material.emissiveColor = new Color3(0.08, 0.06, 0.03);
  }
  snapshot(s: Snapshot, selfId: string): void {
    const ids = new Set(s.players.filter((p) => p.id !== selfId && p.alive).map((p) => p.id));
    for (const [id, avatar] of this.avatars) if (!ids.has(id)) { avatar.root.dispose(); this.avatars.delete(id); }
    for (const player of s.players) {
      if (player.id === selfId || !player.alive) continue;
      let a = this.avatars.get(player.id);
      if (!a) {
        const root = new TransformNode(`remote:${player.id}`, this.scene);
        const body = MeshBuilder.CreateCapsule(`remote-body:${player.id}`, { height: 1.65, radius: 0.3 }, this.scene);
        body.parent = root;
        body.position.y = 0.825;
        body.material = this.material;
        body.isPickable = false;
        const look = new TransformNode(`remote-look:${player.id}`, this.scene);
        look.parent = root;
        look.position.y = 1.46;
        const face = MeshBuilder.CreateBox(`remote-facing:${player.id}`, { width: 0.22, height: 0.16, depth: 0.14 }, this.scene);
        face.parent = look;
        face.position.set(0, 0, -0.29);
        face.material = this.material;
        face.isPickable = false;
        a = { root, look, samples: [], seen: performance.now() };
        this.avatars.set(player.id, a);
      }
      a.seen = performance.now();
      a.samples.push({ at: s.serverTime, player });
      if (a.samples.length > 30) a.samples.shift();
    }
  }
  update(serverTime: number): void {
    for (const [id, a] of this.avatars) {
      if (performance.now() - a.seen > 4000) { a.root.dispose(); this.avatars.delete(id); continue; }
      const samples = a.samples;
      while (samples.length > 2 && samples[1].at < serverTime) samples.shift();
      const older = samples[0], newer = samples[1] ?? older;
      const k = Math.max(0, Math.min(1, (serverTime - older.at) / Math.max(1, newer.at - older.at)));
      const m = older.player.motion, n = newer.player.motion;
      a.root.position.set(m.position.x + (n.position.x - m.position.x) * k, m.position.y + (n.position.y - m.position.y) * k,
        m.position.z + (n.position.z - m.position.z) * k);
      a.root.rotation.y = m.yaw + Math.atan2(Math.sin(n.yaw - m.yaw), Math.cos(n.yaw - m.yaw)) * k;
      a.look.rotation.x = m.pitch + (n.pitch - m.pitch) * k;
      a.root.scaling.y = 1 - (m.crouch + (n.crouch - m.crouch) * k) * 0.36;
    }
  }
  inspect(): { id: string; x: number; y: number; z: number; yaw: number }[] {
    return [...this.avatars].map(([id, a]) => ({ id, x: a.root.position.x, y: a.root.position.y, z: a.root.position.z, yaw: a.root.rotation.y }));
  }
  clear(): void { for (const a of this.avatars.values()) a.root.dispose(); this.avatars.clear(); }
}
