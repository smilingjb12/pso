import * as THREE from 'three';
import type { CcKind } from '../ccResist';
import type { Hittable, StatusTimer } from '../combat/types';
import { mat, part } from '../models/Rig';
import { glowSprite } from '../world/glow';
import type { Cancellable } from '../world/Telegraph';

// De Rol Le's Hell bomb (see DeRolLe and DESIGN.md "Boss — De Rol Le"): a big spiked mine it lobs onto the raft.
// It sits armed with a fuse (a ring round its base filling up while the light on top blinks faster), the poison
// area it would leave outlined around it, its HP in a small bar over it. Anything the player has can hit it: it
// is a target of its own (camera picks, shots, techniques) and none of its HP comes off the boss. The boss runs
// its life (the lob, the fuse, the blast or the fizzle); this is its body, its HP and its look.

/** Hit and collision circle (m). */
export const BOMB_RADIUS = 0.95;
const SHELL = 0.85;
/** The fuse ring round its base (m), rebuilt in steps rather than every frame. */
const FUSE_IN = 1.15;
const FUSE_OUT = 1.55;
const FUSE_STEPS = 48;
const GREEN = 0x7dff4a;
const RED = new THREE.Color(0xff3020);
const BAR_W = 1.5;
const BAR_Y = SHELL * 2 + 0.75;
const FLASH_TIME = 0.08;

type BombState = 'idle' | 'flying' | 'armed' | 'gone';

export class PoisonBomb implements Hittable {
  readonly name = 'Poison Bomb';
  readonly pos = new THREE.Vector3();
  readonly radius = BOMB_RADIUS;
  readonly aimHeight = SHELL * 1.4;
  readonly group = new THREE.Group();
  state: BombState = 'idle';
  hp = 0;
  maxHp = 0;
  /** Fuse left and its full length (boss time). */
  fuse = 0;
  fuseTotal = 0;
  /** The blast's own telegraph, once it is up. */
  warning: Cancellable | null = null;
  /** Gone without a blast (destroyed, or the boss died) and not yet seen by the boss, which plays the fizzle. */
  fizzled = false;

  private body = new THREE.Group();
  private shellMat: THREE.MeshStandardMaterial;
  private light: THREE.MeshBasicMaterial;
  private halo: THREE.Sprite;
  private fuseFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private fuseStep = -1;
  private zone: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private bar: THREE.Sprite;
  private from = new THREE.Vector3();
  private flight = 0;
  private flightT = 0;
  private arc = 0;
  private blink = 0;
  private flashT = 0;

  constructor(
    readonly armor: number,
    readonly techResist: number,
    /** Radius of the blast and its poison (the outline drawn round it). */
    area: number,
  ) {
    // A naval mine: dark shell, a glowing band and horns, a light on top.
    this.shellMat = mat(0x2c3a2a, { rough: 0.45, emissive: 0x000000 });
    const horn = mat(0x8a9a80, { rough: 0.5 });
    const band = new THREE.MeshBasicMaterial({ color: GREEN });
    band.userData.glow = true;
    const b = this.body;
    part(b, new THREE.IcosahedronGeometry(SHELL, 1), this.shellMat);
    part(b, new THREE.TorusGeometry(SHELL * 1.01, 0.07, 6, 20), band, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      // Two rings of four horns, above and below the band.
      const a = ((i % 4) / 4) * Math.PI * 2 + (i < 4 ? 0 : Math.PI / 4);
      const tilt = i < 4 ? 0.55 : -0.5;
      const dir = new THREE.Vector3(Math.sin(a) * Math.cos(tilt), Math.sin(tilt), Math.cos(a) * Math.cos(tilt));
      const m = part(b, new THREE.CylinderGeometry(0.05, 0.09, 0.32, 5), horn, [dir.x * SHELL, dir.y * SHELL, dir.z * SHELL]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
    part(b, new THREE.CylinderGeometry(0.16, 0.22, 0.16, 8), horn, [0, SHELL + 0.02, 0]);
    this.light = new THREE.MeshBasicMaterial({ color: 0xff4030 });
    this.light.userData.glow = true;
    part(b, new THREE.SphereGeometry(0.13, 8, 6), this.light, [0, SHELL + 0.16, 0]);
    this.halo = glowSprite(0xff5030, 1.1, 0.9);
    this.halo.position.set(0, SHELL + 0.16, 0);
    b.add(this.halo, glowSprite(GREEN, 2.6, 0.35));
    b.position.y = SHELL;

    // On the deck: the fuse ring (a dim track and the part burnt so far) and the outline of the poison area.
    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number, y: number) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.position.y = y;
      m.renderOrder = 2;
      this.group.add(m);
      return m;
    };
    flat(new THREE.RingGeometry(FUSE_IN, FUSE_OUT, 40), 0x284a1e, 0.75, 0.06);
    this.fuseFill = flat(new THREE.RingGeometry(FUSE_IN, FUSE_OUT, 2, 1, 0, 0.001), GREEN, 0.9, 0.07);
    this.zone = flat(new THREE.RingGeometry(area - 0.14, area, 64), GREEN, 0.3, 0.06);

    // HP bar over it (camera-facing): a dark track and the fill, left-aligned through the sprites' centre.
    const sprite = (color: number, h: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthWrite: false, depthTest: false }));
      s.scale.set(BAR_W, h, 1);
      s.position.y = BAR_Y;
      s.renderOrder = 10;
      this.group.add(s);
      return s;
    };
    sprite(0x140c0c, 0.17);
    this.bar = sprite(0x9cff60, 0.11);
    this.group.add(this.body);
    this.group.visible = false;
  }

  // ------------------------------------------------------------ Hittable

  get alive(): boolean {
    return this.state === 'armed';
  }
  get invulnerable(): boolean {
    return this.state !== 'armed';
  }
  damage(amount: number): boolean {
    if (this.state !== 'armed') return false;
    this.flashT = FLASH_TIME;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return false;
    this.state = 'gone';
    this.fizzled = true;
    return true;
  }
  quietHit(): void {
    this.flashT = 0;
  }
  /** Burn, poison and the rest don't take on a bomb. */
  applyStatus(): void {}
  statusTimers(): StatusTimer[] {
    return [];
  }
  damageMult(): number {
    return 1;
  }
  /** Crowd control does nothing to it (it shows IMMUNE, like the boss). */
  ccResist(_kind: CcKind): number {
    return 100;
  }

  // ------------------------------------------------------------ the boss's side

  /** Thrown from `from` to land at (x, z) in `flight` s, with this HP and fuse. */
  launch(from: THREE.Vector3, x: number, z: number, flight: number, hp: number, fuse: number): void {
    this.state = 'flying';
    this.pos.set(x, 0, z);
    this.group.position.set(x, 0, z);
    this.from.copy(from).sub(this.pos);
    this.flight = flight;
    this.flightT = 0;
    this.arc = 2 + Math.hypot(this.from.x, this.from.z) * 0.25;
    this.hp = this.maxHp = hp;
    this.fuse = this.fuseTotal = fuse;
    this.warning = null;
    this.fizzled = false;
    this.fuseStep = -1;
    this.blink = 0;
    this.group.visible = true;
    this.setDeck(false);
    this.body.scale.setScalar(1);
  }

  /** Move along the arc; true the moment it lands (it is armed from then on). */
  fly(dt: number): boolean {
    this.flightT += dt;
    const k = Math.min(1, this.flightT / this.flight);
    this.body.position.copy(this.from).multiplyScalar(1 - k);
    this.body.position.y += SHELL * k + this.arc * 4 * k * (1 - k);
    this.body.rotation.set(this.flightT * 5, this.flightT * 3, 0);
    // The landing spot's outline fades in as it comes down.
    this.zone.material.opacity = 0.3 * k;
    if (k < 1) return false;
    this.state = 'armed';
    this.body.position.set(0, SHELL, 0);
    this.body.rotation.set(0, 0, 0);
    this.setDeck(true);
    return true;
  }

  /** Each tick while armed: the fuse ring, the light (blinking faster as the fuse runs out), the HP bar, a hit flash. */
  animate(dt: number): void {
    const left = Math.max(0, this.fuse / this.fuseTotal);
    const step = Math.round((1 - left) * FUSE_STEPS);
    if (step !== this.fuseStep) {
      this.fuseStep = step;
      this.fuseFill.geometry.dispose();
      this.fuseFill.geometry = new THREE.RingGeometry(FUSE_IN, FUSE_OUT, Math.max(2, step), 1, Math.PI / 2, Math.max(0.001, (step / FUSE_STEPS) * Math.PI * 2)).rotateX(-Math.PI / 2);
    }
    // Green to red as it burns down.
    const hot = 1 - left;
    this.fuseFill.material.color.setHex(GREEN).lerp(RED, hot * hot);
    this.blink += dt * (1.2 + 7 * hot * hot);
    const on = this.blink % 1 < 0.35;
    this.light.color.setHex(on ? 0xff6040 : 0x401010);
    this.halo.material.opacity = on ? 0.95 : 0.1;
    this.zone.material.opacity = this.warning ? 0 : 0.28 + 0.2 * hot + (on ? 0.12 * hot : 0);
    // Squash on landing, then sit.
    this.body.scale.y = 1 - 0.18 * Math.max(0, 1 - (this.fuseTotal - this.fuse) * 5);
    const f = Math.max(0.0001, this.hp / this.maxHp);
    this.bar.scale.x = BAR_W * f;
    this.bar.center.set(0.5 / f, 0.5);
    this.flashT = Math.max(0, this.flashT - dt);
    this.shellMat.emissive.setHex(this.flashT > 0 ? 0xffffff : 0x0c2008);
  }

  /** Off the deck and back in the pool (blown, fizzled, or the fight is over). */
  remove(): void {
    this.warning?.cancel();
    this.warning = null;
    this.state = 'idle';
    this.group.visible = false;
  }

  private setDeck(on: boolean): void {
    for (const o of this.group.children) if (o !== this.body && o !== this.zone) o.visible = on;
  }
}
