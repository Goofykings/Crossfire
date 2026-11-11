import { Color3, Mesh, PBRMaterial, VertexData, type AssetContainer, type Scene, type TransformNode } from '@babylonjs/core';
import { assetUrl } from '../core/assets';

/** Decorative icicles of the Frosted skin: one small mesh per weapon, built from the
 * placements written by blender/cosmetics/icicle_design.py and parented to the gun's static
 * body node, so they follow every pose and never ride on the magazine, pump or bolt.
 * Visual only: not pickable, no collision, no shadows, opaque (no transparency sorting). */
export interface IcicleFile { version: number; weapon: string; line: number; icicles: number[][] }

const SIDES = 5;
/** Root ring, a waist at 45% of the length, and the tip: 15 triangles per icicle. */
export function icicleGeometry(icicles: readonly number[][]): VertexData {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  const root = [.93, .97, 1], waist = [.72, .88, 1], tip = [.5, .78, 1];
  for (const [x, y, z, dx, dy, dz, length, radius] of icicles) {
    // Any two axes perpendicular to the direction.
    const ax = Math.abs(dy) > .9 ? [1, 0, 0] : [0, 1, 0];
    let ux = ax[1] * dz - ax[2] * dy, uy = ax[2] * dx - ax[0] * dz, uz = ax[0] * dy - ax[1] * dx;
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const base = positions.length / 3;
    for (const [along, r, colour] of [[0, radius, root], [.45, radius * .56, waist]] as const) for (let i = 0; i < SIDES; i++) {
      const a = i / SIDES * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      positions.push(x + dx * length * along + nx * r, y + dy * length * along + ny * r, z + dz * length * along + nz * r);
      normals.push(nx, ny, nz); colors.push(colour[0], colour[1], colour[2], 1);
    }
    positions.push(x + dx * length, y + dy * length, z + dz * length); normals.push(dx, dy, dz); colors.push(tip[0], tip[1], tip[2], 1);
    const apex = base + SIDES * 2;
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES;
      indices.push(base + i, base + j, base + SIDES + j, base + i, base + SIDES + j, base + SIDES + i, base + SIDES + i, base + SIDES + j, apex);
    }
  }
  const data = new VertexData();
  data.positions = positions; data.normals = normals; data.colors = colors; data.indices = indices;
  return data;
}

export async function addIcicles(c: Pick<AssetContainer, 'meshes' | 'materials' | 'transformNodes'>, path: string, scene: Scene, signal?: AbortSignal): Promise<void> {
  const response = await fetch(assetUrl(path), { signal });
  if (!response.ok) throw new Error(`Icicles unavailable: ${path}`);
  const file = await response.json() as IcicleFile;
  if (file.version !== 1 || !Array.isArray(file.icicles) || !file.icicles.length) return;
  // Anchors are children of the gun's body node, whose space the placements use.
  const body = c.transformNodes.find((n) => n.name === 'muzzle')?.parent as TransformNode | null;
  if (!body) return;
  const mesh = new Mesh('frost_icicles', scene);
  icicleGeometry(file.icicles).applyToMesh(mesh);
  const material = new PBRMaterial('frost_icicle', scene);
  material.albedoColor = Color3.White(); material.metallic = 0; material.roughness = .16;
  // A little self-light keeps the pale ice readable where reflections are off (Chromebook).
  material.emissiveColor = new Color3(.1, .14, .2);
  // Tiny double-sided cones: the winding is the same in first person and on characters.
  material.backFaceCulling = false; material.twoSidedLighting = true;
  mesh.material = material; mesh.parent = body; mesh.isPickable = false; mesh.receiveShadows = false;
  // The container's meshes join the scene with addAllToScene (or as instantiated copies);
  // the material stays registered, like the cloned skin materials, so dirty flags reach it.
  scene.removeMesh(mesh);
  c.meshes.push(mesh); c.materials.push(material);
}
