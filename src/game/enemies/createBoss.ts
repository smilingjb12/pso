import type { HardBossScale } from '../config';
import type { BossId } from '../data/bosses';
import type { Level } from '../world/Level';
import type { Boss } from './Boss';
import { DarkFalz } from './DarkFalz';
import { DeRolLe } from './DeRolLe';
import { Dragon } from './Dragon';
import { Warden } from './Warden';

/** Each boss's constructor, placed in its arena (the boss area's first room). `hard`: Nightmare scaling. */
const FACTORIES: Record<BossId, (level: Level, hard: HardBossScale | null) => Boss> = {
  dragon: (level, hard) => {
    const c = level.center();
    return new Dragon(c.x, c.z - 6, hard);
  },
  derolle: (level, hard) => new DeRolLe(level.rooms[0].rect, hard),
  warden: (level, hard) => new Warden(level.rooms[0].rect, hard),
  falz: (level, hard) => new DarkFalz(level.rooms[0].rect, hard),
};

export function createBoss(id: BossId, level: Level, hard: HardBossScale | null): Boss {
  return FACTORIES[id](level, hard);
}
