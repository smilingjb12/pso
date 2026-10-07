import { enemies as enemyDefs, type EnemyId } from '../config';
import { BoomaModel } from '../models/booma';
import { Hidoom, Lily, Migium, PanArms } from './caveEnemies';
import { Brawler, type Enemy, type EnemyOptions } from './Enemy';
import { ControlNode, Garanz, Gunbot, RepairDrone, Sinow, SparkMite } from './mineEnemies';

/** Build the right body + AI for an enemy type. */
export function createEnemy(type: EnemyId, x: number, z: number, rng: () => number, opts: EnemyOptions = {}): Enemy {
  const arch = opts.arch ?? enemyDefs[type];
  switch (arch.ai) {
    case 'lily':
      return new Lily(type, arch, x, z, rng, opts);
    case 'migium':
      return new Migium(type, arch, x, z, rng, opts);
    case 'panarms':
      return new PanArms(type, arch, x, z, rng, opts);
    case 'hidoom':
      return new Hidoom(type, arch, x, z, rng, opts);
    case 'gunbot':
      return new Gunbot(type, arch, x, z, rng, opts);
    case 'garanz':
      return new Garanz(type, arch, x, z, rng, opts);
    case 'sinow':
      return new Sinow(type, arch, x, z, rng, opts);
    case 'node':
      return new ControlNode(type, arch, x, z, rng, opts);
    case 'mite':
      return new SparkMite(type, arch, x, z, rng, opts);
    case 'drone':
      return new RepairDrone(type, arch, x, z, rng, opts);
    case 'brawler':
      return new Brawler(type, arch, x, z, rng, new BoomaModel(arch.color).rig, opts);
  }
}
