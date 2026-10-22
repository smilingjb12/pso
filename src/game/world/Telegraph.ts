import * as THREE from 'three';

// Ground decals that warn about an incoming area attack. The outline shows the
// full area; an inner fill grows until the attack fires. A dash check (an area
// too big to walk out of in time) also gets a pulsing rim in the dash colour.

/** The dash colour (HUD chevrons, the dash streak). */
const DASH_RIM = 0x7fe8ff;
const RIM = 0.3;
/** A bold telegraph's solid edge (m), and how dark it is against its colour (0 black .. 1 the colour). */
const EDGE = 0.16;
const EDGE_SHADE = 0.6;

export type TelegraphShape =
  | { kind: 'circle'; x: number; z: number; radius: number }
  | { kind: 'cone'; x: number; z: number; yaw: number; range: number; arcDeg: number }
  | { kind: 'line'; x: number; z: number; yaw: number; length: number; width: number }
  /** A band between two radii, `arcDeg` wide around `yaw` (the Warden's sweeping arm). */
  | { kind: 'arc'; x: number; z: number; yaw: number; inner: number; outer: number; arcDeg: number };

export class Telegraph {
  readonly group = new THREE.Group();
  t = 0;
  done = false;
  /** The player's own technique flashes (not a warning; Slipstream ignores them). */
  friendly = false;
  /** Speed of its clock (a chilled boss's telegraphs run as slow as it does). */
  rate: () => number = () => 1;
  private fill: THREE.Mesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private fillMat: THREE.MeshBasicMaterial;
  private rim: THREE.MeshBasicMaterial | null = null;

  constructor(
    readonly shape: TelegraphShape,
    readonly duration: number,
    private onFire: () => void,
    color = 0xff4020,
    dash = false,
  ) {
    const outlineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    this.outlineMat = outlineMat;
    this.fillMat = fillMat;
    let geo: THREE.BufferGeometry;
    switch (shape.kind) {
      case 'circle':
        geo = new THREE.CircleGeometry(shape.radius, 40);
        break;
      case 'cone': {
        const half = THREE.MathUtils.degToRad(shape.arcDeg) / 2;
        // CircleGeometry sector starting angle measured from +X in its plane.
        geo = new THREE.CircleGeometry(shape.range, 24, Math.PI / 2 - half, half * 2);
        break;
      }
      case 'line':
        geo = new THREE.PlaneGeometry(shape.width, shape.length).translate(0, shape.length / 2, 0);
        break;
      case 'arc': {
        const half = THREE.MathUtils.degToRad(shape.arcDeg) / 2;
        geo = new THREE.RingGeometry(shape.inner, shape.outer, 48, 1, Math.PI / 2 - half, half * 2);
        break;
      }
    }
    const outline = new THREE.Mesh(geo, outlineMat);
    this.fill = new THREE.Mesh(geo, fillMat);
    for (const m of [outline, this.fill]) {
      m.rotation.x = -Math.PI / 2;
      this.group.add(m);
    }
    this.group.position.set(shape.x, 0.05, shape.z);
    if (shape.kind !== 'circle') {
      // Decal "up" (+Y in plane space) maps to -Z after the X rotation; yaw 0 faces +Z.
      this.group.rotation.y = shape.yaw + Math.PI;
    }
    this.fill.scale.setScalar(0.001);
    if (dash) this.addRim();
  }

  /** The dash-check rim along the area's outer edge(s). */
  private addRim(): void {
    this.rim = new THREE.MeshBasicMaterial({ color: DASH_RIM, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.addEdges(RIM, this.rim, 0.01);
  }

  private addEdges(w: number, mat: THREE.Material, y: number): void {
    for (const g of edgeGeometries(this.shape, w)) {
      const m = new THREE.Mesh(g, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      this.group.add(m);
    }
  }

  /**
   * Drawn for a bright floor (the Temple Court): a stronger outline and fill and a solid edge a shade darker than its
   * colour, floated `lift` m higher (over raised platforms and a flood's water).
   */
  bolden(lift: number): void {
    this.group.position.y += lift;
    this.outlineMat.opacity = 0.4;
    this.fillMat.opacity = 0.6;
    const edge = this.outlineMat.color.clone().multiplyScalar(EDGE_SHADE);
    this.addEdges(EDGE, new THREE.MeshBasicMaterial({ color: edge, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }), 0.005);
  }

  /** Call it off: removed without firing (e.g. the caster was interrupted). */
  cancel(): void {
    this.done = true;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt * this.rate();
    const k = Math.min(1, this.t / this.duration);
    if (this.rim) this.rim.opacity = 0.55 + 0.45 * Math.sin(this.t * 16);
    if (this.shape.kind === 'line') this.fill.scale.set(1, k, 1);
    else this.fill.scale.setScalar(Math.max(0.001, k));
    if (this.t >= this.duration) {
      this.done = true;
      this.onFire();
    }
  }
}

/** Strips `w` wide along a shape's outer edge(s), in the decal's plane (a line's long sides, an arc's both rims). */
function edgeGeometries(s: TelegraphShape, w: number): THREE.BufferGeometry[] {
  switch (s.kind) {
    case 'circle':
      return [new THREE.RingGeometry(Math.max(0.01, s.radius - w), s.radius, 64)];
    case 'cone': {
      const half = THREE.MathUtils.degToRad(s.arcDeg) / 2;
      return [new THREE.RingGeometry(Math.max(0.01, s.range - w), s.range, 32, 1, Math.PI / 2 - half, half * 2)];
    }
    case 'line':
      return [-1, 1].map((sgn) => new THREE.PlaneGeometry(w, s.length).translate(sgn * (s.width / 2 - w / 2), s.length / 2, 0));
    case 'arc': {
      const half = THREE.MathUtils.degToRad(s.arcDeg) / 2;
      return [
        new THREE.RingGeometry(s.inner, s.inner + w, 48, 1, Math.PI / 2 - half, half * 2),
        new THREE.RingGeometry(s.outer - w, s.outer, 48, 1, Math.PI / 2 - half, half * 2),
      ];
    }
  }
}

/** Something that can be called off (a Telegraph, or the handle a context hands back for one). */
export interface Cancellable {
  cancel(): void;
  /** Finished (fired or called off); a Telegraph has it. */
  readonly done?: boolean;
}

/** The telegraphs one caster has running, so it can call them all off (interrupted, killed, changing form). */
export class TelegraphGroup {
  private list: Cancellable[] = [];

  add<T extends Cancellable>(h: T): T {
    // Drop the ones that already finished, so a long-lived caster's list stays short.
    this.list = this.list.filter((t) => !t.done);
    this.list.push(h);
    return h;
  }

  /** Call every tracked telegraph off. */
  cancelAll(): void {
    for (const h of this.list) h.cancel();
    this.list = [];
  }

  /** Stop tracking them without calling them off: any still running play out. */
  forget(): void {
    this.list = [];
  }
}

/** Geometry tests used to resolve telegraphed attacks. */
export function inShape(shape: TelegraphShape, px: number, pz: number, pr: number): boolean {
  const dx = px - shape.x;
  const dz = pz - shape.z;
  switch (shape.kind) {
    case 'circle':
      return Math.hypot(dx, dz) <= shape.radius + pr;
    case 'cone': {
      const d = Math.hypot(dx, dz);
      if (d > shape.range + pr) return false;
      let a = Math.atan2(dx, dz) - shape.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      // Right at the apex the sector is narrower than a body: count anything in front.
      if (d < 1.5) return Math.abs(a) <= Math.PI / 2;
      return Math.abs(a) <= THREE.MathUtils.degToRad(shape.arcDeg) / 2;
    }
    case 'arc': {
      const d = Math.hypot(dx, dz);
      if (d < shape.inner - pr || d > shape.outer + pr) return false;
      let a = Math.atan2(dx, dz) - shape.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(a) <= THREE.MathUtils.degToRad(shape.arcDeg) / 2 + pr / Math.max(1, d);
    }
    case 'line': {
      const fx = Math.sin(shape.yaw);
      const fz = Math.cos(shape.yaw);
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      return along >= -pr && along <= shape.length + pr && side <= shape.width / 2 + pr;
    }
  }
}
