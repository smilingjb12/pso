import type * as THREE from 'three';
import type { EnemyId } from '../config';
import type { RiftBossId } from '../data/bosses';
import type { CcKind } from '../ccResist';
import type { Hittable, StatusTimer } from '../combat/types';
import type { Level } from '../world/Level';
import type { TelegraphShape } from '../world/Telegraph';
import type { Effect } from '../world/Effects';
import type { Body } from '../world/Machinery';
import type { Enemy, PlayerStatusKind, TelegraphHandle } from './Enemy';

export interface BossContext {
  playerX: number;
  playerZ: number;
  playerAlive: boolean;
  rng(): number;
  /** Show a telegraph; onFire runs when it completes. `dash`: a dash check (too big to walk out of in time). */
  telegraph(shape: TelegraphShape, duration: number, onFire: () => void, color?: number, dash?: boolean): TelegraphHandle;
  /** Damage the player if inside the shape. atpMult scales the boss ATP. Returns true if it hit. */
  hitPlayer(shape: TelegraphShape, atpMult: number, fromX: number, fromZ: number, knockback: number, status?: PlayerStatusKind, chance?: number): boolean;
  /** Flat (non-ATP) damage tick, e.g. fire breath. */
  tickPlayer(shape: TelegraphShape, damage: number, fromX: number, fromZ: number): void;
  /** Leave a poison puddle on the ground. */
  puddle(x: number, z: number, radius: number, life: number): void;
  /** Facility hazard damage (flat, less Area damage taken). */
  hazardHit(damage: number, fromX: number, fromZ: number, knockback: number, source: string): void;
  /** Add Burn stacks. */
  burnPlayer(stacks: number): void;
  /** Paralyse with this chance (ward and immunity apply). */
  paralyse(chance: number): void;
  /** Add Corruption stacks (Dark Falz). */
  corruptPlayer(stacks: number): void;
  /**
   * A failed Hell mechanic: `share` of the player's max HP (without Corruption's cut), ignoring armour and damage
   * taken (see `hell.mechanicHit`). No shape: the caller has decided it lands. True if it did (not dead or invulnerable).
   */
  mechanicHit(share: number, fromX: number, fromZ: number, knockback: number, source: string): boolean;
  /**
   * Drowning (Barba Ray's water, or out of air in its Deep): `share` of the player's max HP straight off (past armour and damage taken, like a
   * failed mechanic), with no knockback, no hit stun and no Corruption: the water does it a little at a time.
   */
  drown(share: number, source: string): void;
  /** Is this spot lit (a pylon's light, or light the boss left, like Dark Falz's Grants)? */
  lightAt(x: number, z: number, r?: number): boolean;
  /** The player's body (for arena machinery, and pulling her around). */
  body(): Body;
  /** Summon a field enemy into the fight (no rewards when it dies). */
  spawnAdd(type: EnemyId, x: number, z: number): Enemy;
  effect(e: Effect): void;
  shake(mag: number): void;
  /** A banner across the screen. */
  announce(text: string): void;
  /** The fight steps up (a new phase, or enraged): the boss track's battle layer comes in. */
  escalate(): void;
  isSolid(x: number, z: number): boolean;
}

/** An area boss: one or more hittable parts plus its own state machine. */
export interface Boss {
  readonly id: RiftBossId;
  readonly name: string;
  readonly atp: number;
  /** Whole-boss HP (damage dealt to it charges injectors). */
  readonly hp: number;
  readonly maxHp: number;
  /** Injector doses its whole HP bar is worth. */
  readonly injectorCharge: number;
  readonly alive: boolean;
  /** Seconds since death. */
  readonly deadT: number;
  /** The fight has started (shows the boss bar). */
  readonly engaged: boolean;
  readonly weakPointOpen: boolean;
  /** Scene objects to add to the world. */
  readonly objects: THREE.Object3D[];
  /** Parts the player can hit right now. */
  parts(): Hittable[];
  /** Is this hittable part of the boss? */
  owns(h: Hittable): boolean;
  /** % chance it shrugs off this kind of crowd control: every boss is immune (100). */
  ccResist(kind: CcKind): number;
  /** Burn and poison running on it (the boss bar). */
  statusTimers(): StatusTimer[];
  update(dt: number, ctx: BossContext): void;
  /** Speed of its state machine and telegraphs (above 1 in higher rift tiers). */
  readonly tempo: number;
  /** Keep the player out of the body and the body inside the arena. */
  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void;
  /** Damage-over-time tick on one of its parts. */
  onDot: ((target: Hittable, damage: number) => void) | null;
  /** Extra text after the name on the boss bar (the Warden's lockdown count). */
  readonly hudNote?: string;
  /** Its state and the last attack it picked, for the fight log ("triple/eclipse"). */
  readonly traceState: string;
  /** Your air (0..1) while the fight has you under the sea (Barba Ray's Deep): the HUD's AIR gauge. Null or missing: none. */
  readonly air?: number | null;
  /** How far under the sea the fight has gone (0..1, Barba Ray's Deep): the world's fog and light go deep blue. */
  readonly depth?: number;
  /** Marks it has put on the player (Barba Ray's ink): shown over her head, `left` of `total` real seconds. */
  readonly marks?: { key: string; left: number; total: number }[];
  /** Light it leaves on the floor (Dark Falz's Grants): cleanses Corruption like a pylon. */
  lightAt?(x: number, z: number, r: number): boolean;
  /** Standing in pylon light right now (set by the world): a Dark boss takes more damage there. */
  setLit?(lit: boolean): void;
}
