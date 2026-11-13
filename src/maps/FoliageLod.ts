import { Vector3, type AbstractMesh, type Mesh } from '@babylonjs/core';

/**
 * Foliage (bushes, hedges, tree canopies and the ivy on the perimeter wall) is baked twice by the Blender generators: a
 * detailed set of alpha-cut leaf cards (canonical materials `leaf_bush`, `leaf_ivy`) and a lite twin (`*_lite`: about a third
 * of the cards, 45% larger). The static batcher turns each set into one mesh per map cell, so this class only decides which
 * of the two is drawn:
 *
 *  - Chromebook mode draws the lite sets everywhere (fewer vertices, less alpha-test overdraw);
 *  - otherwise a cell draws the detailed set while the camera is near it and the lite set beyond `near` metres,
 *    with a small hysteresis so a boundary never flickers.
 *
 * Both sets stay in the scene (and in the shadow list); a disabled mesh costs nothing to draw or to shadow.
 */
const FAMILIES = ['leaf_bush', 'leaf_ivy'];

interface Cell { detail: Mesh | null; lite: Mesh | null; center: Vector3; far: boolean }

export class FoliageLod {
  private readonly cells: Cell[] = [];
  private lite = false;

  constructor(batched: readonly AbstractMesh[], private readonly near = 42) {
    const byCell = new Map<string, { detail: Mesh | null; lite: Mesh | null }>();
    for (const m of batched) {
      const canonical = (m.metadata as { canonical?: string } | null)?.canonical ?? '';
      const family = FAMILIES.find((f) => canonical === f || canonical === `${f}_lite`);
      if (!family) continue;
      // batch names are `batch:<canonical>|<cell>`: the cell is shared by the two sets of one family
      const key = `${family}|${m.name.slice(m.name.indexOf('|') + 1)}`;
      const entry = byCell.get(key) ?? { detail: null, lite: null };
      if (canonical === family) entry.detail = m as Mesh; else entry.lite = m as Mesh;
      byCell.set(key, entry);
    }
    for (const e of byCell.values()) {
      const any = (e.detail ?? e.lite)!;
      this.cells.push({ ...e, center: any.getBoundingInfo().boundingBox.centerWorld.clone(), far: false });
    }
    this.apply();
  }

  get count(): number { return this.cells.length; }

  /** Draw the lite sets everywhere (Chromebook mode) or switch back to the distance rule. */
  setLite(on: boolean): void {
    if (this.lite === on) return;
    this.lite = on;
    this.apply();
  }

  /** Per frame: near cells keep the detailed cards, far cells the lite ones. */
  update(camera: Vector3): void {
    if (this.lite) return;
    let changed = false;
    for (const c of this.cells) {
      const d = Math.hypot(camera.x - c.center.x, camera.z - c.center.z);
      const far = c.far ? d > this.near - 4 : d > this.near + 4;
      if (far !== c.far) { c.far = far; changed = true; }
    }
    if (changed) this.apply();
  }

  private apply(): void {
    for (const c of this.cells) {
      const showLite = this.lite || c.far;
      // A cell with only one of the two sets always shows it.
      c.detail?.setEnabled(c.lite ? !showLite : true);
      c.lite?.setEnabled(c.detail ? showLite : true);
    }
  }

  /** Which set each cell currently draws (tests and the debug hook). */
  inspect(): { cells: number; detail: number; lite: number } {
    let detail = 0, lite = 0;
    for (const c of this.cells) {
      if (c.detail?.isEnabled()) detail++;
      if (c.lite?.isEnabled()) lite++;
    }
    return { cells: this.cells.length, detail, lite };
  }
}
