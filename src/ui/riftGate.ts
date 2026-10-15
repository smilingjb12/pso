import { forgeMult, type Character } from '../game/character';
import { AFFIX_TIER_ILVL, maxAffixTier } from '../game/data/itemAffixes';
import {
  modText, RIFT_MODS, riftCfg, riftGrowth, riftIlvl, riftLoot, riftName, riftSave, riftScale, riftTierBonus, riftTitle, shardRarity,
  sortedShards,
  type RiftBiome, type RiftInfo, type RiftShard,
} from '../game/rifts';
import { esc, type Menu } from './Menus';

// The Rift Gate in Pioneer 2 (DESIGN.md "Endgame: Falz Rifts"): open a plain rift of any unlocked tier, or one
// from a Rift Shard in the stash; return to the open rift. No region to pick: every rift is the Forest with every
// expedition's enemies.

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

type Tab = 'open' | 'shards';

/** "Item level 107 · affix tier 7": what a tier's drops can roll. */
function ilvlLine(tier: number): string {
  const ilvl = riftIlvl(tier);
  const at = maxAffixTier(ilvl);
  const next = AFFIX_TIER_ILVL.find((need) => need > ilvl);
  const nextTier = next ? ` (tier ${at + 1} from rift tier ${next - 100})` : '';
  return `Item level ${ilvl} · affixes up to tier ${at}${nextTier}`;
}

/** The next loot step above `tier`, if any. */
function nextStep(tier: number): string {
  const steps: [number, string][] = [
    [AFFIX_TIER_ILVL[6] - 100, 'affix tier 7'],
    [AFFIX_TIER_ILVL[7] - 100, 'affix tier 8'],
  ];
  const next = steps.find(([t]) => t > tier);
  return next
    ? `Next step: ${next[1]} at tier ${next[0]}.`
    : 'Every affix tier is open: deeper tiers still raise Rift-forging, item quantity and rarity (and Meseta).';
}

/** "+12%" from a multiplier. */
const pctUp = (m: number) => `+${Math.round((m - 1) * 100)}%`;

/** The chosen tier at a glance: how much tougher than tier 1 and than the tier below, and what its drops can roll. */
function tierPreview(tier: number): string {
  const g = riftGrowth(tier);
  const below = riftGrowth(tier - 1);
  const tech = riftScale('ruins', { tier, mods: [] }).techResist;
  const ilvl = riftIlvl(tier);
  const forge = forgeMult({ ilvl });
  const top = maxAffixTier(ilvl);
  const tiers = [top, top - 1, top - 2].filter((t) => t >= 1);
  const odds = tiers.map((t, i) => `${[50, 30, 20][i]}% tier ${t}`).join(' · ');
  const enemies = [
    tier === 1
      ? 'Each one as tough as its own Hell expedition, lifted to Lv 100'
      : `HP ×${g.hp.toFixed(2)}, damage ×${g.dmg.toFixed(2)}, armour +${Math.round(g.armor)}% vs tier 1`,
    ...(tier > 1 ? [`vs tier ${tier - 1}: HP ${pctUp(g.hp / below.hp)}, damage ${pctUp(g.dmg / below.dmg)}`] : []),
    ...(g.tempo > 1 ? [`Bosses act ${pctUp(g.tempo)} faster${tier >= riftCfg.capTier ? ` (no faster past tier ${riftCfg.capTier})` : ''}`] : []),
    `Techniques do ${tech}% less (the Ruins' enemies)`,
    'Hell rules: every hit corrupts, every enemy has affixes',
  ];
  const loot = [
    bonusText(riftTierBonus(tier)),
    `Item level ${ilvl}: gear tiers 13-15, Rift-forged ${pctUp(forge)}`,
    `Each affix rolls ${odds}`,
    `Rares: 6 affixes and 3 dormant · Meseta +${5 * tier}%`,
  ];
  const col = (title: string, lines: string[]) =>
    `<div class="rift-col"><div class="rift-col-title">${title}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  const where =
    'Every rift opens onto a random region (the Forest, Caves, Mines or Ruins), with its look and hazards, and enemies from ' +
    'every expedition: each wave comes from one (Boomas, Cave beasts and Lilies, gunbots and their control nodes, or the ' +
    'Dark), so all four races show up.';
  return `<div class="rift-preview">${col('Enemies', enemies)}${col('Loot', loot)}</div>
    <div class="dim">${esc(nextStep(tier))}</div><div class="dim">${esc(where)}</div>`;
}

/** "Item quantity +35% · Item rarity +42%". */
const bonusText = ({ qty, rar }: { qty: number; rar: number }) => `Item quantity +${qty}% · Item rarity +${rar}%`;

/** A shard's modifiers, and its loot: the tier's own and the modifiers' together. */
function modsHtml(s: { tier: number; mods: RiftShard['mods']; second?: RiftBiome }): string {
  const mods = s.mods.length
    ? `<ul class="rift-mods">${s.mods.map((m) => `<li><b>${esc(RIFT_MODS[m].name)}</b> ${esc(modText(m, s.second))}</li>`).join('')}</ul>`
    : '<div class="dim">No modifiers.</div>';
  return `${mods}<div class="rift-bonus">${bonusText(riftLoot(s))}</div>`;
}

export class RiftGateMenu implements Menu {
  cls = 'rift-gate';
  closable = true;
  private tab: Tab = 'open';
  private tier: number;
  private sel: string | null = null;

  constructor(private api: RiftGateApi) {
    this.tier = riftSave(api.char.data).tier;
  }

  render(): string {
    const save = riftSave(this.api.char.data);
    const open = this.api.openRift();
    const tabs = (['open', 'shards'] as Tab[])
      .map((t) => `<button class="tab${this.tab === t ? ' on' : ''}" data-act="tab" data-arg="${t}">${t === 'open' ? 'Open a rift' : `Shards (${save.shards.length}/${riftCfg.stash})`}</button>`)
      .join('');
    const openRow = open
      ? `<div class="rift-open"><span>Open: <b>${esc(riftName(open))}</b>${open.mods.length ? ` · ${open.mods.length} modifier${open.mods.length > 1 ? 's' : ''}` : ''}${open.boss ? ' · boss' : ''}</span>
        <button class="btn small" data-act="return">Return</button></div>`
      : '';
    const body = this.tab === 'open' ? this.openTab(save.tier, !!open) : this.shardTab(save.shards, !!open);
    return `<div class="menu-head"><div class="win-title">Rift Gate</div><span class="head-gap"></span><button class="btn small" data-act="close">Close</button></div>
      <p class="menu-text">Dark Falz is gone, but Ragol remembers it: every rift pulls the planet's creatures together, stronger every tier.
      Tiers 1-${save.tier} open · ${save.clears} closed${save.best ? ` · best tier ${save.best}` : ''}. The rifts go on without end.</p>
      ${openRow}<div class="tabs">${tabs}</div>${body}`;
  }

  private openTab(maxTier: number, hasOpen: boolean): string {
    const t = Math.min(this.tier, maxTier);
    return `<div class="rift-pick">
      <div class="rift-line"><span class="rift-label">Tier</span>
        <button class="btn small ghost${t <= 1 ? ' disabled' : ''}" data-act="tier" data-arg="-1">−</button>
        <span class="rift-tier">${t}</span>
        <button class="btn small ghost${t >= maxTier ? ' disabled' : ''}" data-act="tier" data-arg="1">+</button>
        <button class="btn small ghost${t >= maxTier ? ' disabled' : ''}" data-act="tier" data-arg="max">Max</button></div>
      ${tierPreview(t)}
      <div class="dim">Close tier ${maxTier} to open tier ${maxTier + 1}. Every rift ends at one of the four bosses (at random), and rift bosses can drop the rift's own uniques.</div>
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
          <span class="rift-shard-ico"></span><span class="row-name">${esc(riftTitle(s))}</span><span class="price">${s.mods.length}</span></div>`;
      })
      .join('');
    const s = shards.find((x) => x.uid === this.sel)!;
    const detail = `<div class="detail-title ${shardRarity(s) === 'rare' ? 'r-rare' : 'r-magic'}">${esc(riftTitle(s))}</div>
      <div class="dim">${esc(ilvlLine(s.tier))}</div>${modsHtml(s)}
      <div class="choices menu-list">
        <button class="btn" data-act="shard" data-arg="${s.uid}">Enter${hasOpen ? '<span class="btn-sub">The rift you have open collapses</span>' : ''}</button>
        <button class="btn" data-act="shatter" data-arg="${s.uid}">Shatter<span class="btn-sub">Destroy this shard</span></button>
      </div>`;
    return `<div class="split"><div class="list">${rows}</div><div class="detail">${detail}</div></div>`;
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
