import * as THREE from 'three';
import { pylonCfg } from '../config';
import { glowDecal, glowMaterial, glowTexture } from './glow';
import { Interactable } from './Interactable';

// Ruins light pylons: a stone obelisk with a crystal on top. The interact key lights it: a circle of
// light (pylonCfg.radius) for a while, then it goes dark and recharges. Inside the light Corruption
// sheds and Dark enemies are slowed and take more damage (the world applies both). Chaos Sorcerers
// blink over and snuff a lit pylon out.

let nextId = 1;

export class Pylon {
  readonly id = nextId++;
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  /** The prompt the player uses (it draws nothing itself). */
  readonly interactable: Interactable;
  /** Seconds of light left, and how long this lighting lasts in all. */
  litT = 0;
  litFor = pylonCfg.litTime;
  /** Seconds until it can be lit again. */
  rechargeT = 0;
  /** A Sorcerer channelling a snuff on it (0..1 progress), shown as dark tendrils. */
  snuffK = 0;
  private time = Math.random() * 10;
  private crystalMat: THREE.MeshStandardMaterial;
  private runeMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private columnMat: THREE.MeshBasicMaterial;
  private baseGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private disc: THREE.Mesh;
  private edge: THREE.Mesh;
  private column: THREE.Mesh;
  private crystal: THREE.Mesh;
  private charge: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private motes: THREE.Points;
  private motePos: Float32Array;

  constructor(
    x: number,
    z: number,
    /** The room it stands in (Sorcerers only go for pylons in their own room). */
    readonly room: string,
    /** Light colour (the area's accent). */
    readonly color = 0xffe6a0,
    stone = 0x6a6080,
  ) {
    this.pos = this.group.position;
    this.pos.set(x, 0, z);
    this.interactable = new Interactable('pylon', 'Light pylon', x, z);

    const stoneMat = new THREE.MeshStandardMaterial({ color: stone, roughness: 0.8, flatShading: true });
    const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(stone).multiplyScalar(0.7), roughness: 0.7, flatShading: true });
    // Stepped plinth, a tapered four-sided shaft, a cradle for the crystal.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.3, 8), trimMat);
    plinth.position.y = 0.15;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.25, 8), stoneMat);
    step.position.y = 0.42;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, 2.4, 4), stoneMat);
    shaft.position.y = 1.75;
    shaft.rotation.y = Math.PI / 4;
    const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.24, 0.3, 4, 1, true), trimMat);
    cradle.position.y = 3.05;
    cradle.rotation.y = Math.PI / 4;
    for (const m of [plinth, step, shaft, cradle]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // Glyphs running up the shaft's faces.
    this.runeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let f = 0; f < 4; f++) {
      const yaw = (f * Math.PI) / 2;
      for (let i = 0; i < 3; i++) {
        const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.26 - i * 0.04), this.runeMat);
        const r = 0.385 - (i * 0.12 + 0.2) * 0.06;
        glyph.position.set(Math.sin(yaw) * r, 1.0 + i * 0.6, Math.cos(yaw) * r);
        glyph.rotation.y = yaw;
        this.group.add(glyph);
      }
    }
    this.crystalMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.2, flatShading: true });
    this.crystalMat.userData.glow = true;
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), this.crystalMat);
    this.crystal.scale.set(1, 1.6, 1);
    this.crystal.position.y = 3.6;
    this.group.add(plinth, step, shaft, cradle, this.crystal);

    // Soft glow at its foot (always), and the recharge ring around it.
    this.baseGlow = glowDecal(color, 3.2, 0.25);
    this.group.add(this.baseGlow);
    this.charge = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.42, 40, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.charge.position.y = 0.05;
    this.group.add(this.charge);

    // The circle of light: a soft disc and a bright edge so its reach reads clearly.
    this.discMat = glowMaterial(color, 0);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(pylonCfg.radius * 1.15, 48).rotateX(-Math.PI / 2), this.discMat);
    this.disc.position.y = 0.04;
    this.disc.renderOrder = 1;
    this.edgeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.edge = new THREE.Mesh(new THREE.RingGeometry(pylonCfg.radius - 0.12, pylonCfg.radius, 64).rotateX(-Math.PI / 2), this.edgeMat);
    this.edge.position.y = 0.05;
    this.edge.renderOrder = 1;
    // A column of light from the crystal up.
    this.columnMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 14, 12, 1, true), this.columnMat);
    this.column.position.y = 3.6 + 7;
    this.group.add(this.disc, this.edge, this.column);

    // Motes drifting up through the light.
    const n = 40;
    this.motePos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.respawnMote(i, Math.random() * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: glowTexture(), color, size: 0.18, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    this.refreshPrompt();
  }

  get lit(): boolean {
    return this.litT > 0;
  }

  get ready(): boolean {
    return this.litT <= 0 && this.rechargeT <= 0;
  }

  /** Light it for `seconds`. */
  light(seconds = pylonCfg.litTime): boolean {
    if (!this.ready) return false;
    this.litT = this.litFor = seconds;
    this.refreshPrompt();
    return true;
  }

  /** Put it out (a Sorcerer's snuff): it recharges from now. */
  snuff(): void {
    if (!this.lit) return;
    this.litT = 0;
    this.rechargeT = pylonCfg.recharge;
    this.snuffK = 0;
    this.refreshPrompt();
  }

  /** Is a point (with this radius) inside its light? */
  inside(x: number, z: number, r = 0): boolean {
    return this.lit && Math.hypot(x - this.pos.x, z - this.pos.z) <= pylonCfg.radius + r;
  }

  private refreshPrompt(): void {
    const it = this.interactable;
    it.enabled = this.ready;
    it.label = this.ready ? 'Light the pylon' : this.lit ? 'Pylon: lit' : `Pylon: recharging (${Math.ceil(this.rechargeT)} s)`;
  }

  private respawnMote(i: number, y = 0): void {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * pylonCfg.radius * 0.95;
    this.motePos.set([Math.sin(a) * d, y, Math.cos(a) * d], i * 3);
  }

  update(dt: number): void {
    this.time += dt;
    const wasLit = this.lit;
    if (this.litT > 0) {
      this.litT = Math.max(0, this.litT - dt);
      if (this.litT === 0) this.rechargeT = pylonCfg.recharge;
    } else if (this.rechargeT > 0) {
      this.rechargeT = Math.max(0, this.rechargeT - dt);
    }
    if (wasLit !== this.lit || this.rechargeT > 0) this.refreshPrompt();

    // Light fades in fast and, in its last two seconds, flickers out.
    const ending = this.litT > 0 && this.litT < 2 ? 0.6 + 0.4 * Math.abs(Math.sin(this.time * 9)) : 1;
    const lit = this.lit ? Math.min(1, (this.litFor - this.litT) * 4) * ending * (1 - this.snuffK * 0.6) : 0;
    const pulse = 0.85 + Math.sin(this.time * 2.2) * 0.15;
    this.discMat.opacity = lit * 0.32 * pulse;
    this.edgeMat.opacity = lit * 0.7;
    this.columnMat.opacity = lit * 0.22 * pulse;
    this.column.scale.set(1 + Math.sin(this.time * 3) * 0.05, 1, 1 + Math.sin(this.time * 3) * 0.05);
    (this.motes.material as THREE.PointsMaterial).opacity = lit * 0.9;
    // Ready: the crystal glows and bobs; recharging: dim, the ring fills; lit: blazing.
    const k = this.lit ? 1 : this.rechargeT > 0 ? 0.08 + 0.3 * (1 - this.rechargeT / pylonCfg.recharge) : 0.55 + Math.sin(this.time * 2.5) * 0.15;
    this.crystalMat.emissiveIntensity = this.lit ? 2.6 * pulse : 0.3 + k * 1.2;
    this.crystal.rotation.y += dt * (this.lit ? 1.6 : 0.4);
    this.crystal.position.y = 3.6 + Math.sin(this.time * 1.6) * 0.08;
    this.runeMat.opacity = this.lit ? 0.9 : 0.2 + k * 0.45;
    this.baseGlow.material.opacity = this.lit ? 0.5 : 0.12 + k * 0.2;
    const charging = this.rechargeT > 0;
    this.charge.material.opacity = charging ? 0.55 : 0;
    if (charging) this.charge.scale.setScalar(0.4 + 0.6 * (1 - this.rechargeT / pylonCfg.recharge));
    if (lit > 0) {
      for (let i = 0; i < this.motePos.length / 3; i++) {
        const y = this.motePos[i * 3 + 1] + dt * (0.6 + (i % 5) * 0.15);
        if (y > 4) this.respawnMote(i);
        else this.motePos[i * 3 + 1] = y;
      }
      this.motes.geometry.attributes.position.needsUpdate = true;
    }
  }
}
