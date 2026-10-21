import { forgeMult, type Character } from '../game/character';
import { BOSSES, type BossId } from '../game/data/bosses';
import { AFFIX_TIER_ILVL, maxAffixTier } from '../game/data/itemAffixes';
import { UNIQUES, type RiftCircle } from '../game/data/uniques';
import { weaponKinds } from '../game/data/items';
import { bossUniques, CIRCLE_TIERS, CIRCLES, circleName, circleOf, firstKillOwed, hasFound } from '../game/riftCircles';
import {
  modText, pickedTier, RIFT_MODS, riftCfg, riftGrowth, riftIlvl, riftLoot, riftName, riftSave, riftTierBonus, riftThreat, riftTitle, shardBossText,
  shardRarity, sortedShards,
  type RiftInfo, type RiftShard,
} from '../game/rifts';
import { esc, type Menu } from './Menus';

// The Rift Gate in Pioneer 2 (DESIGN.md "Endgame: Falz Rifts"): open a plain rift of any unlocked tier, or one
// from a Rift Shard in the stash; return to the open rift; see what each boss drops in each Rift Circle.

export interface RiftGateApi {
  readonly char: Character;
  /** The rift open this session (not complete), if any. */
  openRift(): RiftInfo | null;
  startRift(tier: number): void;
  startShard(uid: string): void;
  shatterShard(uid: string): void;
  returnToRift(): void;
  closeMenu(): void;
}

type Tab = 'open' | 'shards' | 'circles';

const RIFT_BOSSES: BossId[] = ['dragon', 'derolle', 'warden', 'falz'];

/** The rift tier an item level first drops at. */
const tierOfIlvl = (ilvl: number) => Math.ceil((ilvl - 100) / 2);

/** "Item level 108 · affix tier 7": what a tier's drops can roll. */
function ilvlLine(tier: number): string {
  const ilvl = riftIlvl(tier);
  const at = maxAffixTier(ilvl);
  const next = AFFIX_TIER_ILVL.find((need) => need > ilvl);
  const nextTier = next ? ` (tier ${at + 1} from rift tier ${tierOfIlvl(next)})` : '';
  return `Item level ${ilvl} · affixes up to tier ${at}${nextTier}`;
}

/** The next loot step above `tier`, if any. */
function nextStep(tier: number): string {
  const steps: [number, string][] = [
    [tierOfIlvl(AFFIX_TIER_ILVL[6]), `affix tier 7 and Rift Circle ${circleName(2)}'s uniques`],
    [tierOfIlvl(AFFIX_TIER_ILVL[7]), `affix tier 8 and Rift Circle ${circleName(3)}'s uniques`],
  ];
  const next = steps.find(([t]) => t > tier);
  if (next) return `Next step: ${next[1]} at tier ${next[0]}.`;
  return tier < riftCfg.maxTier
    ? `Every affix tier and circle is open: deeper tiers still raise Rift-forging, item quantity and rarity, up to tier ${riftCfg.maxTier}.`
    : `Tier ${riftCfg.maxTier} is the deepest rift: its drops are the best Rift-forged there are.`;
}

/** "+12%" from a multiplier. */
const pctUp = (m: number) => `+${Math.round((m - 1) * 100)}%`;
const pct = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;

/** The chosen tier at a glance: how much tougher than tier 1, how hard it hits you, and what its drops can roll. */
function tierPreview(tier: number, ch: Character): string {
  const g = riftGrowth(tier);
  const ilvl = riftIlvl(tier);
  const forge = forgeMult({ ilvl });
  const top = maxAffixTier(ilvl);
  const tiers = [top, top - 1, top - 2].filter((t) => t >= 1);
  const odds = tiers.map((t, i) => `${[50, 30, 20][i]}% tier ${t}`).join(' · ');
  const threat = riftThreat(tier, ch.maxHp, ch.damageTaken('strike'), ch.damageTaken('area'));
  const enemies = [
    tier === 1
      ? "Each one as tough as its own Hell expedition, lifted to Lv 100, and hitting far harder"
      : `vs tier 1: enemy HP ×${g.hp.toFixed(2)}, boss HP ×${g.bossHp.toFixed(2)}, heavy hits ×${g.heavy.toFixed(2)}, shots ×${g.chip.toFixed(2)}`,
    `On you: a heavy hit takes about ${pct(threat.heavy)} of your HP (the hardest ${pct(threat.hardest)}), a shot ${pct(threat.chip)}`,
    'Hell rules: every hit corrupts, every enemy has affixes',
  ];
  const loot = [
    bonusText(riftTierBonus(tier)),
    `Item level ${ilvl}: gear tiers 13-15, Rift-forged ${pctUp(forge)}`,
    `Each affix rolls ${odds}`,
    `Rares: 6 affixes and 3 dormant · Meseta +${10 * tier}%`,
  ];
  const col = (title: string, lines: string[]) =>
    `<div class="rift-col"><div class="rift-col-title">${title}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  const where =
    'Every rift opens onto a random region (the Forest, Caves, Mines or Ruins), with its look and hazards, and enemies from ' +
    'every expedition, and ends at one of the four bosses at random.';
  return `<div class="rift-preview">${col('Enemies', enemies)}${col('Loot', loot)}</div>
    <div class="dim">${esc(nextStep(tier))}</div><div class="dim">${esc(where)}</div>`;
}

/** "Item quantity +35% · Item rarity +42%". */
const bonusText = ({ qty, rar }: { qty: number; rar: number }) => `Item quantity +${qty}% · Item rarity +${rar}%`;

/** A shard's modifiers, and its loot: the tier's own and the modifiers' together. */
function modsHtml(s: RiftShard): string {
  const lines = s.mods.map((m) => `<li><b>${esc(RIFT_MODS[m].name)}</b> ${esc(modText(m, s.second))}</li>`);
  if (s.boss) lines.unshift(`<li><b>Summons</b> ${esc(shardBossText(s.boss))}</li>`);
  const mods = lines.length ? `<ul class="rift-mods">${lines.join('')}</ul>` : '<div class="dim">No modifiers.</div>';
  return `${mods}<div class="rift-bonus">${bonusText(riftLoot(s))}</div>`;
}

/** One unique in the circles table: found or not. */
function uniqueChip(ch: Character, id: keyof typeof UNIQUES): string {
  const u = UNIQUES[id];
  const found = hasFound(ch.data, id);
  const kind = u.base.type === 'unit' ? 'Unit' : u.base.type === 'weapon' ? weaponKinds[u.base.kind].label : u.base.slot;
  return `<div class="rift-uq${found ? ' found' : ''}" title="${esc(`${u.effect}. Cost: ${u.cost}.`)}">
    <span class="rift-uq-name">${found ? '✓ ' : ''}${esc(u.name)}</span><span class="rift-uq-kind">${esc(kind)}</span></div>`;
}

export class RiftGateMenu implements Menu {
  cls = 'rift-gate';
  closable = true;
  private tab: Tab = 'open';
  private tier: number;
  private sel: string | null = null;

  constructor(private api: RiftGateApi) {
    this.tier = pickedTier(riftSave(api.char.data));
  }

  render(): string {
    const save = riftSave(this.api.char.data);
    const open = this.api.openRift();
    const label: Record<Tab, string> = { open: 'Open a rift', shards: `Shards (${save.shards.length}/${riftCfg.stash})`, circles: 'Rift Circles' };
    const tabs = (['open', 'shards', 'circles'] as Tab[])
      .map((t) => `<button class="tab${this.tab === t ? ' on' : ''}" data-act="tab" data-arg="${t}">${label[t]}</button>`)
      .join('');
    const openRow = open
      ? `<div class="rift-open"><span>Open: <b>${esc(riftName(open))}</b>${open.mods.length ? ` · ${open.mods.length} modifier${open.mods.length > 1 ? 's' : ''}` : ''}${open.boss ? ' · boss' : ''}</span>
        <button class="btn small" data-act="return">Return</button></div>`
      : '';
    const body = this.tab === 'open' ? this.openTab(save.tier, !!open) : this.tab === 'shards' ? this.shardTab(save.shards, !!open) : this.circlesTab(save.tier);
    return `<div class="menu-head"><div class="win-title">Rift Gate</div><span class="head-gap"></span><button class="btn small" data-act="close">Close</button></div>
      <p class="menu-text">Dark Falz is gone, but Ragol remembers it: every rift pulls the planet's creatures together, stronger every tier.
      Tiers 1-${save.tier} open · ${save.clears} closed${save.best ? ` · best tier ${save.best}` : ''}. Tier ${riftCfg.maxTier} is the deepest.</p>
      ${openRow}<div class="tabs">${tabs}</div>${body}`;
  }

  private openTab(maxTier: number, hasOpen: boolean): string {
    const t = Math.min(this.tier, maxTier);
    const c = circleOf(t);
    const [lo, hi] = CIRCLE_TIERS[c];
    const next = maxTier < riftCfg.maxTier ? `Close tier ${maxTier} to open tier ${maxTier + 1}.` : `Every tier is open.`;
    return `<div class="rift-pick">
      <div class="rift-line"><span class="rift-label">Tier</span>
        <button class="btn small ghost${t <= 1 ? ' disabled' : ''}" data-act="tier" data-arg="-1">−</button>
        <span class="rift-tier">${t}</span>
        <button class="btn small ghost${t >= maxTier ? ' disabled' : ''}" data-act="tier" data-arg="1">+</button>
        <button class="btn small ghost${t >= maxTier ? ' disabled' : ''}" data-act="tier" data-arg="max">Max</button>
        <span class="rift-circle">Rift Circle ${circleName(c)} · tiers ${lo}-${hi}</span></div>
      ${tierPreview(t, this.api.char)}
      <div class="dim">${next} Rift bosses drop their own uniques, more of them each circle: the first kill of each boss in a circle always drops one (Rift Circles tab).</div>
      <div class="choices menu-list"><button class="btn" data-act="start">Open the rift${hasOpen ? '<span class="btn-sub">The rift you have open collapses</span>' : ''}</button></div>
    </div>`;
  }

  private shardTab(shards: RiftShard[], hasOpen: boolean): string {
    if (!shards.length) return '<div class="dim empty-note">No Rift Shards yet. Rift bosses and champions drop them.</div>';
    const list = sortedShards(shards);
    if (!this.sel || !shards.some((s) => s.uid === this.sel)) this.sel = list[0].uid;
    const rows = list
      .map((s) => {
        const r = shardRarity(s);
        return `<div class="row${r === 'rare' ? ' r-rare' : ' r-magic'}${this.sel === s.uid ? ' sel' : ''}" data-act="sel" data-arg="${s.uid}">
          <span class="rift-shard-ico"></span><span class="row-name">${esc(riftTitle(s))}${s.boss ? ` · ${esc(BOSSES[s.boss].name)}` : ''}</span><span class="price">${s.mods.length}</span></div>`;
      })
      .join('');
    const s = shards.find((x) => x.uid === this.sel)!;
    const detail = `<div class="detail-title ${shardRarity(s) === 'rare' ? 'r-rare' : 'r-magic'}">${esc(riftTitle(s))}</div>
      <div class="dim">${esc(ilvlLine(s.tier))} · Rift Circle ${circleName(circleOf(s.tier))}</div>${modsHtml(s)}
      <div class="choices menu-list">
        <button class="btn" data-act="shard" data-arg="${s.uid}">Enter${hasOpen ? '<span class="btn-sub">The rift you have open collapses</span>' : ''}</button>
        <button class="btn" data-act="shatter" data-arg="${s.uid}">Shatter<span class="btn-sub">Destroy this shard</span></button>
      </div>`;
    return `<div class="split"><div class="list">${rows}</div><div class="detail">${detail}</div></div>`;
  }

  /** Each boss's uniques by circle: found ones ticked, circles not reached yet dimmed, first kills still owed marked. */
  private circlesTab(maxTier: number): string {
    const ch = this.api.char;
    const save = riftSave(ch.data);
    const reached = circleOf(maxTier);
    const head = CIRCLES.map((c) => `<div class="rift-uq-head${c > reached ? ' locked' : ''}">Circle ${circleName(c)}<span class="dim"> · tiers ${CIRCLE_TIERS[c][0]}-${CIRCLE_TIERS[c][1]}</span></div>`).join('');
    const rows = RIFT_BOSSES.map((boss) => {
      const cells = CIRCLES.map((c: RiftCircle) => {
        const owed = c <= reached && firstKillOwed(save, boss, c);
        return `<div class="rift-uq-cell${c > reached ? ' locked' : ''}">${bossUniques(boss, c, c).map((id) => uniqueChip(ch, id)).join('')}
          ${owed ? '<div class="rift-uq-first">First kill here drops one</div>' : ''}</div>`;
      }).join('');
      return `<div class="rift-uq-boss">${esc(BOSSES[boss].name)}</div>${cells}`;
    }).join('');
    return `<div class="rift-uq-grid"><div></div>${head}${rows}</div>
      <div class="dim">Each boss drops only its own: this circle's two, and the earlier circles' less often. Hover one to see what it does. Unique units are learned into the Mag: run as many as your frame has unit slots.</div>`;
  }

  onAction(act: string, arg: string): void {
    const save = riftSave(this.api.char.data);
    switch (act) {
      case 'close':
        this.api.closeMenu();
        break;
      case 'tab':
        this.tab = arg as Tab;
        break;
      case 'tier':
        this.tier = arg === 'max' ? save.tier : Math.max(1, Math.min(save.tier, Math.min(this.tier, save.tier) + Number(arg)));
        save.picked = this.tier;
        break;
      case 'sel':
        this.sel = arg;
        break;
      case 'start':
        this.api.startRift(Math.min(this.tier, save.tier));
        break;
      case 'shard':
        this.api.startShard(arg);
        break;
      case 'shatter':
        this.api.shatterShard(arg);
        this.sel = null;
        break;
      case 'return':
        this.api.returnToRift();
        break;
    }
  }
}
