import * as THREE from 'three';
import { type DropVerdict, type ItemInstance } from '../character';
import { getDef } from '../data/items';
import { glowDecal, glowSprite, markerTexture } from './glow';

// Items and meseta lying on the ground.

export type PickupContent = { kind: 'item'; item: ItemInstance } | { kind: 'meseta'; amount: number };

const COLORS = {
  weapon: 0xff8a30,
  armor: 0x4aa8ff,
  consumable: 0x50e070,
  injector: 0x40d8c0,
  grinder: 0xdfe6f2, // silver, like the grinder icon
  rare: 0xb050ff,
  meseta: 0xffd040,
  upgrade: 0x30f060,
};
/** Junk gems fade toward this grey. */
const JUNK_GREY = new THREE.Color(0x5a5e66);

/** Tall see-through pillar so a drop is visible across the room (rares, and grinders in their own colour). */
function beam(color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.position.y = 3;
  return m;
}

export class Pickup {
  readonly group = new THREE.Group();
  readonly pos = this.group.position;
  t = Math.random() * 10;
  taken = false;
  /** What the drop means for the player (set by the game; null for meseta and until first set). */
  verdict: DropVerdict | null = null;
  private rare = false;
  private color: THREE.Color;
  private gem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private halo: THREE.Sprite;
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private haloSize: number;
  private junk = false;
  /** Green ▲ over upgrades, built on first use. */
  private marker: THREE.Group | null = null;

  constructor(readonly content: PickupContent, x: number, z: number) {
    this.pos.set(x, 0, z);
    let color = COLORS.meseta;
    let grinder = false;
    if (content.kind === 'item') {
      const def = getDef(content.item.id);
      this.rare = !!def.rare;
      grinder = def.type === 'grinder';
      color = this.rare ? COLORS.rare : COLORS[def.type];
    }
    const rare = this.rare;
    this.color = new THREE.Color(color);
    const geo =
      content.kind === 'meseta'
        ? new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16).rotateX(Math.PI / 2)
        : rare
          ? new THREE.BoxGeometry(0.55, 0.55, 0.55)
          : new THREE.OctahedronGeometry(0.3);
    this.gem = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }),
    );
    this.gem.position.y = 0.6;
    this.group.add(this.gem);

    // Soft halo around the gem plus a glow pool on the floor, so drops read from a distance.
    this.haloSize = content.kind === 'meseta' ? 1.1 : rare ? 2.4 : grinder ? 2 : 1.6;
    this.halo = glowSprite(color, this.haloSize, 0.7);
    this.halo.position.y = 0.6;
    this.pool = glowDecal(color, rare ? 2.6 : 1.8, 0.5);
    this.group.add(this.halo, this.pool);

    // Grinders are scarce and always useful, so they get a pillar too, in their own colour (purple stays rare).
    if (rare || grinder) this.group.add(beam(color));
  }

  /**
   * Junk (the class can't use it, or nothing beats what is equipped) fades to a dull grey gem with no
   * pulse; an upgrade gets a green ▲ above it. Rares never fade.
   */
  setVerdict(v: DropVerdict): void {
    this.verdict = v;
    const junk = v.look === 'junk' && !this.rare;
    if (junk !== this.junk) {
      this.junk = junk;
      const c = this.color.clone();
      if (junk) c.lerp(JUNK_GREY, 0.75);
      this.gem.material.color.copy(c);
      this.gem.material.emissive.copy(c);
      this.gem.material.emissiveIntensity = junk ? 0.3 : 0.9;
      this.halo.material.color.copy(c);
      this.pool.material.color.copy(c);
    }
    const up = v.look === 'upgrade';
    if (up && !this.marker) {
      this.marker = new THREE.Group();
      const arrow = new THREE.Sprite(
        // Untoned so the green stays saturated instead of washing toward white.
        new THREE.SpriteMaterial({ map: markerTexture(), color: COLORS.upgrade, transparent: true, depthWrite: false, toneMapped: false }),
      );
      arrow.scale.setScalar(0.6);
      this.marker.add(glowSprite(COLORS.upgrade, 0.9, 0.25), arrow);
      this.group.add(this.marker);
    }
    if (this.marker) this.marker.visible = up;
  }

  get label(): string {
    if (this.content.kind === 'meseta') return `${this.content.amount} Meseta`;
    const def = getDef(this.content.item.id);
    let s = def.name;
    if (this.content.item.grind) s += ` +${this.content.item.grind}`;
    if ((this.content.item.qty ?? 1) > 1) s += ` x${this.content.item.qty}`;
    return s;
  }

  update(dt: number): void {
    this.t += dt;
    const bob = Math.sin(this.t * 3) * 0.1;
    this.gem.rotation.y += dt * (this.junk ? 0.6 : 2);
    this.gem.position.y = 0.6 + bob * (this.junk ? 0.4 : 1);
    this.halo.position.y = this.gem.position.y;
    if (this.marker?.visible) this.marker.position.y = (this.rare ? 1.6 : 1.45) + bob;
    if (this.junk) {
      // Steady and faint: no pulse to catch the eye.
      this.halo.material.opacity = 0.18;
      this.halo.scale.setScalar(this.haloSize * 0.7);
      this.pool.material.opacity = 0.12;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    this.halo.material.opacity = 0.5 + 0.3 * pulse;
    this.halo.scale.setScalar(this.haloSize * (0.9 + 0.15 * pulse));
    this.pool.material.opacity = 0.35 + 0.25 * pulse;
  }
}
