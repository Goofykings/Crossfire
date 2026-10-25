import {
  Color3,
  Constants,
  DynamicTexture,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  ShaderMaterial,
  StandardMaterial,
  Vector3,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import type { SafeZoneDef, Team, ZoneEntrance } from '../maps/types';

/** Display-referred colours: these materials bypass the scene tone mapping. */
const TEAM_STYLE: Record<Team, { label: string; glow: [number, number, number]; light: string; mid: string; dark: string }> = {
  blue: { label: 'BLUE ZONE', glow: [0.26, 0.52, 1.0], light: '#d6e6ff', mid: '#5f9bff', dark: '#1b3f99' },
  red: { label: 'RED ZONE', glow: [1.0, 0.3, 0.26], light: '#ffe0da', mid: '#ff6b5c', dark: '#a02620' },
};

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
varying vec2 vShape;
varying vec3 vWorld;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vWorld = w.xyz;
  vUV = uv;
  vShape = uv2;
  gl_Position = viewProjection * w;
}`;

// A soft veil: faint body that thickens toward the floor, a glowing rail on top and at the base, a slow rising
// shimmer and a fine gauze weave. It brightens in a ripple around the player so crossing it is unmistakable.
const FRAG = `
precision highp float;
varying vec2 vUV;      // x: metres along the barrier, y: metres above the floor
varying vec2 vShape;   // x: 0..1 up the barrier, y: barrier height at this column
varying vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uPlayer;
uniform float uTime;
void main() {
  float h = vShape.x;
  float m = vUV.y;
  float body = 0.11 + 0.17 * (1.0 - h) * (1.0 - h);
  float shimmer = smoothstep(0.6, 1.0, sin(m * 2.4 - uTime * 0.55 + sin(vUV.x * 1.3) * 1.6)) * 0.06;
  float gauze = smoothstep(0.88, 1.0, 1.0 - abs(fract(vUV.x * 1.5) - 0.5) * 2.0) * 0.035 * (1.0 - h);
  float rail = smoothstep(vShape.y - 0.16, vShape.y, m);
  float base = 1.0 - smoothstep(0.0, 0.1, m);
  float d = distance(vWorld, uPlayer);
  float near = smoothstep(3.2, 0.0, d);
  float ripple = near * (0.22 + 0.12 * sin(uTime * 4.0 - d * 5.0));
  float a = body + shimmer + gauze + rail * 0.5 + base * 0.55 + ripple;
  vec3 c = uColor * (0.85 + 0.5 * rail + 0.5 * base + 0.6 * near) + vec3(0.25) * (rail + base * 0.6);
  gl_FragColor = vec4(c, clamp(a, 0.0, 0.8));
}`;

interface Plane {
  /** Start of the run on the barrier's plane (floor level). */
  origin: Vector3;
  along: Vector3;
  /** Unit vector pointing into the safe zone. */
  inward: Vector3;
}

/**
 * Translucent veils across a safe zone's entrances, with a billboarded name label by each. Purely visual: the
 * protection itself comes from SafeZoneSystem. The veils stand one body radius outside the zone's edge, which is
 * exactly where SafeZoneSystem starts treating a player as inside, so crossing the veil and becoming protected
 * happen at the same moment.
 */
export class ZoneBarriers {
  private readonly meshes: Mesh[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly labelMaterials: StandardMaterial[] = [];
  private readonly textures: DynamicTexture[] = [];
  private time = 0;

  constructor(
    private readonly scene: Scene,
    zones: SafeZoneDef[],
    bodyRadius: number,
  ) {
    const barrierMats = new Map<Team, ShaderMaterial>();
    const labelMats = new Map<Team, StandardMaterial>();
    for (const zone of zones) {
      if (!zone.entrances?.length) continue;
      if (!barrierMats.has(zone.team)) {
        barrierMats.set(zone.team, this.createBarrierMaterial(zone.team));
        labelMats.set(zone.team, this.createLabelMaterial(zone.team));
      }
      zone.entrances.forEach((e, i) => {
        const plane = this.planeFor(zone, e, bodyRadius);
        const barrier = this.createBarrier(`zone-barrier:${zone.id}:${i}`, plane, e);
        barrier.material = barrierMats.get(zone.team)!;
        this.meshes.push(barrier, this.createLabel(`zone-label:${zone.id}:${i}`, zone, e, plane, labelMats.get(zone.team)!));
      });
    }
  }

  /** Advance the shimmer and tell the shader where the player is (for the proximity ripple). */
  update(dt: number, player: Vector3): void {
    this.time += dt;
    for (const m of this.materials) {
      m.setFloat('uTime', this.time);
      m.setVector3('uPlayer', player);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose(false, false);
    for (const m of this.materials) m.dispose();
    for (const m of this.labelMaterials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
    this.labelMaterials.length = 0;
    this.textures.length = 0;
  }

  private planeFor(zone: SafeZoneDef, e: ZoneEntrance, r: number): Plane {
    const [x0, z0, x1, z1] = zone.rect;
    switch (e.side) {
      case 'n':
        return { origin: new Vector3(e.from, 0, z0 - r), along: new Vector3(1, 0, 0), inward: new Vector3(0, 0, 1) };
      case 's':
        return { origin: new Vector3(e.from, 0, z1 + r), along: new Vector3(1, 0, 0), inward: new Vector3(0, 0, -1) };
      case 'w':
        return { origin: new Vector3(x0 - r, 0, e.from), along: new Vector3(0, 0, 1), inward: new Vector3(1, 0, 0) };
      default:
        return { origin: new Vector3(x1 + r, 0, e.from), along: new Vector3(0, 0, 1), inward: new Vector3(-1, 0, 0) };
    }
  }

  private createBarrierMaterial(team: Team): ShaderMaterial {
    const mat = new ShaderMaterial(
      `zone-barrier:${team}`,
      this.scene,
      { vertexSource: VERT, fragmentSource: FRAG },
      {
        attributes: ['position', 'uv', 'uv2'],
        uniforms: ['world', 'viewProjection', 'uColor', 'uPlayer', 'uTime'],
        needAlphaBlending: true,
      },
    );
    mat.setColor3('uColor', new Color3(...TEAM_STYLE[team].glow));
    mat.setVector3('uPlayer', new Vector3(0, -100, 0));
    mat.setFloat('uTime', 0);
    mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_COMBINE;
    mat.disableDepthWrite = true;
    this.materials.push(mat);
    return mat;
  }

  private createBarrier(name: string, plane: Plane, e: ZoneEntrance): Mesh {
    // flush with the neighbouring walls, but not z-fighting with them
    const inset = 0.02;
    const w = e.to - e.from - inset * 2;
    // arched passages need columns so the top edge can follow the vault
    const columns = e.apex !== undefined ? Math.max(2, Math.ceil(w / 0.25)) : 1;
    const positions: number[] = [];
    const uvs: number[] = [];
    const uvs2: number[] = [];
    const indices: number[] = [];
    for (let c = 0; c <= columns; c++) {
      const t = c / columns;
      const top = e.apex !== undefined ? e.height + (e.apex - e.height) * (1 - (2 * t - 1) ** 2) : e.height;
      const p = plane.origin.add(plane.along.scale(inset + w * t));
      for (const y of [0.01, top]) {
        positions.push(p.x, y, p.z);
        uvs.push(inset + w * t, y);
        uvs2.push(y / top, top);
      }
      if (c > 0) {
        const i = (c - 1) * 2;
        indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.uvs = uvs;
    vd.uvs2 = uvs2;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    return mesh;
  }

  private createLabelMaterial(team: Team): StandardMaterial {
    const style = TEAM_STYLE[team];
    const W = 1024;
    const H = 256;
    const tex = new DynamicTexture(`zone-label:${team}`, { width: W, height: H }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 150px 'Trebuchet MS', 'Segoe UI', Verdana, sans-serif`;
    // letter-spacing is not available everywhere; the text reads fine without it
    (ctx as unknown as { letterSpacing: string }).letterSpacing = '10px';
    const cx = W / 2 + 5;
    const cy = H / 2 - 12;
    // coloured halo and a dark outline so the text holds up against bright walls and sky
    ctx.shadowColor = style.mid;
    ctx.shadowBlur = 38;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(8, 10, 18, 0.88)';
    ctx.strokeText(style.label, cx, cy);
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, cy - 70, 0, cy + 70);
    g.addColorStop(0, style.light);
    g.addColorStop(0.45, style.mid);
    g.addColorStop(1, style.dark);
    ctx.fillStyle = g;
    ctx.fillText(style.label, cx, cy);
    // slim underline, echoing the veil's rail
    ctx.shadowBlur = 14;
    ctx.shadowColor = style.mid;
    ctx.fillStyle = style.mid;
    ctx.fillRect(150, 218, 724, 6);
    tex.update(true);

    const mat = new StandardMaterial(`zone-label:${team}`, this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    mat.disableDepthWrite = true;
    // keep the colours as authored: no scene tone mapping on text
    const ip = new ImageProcessingConfiguration();
    ip.toneMappingEnabled = false;
    mat.imageProcessingConfiguration = ip;
    this.textures.push(tex);
    this.labelMaterials.push(mat);
    return mat;
  }

  private createLabel(name: string, zone: SafeZoneDef, e: ZoneEntrance, plane: Plane, mat: StandardMaterial): Mesh {
    const width = e.to - e.from;
    const covered = e.apex !== undefined || e.height < 3;
    const labelW = Math.min(4.6, width - 0.4);
    const labelH = labelW / 4;
    const pos = plane.origin.add(plane.along.scale(width / 2));
    if (covered) {
      // low passage: hang just inside the yard, under the lintel, where it is seen straight on through the tunnel
      pos.addInPlace(plane.inward.scale(0.9));
      pos.y = e.height - 0.5;
    } else {
      // open lane: float above the veil
      pos.y = e.height + 0.35 + labelH / 2;
    }
    const mesh = MeshBuilder.CreatePlane(name, { width: labelW, height: labelH }, this.scene);
    mesh.position.copyFrom(pos);
    // upright but always turned toward the player, so the text is never seen from behind
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alphaIndex = 10;
    mesh.receiveShadows = false;
    mesh.metadata = { zone: zone.id };
    return mesh;
  }
}
