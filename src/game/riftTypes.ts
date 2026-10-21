import type { ExpeditionId } from './data/areas';

// Falz Rifts (DESIGN.md "Endgame: Falz Rifts"): the shared shapes. The generator (riftGen.ts) turns a
// RiftGenOptions into rooms and links; rifts.ts turns a rift into an area, scaling and loot.

/** A rift echoes one of the four regions: its rooms, hazards, enemies and look. */
export type RiftBiome = ExpeditionId;
export const RIFT_BIOMES: RiftBiome[] = ['forest', 'caves', 'mines', 'ruins'];

/** What the room generator needs. Everything random comes from `seed`. */
export interface RiftGenOptions {
  biome: RiftBiome;
  seed: number;
  /** End in a teleporter room to the biome's boss (`toBoss` to 'riftBoss') instead of finishing at the Guardian room. */
  boss: boolean;
  /** Hazard density multiplier (1 = like the region's own floors; the Hazards modifier makes it 2). */
  hazardMult?: number;
  /** Bleed modifier: a second region's hazards in some rooms as well. */
  hazardBiome?: RiftBiome;
  /** Waves mix in this region's enemies (Map Lab only since 2026-10-11). */
  mixBiome?: RiftBiome;
  /**
   * Every wave draws from a random region's roster (Lilies and control nodes with the Caves and Mines waves).
   * Falz Rifts use it since 2026-10-11: the Forest's look, every expedition's enemies.
   */
  mixAll?: boolean;
  /** Swarming modifier: more enemies a wave, the extra ones fodder (RIFT_GEN.swarm). */
  swarm?: boolean;
  /**
   * What to build (Rift Map nodes, 2026-10-21): a whole floor (the default: 5-7 fight rooms, side rooms, the Guardian
   * room; Map Lab), a room node (three fight rooms, maybe a bonus room, the Guardian room), a Vault (one big room,
   * three champion packs) or a Gauntlet (one big room to hold for RIFT_GEN.hold.time seconds).
   */
  kind?: 'floor' | 'room' | 'vault' | 'gauntlet';
}
