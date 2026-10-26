import type { RemotePlayer } from '../game/Teammates';
import { markerRotation, TacticalProjection, type Point2, type TacticalMapData } from '../maps/tactical';
import type { Rect, Team } from '../maps/types';

/** What the overlay needs about the local player each frame. */
export interface LocalMarker {
  x: number;
  z: number;
  yaw: number;
  /** null in free-for-all: nobody is a teammate, so no other marker is ever drawn. */
  team: Team | null;
}

const C = {
  offMap: '#121418',
  building: '#3d4149',
  buildingEdge: '#24272c',
  backdrop: '#30333a',
  ground: '#c9c4b7',
  square: '#d3cebf',
  raised: '#dcd6c6',
  covered: '#a7a194',
  hatch: 'rgba(60, 56, 48, 0.28)',
  ledge: '#6c665a',
  stairs: '#ebe5d5',
  stairLine: '#8c8578',
  obstacle: '#5c6068',
  obstacleEdge: '#3b3e45',
  label: '#3a3d44',
  team: { blue: '#5d97ff', red: '#ff6a5e' },
  you: '#ffc443',
  youEdge: '#1b1406',
};

/**
 * The Tab overlay: a north-up overhead map of the current level with the local player's arrow and (when a data source
 * provides them) friendly markers. The level is drawn once per map and canvas size into an offscreen canvas; while the
 * overlay is open only that image plus the markers are drawn each frame.
 */
export class TacticalMapView {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private readonly scaleLabel: HTMLElement;
  private readonly mateLegend: HTMLElement;
  private readonly layer = document.createElement('canvas');
  private data: TacticalMapData | null = null;
  private projection: TacticalProjection | null = null;
  private dpr = 1;
  private shown = false;
  /** Last drawn local marker in CSS pixels relative to the canvas (read by the debug API). */
  readonly lastMarker = { x: 0, y: 0, rotation: 0, teammates: 0 };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'tactical';
    this.root.setAttribute('aria-hidden', 'true');
    const panel = document.createElement('div');
    panel.className = 'tactical-panel';
    const head = document.createElement('div');
    head.className = 'tactical-head';
    this.title = document.createElement('span');
    this.title.className = 'tactical-title';
    const north = document.createElement('span');
    north.className = 'tactical-north';
    north.innerHTML = '<i></i>N';
    head.append(this.title, north);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tactical-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    const foot = document.createElement('div');
    foot.className = 'tactical-foot';
    this.scaleLabel = document.createElement('span');
    this.scaleLabel.className = 'tactical-scale';
    foot.innerHTML = '<span class="lg you"><i></i>You</span><span class="lg mate" hidden><i></i>Teammates</span>';
    foot.prepend(this.scaleLabel);
    // free-for-all: everyone else is an opponent, so the map shows only you; the teammate entry appears in team modes
    // while a real data source reports friendlies
    this.mateLegend = foot.querySelector('.mate')!;
    panel.append(head, this.canvas, foot);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  setMap(data: TacticalMapData, name: string): void {
    this.data = data;
    this.projection = null;
    this.title.textContent = name;
    const [x0, z0, x1, z1] = data.bounds;
    this.root.style.setProperty('--aspect', String((x1 - x0) / (z1 - z0)));
  }

  setVisible(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.root.classList.toggle('visible', visible);
  }

  /** Redraw the markers (call every frame while visible). */
  draw(player: LocalMarker, teammates: readonly RemotePlayer[]): void {
    if (!this.shown || !this.data) return;
    this.ensureLayer();
    const proj = this.projection;
    if (!proj) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    const k = this.dpr;
    let mates = 0;
    for (const t of teammates) {
      // the registry only hands out friendlies; this check keeps the map safe even if a caller passes everyone
      if (player.team === null || t.team !== player.team) continue;
      const p = proj.toMap(t.x, t.z);
      this.drawTeammate(p.x, p.y, t, k);
      mates++;
    }
    const p = proj.toMap(player.x, player.z);
    const rot = markerRotation(player.yaw);
    this.drawPlayer(p.x, p.y, rot, k, proj.scale);
    this.lastMarker.x = p.x / k;
    this.lastMarker.y = p.y / k;
    this.lastMarker.rotation = rot;
    this.lastMarker.teammates = mates;
    this.mateLegend.hidden = mates === 0;
  }

  /** Canvas box in CSS pixels plus the projection (for tests that compare the marker with the world). */
  debugInfo(): { left: number; top: number; width: number; height: number; scale: number } | null {
    if (!this.projection) return null;
    const r = this.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, scale: this.projection.scale / this.dpr };
  }

  projectCss(x: number, z: number): { x: number; y: number } | null {
    if (!this.projection) return null;
    const p = this.projection.toMap(x, z);
    return { x: p.x / this.dpr, y: p.y / this.dpr };
  }

  // --- static layer ----------------------------------------------------------------------------
  private ensureLayer(): void {
    const data = this.data!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    // not laid out (the whole UI is hidden, e.g. ?nohud): try again next frame instead of caching a 0-size map
    if (w === 0 || h === 0) {
      this.projection = null;
      return;
    }
    if (this.projection && this.canvas.width === w && this.canvas.height === h && this.dpr === dpr) return;
    this.dpr = dpr;
    this.canvas.width = this.layer.width = w;
    this.canvas.height = this.layer.height = h;
    this.projection = new TacticalProjection(data.bounds, w, h);
    this.paintLayer(this.layer.getContext('2d')!, this.projection, dpr);
    const metres = this.scaleBarMetres(this.projection.scale / dpr);
    this.scaleLabel.innerHTML = `<i style="width:${Math.round(metres * (this.projection.scale / dpr))}px"></i>${metres} m`;
  }

  private scaleBarMetres(pxPerMetre: number): number {
    for (const m of [5, 10, 20, 25, 50]) if (m * pxPerMetre >= 60) return m;
    return 100;
  }

  private paintLayer(ctx: CanvasRenderingContext2D, proj: TacticalProjection, k: number): void {
    const d = this.data!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.offMap;
    ctx.fillRect(0, 0, proj.width, proj.height);
    const rectPath = (r: Rect) => {
      const a = proj.toMap(r[0], r[1]);
      const b = proj.toMap(r[2], r[3]);
      const p = new Path2D();
      p.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      return p;
    };
    const polyPath = (pts: Point2[]) => {
      const p = new Path2D();
      pts.forEach(([x, z], i) => {
        const m = proj.toMap(x, z);
        if (i === 0) p.moveTo(m.x, m.y);
        else p.lineTo(m.x, m.y);
      });
      p.closePath();
      return p;
    };

    // like the collision world, the play area is walkable ground unless something stands on it (chamfered corners,
    // small gaps between lots); buildings, walls and obstacles are drawn over it
    ctx.fillStyle = C.ground;
    ctx.fill(rectPath(d.playArea));
    ctx.lineJoin = 'round';
    for (const b of d.buildings) {
      const p = polyPath(b.poly);
      ctx.fillStyle = b.backdrop ? C.backdrop : C.building;
      ctx.fill(p);
      ctx.strokeStyle = C.buildingEdge;
      ctx.lineWidth = 1 * k;
      ctx.stroke(p);
    }
    for (const w of d.walls) {
      const p = polyPath(w.poly);
      ctx.fillStyle = C.building;
      ctx.fill(p);
      ctx.strokeStyle = C.buildingEdge;
      ctx.lineWidth = 1 * k;
      ctx.stroke(p);
    }
    for (const g of d.ground) {
      ctx.fillStyle = g.height > 0.05 ? C.raised : g.kind === 'plaza' || g.kind === 'court' || g.kind === 'yard' ? C.square : C.ground;
      ctx.fill(rectPath(g.rect));
    }
    // roofed routes: walkable, darker, hatched
    const hatch = this.hatchPattern(ctx, k);
    for (const c of d.covered) {
      const p = polyPath(c.poly);
      ctx.fillStyle = C.covered;
      ctx.fill(p);
      if (hatch) {
        ctx.fillStyle = hatch;
        ctx.fill(p);
      }
    }
    ctx.strokeStyle = C.ledge;
    ctx.lineWidth = 1.6 * k;
    for (const r of d.ledges) ctx.stroke(rectPath(r));
    for (const s of d.stairs) {
      ctx.fillStyle = C.stairs;
      const a = proj.toMap(s.rect[0], s.rect[1]);
      const b = proj.toMap(s.rect[2], s.rect[3]);
      // cover the ledge line where the stairs cross it
      ctx.fillRect(a.x - k, a.y - k, b.x - a.x + 2 * k, b.y - a.y + 2 * k);
      ctx.strokeStyle = C.stairLine;
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      for (let i = 1; i < s.steps; i++) {
        const t = i / s.steps;
        if (s.side === 'n' || s.side === 's') {
          const y = a.y + (b.y - a.y) * t;
          ctx.moveTo(a.x, y);
          ctx.lineTo(b.x, y);
        } else {
          const x = a.x + (b.x - a.x) * t;
          ctx.moveTo(x, a.y);
          ctx.lineTo(x, b.y);
        }
      }
      ctx.stroke();
    }
    for (const o of d.obstacles) {
      const p = polyPath(o.poly);
      ctx.fillStyle = C.obstacle;
      ctx.fill(p);
      ctx.strokeStyle = C.obstacleEdge;
      ctx.lineWidth = 1 * k;
      ctx.stroke(p);
    }
    for (const l of d.landmarks) {
      const m = proj.toMap(l.pos[0], l.pos[1]);
      this.label(ctx, l.name, m.x, m.y, k, C.label, false);
    }
  }

  private hatchPattern(ctx: CanvasRenderingContext2D, k: number): CanvasPattern | null {
    const tile = document.createElement('canvas');
    const s = Math.max(4, Math.round(6 * k));
    tile.width = tile.height = s;
    const t = tile.getContext('2d')!;
    t.strokeStyle = C.hatch;
    t.lineWidth = Math.max(1, k);
    t.beginPath();
    t.moveTo(0, s);
    t.lineTo(s, 0);
    t.stroke();
    return ctx.createPattern(tile, 'repeat');
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, color: string, strong: boolean): void {
    ctx.font = `${strong ? 700 : 600} ${Math.round((strong ? 11 : 10) * k)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (strong) {
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(14, 16, 21, 0.75)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(220, 215, 202, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
    }
    ctx.fillText(text, x, y);
  }

  // --- markers ---------------------------------------------------------------------------------
  private drawPlayer(x: number, y: number, rot: number, k: number, pxPerMetre: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // view cone: which way the player is looking
    const r = Math.max(34 * k, pxPerMetre * 7);
    const half = 0.6;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255, 196, 67, 0.38)');
    g.addColorStop(1, 'rgba(255, 196, 67, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.fill();
    // arrow (points up = forward before rotation)
    const s = 9 * k;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.25);
    ctx.lineTo(s * 0.85, s * 0.9);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(-s * 0.85, s * 0.9);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = C.youEdge;
    ctx.stroke();
    ctx.fillStyle = C.you;
    ctx.fill();
    ctx.restore();
  }

  private drawTeammate(x: number, y: number, t: RemotePlayer, k: number): void {
    const ctx = this.ctx;
    const color = C.team[t.team];
    ctx.save();
    ctx.translate(x, y);
    if (t.yaw !== undefined) {
      ctx.save();
      ctx.rotate(markerRotation(t.yaw));
      ctx.beginPath();
      ctx.moveTo(0, -10 * k);
      ctx.lineTo(4 * k, -4 * k);
      ctx.lineTo(-4 * k, -4 * k);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 5 * k, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (t.name) {
      ctx.font = `600 ${Math.round(10 * k)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(14, 16, 21, 0.8)';
      ctx.strokeText(t.name, 9 * k, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.name, 9 * k, 0);
    }
    ctx.restore();
  }
}
