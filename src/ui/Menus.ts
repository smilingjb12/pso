import {
  affixLines, dropVerdict, fitsSlot, GEAR_SLOTS, gearSlot, gearVerdict, isGearItem, itemHeadline, itemName,
  MAG_UNIT_SLOTS, magPointValue, rarityOf, sellPrice, simulateEquip, simulateUnits, unitKind, type Character, type GearSlot, type ItemInstance, type UnitKind,
} from '../game/character';
import { craftPlan } from '../game/crafting';
import { damageBreakdown, type Foe } from '../game/dps';
import { isGear } from '../game/itemTypes';
import { GROWTH, STAT_KEYS, STAT_LABEL, statValue, type MagStat, type StatKey } from '../game/data/stats';
import { ART_IDS, ARTS, type ArtId } from '../game/data/arts';
import { AFFIX_CAPS, affixText, ITEM_AFFIXES, UNIT_KINDS } from '../game/data/itemAffixes';
import { getDef, INVENTORY_SIZE } from '../game/data/items';
import { UNIQUES } from '../game/data/uniques';
import { restaHeal } from '../game/data/techniques';
import { buyPrice, type ShopKind } from '../game/loot';
import { dash as dashCfg, magCfg, passiveCfg, skillCfg } from '../game/config';
import { MAG_BONUS, MAG_EVOLVE_AT, MAG_STAT_LABEL, MAG_STATS, magForm, magLevel, PHOTON_BLASTS, type PhotonBlastId } from '../game/mag';
import { needText, PASSIVES, weaponFits, type PassiveId } from '../game/passives';
import { LANE_COLS, modNodeId, modRowRank, rankOf, rankUpBlock, skillReachable, SKILL_TREES, skillName, skillNode, skillNodes, treeCols, treeLines, treeOf, treeSpent, type SkillLine, type SkillNode } from '../game/skills';
import { sfx, type SfxId } from '../audio';
import { itemGlyph, techIcon } from './icons';
import { modIcon, passiveIcon } from './skillIcons';
import { itemCardHtml } from './itemCard';

// DOM menus. All menus pause the game; the Game owns open/close.

export interface GameApi {
  readonly char: Character;
  readonly inField: boolean;
  /** Show a toast; action methods below return an error to show (or null on success, having toasted it). */
  notify(text: string, kind?: '' | 'good' | 'warn'): void;
  useItem(uid: string): string | null;
  /** Put Mag points into a stat (permanent). */
  magSpend(stat: MagStat, n?: number): string | null;
  /** Put ranks into a skill (step > 0) or take them out (< 0); out of a fight. */
  skillRank(id: string, step: number): string | null;
  /** Put an Art on a bar slot (null empties it); out of a fight. */
  artSlot(slot: number, id: ArtId | null): string | null;
  /** The photon blast the Mag fires. */
  photonBlastPick(id: PhotonBlastId): string | null;
  /** Slot a learned unit (by kind) into the Mag, take one out, or reorder them. */
  unitInsert(kind: UnitKind): string | null;
  unitRemove(index: number): string | null;
  unitMove(index: number, dir: number): string | null;
  /** Switch exactly these learned units on (they go first in the Mag). */
  unitSet(kinds: UnitKind[]): string | null;
  /** Sell all bag gear that is worse than what is worn. */
  sellJunk(): string | null;
  /** Salvage the bag's junk magic and rare gear into Photon Drops. */
  salvageJunk(): string | null;
  equipItem(uid: string): string | null;
  unequipItem(uid: string): void;
  discardItem(uid: string): void;
  /** Use a photon on a weapon or armour piece (`key`: the photon's pick). */
  craftItem(targetUid: string, toolUid: string, key: string): string | null;
  buy(inst: ItemInstance): string | null;
  sell(uid: string): string | null;
  /** The enemy weapon damage estimates are measured against (the current expedition's average). */
  damageFoe(): Foe;
  closeMenu(): void;
  quitToTitle(): void;
}

/** Name colour class for an item's rarity: purple uniques (the old "rare" class), yellow rares, blue magic. */
function rarityCls(it: ItemInstance): string {
  const r = rarityOf(it);
  return r === 'unique' ? ' rare' : r === 'rare' ? ' r-rare' : r === 'magic' ? ' r-magic' : '';
}

/** Small type glyph for an item row. */
function glyph(it: ItemInstance): string {
  const def = getDef(it.id);
  return `<span class="ico">${itemGlyph(def)}</span>`;
}

/** Menu clicks: the game plays its own sound for these (buy, equip...), or an error. */
/** A unique unit (Rift Circles): its effect and cost stand in for an affix. */
const unitUnique = (u: ItemInstance) => {
  const id = getDef(u.id).unique;
  return id && UNIQUES[id].base.type === 'unit' ? UNIQUES[id] : null;
};
/** What a unit does, in one line: its affix, or a unique unit's effect and cost. */
const unitLine = (u: ItemInstance): string => {
  const q = unitUnique(u);
  return q ? `${q.effect} · Cost: ${q.cost}` : affixLines(u).join(', ');
};

const GAME_SOUNDED = new Set(['buy', 'sell', 'sellJunk', 'salvageJunk', 'equip', 'dmgEquip', 'unequip', 'magAdd', 'skillUp', 'skillMax', 'skillDown', 'artPick', 'artClear', 'pbPick', 'unitIn', 'unitOut', 'unitMove', 'dmgUnitsUse', 'use', 'learn', 'craftApply']);
const ACT_SOUND: Record<string, SfxId> = {
  pick: 'ui.confirm', load: 'ui.confirm', new: 'ui.confirm', doDelete: 'ui.confirm',
  close: 'ui.cancel', cancelDelete: 'ui.cancel', cancelCraft: 'ui.cancel', quit: 'ui.cancel',
};

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class MenuLayer {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private current: Menu | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menu-layer';
    this.panel = document.createElement('div');
    this.panel.className = 'menu-panel';
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (this.current?.onKey?.(e)) {
        sfx('ui.cursor');
        e.preventDefault();
        e.stopPropagation();
        this.render();
      }
    }, true);
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (t && this.current && t.classList.contains('disabled')) sfx('ui.error');
      if (t && this.current && !t.classList.contains('disabled')) {
        const act = t.dataset.act!;
        if (!GAME_SOUNDED.has(act)) sfx(ACT_SOUND[act] ?? 'ui.cursor');
        this.current.onAction(act, t.dataset.arg ?? '', t);
        this.render();
      }
    });
    // Soft tick when the pointer moves onto a new button.
    let hovered: Element | null = null;
    this.root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]:not(.disabled)');
      if (t && t !== hovered) sfx('ui.cursor', { vol: 0.5 });
      hovered = t;
    });
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  get menu(): Menu | null {
    return this.current;
  }

  open(menu: Menu): void {
    if (!this.current) sfx('ui.open');
    if (this.current && this.current !== menu) this.current.onClose?.();
    this.current = menu;
    this.root.className = `menu-layer${menu.layer ? ` ${menu.layer}` : ''}`;
    this.root.style.display = 'flex';
    this.panel.className = `menu-panel ${menu.cls ?? ''}`;
    this.render();
  }

  close(): void {
    if (this.current) sfx('ui.close');
    this.current?.onClose?.();
    this.current = null;
    this.root.style.display = 'none';
    this.panel.innerHTML = '';
  }

  render(): void {
    if (!this.current) return;
    // Preserve scroll positions across re-renders: the list's, and any element marked data-scroll (kept while its
    // value stays the same, e.g. one Skills tree; another tree starts at the top).
    const list = this.panel.querySelector('.list');
    const scroll = list ? list.scrollTop : 0;
    const kept = new Map([...this.panel.querySelectorAll<HTMLElement>('[data-scroll]')].map((e) => [e.dataset.scroll, [e.scrollTop, e.scrollLeft]]));
    const focused = (document.activeElement as HTMLInputElement | null)?.id;
    this.panel.innerHTML = this.current.render();
    const nl = this.panel.querySelector('.list');
    if (nl) nl.scrollTop = scroll;
    for (const e of this.panel.querySelectorAll<HTMLElement>('[data-scroll]')) {
      const at = kept.get(e.dataset.scroll);
      if (at) [e.scrollTop, e.scrollLeft] = at;
    }
    if (focused) (this.panel.querySelector(`#${focused}`) as HTMLInputElement | null)?.focus();
    this.current.afterRender?.(this.panel);
  }
}

export interface Menu {
  cls?: string;
  /** Extra class on the full-screen layer (e.g. a transparent layer over a 3D stage). */
  layer?: string;
  /** Escape closes this menu (title screen can't be closed). */
  closable: boolean;
  render(): string;
  onAction(act: string, arg: string, el: HTMLElement): void;
  afterRender?(panel: HTMLElement): void;
  /** Keyboard input while open; return true when handled (the menu re-renders). */
  onKey?(e: KeyboardEvent): boolean;
  onClose?(): void;
}

// ------------------------------------------------------------------ choice

export interface ChoiceOption {
  label: string;
  run: () => void;
  disabled?: boolean;
  sub?: string;
  /** A short chip after the label, e.g. expedition progress "2/3 · Cave 2". */
  tag?: string;
}

export class ChoiceMenu implements Menu {
  cls = 'small';
  constructor(
    private title: string,
    private text: string,
    private options: ChoiceOption[],
    public closable = true,
  ) {}

  render(): string {
    return `<div class="win-title">${esc(this.title)}</div><p class="menu-text">${this.text}</p>
      <div class="choices menu-list">${this.options
        .map(
          (o, i) =>
            `<button class="btn${o.disabled ? ' disabled' : ''}" data-act="pick" data-arg="${i}">${esc(o.label)}${
              o.tag ? `<span class="btn-tag">${esc(o.tag)}</span>` : ''
            }${o.sub ? `<span class="btn-sub">${esc(o.sub)}</span>` : ''}</button>`,
        )
        .join('')}</div>`;
  }

  onAction(act: string, arg: string): void {
    if (act === 'pick') this.options[Number(arg)]?.run();
  }
}

// --------------------------------------------------------------- inventory

type InvTab = 'equip' | 'items' | 'arts' | 'skills' | 'mag' | 'status' | 'damage';
const TAB_LABEL: Record<InvTab, string> = { equip: 'Equipment', items: 'Items', arts: 'Arts', skills: 'Skills', mag: 'Mag', status: 'Status', damage: 'Damage' };
/** The Art bar's keys. */
const ART_KEYS = ['RMB', 'Q', 'E', 'R'];
const ROLE_LABEL: Record<string, string> = { area: 'Area', single: 'Single target', support: 'Support' };
const SLOT_LABEL: Record<GearSlot, string> = { weapon: 'Weapon', frame: 'Frame', barrier: 'Barrier', injector: 'Injector' };


/**
 * Stat gains as text, the two damage-taken stats merged when they move together: "Weapon damage +3 · HP +3",
 * "Damage taken −1% · HP +4", "Crit chance +0.2%".
 */
function gainsText(gains: [StatKey, number][]): string {
  const strike = gains.find(([k]) => k === 'strike')?.[1];
  const area = gains.find(([k]) => k === 'area')?.[1];
  const both = strike !== undefined && strike === area;
  return gains
    .filter(([k, v]) => v && !(both && k === 'area'))
    .map(([k, v]) => {
      if (both && k === 'strike') return `Damage taken −${+v.toFixed(2)}%`;
      if (k === 'lck') return `${STAT_LABEL[k]} +${+(v / 10).toFixed(2)}%`;
      if (k === 'strike' || k === 'area') return `${STAT_LABEL[k]} −${+v.toFixed(2)}%`;
      return `${STAT_LABEL[k]} +${+v.toFixed(1)}`;
    })
    .join(' · ');
}

/** Arrow showing whether gear beats what is in its slot; ✖ if it can't be used. */
function verdictMark(ch: Character, inst: ItemInstance, foe: Foe): string {
  if (!gearSlot(inst) || ch.isEquipped(inst.uid)) return '';
  const check = ch.canEquip(inst);
  // A level requirement only locks it for now (amber, like the pickup prompt); ✖ is for anything else in the way.
  if (check.need) return `<span class="verdict locked" title="${esc(check.reason ?? '')}">Lv ${check.need.level}</span>`;
  if (!check.ok) return `<span class="verdict no" title="${esc(check.reason ?? "Can't equip")}">✖</span>`;
  const v = gearVerdict(ch, inst, foe);
  return v > 0 ? '<span class="verdict up" title="Better than equipped">▲</span>' : v < 0 ? '<span class="verdict down" title="Worse than equipped">▼</span>' : '<span class="verdict same">=</span>';
}

const ITEM_GROUPS: [string, string[]][] = [
  ['Consumables', ['consumable']],
  ['Photons (no bag space)', ['photon']],
  ['Units', ['unit']],
];

/**
 * Skills tree grid (px): a node's square, the column and row pitch, the gutter left of each lane (its Art spine), the
 * gutter before the passive columns (lines from Arts run down it), and the padding round the whole grid.
 */
const SK_N = 46;
const SK_PX = 58;
const SK_PY = 62;
const SK_SPINE = 20;
const SK_GUTTER = 30;
const SK_PAD = 10;
/** An Art's glyph (techniques have their own). */
const artIco = (id: ArtId) => techIcon(id);

export class InventoryMenu implements Menu {
  cls = 'wide';
  closable = true;
  tab: InvTab = 'equip';
  private slot: GearSlot = 'weapon';
  private sel: string | null = null;
  private crafting: string | null = null; // photon uid awaiting a target (weapon or armour)
  private craftTarget: string | null = null; // then the target, awaiting a pick (a photon's affix or offer)
  private swapFrom: number | null = null; // Photon Crystal: the active affix picked, awaiting the dormant one
  /** Arts tab: the bar slot picked (an Art clicked next goes there), and the Art whose details and modifiers show. */
  private artSlotSel: number | null = null;
  private artSel: ArtId | null = null;
  /** Skills tab: the skill whose details show, and the tree on screen. */
  private skillSel: string | null = null;
  private skillTree: string | null = null;
  /** Damage tab: gear picked to compare against what is worn (uid per slot; missing = the worn piece). */
  private dmgPick: Partial<Record<'weapon' | 'frame' | 'barrier', string>> = {};
  /** Damage tab: units switched on to compare (null = the Mag's active units now). */
  private dmgUnits: UnitKind[] | null = null;

  constructor(private api: GameApi) {}

  private get ch(): Character {
    return this.api.char;
  }

  render(): string {
    // Unspent Mag points and skill points: a count badge, and the tab pulses until you open it.
    const unspent: Partial<Record<InvTab, [number, string]>> = {
      mag: [this.ch.magPoints, 'Mag point'],
      skills: [this.ch.skillPointsFree, 'skill point'],
    };
    // Units switched off by the frame, or a free slot with units in the bag: the Mag tab is flagged.
    const unitWarn = this.ch.inactiveUnits > 0 ? `${this.ch.inactiveUnits} unit${this.ch.inactiveUnits > 1 ? 's' : ''} inactive: your frame has fewer unit slots` : this.ch.unitSlotIdle ? 'A unit slot is free and you have learned units to slot' : '';
    const tabs = (Object.keys(TAB_LABEL) as InvTab[])
      .map((t) => {
        const [pts, what] = unspent[t] ?? [0, ''];
        const badge = pts > 0;
        const warn = t === 'mag' ? unitWarn : '';
        const cls = `tab${this.tab === t ? ' on' : ''}${(badge || warn) && this.tab !== t ? ' pulse' : ''}`;
        const tip = [badge ? `${pts} ${what}${pts > 1 ? 's' : ''} to spend` : '', warn].filter(Boolean).join(' · ');
        const title = tip ? ` title="${tip}"` : '';
        return `<button class="${cls}" data-act="tab" data-arg="${t}"${title}>${TAB_LABEL[t]}${badge ? `<span class="tab-badge">${pts}</span>` : ''}${warn ? '<span class="tab-badge warn">!</span>' : ''}</button>`;
      })
      .join('');
    let body = '';
    if (this.tab === 'equip') body = this.renderEquip();
    else if (this.tab === 'items') body = this.renderItems();
    else if (this.tab === 'mag') body = this.renderMag();
    else if (this.tab === 'skills') body = this.renderSkills();
    else if (this.tab === 'status') body = this.renderStatus();
    else if (this.tab === 'arts') body = this.renderArts();
    else body = this.renderDamage();
    return `<div class="win-title">${esc(this.ch.data.name)} · Lv.${this.ch.level}</div>
      <div class="menu-head"><div class="tabs">${tabs}</div><span class="head-gap"></span><button class="btn small ghost" data-act="quit">Save &amp; quit</button><button class="btn small" data-act="close">Close <kbd>I</kbd></button></div>
      ${body}`;
  }

  private foot(): string {
    return `<div class="menu-foot"><span>${this.ch.bagCount} / ${INVENTORY_SIZE} items</span><span class="meseta">${this.ch.data.meseta.toLocaleString()} <b>M</b></span></div>`;
  }

  /** Equipment: the three slots, the bag's gear for the chosen slot, and a comparison. */
  private renderEquip(): string {
    const ch = this.ch;
    const cards = GEAR_SLOTS
      .map((slot) => {
        const it = ch.equippedItem(slot);
        const icon = it ? glyph(it) : '<span class="ico"></span>';
        return `<div class="gear-slot${this.slot === slot ? ' on' : ''}" data-act="slot" data-arg="${slot}">
          <span class="gs-label">${SLOT_LABEL[slot]}</span>${icon}
          <span class="gs-name${it ? rarityCls(it) : ''}">${it ? esc(itemName(it)) : '<span class="dim">— empty —</span>'}</span>
          <span class="gs-stat">${it ? esc(itemHeadline(it, ch)) : ''}</span></div>`;
      })
      .join('');
    const bag = ch.data.inventory.filter((it) => fitsSlot(it, this.slot));
    const rows = bag.length
      ? bag
          .map((it) => {
            const eq = ch.isEquipped(it.uid) ? '<span class="eq">E</span>' : '';
            const rare = rarityCls(it);
            return `<div class="row${rare}${this.sel === it.uid ? ' sel' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}${eq}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it, this.api.damageFoe())}</div>`;
          })
          .join('')
      : `<div class="dim empty-note">No ${SLOT_LABEL[this.slot].toLowerCase()}s in your bag.</div>`;
    const sel = this.selected(this.slot) ?? ch.equippedItem(this.slot);
    let detail = '<div class="dim">Nothing equipped. Pick an item from the list.</div>';
    if (sel) {
      const equipped = ch.isEquipped(sel.uid);
      const here = ch.data.equipped[this.slot] === sel.uid;
      const btns = [
        here
          ? `<button class="btn" data-act="unequip" data-arg="${sel.uid}">Unequip</button>`
          : `<button class="btn primary${ch.canEquip(sel).ok ? '' : ' disabled'}" data-act="equip" data-arg="${sel.uid}">Equip</button>`,
      ];
      if (!equipped) btns.push(`<button class="btn danger" data-act="discard" data-arg="${sel.uid}">${this.api.inField ? 'Drop' : 'Discard'}</button>`);
      detail = `${itemCardHtml(ch, sel, this.api.damageFoe())}
        <div class="detail-sell dim">Sells for ${sellPrice(sel)} M</div><div class="choices inline">${btns.join('')}</div>`;
    }
    const s = ch.stats();
    const totals = `<div class="gear-totals"><span>Tech damage <b>${s.mst}</b></span><span>Crit chance <b>${statValue('lck', s.lck)}</b></span><span>Strike <b>${statValue('strike', ch.damageTaken('strike'))}</b></span><span>Area <b>${statValue('area', ch.damageTaken('area'))}</b></span></div>`;
    return `<div class="split"><div class="equip-col"><div class="gear-slots">${cards}</div>
        <div class="list">${rows}</div>${totals}</div><div class="detail">${detail}</div></div>${this.foot()}`;
  }

  /** The selected item if it belongs to `slot` (or to the items tab when slot is null). */
  private selected(slot: GearSlot | null): ItemInstance | undefined {
    const it = this.sel ? this.ch.find(this.sel) : undefined;
    if (!it) return undefined;
    return slot ? (fitsSlot(it, slot) ? it : undefined) : gearSlot(it) ? undefined : it;
  }

  /** Items: everything that isn't gear, grouped by kind. */
  private renderItems(): string {
    const ch = this.ch;
    const items = ch.data.inventory.filter((it) => !gearSlot(it));
    const groups = ITEM_GROUPS.map(([label, types]) => [label, items.filter((it) => types.includes(getDef(it.id).type))] as const);
    const other = items.filter((it) => !ITEM_GROUPS.some(([, t]) => t.includes(getDef(it.id).type)));
    const rows = [...groups, ['Other', other] as const]
      .filter(([, list]) => list.length)
      .map(
        ([label, list]) =>
          `<div class="list-group">${label}</div>` +
          list
            .map((it) => `<div class="row${rarityCls(it)}${this.sel === it.uid ? ' sel' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}<span class="row-name">${esc(itemName(it))}</span></div>`)
            .join(''),
      )
      .join('');
    const sel = this.selected(null);
    let detail = '<div class="dim">Select an item.</div>';
    const tool = this.crafting ? ch.find(this.crafting) : undefined;
    const target = this.craftTarget ? ch.find(this.craftTarget) : undefined;
    if (tool && target) {
      detail = this.renderCraftPicker(tool, target);
    } else if (tool) {
      detail = this.renderCraftTargets(tool);
    } else if (sel) {
      const def = getDef(sel.id);
      const card = itemCardHtml(ch, sel, this.api.damageFoe());
      const btns: string[] = [];
      if (def.type === 'photon') btns.push(`<button class="btn primary" data-act="craft" data-arg="${sel.uid}">Use on…</button>`);
      btns.push(`<button class="btn danger" data-act="discard" data-arg="${sel.uid}">${this.api.inField ? 'Drop' : 'Discard'}</button>`);
      const hint = def.type === 'consumable' ? '<div class="dim">Put it on a Q / E quick slot (Palette tab) to use it in the field.</div>'
        : def.type === 'unit' ? `<div class="dim">${esc(dropVerdict(this.ch, sel).note)}. Units are learned when picked up (Mag tab → Units); this one is only worth its price.</div>`
        : '';
      detail = `${card}${hint}
        <div class="detail-sell dim">Sells for ${sellPrice(sel)} M</div><div class="choices inline">${btns.join('')}</div>`;
    }
    return `<div class="split"><div class="list">${rows || '<div class="dim empty-note">No items.</div>'}</div><div class="detail">${detail}</div></div>${this.foot()}`;
  }

  /**
   * A photon picked: choose the weapon or armour piece to use it on. The equipped pieces come first (they are nearly
   * always the ones worked on); dimmed where the photon can't work.
   */
  private renderCraftTargets(tool: ItemInstance): string {
    const ch = this.ch;
    const tdef = getDef(tool.id);
    const order = (it: ItemInstance) => (ch.isEquipped(it.uid) ? 0 : 1) * 10 + ['weapon', 'frame', 'barrier'].indexOf(gearSlot(it) ?? '');
    const items = ch.data.inventory.filter(isGearItem).sort((a, b) => order(a) - order(b));
    const rows = items
      .map((it) => {
        const def = getDef(it.id);
        let why = '';
        if (tdef.type === 'photon') {
          const plan = craftPlan(it, tdef.craft);
          if (!plan.ok) why = plan.reason;
        }
        // Rares show how many dormant affixes they hold (what a Crystal can swap in).
        const fill = def.type !== 'unit' && it.dormant?.length ? `${it.dormant.length} dormant` : '';
        const title = why ? ` title="${esc(why)}"` : '';
        return `<div class="row${rarityCls(it)}${why ? ' dimmed' : ''}"${title} data-act="craftTarget" data-arg="${it.uid}">${glyph(it)}${ch.isEquipped(it.uid) ? '<span class="eq">E</span>' : ''}<span class="row-name">${esc(itemName(it))}</span><span class="dim">${fill}</span></div>`;
      })
      .join('');
    return `<div class="detail-title">${esc(itemName(tool))}: choose a weapon or armour piece</div>
      <div class="dim grind-head">${esc(getDef(tool.id).desc ?? '')}</div>
      <div class="list short">${rows || '<div class="dim empty-note">No weapons or armour in your bag.</div>'}</div>
      <div class="choices inline"><button class="btn ghost" data-act="cancelCraft">Cancel</button></div>`;
  }

  /**
   * A photon on `target`: one row per affix it can work on, and the item's card below. A Crystal picks in two steps:
   * the active affix to swap out, then the dormant one to bring in.
   */
  private renderCraftPicker(photon: ItemInstance, target: ItemInstance): string {
    const ch = this.ch;
    const pdef = getDef(photon.id);
    if (pdef.type !== 'photon') return '<div class="dim">Nothing to craft.</div>';
    const plan = craftPlan(target, pdef.craft);
    const tierTag = (t?: number) => (t ? `<span class="cp-tier">T${t}</span>` : '');
    const row = (label: string, t: number | undefined, after: string, act: string, arg: string, can: boolean, reason: string, downside: boolean) =>
      `<div class="row craft-pick${downside ? ' downside' : ''}${can ? '' : ' dimmed'}" ${can ? `data-act="${act}" data-arg="${arg}"` : ''}>
        <span class="cp-name">${esc(label)}${tierTag(t)}</span><span class="cp-after">${esc(after)}</span>${reason ? `<span class="gp-note">${esc(reason)}</span>` : ''}</div>`;
    let rows = '';
    let how = '';
    let back = '';
    if (pdef.craft === 'crystal') {
      const active = target.affixes ?? [];
      const from = this.swapFrom !== null && active[this.swapFrom] ? this.swapFrom : null;
      if (from === null) {
        // Step 1: the active affix to swap out, with how many dormant ones of its kind could come in.
        how = 'Pick the active affix to swap out.';
        rows = active
          .map((r, i) => {
            const mine = plan.choices.filter((c) => c.key.startsWith(`${i}:`));
            const open = mine.filter((c) => c.ok).length;
            const kind = ITEM_AFFIXES[r.id].kind;
            const reason = !mine.length ? `No dormant ${kind}` : !open ? mine[0].reason : '';
            return row(affixText(r), r.t, open ? `${open} to swap in` : '', 'swapFrom', String(i), plan.ok && open > 0, reason, !!ITEM_AFFIXES[r.id].penalty);
          })
          .join('');
      } else {
        // Step 2: the dormant affix to bring in for it.
        const out = active[from];
        how = `Swapping out <b>${esc(affixText(out))}</b>. Pick the dormant affix to bring in: it keeps its roll, and the one going out keeps its own (a later Crystal can swap it back).`;
        rows = plan.choices
          .filter((c) => c.key.startsWith(`${from}:`))
          .map((c) => {
            const d = target.dormant![Number(c.key.split(':')[1])];
            return row(affixText(d), d.t, '', 'craftApply', c.key, plan.ok && c.ok, c.reason, !!c.downside);
          })
          .join('');
        back = '<button class="btn ghost" data-act="swapBack">Other affix</button>';
      }
    } else {
      how = pdef.craft === 'drop' ? 'Pick an affix to reroll within its strength tier (T).' : 'Pick an affix to raise a strength tier (T): it never comes out lower.';
      rows = plan.choices.map((c) => row(c.label, c.tier, c.after, 'craftApply', c.key, plan.ok && c.ok, c.reason, !!c.downside)).join('');
    }
    const head = plan.reason ? `<div class="gp-note warn">${esc(plan.reason)}</div>` : `<div class="dim grind-head">${how}</div>`;
    return `<div class="detail-title">${esc(itemName(photon))} → ${esc(itemName(target))}</div>
      ${head}
      <div class="list craft-picks">${rows}</div>
      <div class="choices inline">${back}<button class="btn ghost" data-act="craftBack">Other item</button><button class="btn ghost" data-act="cancelCraft">Cancel</button></div>
      ${itemCardHtml(ch, target, this.api.damageFoe())}`;
  }

  private renderStatus(): string {
    const ch = this.ch;
    const base = ch.baseStats();
    const own = ch.ownStats();
    const tot = ch.stats();
    const cap = AFFIX_CAPS.damageTaken;
    // A part of a stat in its own terms: "+12", "+0.4%" (crit chance), "−3%" (damage taken).
    const part = (k: StatKey, v: number) => (k === 'lck' ? `+${+(v / 10).toFixed(1)}%` : k === 'strike' || k === 'area' ? `−${v}%` : `+${v}`);
    const rows = STAT_KEYS.map((k) => {
      let val = statValue(k, tot[k]);
      if (k === 'strike' || k === 'area') val = statValue(k, ch.damageTaken(k)) + (tot[k] >= cap ? ' (cap)' : '');
      const magB = own[k] - base[k];
      const gearB = tot[k] - own[k];
      const bonus = [magB ? `${part(k, magB)} Mag` : '', gearB ? `${part(k, gearB)} gear` : ''].filter(Boolean).join(' ');
      // Live numbers where the stat feeds more than one thing (same terms Combat uses).
      const note = k === 'mst' ? `Foie ${Math.round(ch.techDamage('foie'))}, Resta +${restaHeal(tot.mst)} HP` : '';
      return `<tr class="stat-row"><td>${STAT_LABEL[k]}</td><td>${val}</td><td class="dim">${bonus ? `(${bonus})` : ''}</td></tr>${
        note ? `<tr class="stat-note"><td colspan="3">${esc(note)}</td></tr>` : ''}`;
    }).join('') + this.critRows() + this.hasteRows();
    const w = ch.weaponInstance();
    const eq = GEAR_SLOTS
      .map((s) => {
        const it = ch.equippedItem(s);
        return `<tr><td>${SLOT_LABEL[s]}</td><td>${it ? esc(itemName(it)) : '<span class="dim">—</span>'}</td></tr>`;
      })
      .join('');
    const st = ch.data.stats;
    return `<div class="split"><div class="detail">
        <div class="detail-title">${esc(ch.data.name)} — Lv.${ch.level}</div>
        <div class="dim">${ch.maxed ? 'Level cap reached: the chase is gear now.' : `EXP ${ch.data.xp} / ${ch.xpToNext()} to next level`}</div>
        <span class="ms-bar xp-bar"><i style="width:${ch.maxed ? 100 : Math.min(100, (100 * ch.data.xp) / Math.max(1, ch.xpToNext()))}%"></i></span>
        <table class="stats">${rows}</table>${this.otherStatsHtml()}</div>
      <div class="detail">${this.growthHtml()}<div class="detail-title">Equipment</div><table class="stats">${eq}</table>
        ${w ? itemCardHtml(ch, w, this.api.damageFoe()) : ''}
        <div class="detail-title" style="margin-top:12px">Record</div>
        <div class="dim">Kills ${st.kills} · Deaths ${st.deaths} · Dragons slain ${st.bossKills.dragon ?? 0}</div></div></div>${this.foot()}`;
  }

  /**
   * Everything else the gear and passives add up to, grouped: movement, defence, offence, sustain. Same terms the game
   * uses (passives and caps counted); rows that can't apply to this character and are zero are left out.
   */
  private otherStatsHtml(): string {
    const ch = this.ch;
    const a = (id: Parameters<Character['gearAffix']>[0]) => ch.gearAffix(id);
    type Row = { label: string; value: string; zero: boolean; tip?: string; show?: boolean };
    const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
    const row = (label: string, v: number, text: string, tip?: string, show = true): Row => ({ label, value: text, zero: !v, tip, show });

    // Movement: the permanent part (Rush's burst isn't counted), capped like the game caps it.
    const runK = Math.min(1 + AFFIX_CAPS.walk, ch.pMult('lightFeet', passiveCfg.lightFeetRunMult) * (1 + a('walk') / 100));
    const dashK = ch.pMult('lightFeet', passiveCfg.lightFeetDashMult) * (1 + a('dashRecharge') / 100);
    const charges = dashCfg.charges + (ch.hasPassive('fleet') ? passiveCfg.fleetCharges : 0);
    const move: Row[] = [
      row('Run speed', runK - 1, `${pct((runK - 1) * 100)}${runK >= 1 + AFFIX_CAPS.walk ? ' (cap)' : ''}`, `Gear and Light Feet, +${AFFIX_CAPS.walk * 100}% at most in all.`),
      row('Dash charges', charges, String(charges)),
      row('Dash recharge', dashK - 1, pct((dashK - 1) * 100), 'How much faster spent dashes come back (gear and Light Feet).'),
    ];
    const res = (id: 'resPoison' | 'resPara' | 'resBurn' | 'resCorrupt', label: string) => {
      const v = ch.resist(id);
      return row(label, v, `${v}%${v >= AFFIX_CAPS.resist ? ' (cap)' : ''}`, `Shortens or weakens it; ${AFFIX_CAPS.resist}% at most.`);
    };
    const defence: Row[] = [
      res('resPoison', 'Poison resistance'),
      res('resPara', 'Paralysis resistance'),
      res('resBurn', 'Burn resistance'),
      res('resCorrupt', 'Corruption resistance'),
      row('Knockback', a('stability'), a('stability') ? `−${a('stability')}%` : '0%', 'Barrier affix (Stability).'),
      row('HP regen', a('regen'), `${a('regen')} / s`, 'Mending: HP back every second, in fights too.'),
    ];
    const offence: Row[] = [
      row('Tech damage', a('techPct') + a('brittle'), pct(a('techPct') + a('brittle')), 'Tech damage % affixes (Brittle counts).'),
      row('Fire damage', a('firePct'), pct(a('firePct'))),
      row('Lightning damage', a('lightningPct'), pct(a('lightningPct'))),
      row('Ice damage', a('icePct'), pct(a('icePct'))),
      row('Technique TP cost', a('tpCost'), a('tpCost') ? `−${a('tpCost')}%` : '0%'),
      row('TP regen', a('tpRegen'), `${a('tpRegen')} / s`, 'Spring: TP back every second, in fights too.'),
    ];
    const sustain: Row[] = [
      row('Injector potency', a('injPotency'), pct(a('injPotency')), 'Each dose restores this much more.'),
      row('Injector charge', a('injCharge'), pct(a('injCharge')), 'Doses charge this much faster from damage you deal.'),
      row('TP refill', a('tpRefill'), pct(a('tpRefill')), 'Photon bolts refill this much more TP (Flow).'),
    ];
    const group = (title: string, rows: Row[]) =>
      `<div class="ss-group"><div class="ss-head">${title}</div>${rows
        .filter((r) => r.show !== false)
        .map((r) => `<div class="ss-row${r.zero ? ' zero' : ''}"${r.tip ? ` title="${esc(r.tip)}"` : ''}><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`)
        .join('')}</div>`;
    return `<div class="detail-title" style="margin-top:12px">Other stats</div><div class="other-stats">${group('Movement', move)}${group('Defence', defence)}${group('Offence', offence)}${group('Sustain', sustain)}</div>`;
  }

  /** Damage tab: what a slot's picker cycles through: the worn piece first, then bag items that fit the slot. */
  private dmgOptions(slot: 'weapon' | 'frame' | 'barrier'): ItemInstance[] {
    const ch = this.ch;
    const worn = ch.equippedItem(slot);
    const bag = ch.data.inventory.filter((it) => fitsSlot(it, slot) && it.uid !== worn?.uid).sort((a, b) => itemName(a).localeCompare(itemName(b)));
    return worn ? [worn, ...bag] : bag;
  }

  /**
   * The Damage tab: damage per second (per hit until 2026-10-11, when the user asked for per second so Haste shows).
   * The basic chain and each Art on the bar used back to back, against the typical enemy
   * where you are. Pick other gear (weapon, frame, barrier) to compare: the
   * tables then show the numbers now, with the picks, and the change.
   */
  private renderDamage(): string {
    const ch = this.ch;
    const foe = this.api.damageFoe();
    const b = damageBreakdown(ch, foe);
    // The same character wearing the picked pieces (simulateEquip copies, so nothing changes until you equip).
    const slots = ['weapon', 'frame', 'barrier'] as const;
    let sim: Character | null = null;
    for (const slot of slots) {
      const uid = this.dmgPick[slot];
      const inst = uid ? ch.find(uid) : undefined;
      if (inst) sim = simulateEquip(sim ?? ch, inst, slot);
    }
    // Then the units switched on, in the slots of the frame worn (or picked).
    const unitsNow = ch.activeUnits().map((u) => unitKind(u)!);
    const unitsOn = this.dmgUnits ?? unitsNow;
    const unitSlots = (sim ?? ch).unitSlotsOpen;
    if (this.dmgUnits) sim = simulateUnits(sim ?? ch, this.dmgUnits);
    const b2 = sim ? damageBreakdown(sim, foe) : null;
    const n = (v: number) => Math.round(v).toLocaleString();

    // Pickers: ◀ item ▶ per slot.
    const pickers = slots
      .map((slot) => {
        const options = this.dmgOptions(slot);
        const picked = this.dmgPick[slot] ? ch.find(this.dmgPick[slot]!) : ch.equippedItem(slot);
        const worn = !this.dmgPick[slot];
        const check = picked && !worn ? ch.canEquip(picked) : { ok: true };
        const name = picked ? `<span class="row-name${rarityCls(picked)}">${esc(itemName(picked))}</span>` : '<span class="dim">—</span>';
        const tag = worn ? '<span class="dim">worn</span>' : check.ok ? '<span class="dmg-new">picked</span>' : `<span class="verdict locked">${esc(check.reason ?? "can't equip")}</span>`;
        const dis = options.length < 2 ? ' disabled' : '';
        return `<div class="dmg-pick"><span class="dmg-slot">${SLOT_LABEL[slot]}</span>
          <button class="btn small ghost${dis}" data-act="dmgPrev" data-arg="${slot}">◀</button>
          <span class="dmg-item">${name} ${tag}</span>
          <button class="btn small ghost${dis}" data-act="dmgNext" data-arg="${slot}">▶</button>
          <button class="btn small ghost${worn || !check.ok ? ' disabled' : ''}" data-act="dmgEquip" data-arg="${slot}">Equip</button>
          <button class="btn small danger${worn ? ' disabled' : ''}" data-act="dmgDrop" data-arg="${slot}">${this.api.inField ? 'Drop' : 'Discard'}</button></div>`;
      })
      .join('');

    // A rate and the seconds behind it (a whole combo, or one cast in a chain): Haste shows up in both.
    type Rate = { dps: number; secs: number };
    const change = (now: number, then: number) => {
      const d = then / Math.max(1e-9, now) - 1;
      if (Math.abs(d) < 0.0005) return '<td class="dim">—</td>';
      return `<td class="${d > 0 ? 'dmg-up' : 'dmg-down'}">${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%</td>`;
    };
    const row = (label: string, now: Rate, then?: Rate) =>
      then
        ? `<tr><td>${label}</td><td>${n(now.dps)}</td><td><b>${n(then.dps)}</b></td>${change(now.dps, then.dps)}</tr>`
        : `<tr><td>${label}</td><td><b>${n(now.dps)}</b></td><td>${now.secs.toFixed(2)} s</td></tr>`;
    const head = (title: string, unit: string) =>
      b2 ? `<tr><th>${title}</th><th>Now</th><th>Picked</th><th>Change</th></tr>` : `<tr><th>${title}</th><th>Per sec</th><th>${unit}</th></tr>`;

    const kind = ch.weaponKind();
    const kind2 = sim ? sim.weaponKind() : kind;
    const weapon = row(`Basic chain <span class="dim">(photon bolts)</span>`, b.basic, b2?.basic);
    const casts = b.arts
      .map((x) => {
        const x2 = b2?.arts.find((y) => y.id === x.id);
        const what = x.perUse > 0 ? `${n(x.perUse)} a use` : 'no damage';
        const rate = (y: typeof x) => ({ dps: y.sustained, secs: y.secs });
        return row(`${esc(ARTS[x.id].name)} <span class="dim">· ${what} · ${x.tp} TP</span>`, rate(x), x2 && rate(x2));
      })
      .join('') || `<tr><td colspan="3" class="dim">No Arts on your bar (Menu → Arts).</td></tr>`;
    // Units: a chip per learned unit (its affix), lit when switched on; the frame's slots cap how many.
    const unitCap = Math.min(unitSlots, MAG_UNIT_SLOTS);
    const chips = ch.data.units
      .map((u) => {
        const kind = unitKind(u)!;
        const at = unitsOn.indexOf(kind);
        const spare = at >= unitSlots; // on, but the (picked) frame has no slot left for it
        const full = at < 0 && unitsOn.length >= unitCap;
        const why =
          at >= 0 ? (spare ? 'No slot for it in this frame: switch it off' : 'On: click to switch it off')
          : full ? (unitSlots ? `Your frame opens ${unitSlots} unit slot${unitSlots === 1 ? '' : 's'}: switch one off first` : 'Your frame has no unit slots')
          : 'Click to switch it on';
        return `<button class="btn small dmg-chip${at >= 0 ? ' on' : ' ghost'}${spare ? ' spare' : ''}${full ? ' disabled' : ''}" data-act="dmgUnit" data-arg="${kind}" title="${esc(`${itemName(u)}${unitUnique(u) ? `: ${unitLine(u)}` : ''}. ${why}`)}">${esc(unitUnique(u) ? itemName(u) : unitLine(u))}</button>`;
      })
      .join('');
    const unitRow = `<div class="dmg-pick dmg-units"><span class="dmg-slot">Units <span class="dim">${Math.min(unitsOn.length, unitSlots)}/${unitSlots}</span></span>
      <span class="dmg-chips">${chips || '<span class="dim">None learned yet</span>'}</span></div>`;
    const weaponTitle = kind2.label !== kind.label ? `${esc(kind.label)} → ${esc(kind2.label)}` : esc(kind.label);
    const crit = b2 && b2.critChance.toFixed(1) !== b.critChance.toFixed(1) ? `${b.critChance.toFixed(1)}% → ${b2.critChance.toFixed(1)}%` : `${b.critChance.toFixed(1)}%`;
    const haste = b2 && b2.haste !== b.haste ? `${b.haste}% → ${b2.haste}%` : `${b.haste}%`;
    return `<div class="dmg-tab">
      <div class="dmg-head"><span>Against a typical <b>${esc(foe.label)}</b> enemy · tech resist ${foe.techResist}%</span></div>
      <div class="detail dmg-body"><div class="dmg-col">
        <table class="dps dmg-table${b2 ? ' cmp' : ''}">${head(weaponTitle, 'Chain')}${weapon}</table>
        <table class="dps dmg-table${b2 ? ' cmp' : ''}">${head('Arts on your bar', 'Per use')}${casts}</table>
        <div class="dim dmg-note">Damage per second on one target, chained as fast as the chain allows, crits averaged in (crit chance ${crit}, Haste ${haste}).
          An Art's rate is casting it whenever its TP allows, the photon bolts between casts winning the TP back; area Arts hit everything in their area.${b2 ? ' Picks are only compared here until you equip or use them.' : ''}</div></div>
        <div class="dmg-picks"><div class="dmg-picks-head">Compare gear and units</div>${pickers}${unitRow}
          <div class="dmg-picks-foot"><button class="btn small ghost${this.dmgUnits ? '' : ' disabled'}" data-act="dmgUnitsUse" title="Switch these units on in your Mag">Use these units</button>
            <button class="btn small ghost${b2 ? '' : ' disabled'}" data-act="dmgReset">Reset</button></div></div>
      </div></div>${this.foot()}`;
  }

  /** Crit damage for the status table: ×2 plus Crit damage affixes (and the Red Ring). */
  private critRows(): string {
    const ch = this.ch;
    const extra = Math.round((ch.critDamage() - 2) * 100);
    return `<tr class="stat-row"><td>Crit damage</td><td>×${ch.critDamage().toFixed(2).replace(/0$/, '')}</td><td class="dim">${extra ? `(+${extra}% gear)` : ''}</td></tr>`;
  }

  /** Haste for the status table: gear-only, so it isn't a stat, but it needs a home. */
  private hasteRows(): string {
    const ch = this.ch;
    const haste = ch.haste();
    const bolt = Math.round((1 - ch.hasteMult()) * 100);
    const castCut = Math.round((1 - ch.castTimeMult()) * 100);
    const parts = [bolt ? `photon bolts ${bolt}% quicker` : '', haste || castCut ? `techniques ${castCut}% quicker` : ''].filter(Boolean);
    const note = parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : '';
    return `<tr class="stat-row"><td>Haste</td><td>${haste}%</td><td class="dim">${haste ? `(+${haste}% gear)` : ''}</td></tr>${
      note ? `<tr class="stat-note"><td colspan="3">${esc(note)}</td></tr>` : ''}`;
  }

  /** What every level adds. */
  private growthHtml(): string {
    return `<div class="detail-title">Growth</div><div class="dim attr-note">Per level: ${gainsText(STAT_KEYS.map((k) => [k, GROWTH[k]]))}.</div>`;
  }

  /** Mag: two tracks, a point a level into one of them (permanent), and its units. */
  private renderMag(): string {
    const ch = this.ch;
    const m = ch.mag;
    const form = magForm(m);
    const free = ch.magPoints;
    const foe = this.api.damageFoe();
    const rows = MAG_STATS.map((st) => {
      // What the next point is worth now, so the choice can be weighed (DEF: no damage figure).
      const v = magPointValue(ch, st, foe);
      const worth = v === null ? '' : `<span class="mag-worth" title="Damage per second against ${esc(foe.label)} with what you have equipped now">Next point: damage +${v.toFixed(1)}%</span>`;
      const gains = Object.entries(MAG_BONUS[st]) as [StatKey, number][];
      const text = (n: number) => gainsText(gains.map(([k, v]) => [k, Math.floor(n * v + 1e-6)]));
      const each = gainsText(gains);
      const add = (n: number) => `<button class="btn small attr-add${free >= n ? '' : ' disabled'}" data-act="magAdd" data-arg="${st}:${n}" title="+${n} points (each: ${each}). Permanent.">+${n}</button>`;
      return `<div class="attr-row mag-row a-${st}"><span class="attr-name">${MAG_STAT_LABEL[st]}</span><b class="attr-val">${m[st]}</b>
        <span class="attr-gain">${m[st] ? text(m[st]) : ''} <span class="dim">· each: ${each}</span>${worth}</span>
        <span class="mag-btns">${add(1)}${add(5)}</span></div>`;
    }).join('');
    const lv = magLevel(m);
    const next = MAG_EVOLVE_AT.find((n) => n > lv);
    return `<div class="split"><div class="detail">
        <div class="mag-head"><span class="mag-name" style="color:#${form.color.toString(16).padStart(6, '0')}">${esc(form.name)}</span>
          <span class="dim">Lv.${lv}${next ? ` · evolves at Lv.${next}` : ' · final form'}</span></div>
        <div class="mag-points"><b>${free}</b> point${free === 1 ? '' : 's'} to spend</div>
        <div class="attr-list">${rows}</div>
        <div class="dim mag-note">One point per character level, into one track. Every point is permanent: the Mag is your long-term build, while Arts and skills change freely out of a fight. Its form follows the track with the most points.</div>
        ${this.photonBlastHtml()}</div>
      <div class="detail">${this.unitsHtml()}</div></div>${this.foot()}`;
  }

  /** The Mag's photon blast: picked here once the Mag teaches them. */
  private photonBlastHtml(): string {
    const ch = this.ch;
    if (ch.level < magCfg.pbLevel) return `<div class="detail-title" style="margin-top:12px">Photon blast</div><div class="dim">The Mag teaches photon blasts at Lv ${magCfg.pbLevel}.</div>`;
    const opts = (Object.keys(PHOTON_BLASTS) as PhotonBlastId[])
      .map((id) => {
        const picked = ch.data.photonBlast === id;
        return `<div class="tl-opt role-offence open${picked ? ' picked' : ''}" data-act="pbPick" data-arg="${id}"><div class="tl-name">${esc(PHOTON_BLASTS[id].name)}</div><div class="tl-desc">${esc(PHOTON_BLASTS[id].desc())}</div></div>`;
      })
      .join('');
    return `<div class="detail-title" style="margin-top:12px">Photon blast</div><div class="dim">Fills from your damage and fires by itself when full, in a fight.</div><div class="tl-rows">${opts}</div>`;
  }

  /**
   * Skills (2026-10-15, Diablo 2 style): the trees, one at a time. Each is a grid of square icons: Arts with
   * their modifiers forking below them (a lane down the left), passives in two columns on the right, joined by
   * right-angled lines to what they hang from. Names show on hover and in the details pane.
   */
  private renderSkills(): string {
    const ch = this.ch;
    const s = ch.data.skills;
    const sel = (this.skillSel && skillNode(this.skillSel)) || null;
    const trees = SKILL_TREES;
    const tree = trees.find((t) => t.id === (sel?.tree ?? this.skillTree)) ?? trees[0];
    const tabs = trees
      .map((t) => {
        const spent = treeSpent(s, t.id);
        return `<button class="btn small${t === tree ? '' : ' ghost'}" data-act="skillTree" data-arg="${t.id}">${esc(t.name)}${spent ? ` <span class="sk-spent">${spent}</span>` : ''}</button>`;
      })
      .join('');
    const nodes = skillNodes().filter((n) => n.tree === tree.id);
    const lanes = tree.lanes.length;
    const laneW = SK_SPINE + LANE_COLS * SK_PX;
    const colX = (c: number) => (c < lanes * LANE_COLS ? SK_PAD + Math.floor(c / LANE_COLS) * laneW + SK_SPINE + (c % LANE_COLS) * SK_PX : SK_PAD + lanes * laneW + SK_GUTTER + (c - lanes * LANE_COLS) * SK_PX);
    const box = (n: SkillNode) => {
      const x = colX(n.col) + (SK_PX - SK_N) / 2;
      const y = SK_PAD + n.row * SK_PY + (SK_PY - SK_N) / 2;
      return { x, y, r: x + SK_N, b: y + SK_N, cx: x + SK_N / 2, cy: y + SK_N / 2 };
    };
    const width = SK_PAD * 2 + lanes * laneW + SK_GUTTER + (treeCols(tree.id) - lanes * LANE_COLS) * SK_PX;
    const height = SK_PAD * 2 + (Math.max(...nodes.map((n) => n.row)) + 1) * SK_PY;
    const gap = (SK_PY - SK_N) / 2;
    // Each Art and its modifier fork sit on a faint panel of their own.
    const groups = nodes
      .filter((n) => n.kind === 'art')
      .map((n) => {
        const left = colX(n.col - 1) - 4;
        const top = box(n).y - 6;
        return `<rect class="sk-group" x="${left}" y="${top}" width="${LANE_COLS * SK_PX + 8}" height="${3 * SK_PY - 2 * gap + 12}" rx="10"/>`;
      })
      .join('');
    // A second-row modifier's line comes from the first-row pick, once there is one (the fork followed).
    const taken0 = (art: string) => nodes.find((n) => n.art === art && n.modRow === 0 && rankOf(s, n.id) > 0);
    const route = (l: SkillLine): number[][] => {
      const t = box(skillNode(l.to)!);
      const toNode = skillNode(l.to)!;
      const fromNode = (l.kind === 'fork2' && taken0(toNode.art!)) || skillNode(l.from)!;
      const f = box(fromNode);
      switch (l.kind) {
        case 'spine': {
          const x = SK_PAD + Math.floor(toNode.col / LANE_COLS) * laneW + SK_SPINE / 2;
          return [[f.x, f.cy], [x, f.cy], [x, t.cy], [t.x, t.cy]];
        }
        case 'branch': {
          const x = SK_PAD + lanes * laneW + SK_GUTTER / 2;
          return [[f.r, f.cy], [x, f.cy], [x, t.cy], [t.x, t.cy]];
        }
        default: {
          const bus = f.b + gap;
          return f.cx === t.cx ? [[f.cx, f.b], [t.cx, t.y]] : [[f.cx, f.b], [f.cx, bus], [t.cx, bus], [t.cx, t.y]];
        }
      }
    };
    const paths = treeLines(tree.id).map((l) => ({ on: rankOf(s, l.to) > 0, d: `M${route(l).map((p) => p.join(' ')).join(' L')}` }));
    // Unlit lines first, so lit ones run on top.
    const lines = [...paths.filter((p) => !p.on), ...paths.filter((p) => p.on)].map((p) => `<path class="${p.on ? 'on' : ''}" d="${p.d}"/>`).join('');
    const body = nodes.map((n) => this.skillNodeHtml(n, n === sel, box(n))).join('');
    const grid = `<div class="sk-grid" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${groups}${lines}</svg>${body}</div>`;
    return `<div class="tl-intro dim">Skill points: <b class="sk-pts">${ch.skillPointsLeft}</b> of ${ch.skillPoints} left (one a level).
        An Art's first rank learns it; each rank after adds power and takes off TP. Its modifiers fork below it: one of three per row, a point each, the first row at rank ${modRowRank(0)}, the second at rank ${modRowRank(1)}.
        Passives take up to five ranks. A skill needs a point in the one it hangs from. Points come back for free out of a fight.</div>
      <div class="sk-tabs">${tabs}</div>
      <div class="sk-wrap"><div class="sk-tree" data-scroll="skills:${tree.id}">${grid}</div>
      <div class="detail sk-detail">${sel ? this.skillDetail(sel) : '<div class="dim">Click a skill to see it.</div>'}</div></div>${this.foot()}`;
  }

  /** A skill's icon: an Art's own glyph, a passive's or modifier's symbol. */
  private skillIco(n: SkillNode): string {
    if (n.kind === 'art') return artIco(n.id as ArtId);
    if (n.kind === 'mod') return modIcon(n.art!, n.mod!);
    return passiveIcon(n.id as PassiveId);
  }

  /** One skill on its tree: a square icon, its rank in the corner, its state in its frame. */
  private skillNodeHtml(n: SkillNode, selected: boolean, b: { x: number; y: number }): string {
    const ch = this.ch;
    const s = ch.data.skills;
    const r = rankOf(s, n.id);
    const block = rankUpBlock(ch.level, s, n);
    // Three looks: learned (frame and fill in its colour), in reach (its colour as the frame only: points could get it
    // at this level, whatever else it waits on first), and out of reach for now (faded far back: a level stands in the
    // way, here or up the nodes it hangs from).
    const reach = !r && skillReachable(ch.level, n);
    const lock = !r && !reach;
    const role = n.kind === 'passive' ? PASSIVES[n.id as PassiveId].role : n.kind;
    const idle = n.kind === 'passive' && r > 0 && !ch.hasPassive(n.id as PassiveId);
    const badge = n.kind !== 'mod' && r ? `<span class="sk-badge">${r}</span>` : '';
    const tip = `${skillName(n)}${n.kind === 'mod' ? '' : ` (${r}/${n.max})`}${block && !r ? ` · ${block}` : ''}`;
    const cls = `sk-node sk-${n.kind} role-${role}${r ? ' has' : ''}${r >= n.max ? ' max' : ''}${reach ? ' reach' : ''}${!block ? ' open' : ''}${lock ? ' locked' : ''}${idle ? ' idle' : ''}${selected ? ' sel' : ''}`;
    return `<div class="${cls}" style="left:${b.x}px;top:${b.y}px;width:${SK_N}px;height:${SK_N}px" data-act="skillSel" data-arg="${n.id}" title="${esc(tip)}"><span class="sk-ico">${this.skillIco(n)}</span>${badge}</div>`;
  }

  /** The details pane's head: the skill's icon beside its name (the loudest thing in the pane) and what kind it is. */
  private skillCard(n: SkillNode, name: string, kind: string): string {
    return `<div class="sk-card"><span class="sk-card-ico sk-${n.kind}">${this.skillIco(n)}</span><div><div class="sk-title">${esc(name)}</div><div class="sk-kind">${esc(kind)}</div></div></div>`;
  }

  /**
   * The picked skill, loudest first (the user's order, 2026-10-15): its name, what it does in words, the technical
   * numbers (small chips), what it needs and its rank, and last the buttons that put points in or take them out.
   */
  private skillDetail(n: SkillNode): string {
    const ch = this.ch;
    const s = ch.data.skills;
    const r = rankOf(s, n.id);
    const up = rankUpBlock(ch.level, s, n);
    const tree = SKILL_TREES.find((t) => t.id === n.tree)!.name;
    const chips = (items: string[]) => (items.length ? `<div class="sk-tech">${items.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '');
    const reqs = (items: string[]) => `<div class="sk-req">${items.filter(Boolean).join(' · ')}</div>${up && r < n.max ? `<div class="sk-why">${esc(up)}</div>` : ''}`;
    const pre = n.pre ? `needs ${esc(skillName(skillNode(n.pre)!))}` : '';
    const rank = `Rank <b>${r}</b> / ${n.max}`;
    const rankBtns = `<div class="sk-btns"><button class="btn small" data-act="skillUp" data-arg="${n.id}">+1 rank</button><button class="btn small ghost" data-act="skillMax" data-arg="${n.id}">Max</button><button class="btn small ghost" data-act="skillDown" data-arg="${n.id}">−1 rank</button></div>`;
    if (n.kind === 'mod') {
      const a = ARTS[n.art!];
      const m = a.mods[n.modRow!].find((x) => x.id === n.mod)!;
      const btn = r
        ? `<button class="btn small ghost" data-act="skillDown" data-arg="${n.id}">Take back</button>`
        : `<button class="btn small" data-act="skillUp" data-arg="${n.id}">Take (1 point)</button>`;
      return `${this.skillCard(n, m.name, `Modifier of ${a.name}`)}<div class="sk-desc">${esc(m.desc)}</div>
        ${reqs([r ? '<b>Taken</b>' : 'Not taken', `needs ${esc(a.name)} at rank ${modRowRank(n.modRow!)}`, n.modRow ? 'and a first-row modifier' : ''])}
        <div class="sk-btns">${btn}</div>`;
    }
    if (n.kind === 'passive') {
      const d = PASSIVES[n.id as PassiveId];
      const k = (x: number) => x / n.max;
      const fits = weaponFits(n.id as PassiveId, !!ch.weaponInstance());
      const scale = r && r < n.max ? [`Next rank: ${d.desc(k(r + 1))}`] : !r && n.max > 1 ? [`At rank ${n.max}: ${d.desc(1)}`] : [];
      const need = d.needsWeapon ? `<span class="${fits ? '' : 'sk-off'}">${esc(needText(n.id as PassiveId))}${fits ? '' : ' (inactive now)'}</span>` : '';
      return `${this.skillCard(n, d.name, `Passive · ${tree}`)}<div class="sk-desc">${esc(d.desc(k(Math.max(1, r))))}</div>
        ${scale.length ? `<div class="sk-tech-line">${esc(scale[0])}</div>` : ''}
        ${reqs([rank, `Lv ${n.level}`, pre, need])}${rankBtns}`;
    }
    const id = n.id as ArtId;
    const a = ARTS[id];
    const pow = (x: number) => Math.round(skillCfg.artBasePower * (1 + skillCfg.artPowerPerRank * (x - 1)) * 100);
    const tp = (x: number) => Math.round(skillCfg.artTpPerRank * (x - 1) * 100);
    const t = ch.artTiming(id);
    const tech = [
      ROLE_LABEL[a.role],
      `${ch.artCost(id)} TP`,
      `${(t.windup + t.active + t.recovery).toFixed(2)} s`,
      `power ${pow(Math.max(1, r))}%`,
      tp(Math.max(1, r)) ? `TP −${tp(Math.max(1, r))}%` : '',
    ].filter(Boolean);
    const next = r && r < n.max ? `next rank: power ${pow(r + 1)}%, TP −${tp(r + 1)}%` : '';
    return `${this.skillCard(n, a.name, `Art · ${tree}`)}<div class="sk-desc">${esc(a.desc)}</div>${chips(tech)}
      ${reqs([rank, next, `Lv ${n.level}`, pre])}${rankBtns}`;
  }

  /**
   * The Mag's units: learned units slotted in priority order, the first N active where N is the equipped frame's
   * unit slots. Reorder with ▲ ▼, take one out, or slot another learned one.
   */
  private unitsHtml(): string {
    const ch = this.ch;
    const units = ch.slottedUnits();
    const open = ch.unitSlotsOpen;
    const rows = Array.from({ length: MAG_UNIT_SLOTS }, (_, i) => {
      const u = units[i];
      const active = i < open;
      const tag = `<span class="unit-tag ${active ? 'on' : 'off'}">${active ? 'Active' : 'Inactive'}</span>`;
      if (!u) return `<div class="unit-slot empty dim">${tag}— empty —</div>`;
      // Order only matters when the frame switches some units off: then it decides which stay active.
      const order = units.length > open;
      const up = order && i > 0 ? `<button class="btn small ghost" data-act="unitMove" data-arg="${i}:-1" title="Move up (the first ones are active)">▲</button>` : '';
      const down = order && i < units.length - 1 ? `<button class="btn small ghost" data-act="unitMove" data-arg="${i}:1" title="Move down">▼</button>` : '';
      return `<div class="unit-slot${active ? '' : ' inactive'}">${tag}${glyph(u)}<span class="row-name${rarityCls(u)}" title="${esc(`${itemName(u)}: ${unitLine(u)}`)}">${esc(itemName(u))}: ${esc(unitLine(u))}</span>${up}${down}<button class="btn small ghost" data-act="unitOut" data-arg="${i}">Remove</button></div>`;
    }).join('');
    // Learned units not in the Mag: click one to slot it.
    // Best on top: rares (the downside units) first, then by item level.
    const rank = (u: ItemInstance) => (unitUnique(u) ? 2000 : rarityOf(u) === 'rare' ? 1000 : 0) + ('tier' in getDef(u.id) ? (getDef(u.id) as { tier: number }).tier : 0);
    const spare = ch.data.units.filter((u) => !units.includes(u)).sort((a, b) => rank(b) - rank(a));
    const full = units.length >= MAG_UNIT_SLOTS;
    const uniques = ch.data.units.filter((u) => unitUnique(u)).length;
    const plain = ch.data.units.length - uniques;
    const learned = `<div class="list-group">Learned units (${plain} of ${UNIT_KINDS.length} kinds${uniques ? ` · ${uniques} unique` : ''})${spare.length && !full ? ': click one to slot it' : ''}</div>`;
    const pick = spare.length
      ? `${learned}<div class="list short">${spare
          .map((u) => `<div class="row${rarityCls(u)}${full ? ' dim' : ''}"${full ? '' : ` data-act="unitIn" data-arg="${unitKind(u)}"`}>${glyph(u)}<span class="row-name${rarityCls(u)}" title="${esc(`${itemName(u)}: ${unitLine(u)}`)}">${esc(itemName(u))}: ${esc(unitLine(u))}</span></div>`)
          .join('')}</div>${full ? '<div class="dim units-note">The Mag is full: remove a unit to slot another.</div>' : ''}`
      : `${learned}<div class="dim units-note">${ch.data.units.length ? 'Every learned unit is in the Mag.' : 'None yet.'} Picking up a unit learns it for good; a better roll of one you know replaces it.</div>`;
    const frame = open ? `Your frame opens <b>${open}</b> unit slot${open === 1 ? '' : 's'}: the first ${open} unit${open === 1 ? ' is' : 's are'} active.` : 'Your frame has <b>no</b> unit slots: units stay inactive until you wear one that does.';
    const choose = units.length > open && open > 0 ? ' Use ▲ ▼ to choose which.' : '';
    return `<div class="units"><div class="detail-title">Units</div><div class="dim units-note">${frame}${choose}</div>${rows}${pick}</div>`;
  }

  /**
   * Arts: the bar (RMB, Q, E, R), every Art that can go on it (and the ones still to come), and the picked Art's
   * details and modifiers. Click a slot, then an Art, to put it there; changes wait for the end of a fight.
   */
  private renderArts(): string {
    const ch = this.ch;
    const bar = ch.artBar();
    const slots = bar
      .map((id, i) => {
        const on = this.artSlotSel === i;
        const name = id ? `<span class="art-ico">${artIco(id)}</span>${esc(ARTS[id].name)}` : '<span class="dim">— empty —</span>';
        const clear = id ? ` <button class="btn small ghost" data-act="artClear" data-arg="${i}">✕</button>` : '';
        return `<div class="pal-slot art-bar-slot${on ? ' sel' : ''}" data-act="artSlot" data-arg="${i}"><div class="slot-key">${ART_KEYS[i]}</div>${name}${clear}</div>`;
      })
      .join('');
    // What can go on the bar; the ones still to come greyed.
    const known = ch.artsFor();
    const later = ART_IDS.filter((id) => !known.includes(id)).sort((a, b) => ARTS[a].level - ARTS[b].level);
    const sel = this.artSel ?? (this.artSlotSel !== null ? bar[this.artSlotSel] : null) ?? bar.find((x) => x) ?? known[0] ?? null;
    const line = (id: ArtId, locked: boolean) => {
      const a = ARTS[id];
      const tags = locked ? (ch.level >= a.level ? 'learn in Skills' : `Lv ${a.level}`) : `${ch.artCost(id)} TP`;
      const on = bar.includes(id);
      return `<div class="row${sel === id ? ' sel' : ''}${locked ? ' dim' : ''}" data-act="artPick" data-arg="${id}"><span class="art-ico">${artIco(id)}</span><span class="row-name">${esc(a.name)}${on ? ' <span class="dim">· on the bar</span>' : ''}</span><span class="price">${tags}</span></div>`;
    };
    const list = `${known.map((id) => line(id, false)).join('')}${later.length ? `<div class="list-group">Not learned yet</div>${later.map((id) => line(id, true)).join('')}` : ''}`;
    return `<div class="detail"><div class="tl-intro dim">LMB is your basic chain of photon bolts: it refills TP. The Arts on RMB, Q, E and R spend it; an Art pressed in the chain's window becomes its next step and gets the perfect streak.
        Click a slot, then an Art, to put it there. Changes wait for the end of a fight.</div>
      <div class="pal-row">${slots}</div></div>
      <div class="split"><div class="list">${list || '<div class="dim empty-note">No Arts yet.</div>'}</div><div class="detail">${sel ? this.artDetail(sel) : ''}</div></div>${this.foot()}`;
  }

  /** One Art: what it does, its numbers now, its rank and its two modifier rows (both set in Skills). */
  private artDetail(id: ArtId): string {
    const ch = this.ch;
    const a = ARTS[id];
    const r = ch.artRank(id);
    const t = ch.artTiming(id);
    const facts = [
      ROLE_LABEL[a.role],
      r ? `rank ${r}` : ch.level >= a.level ? 'not learned' : `opens at Lv ${a.level}`,
      r ? `${ch.artCost(id)} TP` : '',
      `${(t.windup + t.active + t.recovery).toFixed(2)} s`,
    ].filter(Boolean);
    const rows = ([0, 1] as const)
      .map((row) => {
        const need = modRowRank(row);
        const picked = a.mods[row].find((m) => rankOf(ch.data.skills, modNodeId(id, m.id)) > 0)?.id ?? null;
        const opts = a.mods[row]
          .map((m) => `<div class="tl-opt role-utility${picked === m.id ? ' picked' : ''}"><div class="tl-name">${esc(m.name)}</div><div class="tl-desc">${esc(m.desc)}</div></div>`)
          .join('');
        return `<div class="tl-row${picked ? '' : ' locked'}"><div class="tl-head"><b>Rank ${need}</b><span>${picked ? 'picked' : r >= need ? 'pick one' : 'not yet'}</span></div>${opts}</div>`;
      })
      .join('');
    const go = `<button class="btn small" data-act="skillGo" data-arg="${id}">${r ? 'Ranks and modifiers in Skills' : 'Learn in Skills'}</button>`;
    return `<div class="detail-title"><span class="art-ico">${artIco(id)}</span>${esc(a.name)}</div>
      <div class="dim">${esc(facts.join(' · '))}</div><div class="art-desc">${esc(a.desc)}</div>${go}
      <div class="detail-title" style="margin-top:10px">Modifiers</div><div class="tl-rows">${rows}</div>`;
  }
  private fail(err: string | null): void {
    if (err) this.api.notify(err, 'warn');
  }

  onAction(act: string, arg: string): void {
    switch (act) {
      case 'slot':
        this.slot = arg as GearSlot;
        this.sel = null;
        break;
      case 'dmgPrev':
      case 'dmgNext': {
        // Cycle a slot's pick through the worn piece and every bag item that fits the slot.
        const slot = arg as 'weapon' | 'frame' | 'barrier';
        const options = this.dmgOptions(slot);
        const at = Math.max(0, options.findIndex((o) => o.uid === (this.dmgPick[slot] ?? this.ch.equippedItem(slot)?.uid)));
        const next = options[(at + (act === 'dmgNext' ? 1 : options.length - 1)) % options.length];
        if (!next || next.uid === this.ch.equippedItem(slot)?.uid) delete this.dmgPick[slot];
        else this.dmgPick[slot] = next.uid;
        break;
      }
      case 'dmgEquip': {
        // Wear the picked piece; it becomes the worn one, so the slot's pick is spent.
        const slot = arg as 'weapon' | 'frame' | 'barrier';
        const uid = this.dmgPick[slot];
        if (!uid) break;
        const err = this.api.equipItem(uid);
        this.fail(err);
        if (!err) delete this.dmgPick[slot];
        break;
      }
      case 'dmgDrop': {
        // Out of the bag: the slot goes back to comparing the worn piece.
        const slot = arg as 'weapon' | 'frame' | 'barrier';
        const uid = this.dmgPick[slot];
        if (!uid) break;
        this.api.discardItem(uid);
        delete this.dmgPick[slot];
        break;
      }
      case 'dmgReset':
        this.dmgPick = {};
        this.dmgUnits = null;
        break;
      case 'dmgUnit': {
        // Switch a unit on or off in the comparison; back to the Mag's own set, it's no pick at all.
        const kind = arg as UnitKind;
        const now = this.ch.activeUnits().map((u) => unitKind(u)!);
        const set = [...(this.dmgUnits ?? now)];
        const i = set.indexOf(kind);
        if (i >= 0) set.splice(i, 1);
        else set.push(kind);
        this.dmgUnits = set.length === now.length && set.every((k) => now.includes(k)) ? null : set;
        break;
      }
      case 'dmgUnitsUse': {
        if (!this.dmgUnits) break;
        const err = this.api.unitSet(this.dmgUnits);
        this.fail(err);
        if (!err) this.dmgUnits = null;
        break;
      }
      case 'tab':
        this.tab = arg as InvTab;
        this.sel = null;
        this.crafting = null;
        this.craftTarget = null;
        this.swapFrom = null;
        this.artSlotSel = null;
        this.artSel = null;
        this.skillSel = null;
        break;
      case 'close':
        this.api.closeMenu();
        break;
      case 'quit':
        this.api.quitToTitle();
        break;
      case 'select':
        this.sel = arg;
        // Picking another item leaves the craft flow (it would otherwise keep going with the old grinder or photon).
        this.crafting = null;
        this.craftTarget = null;
        this.swapFrom = null;
        break;
      case 'equip':
        this.fail(this.api.equipItem(arg));
        break;
      case 'use':
        this.fail(this.api.useItem(arg));
        break;
      case 'unequip':
        this.api.unequipItem(arg);
        break;
      case 'magAdd': {
        const [st, n] = arg.split(':');
        this.fail(this.api.magSpend(st as MagStat, Number(n)));
        break;
      }
      case 'skillSel':
        this.skillSel = arg;
        break;
      case 'skillTree':
        this.skillTree = arg;
        this.skillSel = null;
        break;
      case 'skillGo':
        this.tab = 'skills';
        this.skillSel = arg;
        this.skillTree = treeOf(arg)?.id ?? null;
        break;
      case 'skillUp':
        this.fail(this.api.skillRank(arg, 1));
        break;
      case 'skillMax':
        this.fail(this.api.skillRank(arg, 99));
        break;
      case 'skillDown':
        this.fail(this.api.skillRank(arg, -1));
        break;
      case 'artSlot':
        this.artSlotSel = Number(arg);
        this.artSel = this.ch.artBar()[this.artSlotSel] ?? null;
        break;
      case 'artPick': {
        const id = arg as ArtId;
        this.artSel = id;
        if (this.artSlotSel === null) break;
        if (!this.ch.artUsable(id)) {
          this.fail(this.ch.level < ARTS[id].level ? `${ARTS[id].name} opens at Lv ${ARTS[id].level}` : `Learn ${ARTS[id].name} in Skills first`);
          break;
        }
        this.fail(this.api.artSlot(this.artSlotSel, id));
        this.artSlotSel = null;
        break;
      }
      case 'artClear':
        this.fail(this.api.artSlot(Number(arg), null));
        this.artSlotSel = null;
        break;
      case 'pbPick':
        this.fail(this.api.photonBlastPick(arg as PhotonBlastId));
        break;
      case 'unitIn':
        this.fail(this.api.unitInsert(arg as UnitKind));
        break;
      case 'unitOut':
        this.fail(this.api.unitRemove(Number(arg)));
        break;
      case 'unitMove': {
        const [i, dir] = arg.split(':').map(Number);
        this.fail(this.api.unitMove(i, dir));
        break;
      }
      case 'discard':
        this.api.discardItem(arg);
        this.sel = null;
        break;
      case 'craft':
        this.crafting = arg;
        break;
      case 'craftTarget':
        if (this.crafting) this.craftTarget = arg;
        this.swapFrom = null;
        break;
      case 'swapFrom':
        this.swapFrom = Number(arg);
        break;
      case 'swapBack':
        this.swapFrom = null;
        break;
      case 'craftApply':
        if (this.crafting && this.craftTarget) {
          const err = this.api.craftItem(this.craftTarget, this.crafting, arg);
          this.fail(err);
          if (!err) this.swapFrom = null;
          // Stay on the picker while the stack lasts, so several can be spent on one item in a row.
          if (!err && !this.ch.find(this.crafting)) {
            this.sel = null;
            this.crafting = null;
            this.craftTarget = null;
          }
        }
        break;
      case 'craftBack':
        this.craftTarget = null;
        this.swapFrom = null;
        break;
      case 'cancelCraft':
        this.crafting = null;
        this.craftTarget = null;
        this.swapFrom = null;
        break;
    }
  }
}

// -------------------------------------------------------------------- shop

export class ShopMenu implements Menu {
  cls = 'wide';
  closable = true;
  private mode: 'buy' | 'sell' = 'buy';
  private sel: number | string | null = null;

  constructor(
    private api: GameApi,
    private kind: ShopKind,
    private stock: ItemInstance[],
  ) {}

  private get title(): string {
    return { weapon: 'Weapon Shop', armor: 'Armor Shop', item: 'Item Shop' }[this.kind];
  }

  render(): string {
    const ch = this.api.char;
    const tabs = `<button class="tab${this.mode === 'buy' ? ' on' : ''}" data-act="mode" data-arg="buy">Buy</button>
      <button class="tab${this.mode === 'sell' ? ' on' : ''}" data-act="mode" data-arg="sell">Sell</button>`;
    const junk =
      this.mode === 'sell'
        ? '<button class="btn small" data-act="salvageJunk" title="Breaks the magic and rare gear in the bag that is worse than what you wear into Photon Drops: one from each rare, sometimes one from a magic item (uniques stay)">Salvage junk</button>' +
          '<button class="btn small" data-act="sellJunk" title="Sells every piece of gear in the bag that is worse than what you wear, and units you have already learned (uniques stay)">Sell all junk</button>'
        : '';
    let list = '';
    let detail = '<div class="dim">Select an item.</div>';
    if (this.mode === 'buy') {
      list = this.stock
        .map((it, i) => {
          const def = getDef(it.id);
          const price = buyPrice(it);
          const ok = ch.data.meseta >= price;
          return `<div class="row ${def.type}${rarityCls(it)}${this.sel === i ? ' sel' : ''}${ok ? '' : ' dimmed'}" data-act="select" data-arg="${i}">${glyph(it)}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it, this.api.damageFoe())}<span class="price">${price} M</span></div>`;
        })
        .join('');
      if (typeof this.sel === 'number' && this.stock[this.sel]) {
        const it = this.stock[this.sel];
        const price = buyPrice(it);
        const stackable = it.qty !== undefined;
        detail = `${itemCardHtml(ch, it, this.api.damageFoe())}
          <div class="choices inline"><button class="btn primary${ch.data.meseta >= price ? '' : ' disabled'}" data-act="buy" data-arg="1">Buy (${price} M)</button>
          ${stackable ? `<button class="btn${ch.data.meseta >= price * 5 ? '' : ' disabled'}" data-act="buy" data-arg="5">Buy 5 (${price * 5} M)</button>` : ''}</div>`;
      }
    } else {
      const row = (it: ItemInstance) => {
        const eq = ch.isEquipped(it.uid);
        return `<div class="row ${getDef(it.id).type}${rarityCls(it)}${this.sel === it.uid ? ' sel' : ''}${eq ? ' dimmed' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}${eq ? '<span class="eq">E</span>' : ''}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it, this.api.damageFoe())}<span class="price">${sellPrice(it)} M</span></div>`;
      };
      const [gear, rest] = this.sellGroups();
      list = (gear.length ? `<div class="list-group">Equipment</div>${gear.map(row).join('')}` : '') + (rest.length ? `<div class="list-group">Items</div>${rest.map(row).join('')}` : '');
      const it = typeof this.sel === 'string' ? ch.find(this.sel) : undefined;
      if (it) {
        const eq = ch.isEquipped(it.uid);
        detail = `${itemCardHtml(ch, it, this.api.damageFoe())}
          <div class="choices inline"><button class="btn primary${eq ? ' disabled' : ''}" data-act="sell" data-arg="${it.uid}">${eq ? 'Equipped' : `Sell (${sellPrice(it)} M)`}</button></div>`;
      }
    }
    return `<div class="win-title">${this.title}</div>
      <div class="menu-head"><div class="tabs">${tabs}</div><span class="head-gap"></span>${junk}<button class="btn small" data-act="close">Leave <kbd>Esc</kbd></button></div>
      <div class="split"><div class="list">${list}</div><div class="detail docked">${detail}</div></div>
      <div class="menu-foot"><span>${ch.bagCount} / ${INVENTORY_SIZE} items</span><span class="meseta">${ch.data.meseta.toLocaleString()} <b>M</b></span></div>`;
  }

  /** The sell list as shown: equipment first, then everything else. */
  private sellGroups(): [ItemInstance[], ItemInstance[]] {
    const inv = this.api.char.data.inventory;
    return [inv.filter((it) => gearSlot(it)), inv.filter((it) => !gearSlot(it))];
  }

  onAction(act: string, arg: string): void {
    switch (act) {
      case 'mode':
        this.mode = arg as 'buy' | 'sell';
        this.sel = null;
        break;
      case 'select':
        this.sel = this.mode === 'buy' ? Number(arg) : arg;
        break;
      case 'buy': {
        if (typeof this.sel !== 'number') break;
        const proto = this.stock[this.sel];
        const n = Number(arg);
        let bought = 0;
        let err: string | null = null;
        for (; bought < n; bought++) {
          err = this.api.buy(proto);
          if (err) break;
        }
        if (bought) this.api.notify(`Bought ${itemName(proto)}${bought > 1 ? ` x${bought}` : ''}.`, 'good');
        if (err) this.api.notify(err, 'warn');
        // Equipment is unique stock; consumables stay available.
        const def = getDef(proto.id);
        if (isGear(def) && bought) {
          this.stock.splice(this.sel, 1);
          this.sel = null;
        }
        break;
      }
      case 'sell': {
        // Keep the cursor where it was: select the next sellable item down the list (or the one above at the end),
        // so several items can be sold in a row.
        const ch = this.api.char;
        const order = this.sellGroups().flat();
        const i = order.findIndex((it) => it.uid === arg);
        const err = this.api.sell(arg);
        if (err) {
          this.api.notify(err, 'warn');
          break;
        }
        const sellable = (it: ItemInstance) => !ch.isEquipped(it.uid) && ch.find(it.uid);
        const next = order.slice(i + 1).find(sellable) ?? order.slice(0, Math.max(0, i)).reverse().find(sellable);
        this.sel = next?.uid ?? null;
        break;
      }
      case 'sellJunk': {
        const err = this.api.sellJunk();
        if (err) this.api.notify(err, 'warn');
        this.sel = null;
        break;
      }
      case 'salvageJunk': {
        const err = this.api.salvageJunk();
        if (err) this.api.notify(err, 'warn');
        this.sel = null;
        break;
      }
      case 'close':
        this.api.closeMenu();
        break;
    }
  }
}
