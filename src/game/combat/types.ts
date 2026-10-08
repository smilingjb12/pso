import type * as THREE from 'three';
import type { Race } from '../config';

export type StatusEffect = 'burn' | 'freeze' | 'stun' | 'poison';

/** A status running on a target, for the HUD: seconds left out of the duration it last got. */
export interface StatusTimer {
  kind: StatusEffect;
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
  readonly evp: number;
  readonly dfp: number;
  readonly race: Race | null;
  /** Height of the point damage numbers / reticle attach to. */
  readonly aimHeight: number;
  /** Not damageable right now (e.g. boss burrowed). */
  readonly invulnerable: boolean;
  /** Apply damage, adding `stagger` points toward a flinch. Returns true if this killed it. */
  damage(amount: number, fromX: number, fromZ: number, knockback: number, stagger: number): boolean;
  applyStatus(effect: StatusEffect, power: number, duration: number): void;
  /** Statuses currently running (target frame icons). */
  statusTimers?(): StatusTimer[];
  /**
   * Damage taken multiplier right now (weak point windows, shields, a guard). `fromX, fromZ` is where the hit
   * comes from (a lone Shielding elite and a Delsaber guard their front); `heavy`: a heavy attack or cast.
   */
  damageMult(fromX?: number, fromZ?: number, heavy?: boolean): number;
}
