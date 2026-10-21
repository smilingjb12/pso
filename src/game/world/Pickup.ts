import * as THREE from 'three';
import { itemName, rarityOf, type DropVerdict, type ItemInstance } from '../character';
import { getDef, type CraftId } from '../data/items';
import { glowDecal, glowSprite, markerTexture } from './glow';

// Items and meseta lying on the ground.

export type PickupContent = { kind: 'item'; item: ItemInstance } | { kind: 'meseta'; amount: number };

const COLORS = {
  weapon: 0xff8a30,
  armor: 0x4aa8ff,
  consumable: 0x50e070,
  injector: 0x40d8c0,
  photon: 0x8ff6ff, // photon cyan (crafting; each photon wears its own, PHOTON_COLOR)
  unit: 0x9ad0ff,
  /** Uniques (purple cube and pillar). */
  rare: 0xb050ff,
  meseta: 0xffd040,
  upgrade: 0x30f060,
};
/** Magic (blue) and rare (yellow) gear: the halo and floor glow take the rarity's colour; rares get a pillar too. */
const RARITY_TINT = { magic: 0x6a9cff, rare: 0xffd84a };
/** Junk gems fade toward this grey. */
const JUNK_GREY = new THREE.Color(0x5a5e66);

/** Each photon's colour on the ground (gem, halo, pillar), as in its menu icon. */
const PHOTON_COLOR: Record<CraftId, number> = { drop: 0x5ae8ff, sphere: 0x7a9cff, crystal: 0xffe27a };

const glowMat = (color: number, intensity = 0.9, flat = false) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, flatShading: flat });

/**
 * A photon's shape on the ground, after its menu icon (2026-10-11, the user's ask: tell them apart at a glance).
 * The returned mesh is the gem (recoloured with the drop); its children are the extra parts and spin with it.
 * Drop: a teardrop. Sphere: an orb with a tilted orbiting ring. Crystal: a tall six-sided crystal with two floating
 * chips (not the Rift Shard's violet octahedron).
 */
function photonGem(craft: CraftId): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const color = PHOTON_COLOR[craft];
  switch (craft) {
    case 'drop': {
      // Teardrop: x = sin t * sin(t / 2), point up.
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = Math.PI * (1 - i / 16);
        pts.push(new THREE.Vector2(0.26 * Math.sin(t) * Math.sin(t / 2), -0.34 * Math.cos(t)));
      }
      return new THREE.Mesh(new THREE.LatheGeometry(pts, 20), glowMat(color));
    }
    case 'sphere': {
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), glowMat(color));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 40), glowMat(0xdfe8ff, 1));
      ring.rotation.set(1.25, 0, 0.35);
      gem.add(ring);
      return gem;
    }
    case 'crystal': {
      const body = [new THREE.Vector2(0, -0.4), new THREE.Vector2(0.17, -0.06), new THREE.Vector2(0.17, 0.08), new THREE.Vector2(0, 0.42)];
      const gem = new THREE.Mesh(new THREE.LatheGeometry(body, 6), glowMat(color, 0.9, true));
      for (const [x, y, s] of [[0.3, 0.12, 1], [-0.28, -0.1, 0.8]]) {
        const chip = new THREE.Mesh(new THREE.OctahedronGeometry(0.06 * s), glowMat(0xfff4c0, 1, true));
        chip.position.set(x, y, 0);
        gem.add(chip);
      }
      return gem;
    }
  }
}

/** Tall see-through pillar so a drop is visible across the room (rares, and photons and units in their own colour). */
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
  /** Seconds on the ground. */
  age = 0;
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
  /** The see-through pillar (rares, uniques, photons, units). */
  private pillar: THREE.Mesh | null = null;
  /** Units: the pillar only stands while the unit is worth learning (a new kind or a better roll). */
  private unit = false;

  constructor(readonly content: PickupContent, x: number, z: number) {
    this.pos.set(x, 0, z);
    let color = COLORS.meseta;
    let grinder = false;
    let tint: number | null = null;
    let photon: CraftId | null = null;
    if (content.kind === 'item') {
      const def = getDef(content.item.id);
      if (def.type === 'photon') photon = def.craft;
      const rarity = rarityOf(content.item);
      this.rare = rarity === 'unique';
      // Grinders, photons and units are scarce and worth a look: a pillar in their own colour (a unit's only while
      // it's worth learning, see setVerdict).
      this.unit = def.type === 'unit';
      grinder = def.type === 'photon' || this.unit;
      color = this.rare ? COLORS.rare : photon ? PHOTON_COLOR[photon] : COLORS[def.type];
      if (rarity === 'magic' || rarity === 'rare') tint = RARITY_TINT[rarity];
      if (rarity === 'rare') grinder = true; // a pillar, in the rarity's colour
    }
    const rare = this.rare;
    this.color = new THREE.Color(color);
    const geo =
      content.kind === 'meseta'
        ? new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16).rotateX(Math.PI / 2)
        : rare
          ? new THREE.BoxGeometry(0.55, 0.55, 0.55)
          : new THREE.OctahedronGeometry(0.3);
    this.gem = photon ? photonGem(photon) : new THREE.Mesh(geo, glowMat(color));
    this.gem.position.y = 0.6;
    this.group.add(this.gem);

    // Soft halo around the gem plus a glow pool on the floor, so drops read from a distance.
    this.haloSize = content.kind === 'meseta' ? 1.1 : rare ? 2.4 : grinder ? 2 : 1.6;
    this.halo = glowSprite(tint ?? color, this.haloSize, 0.7);
    this.halo.position.y = 0.6;
    this.pool = glowDecal(tint ?? color, rare ? 2.6 : 1.8, 0.5);
    this.group.add(this.halo, this.pool);

    // Grinders are scarce and always useful, so they get a pillar too, in their own colour (purple stays rare).
    if (rare || grinder) {
      this.pillar = beam(tint ?? color);
      this.group.add(this.pillar);
    }
  }

  /**
   * Junk (nothing beats what is equipped, even fully crafted) fades to a dull grey gem with no
   * pulse; an upgrade gets a green ▲ above it. Rares never fade.
   */
  setVerdict(v: DropVerdict): void {
    this.verdict = v;
    const junk = v.look === 'junk' && !this.rare;
    if (junk !== this.junk) this.paint(junk, 0.75);
    if (this.unit && this.pillar) this.pillar.visible = !junk;
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

  /** Colour the gem, halo and pool; `dim` greys it out with no pulse. */
  private paint(dim: boolean, grey: number): void {
    this.junk = dim;
    const c = this.color.clone();
    if (dim) c.lerp(JUNK_GREY, grey);
    this.gem.material.color.copy(c);
    this.gem.material.emissive.copy(c);
    this.gem.material.emissiveIntensity = dim ? 0.3 : 0.9;
    this.halo.material.color.copy(c);
    this.pool.material.color.copy(c);
  }

  get label(): string {
    if (this.content.kind === 'meseta') return `${this.content.amount} Meseta`;
    return itemName(this.content.item);
  }

  update(dt: number): void {
    this.t += dt;
    this.age += dt;
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
