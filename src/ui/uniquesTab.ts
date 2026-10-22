import { forgeMult, type Character } from '../game/character';
import { drops } from '../game/config';
import { BOSS_IDS, BOSSES, isMainBoss, RIFT_BOSS_IDS, type RiftBossId } from '../game/data/bosses';
import { getDef, weaponKinds } from '../game/data/items';
import { STAT_LABEL, statValue } from '../game/data/stats';
import { isUniqueUnit, UNIQUE_IDS, UNIQUES, uniqueDropId, uniqueItemId, type UniqueId } from '../game/data/uniques';
import { DIFFICULTY_NAME, type Difficulty } from '../game/difficulty';
import { itemRequirement } from '../game/itemTypes';
import { bossUniqueTier, uniqueShare } from '../game/loot';
import { bossUniques, bossUniqueShare, CIRCLE_TIERS, CIRCLES, circleName, circleOf, firstKillOwed, hasFound, riftUniqueOdds } from '../game/riftCircles';
import { BOSS_TIER } from '../game/riftMap';
import { riftIlvl, riftSave, riftsOpen } from '../game/rifts';
import { itemGlyph } from './icons';

// The Uniques tab (Menu → Uniques; 2026-10-21, the user's ask, in place of the Rift Gate's Rift Circles tab): every
// unique as a card with its effect, cost and finer rules, its base stats, where it drops and the odds, and whether you
// have it. The odds come from the same weights the drops roll with (loot.ts uniqueShare, riftCircles.ts).

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What the tab shows: every unique, the main game's, or one rift boss's. */
export type UniqueFilter = 'all' | 'main' | RiftBossId;

const DIFFS: Difficulty[] = ['normal', 'nightmare', 'hell'];
const MAIN_IDS = UNIQUE_IDS.filter((id) => UNIQUES[id].pool === 'main');

/** "2%", "0.5%", "33%". */
const pct = (v: number) => {
  const p = v * 100;
  return `${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`;
};

/** "Unique rod", "Unique frame", "Unique unit". */
export function kindLine(id: UniqueId): string {
  const b = UNIQUES[id].base;
  if (b.type === 'unit') return 'Unique unit';
  if (b.type === 'armor') return `Unique ${b.slot}`;
  return `Unique ${weaponKinds[b.kind].label.toLowerCase()}`;
}

/** Gear's base stats at gear tier `tier`, before Rift-forging: "Tech damage +120 · Req Lv 90". */
function baseAt(id: UniqueId, tier: number): string {
  const def = getDef(uniqueItemId(id, tier));
  const req = itemRequirement(def);
  const reqText = req ? ` · Req Lv ${req.level}` : '';
  if (def.type === 'weapon') return `${STAT_LABEL.mst} +${def.bonus.mst ?? 0}${reqText}`;
  if (def.type === 'armor') return `Damage taken ${statValue('strike', def.dr)}${reqText}`;
  return '';
}

const UNIT_NOTE = 'A unit: learned into the Mag when picked up; slot it there (the Mag runs four) and it works.';

/** Main-game uniques: any boss, any difficulty, at the boss's gear tier. */
function mainDrops(id: UniqueId): string[] {
  const share = uniqueShare(id);
  const odds = DIFFS.map((d) => `${DIFFICULTY_NAME[d]} ${pct(drops.uniqueBoss[d] * drops.rareMult * share)}`).join(' · ');
  const tiers = (d: Difficulty) => BOSS_IDS.map((b) => bossUniqueTier(b, d));
  const range = DIFFS.map((d) => `${DIFFICULTY_NAME[d]} ${Math.min(...tiers(d))}-${Math.max(...tiers(d))}`).join(' · ');
  const lo = Math.min(...tiers('normal'));
  const hi = Math.max(...tiers('hell'));
  return [
    `<b>Every main-game boss</b> (${BOSS_IDS.map((b) => esc(BOSSES[b].name)).join(', ')}), on any difficulty`,
    `A kill drops this one: ${odds}`,
    `Gear tier, by boss: ${range}`,
    `Tier ${lo}: ${baseAt(id, lo)}`,
    `Tier ${hi}: ${baseAt(id, hi)}`,
  ];
}

/** A rift boss's own: its circle, the first kill there, the later odds, and the base it drops at. */
function riftDrops(ch: Character, id: UniqueId): string[] {
  const u = UNIQUES[id];
  const boss = u.boss!;
  const c = u.circle ?? 1;
  const save = riftSave(ch.data);
  const lo = CIRCLE_TIERS[c][0];
  const at = BOSS_TIER[c];
  const open = riftsOpen(ch.data);
  const reached = open && c <= circleOf(save.tier);
  const name = esc(BOSSES[boss].name);
  const pair = bossUniques(boss, c, c).find((x) => x !== id);
  const state = !open ? '' : !reached ? ` <span class="uq-state">Circle ${circleName(c)} begins at rift tier ${lo}</span>`
    : firstKillOwed(save, boss, c) ? ' <span class="uq-state owed">still to claim</span>' : ' <span class="uq-state">claimed</span>';
  const shares = CIRCLES.filter((k) => k >= c).map((k) => `${circleName(k)} ${pct(bossUniqueShare(id, k))}`).join(' · ');
  const forge = (tier: number) => `+${Math.round((forgeMult({ ilvl: riftIlvl(tier) }) - 1) * 100)}%`;
  if (!isMainBoss(boss)) {
    // A pinnacle's boss: one node, between two quarters, at its circle's boss tier, with doubled odds.
    const mult = drops.pinnacleUniqueMult;
    const lines = [
      `<b>${name}</b> on the Rift Map: Pinnacle ${circleName(c)} (tier ${at}), open once both neighbouring Circle ${circleName(c)} bosses are dead`,
      `Its first kill drops this or ${esc(pair ? UNIQUES[pair].name : '')}, one you lack first${state}`,
      `Later kills: ${pct(drops.riftUnique * mult * drops.rareMult)} for one of its uniques (+${pct(drops.riftUniqueDry * mult)} a kill without one; twice a boss's odds, item rarity raises it)`,
      `This one's share of those: ${pct(bossUniqueShare(id, c))}`,
    ];
    if (isUniqueUnit(id)) return [...lines, UNIT_NOTE];
    return [...lines, `Gear tier 15, Rift-forged ${forge(at)}`, `Tier 15: ${baseAt(id, 15)}`];
  }
  const lines = [
    `<b>${name}</b> on the Rift Map: its Circle ${circleName(c)} node (tier ${at}) and deeper circles' ${name} nodes`,
    `The first ${name} kill in Circle ${circleName(c)} drops this or ${esc(pair ? UNIQUES[pair].name : '')}, one you lack first${state}`,
    `Later kills: ${pct(drops.riftUnique * drops.rareMult)} for one of its uniques (+${pct(drops.riftUniqueDry)} a kill without one; item rarity raises it)`,
    `This one's share of those, by circle: ${shares}`,
  ];
  if (isUniqueUnit(id)) return [...lines, UNIT_NOTE];
  return [
    ...lines,
    `Gear tier 15, Rift-forged ${forge(at)} from the Circle ${circleName(c)} node${c < 3 ? `, up to ${forge(BOSS_TIER[3])} from Circle III's` : ''}`,
    `Tier 15: ${baseAt(id, 15)}`,
  ];
}

/** One unique's card. `locked`: its circle isn't open to you yet (dimmed). */
function card(ch: Character, id: UniqueId): string {
  const u = UNIQUES[id];
  const found = hasFound(ch.data, id);
  const locked = u.pool === 'rift' && (!riftsOpen(ch.data) || (u.circle ?? 1) > circleOf(riftSave(ch.data).tier));
  const line = (dot: string, text: string) => `<div class="ic-aff"><i class="ic-dot ${dot}"></i><span class="ic-txt">${esc(text)}</span></div>`;
  const notes = (u.notes ?? []).map((n) => `<div class="uq-note">${esc(n)}</div>`).join('');
  const where = (u.pool === 'main' ? mainDrops(id) : riftDrops(ch, id)).map((l) => `<div>${l}</div>`).join('');
  return `<div class="uq-card${found ? ' found' : ''}${locked ? ' locked' : ''}">
    <div class="uq-top"><span class="ico">${itemGlyph(getDef(uniqueDropId(id, 15)))}</span><span class="uq-name">${esc(u.name)}</span>
      ${found ? `<span class="uq-found">✓ ${isUniqueUnit(id) ? 'Learned' : 'Found'}</span>` : ''}</div>
    <div class="ic-sub"><span>${esc(kindLine(id))}</span>${u.circle ? `<span class="uq-circle">Circle ${circleName(u.circle)}</span>` : ''}</div>
    ${line('good', u.effect)}${line('bad', u.cost)}${notes}
    <div class="ic-sec">Drops</div><div class="uq-drops">${where}</div>
    <div class="ic-flavour">${esc(u.flavour)}</div></div>`;
}

/** The Uniques tab: filter buttons (with found counts), then a heading and a grid of cards per source. */
export function uniquesTabHtml(ch: Character, filter: UniqueFilter): string {
  const open = riftsOpen(ch.data);
  const save = riftSave(ch.data);
  const groups: { key: Exclude<UniqueFilter, 'all'>; label: string; ids: UniqueId[]; note: string }[] = [
    { key: 'main', label: 'Main game', ids: MAIN_IDS, note: 'Three weapons, from Normal, Nightmare and Hell bosses' },
    ...RIFT_BOSS_IDS.map((b) => {
      const dry = save.dry?.[b] ?? 0;
      const note = !open
        ? 'The Falz Rifts open once Dark Falz falls on Hell'
        : `Falz Rifts · next kill ${pct(riftUniqueOdds(save, b))}${dry ? ` (${dry} kill${dry > 1 ? 's' : ''} without one)` : ''}, more with item rarity`;
      return { key: b, label: BOSSES[b].name, ids: bossUniques(b, 3), note };
    }),
  ];
  const count = (ids: UniqueId[]) => `${ids.filter((id) => hasFound(ch.data, id)).length}/${ids.length}`;
  const btn = (key: UniqueFilter, label: string, ids: UniqueId[]) =>
    `<button class="btn small${filter === key ? '' : ' ghost'}" data-act="uqFilter" data-arg="${key}">${esc(label)} <span class="uq-count">${count(ids)}</span></button>`;
  const btns = [btn('all', 'All', UNIQUE_IDS), ...groups.map((g) => btn(g.key, g.label, g.ids))].join('');
  const body = groups
    .filter((g) => filter === 'all' || filter === g.key)
    .map((g) => `<div class="uq-group"><span>${esc(g.label)}</span><span class="uq-group-note">${esc(g.note)}</span></div>
      <div class="uq-grid">${g.ids.map((id) => card(ch, id)).join('')}</div>`)
    .join('');
  return `<div class="uq-tab"><div class="uq-head">${btns}</div>
    <div class="dim uq-intro">Bosses drop uniques, nothing else does. Each has one effect nothing else has and a real cost; gear uniques have no affixes, unique units are learned into the Mag.</div>
    <div class="detail uq-list" data-scroll="uq-${filter}">${body}</div></div>`;
}
