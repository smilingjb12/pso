import type * as THREE from 'three';
import type { CcKind } from '../ccResist';
import type { Race } from '../config';

export type StatusEffect = 'burn' | 'freeze' | 'stun' | 'poison';

/** A status running on a target, for the HUD: seconds left out of the duration it last got (slow: chilled). */
export interface StatusTimer {
  kind: StatusEffect | 'slow';
  left: number;
  total: number;
}

/** Anything the player's attacks can hit: enemies and boss parts. */
export interface Hittable {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  readonly name: string;
  hp: number;
  readonly maxHp: number;
  /** % of weapon damage its armour takes off. */
  readonly armor: number;
  /** % of technique damage it shrugs off (none if missing; below 0 it takes more). */
  readonly techResist?: number;
  readonly race: Race | null;
  /** Height of the point damage numbers / reticle attach to. */
  readonly aimHeight: number;
  /** Not damageable right now (e.g. boss burrowed). */
  readonly invulnerable: boolean;
  /** Apply damage, adding `stagger` points toward a flinch. Returns true if this killed it. */
  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean;
  /** Skip the white hit flash of the damage just taken (a blizzard's pulses would strobe it). */
  quietHit?(): void;
  applyStatus(effect: StatusEffect, power: number, duration: number): void;
  /** Statuses currently running (target frame icons). */
  statusTimers?(): StatusTimer[];
  /**
   * Damage taken multiplier right now (weak point windows, shields, a guard). `fromX, fromZ` is where the hit
   * comes from (a Delsaber guards its front); `heavy`: a heavy attack or cast.
   */
  damageMult(fromX?: number, fromZ?: number, heavy?: boolean): number;
  /** Flinching or frozen right now (Executioner, Daunt, Shatter look at it). */
  readonly staggered?: boolean;
  /** End a freeze now (a Frozen Shooter shatter). */
  thaw?(): void;
  /** Slow its movement and attacks to `mult` speed for `seconds` (a Barta Field). */
  chill?(mult: number, seconds: number): void;
  /** Push it away from a point without damage (Breathing Room, Point Blank). */
  shove?(fromX: number, fromZ: number, force: number): void;
  /** % chance it shrugs off this kind of crowd control (none if missing; 100: immune). Combat.resisted rolls it. */
  ccResist?(kind: CcKind): number;
}
