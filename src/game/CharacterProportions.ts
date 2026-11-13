import { Mesh, Vector3, VertexBuffer, type AbstractMesh, type Geometry } from '@babylonjs/core';

const adjusted = new WeakSet<Geometry>();

/** Broaden the shared bind mesh once, not the rig. Joint centres, animation tracks,
 * head/hands, height and gameplay collision remain unchanged. Apply to the same
 * arm geometry in first person so dagger grips keep their original rest frames. */
export function broadenCharacter(meshes: readonly AbstractMesh[]): void {
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.skeleton || !mesh.geometry || adjusted.has(mesh.geometry)) continue;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    const indices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
    if (!positions || !normals || !weights || !indices) continue;
    const rules = new Map<number, { amount: number; depth: number; x: number; y: number; z: number; slope: number; zSlope: number }>();
    for (const bone of mesh.skeleton.bones) {
      const name = bone.name;
      let amount = 0, depth = 0, childName = '';
      // Additional width relative to the existing silhouette, not the raw GLB.
      if (/^(pelvis|spine|chest|clavicle_[lr])$/.test(name)) amount = 1.12 * 1.09 - 1;
      else if (/^(upper_arm|forearm)_[lr]$/.test(name)) {
        amount = (name.startsWith('upper_arm') ? 1.16 : 1) * 1.125 - 1; depth = .125;
        childName = name.replace(/^(upper_arm|forearm)/, name.startsWith('upper_arm') ? 'forearm' : 'hand');
      }
      else if (/^(thigh|shin)_[lr]$/.test(name)) { amount = 1.14 * 1.125 - 1; depth = .125; childName = name.replace(/^(thigh|shin)/, name.startsWith('thigh') ? 'shin' : 'foot'); }
      if (!amount) continue;
      let x = 0, y = 0, z = 0, slope = 0, zSlope = 0;
      if (childName) {
        const start = bone.getAbsoluteInverseBindMatrix().clone().invert().getTranslation();
        const child = mesh.skeleton.bones.find(b => b.name === childName);
        if (!child) continue;
        const end = child.getAbsoluteInverseBindMatrix().clone().invert().getTranslation();
        x = start.x; y = start.y; z = start.z;
        slope = Math.abs(end.y - y) > 1e-6 ? (end.x - x) / (end.y - y) : 0;
        zSlope = Math.abs(end.y - y) > 1e-6 ? (end.z - z) / (end.y - y) : 0;
      }
      rules.set(bone.getIndex(), { amount, depth, x, y, z, slope, zSlope });
    }
    const p = Array.from(positions), n = Array.from(normals);
    for (let v = 0; v < positions.length / 3; v++) {
      const i = v * 3, x = positions[i], y = positions[i + 1], z = positions[i + 2];
      let offset = 0, stretch = 1, shear = 0, zOffset = 0, zStretch = 1, zShear = 0;
      for (let j = 0; j < 4; j++) {
        const rule = rules.get(indices[v * 4 + j]);
        if (!rule) continue;
        const s = weights[v * 4 + j] * rule.amount;
        offset += s * (x - rule.x - rule.slope * (y - rule.y));
        stretch += s; shear -= s * rule.slope;
        const d = weights[v * 4 + j] * rule.depth;
        zOffset += d * (z - rule.z - rule.zSlope * (y - rule.y));
        zStretch += d; zShear -= d * rule.zSlope;
      }
      p[i] = x + offset;
      if(zOffset!==0)p[i + 2] = z + zOffset;
      // Inverse transpose of the blended width transform preserves the exported
      // smooth normals and UV seams; do not recompute split glTF vertex normals.
      const normal = new Vector3(normals[i] / stretch, normals[i + 1] - shear * normals[i] / stretch - zShear * normals[i + 2] / zStretch, normals[i + 2] / zStretch).normalize();
      n[i] = normal.x; n[i + 1] = normal.y; n[i + 2] = normal.z;
    }
    mesh.setVerticesData(VertexBuffer.PositionKind, p);
    mesh.setVerticesData(VertexBuffer.NormalKind, n);
    mesh.refreshBoundingInfo();
    adjusted.add(mesh.geometry);
  }
}
