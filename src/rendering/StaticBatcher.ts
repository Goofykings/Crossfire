import { AbstractMesh, Matrix, Mesh, Quaternion, Vector3, VertexBuffer, VertexData, type Material, type Scene } from '@babylonjs/core';

export interface CanonicalMaterial {
  material: Material;
  /** Multiplier baked into vertex colours so tint variants can share one material. */
  tint: [number, number, number];
  /** Canonical material name (used for grouping and shadow decisions). */
  name: string;
}

interface Entry {
  source: Mesh;
  world: Matrix;
  canon: CanonicalMaterial;
}

interface SourceData {
  positions: Float32Array | number[];
  normals: Float32Array | number[] | null;
  uvs: Float32Array | number[] | null;
  colors: Float32Array | number[] | null;
  indices: Uint32Array | Uint16Array | Int32Array | number[];
}

/**
 * Bakes static geometry (building shells, instanced kit pieces, props) into one mesh per
 * canonical material and spatial cell. Works directly on vertex buffers, so thousands of kit
 * instances collapse into a few dozen draw calls without creating intermediate meshes.
 */
export class GeometryBatcher {
  private readonly entries: Entry[] = [];
  private readonly sources = new Map<Mesh, SourceData>();

  constructor(
    private readonly scene: Scene,
    private readonly cellSize: number,
  ) {}

  add(source: Mesh, world: Matrix, canon: CanonicalMaterial): void {
    if (source.getTotalVertices() === 0) return;
    if (!this.sources.has(source)) {
      this.sources.set(source, {
        positions: source.getVerticesData(VertexBuffer.PositionKind)!,
        normals: source.getVerticesData(VertexBuffer.NormalKind),
        uvs: source.getVerticesData(VertexBuffer.UVKind),
        colors: source.getVerticesData(VertexBuffer.ColorKind),
        indices: source.getIndices() ?? [],
      });
    }
    this.entries.push({ source, world, canon });
  }

  get count(): number {
    return this.entries.length;
  }

  build(): Mesh[] {
    // bucket entries by material + cell (cell from the transformed bounding centre)
    const buckets = new Map<string, Entry[]>();
    const c = new Vector3();
    for (const e of this.entries) {
      const bb = e.source.getBoundingInfo().boundingBox;
      Vector3.TransformCoordinatesToRef(bb.center, e.world, c);
      // glTF meshes in a right-handed scene are counter-clockwise; keep winding conventions apart
      const key = `${e.canon.name}|${Math.floor(c.x / this.cellSize)}|${Math.floor(c.z / this.cellSize)}|${e.source.sideOrientation}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(e);
    }
    const out: Mesh[] = [];
    const p = new Vector3();
    const n = new Vector3();
    for (const [key, list] of buckets) {
      let vcount = 0;
      let icount = 0;
      for (const e of list) {
        const s = this.sources.get(e.source)!;
        vcount += s.positions.length / 3;
        icount += s.indices.length;
      }
      const positions = new Float32Array(vcount * 3);
      const normals = new Float32Array(vcount * 3);
      const uvs = new Float32Array(vcount * 2);
      const colors = new Float32Array(vcount * 4);
      const indices = new Uint32Array(icount);
      let vo = 0;
      let io = 0;
      // which source piece each run of triangles came from (geometry audits: tools/dev-zfight.mjs)
      const origin: { tri: number; name: string }[] = [];
      for (const e of list) {
        const s = this.sources.get(e.source)!;
        origin.push({ tri: io / 3, name: e.source.name });
        const m = e.world;
        const nv = s.positions.length / 3;
        const flip = m.determinant() < 0;
        const [tr, tg, tb] = e.canon.tint;
        for (let i = 0; i < nv; i++) {
          Vector3.TransformCoordinatesFromFloatsToRef(s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2], m, p);
          positions[(vo + i) * 3] = p.x;
          positions[(vo + i) * 3 + 1] = p.y;
          positions[(vo + i) * 3 + 2] = p.z;
          if (s.normals) {
            Vector3.TransformNormalFromFloatsToRef(s.normals[i * 3], s.normals[i * 3 + 1], s.normals[i * 3 + 2], m, n);
            n.normalize();
            normals[(vo + i) * 3] = n.x;
            normals[(vo + i) * 3 + 1] = n.y;
            normals[(vo + i) * 3 + 2] = n.z;
          }
          if (s.uvs) {
            uvs[(vo + i) * 2] = s.uvs[i * 2];
            uvs[(vo + i) * 2 + 1] = s.uvs[i * 2 + 1];
          }
          const ci = (vo + i) * 4;
          if (s.colors) {
            colors[ci] = s.colors[i * 4] * tr;
            colors[ci + 1] = s.colors[i * 4 + 1] * tg;
            colors[ci + 2] = s.colors[i * 4 + 2] * tb;
            colors[ci + 3] = 1;
          } else {
            colors[ci] = tr;
            colors[ci + 1] = tg;
            colors[ci + 2] = tb;
            colors[ci + 3] = 1;
          }
        }
        const idx = s.indices;
        for (let i = 0; i < idx.length; i += 3) {
          indices[io + i] = idx[i] + vo;
          indices[io + i + 1] = (flip ? idx[i + 2] : idx[i + 1]) + vo;
          indices[io + i + 2] = (flip ? idx[i + 1] : idx[i + 2]) + vo;
        }
        vo += nv;
        io += idx.length;
      }
      const mesh = new Mesh(`batch:${key}`, this.scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.uvs = uvs;
      vd.colors = colors;
      vd.indices = indices;
      vd.applyToMesh(mesh, false);
      mesh.material = list[0].canon.material;
      mesh.sideOrientation = list[0].source.sideOrientation;
      mesh.metadata = { canonical: list[0].canon.name, origin };
      finalizeStatic(mesh);
      out.push(mesh);
    }
    this.entries.length = 0;
    this.sources.clear();
    return out;
  }
}

export function finalizeStatic(m: Mesh): void {
  m.isPickable = false;
  m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
  m.computeWorldMatrix(true);
  m.freezeWorldMatrix();
  m.doNotSyncBoundingInfo = true;
}

/** Detach a mesh from its hierarchy and reset it to identity, returning its previous world matrix. */
export function detachToIdentity(m: AbstractMesh): Matrix {
  m.computeWorldMatrix(true);
  const world = m.getWorldMatrix().clone();
  m.parent = null;
  m.position = Vector3.Zero();
  m.rotationQuaternion = Quaternion.Identity();
  m.scaling = Vector3.One();
  m.computeWorldMatrix(true);
  return world;
}
