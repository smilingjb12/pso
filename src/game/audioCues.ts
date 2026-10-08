import { sfx, type SfxId } from '../audio';
import type { Enemy, EnemyState } from './enemies/Enemy';
import type { LavaVent } from './world/Hazard';
import type { World } from './world/World';

// Sounds for field enemies and hazards, driven by their state changes so the
// enemy classes themselves stay audio-free. (Bosses and one-off events call
// sfx() directly at the moment they happen.)

interface Seen {
  state: EnemyState;
}

const RUINS_AI = new Set<string>(['dimenian', 'delsaber', 'sorcerer', 'belra', 'bringer']);

export class AudioCues {
  private enemies = new WeakMap<Enemy, Seen>();
  private vents = new WeakMap<LavaVent, { warn: boolean; erupt: boolean }>();

  update(world: World): void {
    for (const e of world.enemies) this.enemy(e);
    for (const v of world.vents) {
      const prev = this.vents.get(v);
      const now = { warn: v.warning, erupt: v.erupting };
      if (prev) {
        if (now.warn && !prev.warn) sfx('lava.warn', { x: v.x, z: v.z });
        if (now.erupt && !prev.erupt) sfx('lava.erupt', { x: v.x, z: v.z });
      }
      this.vents.set(v, now);
    }
  }

  private enemy(e: Enemy): void {
    // Machines raise their own cues (gunbot shots, Sinow slashes...).
    for (const id of e.cues) sfx(id as SfxId, { x: e.pos.x, z: e.pos.z });
    e.cues.length = 0;
    const seen = this.enemies.get(e);
    const cur = e.state;
    if (!seen) {
      this.enemies.set(e, { state: cur });
      if (cur === 'spawning') sfx('enemy.spawn', { x: e.pos.x, z: e.pos.z });
      return;
    }
    const prev = seen.state;
    if (prev === cur) return;
    seen.state = cur;

    const at = { x: e.pos.x, z: e.pos.z, arg: e.arch.scale };
    const ai = e.arch.ai;
    if (e.arch.race === 'machine') {
      if (cur === 'frozen') sfx('status.freeze', at);
      if (cur === 'dead' && !e.vanished) sfx(ai === 'node' ? 'node.die' : 'machine.die', at);
      return;
    }
    // Ruins enemies raise their own attack cues; they dissolve when they die.
    if (RUINS_AI.has(ai)) {
      if (cur === 'frozen') sfx('status.freeze', at);
      if (cur === 'dead' && !e.vanished) sfx('ruins.die', at);
      return;
    }
    switch (cur) {
      case 'windup':
        // Follow-up strikes wind up again straight from 'strike': no second growl.
        if (prev !== 'strike') sfx('booma.growl', at);
        break;
      case 'strike':
        if (ai !== 'lily' && ai !== 'migium') sfx('enemy.swipe', at);
        break;
      case 'aim':
      case 'burst':
        sfx('lily.charge', at);
        break;
      case 'cast':
        sfx('migium.charge', at);
        break;
      case 'recover':
        if (prev === 'burst') sfx('lily.burst', at);
        break;
      case 'frozen':
        sfx('status.freeze', at);
        break;
      case 'dead':
        if (!e.vanished) sfx(ai === 'lily' ? 'lily.die' : 'booma.die', at);
        break;
    }
  }
}
