import type { Vector3 } from 'three';

/** Axis-aligned box on the XZ plane. */
export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Push a circle (on XZ) out of every box it overlaps. Mutates pos. */
export function resolveCircleBoxes(pos: Vector3, radius: number, boxes: readonly Box2[]): void {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = radius - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else {
      // Center is inside the box: push out along the shallowest axis.
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const down = pos.z - b.minZ;
      const up = b.maxZ - pos.z;
      const m = Math.min(left, right, down, up);
      if (m === left) pos.x = b.minX - radius;
      else if (m === right) pos.x = b.maxX + radius;
      else if (m === down) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    }
  }
}

/** Separate two circles on XZ, splitting the correction by inverse weight. */
export function separateCircles(
  a: Vector3,
  ra: number,
  wa: number,
  b: Vector3,
  rb: number,
  wb: number,
): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = ra + rb;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-8) return;
  const d = Math.sqrt(d2);
  const overlap = min - d;
  const total = wa + wb;
  const nx = dx / d;
  const nz = dz / d;
  a.x -= nx * overlap * (wb / total);
  a.z -= nz * overlap * (wb / total);
  b.x += nx * overlap * (wa / total);
  b.z += nz * overlap * (wa / total);
}

/** Signed smallest angle from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate angle `from` toward `to` by at most maxStep. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Yaw (rotation about +Y) that faces from (x1,z1) toward (x2,z2). Facing +Z at yaw 0. */
export function yawTo(x1: number, z1: number, x2: number, z2: number): number {
  return Math.atan2(x2 - x1, z2 - z1);
}
