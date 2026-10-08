import type * as THREE from 'three';
import type { EnemyId, Race } from '../config';
import type { BossId } from '../data/bosses';
import type { Hittable } from '../combat/types';
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
  /** Facility hazard damage (flat, softened by DFP). */
  hazardHit(damage: number, fromX: number, fromZ: number, knockback: number, source: string): void;
  /** Add Burn stacks. */
  burnPlayer(stacks: number): void;
  /** Paralyse with this chance (ward and immunity apply). */
  paralyse(chance: number): void;
  /** Add Corruption stacks (Dark Falz). */
  corruptPlayer(stacks: number): void;
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
  readonly id: BossId;
  readonly name: string;
  readonly race: Race;
  readonly atp: number;
  readonly ata: number;
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
  update(dt: number, ctx: BossContext): void;
  /** Keep the player out of the body and the body inside the arena. */
  collide(playerPos: THREE.Vector3, playerRadius: number, level: Level): void;
  /** Damage-over-time tick on one of its parts. */
  onDot: ((target: Hittable, damage: number) => void) | null;
  /** Extra text after the name on the boss bar (the Warden's lockdown count). */
  readonly hudNote?: string;
  /** Light it leaves on the floor (Dark Falz's Grants): cleanses Corruption like a pylon. */
  lightAt?(x: number, z: number, r: number): boolean;
  /** Standing in pylon light right now (set by the world): a Dark boss takes more damage there. */
  setLit?(lit: boolean): void;
}
