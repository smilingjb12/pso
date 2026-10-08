import {
  armorStatText, compareEquip, describeItem, edgeLevels, fitsSlot, GEAR_SLOTS, gearSlot, gearVerdict, grindBonus, grindPreview, itemName, itemSpecial,
  sellPrice, simulateEquip, weaponRace, type Character, type GearSlot, type GrindTrack, type ItemInstance,
} from '../game/character';
import { estimateDamage, RACES, type Foe } from '../game/dps';
import { chargeOf, injectorStats } from '../game/injectors';
import {
  ATTRIBUTE_INFO, ATTRIBUTES, STAT_INFO, STAT_KEYS, STAT_LABEL, type AttributeId, type PaletteEdit, type PaletteRow, type QuickAction, type StatKey,
} from '../game/data/stats';
import { ATTR_LABEL, getDef, grindCap, INVENTORY_SIZE, raceCap, specials, weaponKinds } from '../game/data/items';
import { buffPct, isAttackTech, restaHeal, TECH_IDS, techniques } from '../game/data/techniques';
import { buyPrice, type ShopKind } from '../game/loot';
import { attributeCfg, formulas, spellForms, techScaling, telepipeCfg } from '../game/config';
import {
  cellBlocked, CORE_ID, MAG_BONUS, MAG_CELLS, MAG_EVOLVE_AT, MAG_RADIUS, MAG_STAT_LABEL, MAG_STATS, magBonuses, magForm, magLevel,
  PASSIVE_INFO, reqText, type MagCell,
} from '../game/mag';
import { sfx, type SfxId } from '../audio';
import { typeIcon, weaponIcon } from './icons';

// DOM menus. All menus pause the game; the Game owns open/close.

export interface GameApi {
  readonly char: Character;
  readonly inField: boolean;
  /** Show a toast; action methods below return an error to show (or null on success, having toasted it). */
  notify(text: string, kind?: '' | 'good' | 'warn'): void;
  useItem(uid: string): string | null;
  /** Learn Mag grid squares in order (permanent). */
  magLearn(ids: string[]): string | null;
  /** Spend one attribute point (permanent). */
  attrSpend(attr: AttributeId): string | null;
  equipItem(uid: string): string | null;
  unequipItem(uid: string): void;
  discardItem(uid: string): void;
  grindItem(weaponUid: string, grinderUid: string, track: GrindTrack): string | null;
  setPalette(row: number, col: number, edit: PaletteEdit): void;
  buy(inst: ItemInstance): string | null;
  sell(uid: string): string | null;
  /** The enemy weapon damage estimates are measured against (the current expedition's average). */
  damageFoe(): Foe;
  closeMenu(): void;
  quitToTitle(): void;
}

/** Small type glyph for an item row. */
function glyph(it: ItemInstance): string {
  const def = getDef(it.id);
  return `<span class="ico">${def.type === 'weapon' ? weaponIcon(def.kind) : typeIcon(def.type, it.id)}</span>`;
}

/** Menu clicks: the game plays its own sound for these (buy, equip...), or an error. */
const GAME_SOUNDED = new Set(['buy', 'sell', 'equip', 'unequip', 'magCell', 'attr', 'use', 'learn', 'grindTarget']);
const ACT_SOUND: Record<string, SfxId> = {
  pick: 'ui.confirm', load: 'ui.confirm', new: 'ui.confirm', doDelete: 'ui.confirm',
  close: 'ui.cancel', cancelDelete: 'ui.cancel', cancelGrind: 'ui.cancel', quit: 'ui.cancel',
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
    // Preserve list scroll position across re-renders.
    const list = this.panel.querySelector('.list');
    const scroll = list ? list.scrollTop : 0;
    const focused = (document.activeElement as HTMLInputElement | null)?.id;
    this.panel.innerHTML = this.current.render();
    const nl = this.panel.querySelector('.list');
    if (nl) nl.scrollTop = scroll;
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

type InvTab = 'equip' | 'items' | 'mag' | 'status' | 'palette' | 'techs';
const TAB_LABEL: Record<InvTab, string> = { equip: 'Equipment', items: 'Items', mag: 'Mag', status: 'Status', palette: 'Palette', techs: 'Techniques' };
const SLOT_LABEL: Record<GearSlot, string> = { weapon: 'Weapon', frame: 'Frame', barrier: 'Barrier', injector: 'Injector' };

const fmtDelta = (d: number) => `${Math.round(d)}`;

/** Before/after table for equipping `inst` (shops and inventory). */
function compareHtml(ch: Character, inst: ItemInstance): string {
  if (ch.isEquipped(inst.uid)) return '<div class="cmp-note">Currently equipped.</div>';
  const c = compareEquip(ch, inst);
  if (!c) return '';
  // A weapon's race % shows up in its damage table instead.
  const raceLabels = RACES.map((r) => ATTR_LABEL[r]);
  const rows = c.rows
    .filter((r) => c.slot !== 'weapon' || !raceLabels.includes(r.label))
    .map((r) => {
      const cls = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'same';
      const d = r.delta > 0 ? `▲ +${fmtDelta(r.delta)}` : r.delta < 0 ? `▼ ${fmtDelta(r.delta)}` : r.label === 'Special' ? '⇄' : '=';
      return `<tr class="${cls}"><td>${esc(r.label)}</td><td>${esc(r.before)}</td><td class="arrow">▶</td><td>${esc(r.after)}</td><td class="d">${d}</td></tr>`;
    })
    .join('');
  const vs = c.current ? esc(itemName(c.current)) : `no ${SLOT_LABEL[c.slot].toLowerCase()}`;
  return `<div class="cmp"><div class="cmp-head">If equipped <span class="dim">(replaces ${vs})</span></div><table class="cmp-table">${rows}</table></div>`;
}

/** Change from `was` to `v` as a coloured percentage. */
function pctDelta(v: number, was: number): string {
  const pct = Math.round((v / Math.max(0.001, was) - 1) * 100);
  return pct > 0 ? `<i class="d up">▲${pct}%</i>` : pct < 0 ? `<i class="d down">▼${-pct}%</i>` : '<i class="d same">=</i>';
}

/**
 * Damage per second with this weapon against each enemy race: the selected technique (casters) and the
 * weapon itself. A weapon that isn't the equipped one shows the change against the equipped one.
 */
function damageTableHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  const caster = ch.prefersMagic;
  const equipped = ch.isEquipped(inst.uid);
  const now = estimateDamage(ch, foe, caster);
  const est = equipped ? now : estimateDamage(simulateEquip(ch, inst, 'weapon'), foe, caster);
  const current = ch.weaponInstance();
  const cell = (v: number, was: number) => `<td>${Math.round(v)}${equipped ? '' : pctDelta(v, was)}</td>`;
  const rows = RACES.map((r) => {
    const pct = weaponRace(inst, r);
    // Rows where neither weapon has a bonus only differ by ATP / MST: dim them so the bonuses stand out.
    const on = pct || (!equipped && current && weaponRace(current, r));
    return `<tr${on ? '' : ' class="off"'}><td class="attr-${r}">${ATTR_LABEL[r]}</td><td class="pct">${pct ? `+${pct}%` : '—'}</td>${
      est.spell && now.spell ? cell(est.spell[r], now.spell[r]) : ''
    }${cell(est.weapon[r], now.weapon[r])}</tr>`;
  }).join('');
  const spellHead = est.spell ? `<th title="Chained heavy casts of your selected technique (the mouse wheel changes it)">Heavy ${techniques[est.tech].name}</th>` : '';
  const head = `<tr><th>Damage / sec</th><th></th>${spellHead}<th title="The best light / heavy mix of a 3-hit combo on one enemy">Weapon</th></tr>`;
  const how = 'An estimate against one enemy: counts ATP, MST, race %, accuracy and swing / cast speed. Leaves out crits, perfect chains, specials, buffs and TP.';
  return `<table class="dps">${head}${rows}</table>
    <div class="dps-note" title="${esc(how)}">vs. a typical ${esc(foe.label)} enemy (DFP ${foe.dfp}, EVP ${foe.evp})${equipped ? '' : ' · % vs. equipped'}</div>`;
}

/** A weapon's own numbers (what its kind does is common knowledge), then its damage table. */
function weaponCardHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  const def = getDef(inst.id);
  if (def.type !== 'weapon') return '';
  const kind = weaponKinds[def.kind];
  const g = grindBonus(def, edgeLevels(inst));
  const stat = (label: string, value: string) => `<div class="wc-stat"><span>${label}</span><b>${value}</b></div>`;
  const stats = [
    stat('ATP', `${def.atpMin + g.atp}-${def.atpMax + g.atp}`),
    stat('ATA', `${def.ata + g.ata}`),
    def.mst ? stat('MST', `+${def.mst + g.mst}`) : '',
    stat('Grind', `${inst.grind ?? 0}/${grindCap(def)}`),
  ].join('');
  // Where the grind levels went: Edge is already in the tiles above, race levels in the damage table's % column.
  const ground = inst.grind
    ? [edgeLevels(inst) ? `Edge ${edgeLevels(inst)}` : '', ...RACES.map((r) => (inst.bane?.[r] ? `${ATTR_LABEL[r]} ${inst.bane[r]}` : ''))].filter(Boolean).join(' · ')
    : '';
  const check = ch.canEquip(inst);
  const sp = itemSpecial(inst);
  const tags = [
    sp ? `<span class="wc-tag special">${specials[sp].name}</span>` : '',
    inst.attrs?.hit ? `<span class="wc-tag">Hit +${inst.attrs.hit}%</span>` : '',
    ground ? `<span class="wc-tag" title="Where the grind levels went">Ground: ${ground}</span>` : '',
    def.req ? `<span class="wc-tag${check.need ? ' bad' : ''}">Req ${kind.reqStat.toUpperCase()} ${def.req}</span>` : '',
  ].join('');
  let html = `<div class="wc-kind">${kind.label}${def.rare ? ' · ★ Rare' : ''}</div><div class="wc-stats">${stats}</div>`;
  if (tags) html += `<div class="wc-tags">${tags}</div>`;
  if (def.desc) html += `<div class="wc-desc">${esc(def.desc)}</div>`;
  if (!check.ok) html += `<div class="wc-warn">✖ ${esc(check.reason ?? "Can't equip")}</div>`;
  // A stat requirement still shows the damage, to plan ahead.
  return html + damageTableHtml(ch, inst, foe);
}

/** The detail panel's description: the weapon card for weapons, plain lines for everything else. */
function itemInfoHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  if (getDef(inst.id).type === 'weapon') return weaponCardHtml(ch, inst, foe);
  return `<div class="detail-lines">${describeItem(inst, ch).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

/** Arrow showing whether gear beats what is in its slot; ✖ if it can't be used. */
function verdictMark(ch: Character, inst: ItemInstance): string {
  if (!gearSlot(inst) || ch.isEquipped(inst.uid)) return '';
  const check = ch.canEquip(inst);
  // A stat requirement only locks it for now (amber, like the pickup prompt); ✖ is for anything else in the way.
  if (check.need) return `<span class="verdict locked" title="${esc(check.reason ?? '')}">${check.need.stat.toUpperCase()} ${check.need.req}</span>`;
  if (!check.ok) return `<span class="verdict no" title="${esc(check.reason ?? "Can't equip")}">✖</span>`;
  const v = gearVerdict(ch, inst);
  return v > 0 ? '<span class="verdict up" title="Better than equipped">▲</span>' : v < 0 ? '<span class="verdict down" title="Worse than equipped">▼</span>' : '<span class="verdict same">=</span>';
}

/** Headline stats of a gear item. */
function gearStat(inst: ItemInstance, ch?: Character): string {
  const def = getDef(inst.id);
  if (def.type === 'weapon') return describeItem(inst)[1] ?? ''; // "ATP a-b  ATA c", grind included
  if (def.type === 'armor') return armorStatText(def);
  if (def.type === 'injector') {
    const s = injectorStats(inst, ch);
    return `${def.kind === 'mate' ? 'HP' : 'TP'} ${Math.round(s.potency * 100)}% · ${Math.floor(chargeOf(inst, ch))}/${s.doses} doses`;
  }
  return '';
}

const ITEM_GROUPS: [string, string[]][] = [
  ['Consumables', ['consumable']],
  ['Grinders', ['grinder']],
];

const SOURCE_LABEL: Record<PaletteRow['mouse'], string> = { weapon: 'Weapon', magic: 'Magic' };

function quickLabel(a: QuickAction, ch: Character): string {
  switch (a.kind) {
    case 'tech':
      return techniques[a.tech].name;
    case 'item':
      return `${getDef(a.item).name} (${ch.countOf(a.item)})`;
    case 'injector': {
      const inst = ch.injector();
      return `Injector${inst ? `: ${itemName(inst)}` : ' (none equipped)'}`;
    }
    case 'empty':
      return '—';
  }
}

export class InventoryMenu implements Menu {
  cls = 'wide';
  closable = true;
  tab: InvTab = 'equip';
  private slot: GearSlot = 'weapon';
  private sel: string | null = null;
  private grinding: string | null = null; // grinder uid awaiting a weapon pick
  private grindWeapon: string | null = null; // then the weapon, awaiting a track pick (Edge or a race)
  private paletteEdit: [number, number] | null = null;
  /** Square shown in the Mag info box (last clicked). */
  private magFocus: string | null = null;
  /** Info box HTML per square, rebuilt each render (hover swaps it in without a re-render). */
  private magInfo: Record<string, string> = {};

  constructor(private api: GameApi) {}

  private get ch(): Character {
    return this.api.char;
  }

  render(): string {
    // Unspent Mag and attribute points: a count badge, and the tab pulses until you open it.
    const unspent: Partial<Record<InvTab, [number, string]>> = { mag: [this.ch.magPoints, 'Mag point'], status: [this.ch.attributePoints, 'attribute point'] };
    const tabs = (Object.keys(TAB_LABEL) as InvTab[])
      .map((t) => {
        const [pts, what] = unspent[t] ?? [0, ''];
        const badge = pts > 0;
        const cls = `tab${this.tab === t ? ' on' : ''}${badge && this.tab !== t ? ' pulse' : ''}`;
        const title = badge ? ` title="${pts} ${what}${pts > 1 ? 's' : ''} to spend"` : '';
        return `<button class="${cls}" data-act="tab" data-arg="${t}"${title}>${TAB_LABEL[t]}${badge ? `<span class="tab-badge">${pts}</span>` : ''}</button>`;
      })
      .join('');
    let body = '';
    if (this.tab === 'equip') body = this.renderEquip();
    else if (this.tab === 'items') body = this.renderItems();
    else if (this.tab === 'mag') body = this.renderMag();
    else if (this.tab === 'status') body = this.renderStatus();
    else if (this.tab === 'palette') body = this.renderPalette();
    else body = this.renderTechs();
    return `<div class="win-title">${esc(this.ch.data.name)} · Lv.${this.ch.level} ${this.ch.title}</div>
      <div class="menu-head"><div class="tabs">${tabs}</div><span class="head-gap"></span><button class="btn small ghost" data-act="quit">Save &amp; quit</button><button class="btn small" data-act="close">Close <kbd>I</kbd></button></div>
      ${body}`;
  }

  private foot(): string {
    return `<div class="menu-foot"><span>${this.ch.data.inventory.length} / ${INVENTORY_SIZE} items</span><span class="meseta">${this.ch.data.meseta.toLocaleString()} <b>M</b></span></div>`;
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
          <span class="gs-name${it && getDef(it.id).rare ? ' rare' : ''}">${it ? esc(itemName(it)) : '<span class="dim">— empty —</span>'}</span>
          <span class="gs-stat">${it ? esc(gearStat(it, ch)) : ''}</span></div>`;
      })
      .join('');
    const bag = ch.data.inventory.filter((it) => fitsSlot(it, this.slot));
    const rows = bag.length
      ? bag
          .map((it) => {
            const eq = ch.isEquipped(it.uid) ? '<span class="eq">E</span>' : '';
            const rare = getDef(it.id).rare ? ' rare' : '';
            return `<div class="row${rare}${this.sel === it.uid ? ' sel' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}${eq}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it)}</div>`;
          })
          .join('')
      : `<div class="dim empty-note">No ${SLOT_LABEL[this.slot].toLowerCase()}s in your bag.</div>`;
    const sel = this.selected(this.slot) ?? ch.equippedItem(this.slot);
    let detail = '<div class="dim">Nothing equipped. Pick an item from the list.</div>';
    if (sel) {
      const def = getDef(sel.id);
      const equipped = ch.isEquipped(sel.uid);
      const here = ch.data.equipped[this.slot] === sel.uid;
      const btns = [
        here
          ? `<button class="btn" data-act="unequip" data-arg="${sel.uid}">Unequip</button>`
          : `<button class="btn primary${ch.canEquip(sel).ok ? '' : ' disabled'}" data-act="equip" data-arg="${sel.uid}">Equip</button>`,
      ];
      if (!equipped) btns.push(`<button class="btn danger" data-act="discard" data-arg="${sel.uid}">${this.api.inField ? 'Drop' : 'Discard'}</button>`);
      detail = `<div class="detail-title${def.rare ? ' rare' : ''}">${esc(itemName(sel))}</div>${itemInfoHtml(ch, sel, this.api.damageFoe())}
        ${compareHtml(ch, sel)}
        <div class="detail-sell dim">Sells for ${sellPrice(sel)} M</div><div class="choices inline">${btns.join('')}</div>`;
    }
    const s = ch.stats();
    const [lo, hi] = ch.weaponAtp();
    const totals = `<div class="gear-totals"><span>ATP <b>${s.atp} + ${lo}-${hi}</b></span><span>ATA <b>${s.ata}</b></span><span>DFP <b>${s.dfp}</b></span><span>EVP <b>${s.evp}</b></span><span>MST <b>${s.mst}</b></span></div>`;
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
            .map((it) => `<div class="row${getDef(it.id).rare ? ' rare' : ''}${this.sel === it.uid ? ' sel' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}<span class="row-name">${esc(itemName(it))}</span></div>`)
            .join(''),
      )
      .join('');
    const sel = this.selected(null);
    let detail = '<div class="dim">Select an item.</div>';
    const grindWeapon = this.grindWeapon ? ch.find(this.grindWeapon) : undefined;
    if (this.grinding && grindWeapon) {
      detail = this.renderGrindPicker(grindWeapon);
    } else if (this.grinding) {
      const grinder = ch.find(this.grinding);
      // The equipped weapon first: it is nearly always the one being ground.
      const weapons = ch.data.inventory
        .filter((it) => getDef(it.id).type === 'weapon')
        .sort((a, b) => Number(ch.isEquipped(b.uid)) - Number(ch.isEquipped(a.uid)));
      detail = `<div class="detail-title">${grinder ? esc(itemName(grinder)) : 'Grinder'}: choose a weapon</div>
        <div class="list short">${weapons
          .map((w) => {
            const def = getDef(w.id);
            const full = def.type === 'weapon' && (w.grind ?? 0) >= grindCap(def);
            const fill = def.type === 'weapon' ? `<span class="dim">${w.grind ?? 0}/${grindCap(def)}</span>` : '';
            return `<div class="row${full ? ' dimmed' : ''}" data-act="grindTarget" data-arg="${w.uid}">${glyph(w)}${ch.isEquipped(w.uid) ? '<span class="eq">E</span>' : ''}<span class="row-name">${esc(itemName(w))}</span>${fill}</div>`;
          })
          .join('')}</div><div class="choices inline"><button class="btn ghost" data-act="cancelGrind">Cancel</button></div>`;
    } else if (sel) {
      const def = getDef(sel.id);
      const lines = describeItem(sel, ch).map((l) => `<div>${esc(l)}</div>`).join('');
      const btns: string[] = [];
      if (def.type === 'grinder') btns.push(`<button class="btn primary" data-act="grind" data-arg="${sel.uid}">Use on weapon…</button>`);
      // The Telepipe can be cast from here: the menu closes and the cast starts.
      const usable = def.type === 'consumable' && def.effect === 'telepipe';
      if (usable) {
        const ok = !def.fieldOnly || this.api.inField;
        const tip = ok ? 'Closes the menu and starts the cast' : 'Only works outside the city';
        btns.push(`<button class="btn primary${ok ? '' : ' disabled'}" data-act="use" data-arg="${sel.uid}" title="${tip}">Use</button>`);
      }
      btns.push(`<button class="btn danger" data-act="discard" data-arg="${sel.uid}">${this.api.inField ? 'Drop' : 'Discard'}</button>`);
      const hint = usable
        ? `<div class="dim">Use closes the menu and starts the ${telepipeCfg.castTime} s cast; a step, a dash or a hit breaks it. A Q / E quick slot (Palette tab) casts it too.</div>`
        : def.type === 'consumable' ? '<div class="dim">Put it on a Q / E quick slot (Palette tab) to use it in the field.</div>' : '';
      detail = `<div class="detail-title${def.rare ? ' rare' : ''}">${esc(itemName(sel))}</div><div class="detail-lines">${lines}</div>${hint}
        <div class="detail-sell dim">Sells for ${sellPrice(sel)} M</div><div class="choices inline">${btns.join('')}</div>`;
    }
    return `<div class="split"><div class="list">${rows || '<div class="dim empty-note">No items.</div>'}</div><div class="detail">${detail}</div></div>${this.foot()}`;
  }

  /**
   * Where a grinder's levels go on `weapon`: Edge or one race, each row with what it adds and the change in
   * damage per second (the selected technique for casters) against the current expedition's typical enemy.
   */
  private renderGrindPicker(weapon: ItemInstance): string {
    const ch = this.ch;
    const grinder = this.grinding ? ch.find(this.grinding) : undefined;
    const gdef = grinder ? getDef(grinder.id) : undefined;
    const wdef = getDef(weapon.id);
    if (!grinder || gdef?.type !== 'grinder' || wdef.type !== 'weapon') return '<div class="dim">Nothing to grind.</div>';
    const foe = this.api.damageFoe();
    const caster = ch.prefersMagic;
    const dps = (inst: ItemInstance) => {
      const e = estimateDamage(simulateEquip(ch, inst, 'weapon'), foe, caster);
      return e.spell ?? e.weapon;
    };
    const now = dps(weapon);
    const pct = (v: number, was: number) => Math.round((v / Math.max(0.001, was) - 1) * 100);
    const g0 = grindBonus(wdef, edgeLevels(weapon));
    const tracks: GrindTrack[] = ['edge', ...RACES];
    const rows = tracks.map((t) => {
      const p = grindPreview(weapon, t, gdef.amount);
      const name = t === 'edge' ? 'Edge' : ATTR_LABEL[t];
      let what = '';
      if (t === 'edge') {
        const g1 = grindBonus(wdef, edgeLevels(p.after));
        const parts = [`ATP +${g1.atp - g0.atp}`, `ATA +${g1.ata - g0.ata}`];
        if (wdef.mst) parts.push(`MST +${g1.mst - g0.mst}`);
        if (p.levels) what = parts.join(' · ');
      } else {
        const was = weaponRace(weapon, t);
        what = p.levels ? `${was}% → ${weaponRace(p.after, t)}%` : `${was}% (cap ${raceCap(wdef.tier)}%)`;
      }
      let gain = '';
      if (now && p.levels) {
        const after = dps(p.after);
        const d = t === 'edge' ? Math.round(RACES.reduce((s, r) => s + pct(after[r], now[r]), 0) / RACES.length) : pct(after[t], now[t]);
        gain = `<span class="gp-gain">▲${d}%${t === 'edge' ? ' vs all' : ` vs ${ATTR_LABEL[t]}`}</span>`;
      }
      const note = !p.levels
        ? `<span class="gp-note">${esc(p.reason)}</span>`
        : p.wasted
          ? `<span class="gp-note warn">+${p.levels} only, ${p.wasted} lost</span>`
          : '';
      // Where this race is met in the current expedition: its regular enemies, its boss, or both (Mines).
      const where = [foe.mainRace === t ? 'here' : '', foe.bossRace === t ? 'boss' : ''].filter(Boolean).join(' · ');
      const here = where ? `<span class="gp-here" title="In the ${esc(foe.label)}: ${where === 'boss' ? 'the boss is' : 'most enemies are'} ${name}">${where}</span>` : '';
      return `<div class="row grind-pick${p.levels ? '' : ' dimmed'}" ${p.levels ? `data-act="grindApply" data-arg="${t}"` : ''}>
        <span class="gp-name">${name}${here}</span><span class="gp-what">${what}</span>${gain}${note}</div>`;
    }).join('');
    const left = grindCap(wdef) - (weapon.grind ?? 0);
    const levels = gdef.amount > 1 ? `its ${gdef.amount} levels all go` : 'its level goes';
    return `<div class="detail-title">${esc(itemName(grinder))} → ${esc(itemName(weapon))}</div>
      <div class="dim grind-head">Grind ${weapon.grind ?? 0}/${grindCap(wdef)} (${left} left). Pick where ${levels}: Edge raises the weapon's own stats against everything;
      a race adds ${formulas.banePerGrind}% per level against that race only, up to ${raceCap(wdef.tier)}% with what the weapon rolled.</div>
      <div class="list grind-picks">${rows}</div>
      <div class="dps-note">Damage / sec ${caster ? '(selected technique) ' : ''}vs. a typical ${esc(foe.label)} enemy</div>
      <div class="choices inline"><button class="btn ghost" data-act="grindBack">Other weapon</button><button class="btn ghost" data-act="cancelGrind">Cancel</button></div>`;
  }

  private renderStatus(): string {
    const ch = this.ch;
    const base = ch.baseStats();
    const req = ch.reqStats();
    const tot = ch.stats();
    const [lo, hi] = ch.weaponAtp();
    const rows = STAT_KEYS.map((k) => {
      let val = `${tot[k]}`;
      if (k === 'atp') val = `${tot.atp} + ${lo}-${hi}`;
      // Split the bonus so it's clear which part counts toward equip requirements (Mag) and which doesn't (gear).
      const magB = req[k] - base[k];
      const gearB = tot[k] - req[k];
      const bonus = [magB ? `+${magB} Mag` : '', gearB ? `+${gearB} gear` : ''].filter(Boolean).join(' ');
      const info = STAT_INFO[k];
      let note = info.short;
      // Live numbers for the stats whose effect isn't obvious from the value itself (same terms Combat uses).
      if (k === 'mst') note += ` Heavy Foie ${Math.round(ch.techDamage('foie') * spellForms.heavy.powerMult)}, Resta +${restaHeal(tot.mst)} HP.`;
      if (k === 'lck') note += ` ${(base.lck / 5).toFixed(1)}%, 1.5× damage.`;
      return `<tr class="stat-row" title="${esc(info.detail)}"><td>${STAT_LABEL[k]}</td><td>${val}</td><td class="dim">${bonus ? `(${bonus})` : ''}</td></tr>
        <tr class="stat-note" title="${esc(info.detail)}"><td colspan="3">${esc(note)}</td></tr>`;
    }).join('');
    const w = ch.weaponInstance();
    const eq = GEAR_SLOTS
      .map((s) => {
        const it = ch.equippedItem(s);
        return `<tr><td>${SLOT_LABEL[s]}</td><td>${it ? esc(itemName(it)) : '<span class="dim">—</span>'}</td></tr>`;
      })
      .join('');
    const st = ch.data.stats;
    return `<div class="split"><div class="detail">
        <div class="detail-title">${esc(ch.data.name)} — ${ch.title} Lv.${ch.level}</div>
        <div class="dim">EXP ${ch.data.xp} / ${ch.xpToNext()} to next level</div>
        <span class="ms-bar xp-bar"><i style="width:${Math.min(100, (100 * ch.data.xp) / Math.max(1, ch.xpToNext()))}%"></i></span>
        <table class="stats">${rows}</table></div>
      <div class="detail">${this.attributesHtml()}<div class="detail-title">Equipment</div><table class="stats">${eq}</table>
        ${w ? itemInfoHtml(ch, w, this.api.damageFoe()) : ''}
        <div class="detail-title" style="margin-top:12px">Record</div>
        <div class="dim">Kills ${st.kills} · Deaths ${st.deaths} · Dragons slain ${st.dragonKills}</div></div></div>${this.foot()}`;
  }

  /**
   * Attributes: points to spend, and per attribute its points, what they add and a + button. Every point is
   * permanent; keystones in the Mag tree need points in their attribute.
   */
  private attributesHtml(): string {
    const ch = this.ch;
    const free = ch.attributePoints;
    const rows = ATTRIBUTES.map((a) => {
      const info = ATTRIBUTE_INFO[a];
      const n = ch.data.attributes[a];
      const gains = Object.entries(info.gain) as [StatKey, number][];
      const total = gains.map(([k, v]) => `${STAT_LABEL[k]} +${Math.floor(v * n + 1e-6)}`).join(' · ');
      const each = gains.map(([k, v]) => `${STAT_LABEL[k]} +${+v.toFixed(2)}`).join(', ');
      const tip = `${info.desc} Each point: ${each}. Permanent.`;
      return `<div class="attr-row a-${a}" title="${esc(tip)}"><span class="attr-name">${info.label}</span><b class="attr-val">${n}</b>
        <span class="attr-gain">${n ? total : `<span class="dim">${esc(info.desc)}</span>`}</span>
        <button class="btn small attr-add${free > 0 ? '' : ' disabled'}" data-act="attr" data-arg="${a}" title="${esc(`+1 ${info.label}: ${each}. Permanent.`)}">+</button></div>`;
    }).join('');
    const pts = free ? `<span class="attr-pts"><b>${free}</b> to spend</span>` : '';
    return `<div class="detail-title">Attributes ${pts}</div><div class="attr-list">${rows}</div>
      <div class="dim attr-note">${attributeCfg.pointsPerLevel} points a level, and every point is permanent. The attribute with the most points names you (${esc(ch.title)}). Mag keystones need points in their attribute.</div>`;
  }

  /** What a Mag grid square gives, as a title and a line of text. */
  private magCellText(c: MagCell): [string, string] {
    if (c.kind === 'core') return ['Your Mag', 'Every path starts here. Each character level gives one point to spend on a square next to one it already knows. Squares are permanent.'];
    if (c.passive) {
      const p = PASSIVE_INFO[c.passive];
      const arms = c.stats.map((s) => MAG_STAT_LABEL[s]).join(' + ');
      const what = c.kind === 'keystone' ? `${arms} keystone ${c.tier === 2 ? 'II' : 'I'}` : `${arms} notable`;
      return [`${p.name} · ${what}`, p.desc()];
    }
    const bonus = Object.entries(c.bonus).map(([k, v]) => `${k.toUpperCase()} +${v}`).join('  ');
    return [c.stats.map((s) => MAG_STAT_LABEL[s]).join(' / '), bonus];
  }

  /** Mag: the talent grid on the left (click a square to learn it); form, points and bonuses on the right. */
  private renderMag(): string {
    const ch = this.ch;
    const m = ch.mag;
    const form = magForm(m, ch.leadAttribute);
    const owned = new Set(m.cells);
    const free = ch.magPoints;

    this.magInfo = {};
    const cells: string[] = [];
    for (let y = -MAG_RADIUS; y <= MAG_RADIUS; y++) {
      for (let x = -MAG_RADIUS; x <= MAG_RADIUS; x++) {
        const c = MAG_CELLS[`${x},${y}`];
        if (!c) {
          cells.push('<span class="mg-void"></span>');
          continue;
        }
        const blocked = c.kind === 'core' || owned.has(c.id) ? null : cellBlocked(m.cells, c.id, ch.data.attributes);
        const state = c.kind === 'core' || owned.has(c.id) ? 'owned' : !blocked && free > 0 ? 'open' : 'locked';
        const [title, text] = this.magCellText(c);
        const why = state === 'owned' ? (c.kind === 'core' ? '' : 'Learned') : state === 'open' ? 'Click to learn (permanent)' : (blocked ?? 'No points left');
        const req = reqText(c);
        this.magInfo[c.id] = `<div class="mi-title">${esc(title)}</div><div>${esc(text)}</div>${req ? `<div class="mi-req">Needs ${esc(req)}</div>` : ''}${why ? `<div class="mi-state ${state}">${esc(why)}</div>` : ''}`;
        const label = c.kind === 'core' ? 'MAG' : c.kind === 'keystone' ? (c.tier === 2 ? '◈' : '◆') : c.kind === 'notable' ? '★' : c.kind === 'hybrid' ? Object.values(c.bonus).join('/') : Object.values(c.bonus).map((v) => `+${v}`).join('/');
        const arms = c.stats.map((s) => `a-${s}`).join(' ');
        const tier = c.tier ? ` t${c.tier}` : '';
        cells.push(`<div class="mg-cell k-${c.kind}${tier} ${arms} ${state}${this.magFocus === c.id ? ' focus' : ''}" data-act="magCell" data-arg="${c.id}" data-cell="${c.id}">${label}</div>`);
      }
    }
    const grid = `<div class="mag-grid-wrap"><span class="mg-arm a-pow top">POW</span><span class="mg-arm a-dex right">DEX</span>
      <span class="mg-arm a-mind bottom">MIND</span><span class="mg-arm a-def left">DEF</span>
      <div class="mag-grid" style="grid-template-columns: repeat(${2 * MAG_RADIUS + 1}, var(--cell))">${cells.join('')}</div></div>`;

    const now = magBonuses(m);
    const bonusRows = MAG_STATS.map((s) => {
      const key = MAG_BONUS[s][0];
      return `<span>${key.toUpperCase()} <b>+${now[key] ?? 0}</b></span>`;
    }).join('');

    const lv = magLevel(m);
    const next = MAG_EVOLVE_AT.find((n) => n > lv);
    const focus = this.magInfo[this.magFocus ?? ''] ?? '<div class="dim">Point at a square to see what it gives.</div>';
    const side = `<div class="mag-head"><span class="mag-name" style="color:#${form.color.toString(16).padStart(6, '0')}">${esc(form.name)}</span>
        <span class="dim">Lv.${lv}${next ? ` · evolves at Lv.${next}` : ' · final form'}</span></div>
      <div class="mag-points"><b>${free}</b> point${free === 1 ? '' : 's'} to spend</div>
      <div class="mag-info">${focus}</div>
      <div class="gear-totals mag-totals">${bonusRows}</div>
      <div class="dim mag-note">One point per character level, and every square is permanent. Keystones (◆ ◈) need squares of their colour and points in its attribute; two-arm notables need points in both. Mag bonuses count toward weapon and armor requirements.</div>`;
    return `<div class="split mag-split"><div class="detail mag-panel">${grid}</div><div class="detail">${side}</div></div>${this.foot()}`;
  }

  afterRender(panel: HTMLElement): void {
    if (this.tab !== 'mag') return;
    const info = panel.querySelector('.mag-info');
    panel.querySelector('.mag-grid')?.addEventListener('pointerover', (e) => {
      const id = ((e.target as HTMLElement).closest('[data-cell]') as HTMLElement | null)?.dataset.cell;
      if (info && id && this.magInfo[id]) info.innerHTML = this.magInfo[id];
    });
  }

  /** Clicking a square learns it straight away. */
  private magCellClick(id: string): void {
    const ch = this.ch;
    this.magFocus = id;
    if (id === CORE_ID || ch.mag.cells.includes(id)) return void sfx('ui.cursor');
    const why = cellBlocked(ch.mag.cells, id, ch.data.attributes);
    if (why) return this.fail(why);
    if (ch.magPoints <= 0) return this.fail('No Mag points left. Level up to earn more.');
    this.fail(this.api.magLearn([id]));
  }

  private renderPalette(): string {
    const ch = this.ch;
    const keys = ['LMB / RMB', 'Q', 'E'];
    const grid = ch.data.palette
      .map((row, r) => {
        const labels = [SOURCE_LABEL[row.mouse], quickLabel(row.quick[0], ch), quickLabel(row.quick[1], ch)];
        return `<div class="pal-row"><div class="dim">Palette ${r + 1}${r === 1 ? ' (hold Shift)' : ''}</div>${labels
          .map((label, c) => {
            const on = this.paletteEdit?.[0] === r && this.paletteEdit?.[1] === c;
            return `<div class="pal-slot${on ? ' sel' : ''}" data-act="palSlot" data-arg="${r},${c}"><div class="slot-key">${keys[c]}</div>${esc(label)}</div>`;
          })
          .join('')}</div>`;
      })
      .join('');
    const sel = ch.selectedTech();
    let options = `<div class="dim">Click a slot to change it.</div>
      <div class="dim" style="margin-top:8px">LMB is the heavy attack (single target, weapon special), RMB the light one (hits an area).
      Weapon swings your weapon; Magic casts your selected attack technique (now ${esc(techniques[sel].name)}), chosen with the mouse wheel.
      Q and E hold the injector, items and support techniques. Key 1 always uses the injector.</div>`;
    if (this.paletteEdit) {
      const opts: [string, PaletteEdit][] = [];
      if (this.paletteEdit[1] === 0) {
        opts.push(['Weapon', { kind: 'source', source: 'weapon' }], ['Magic', { kind: 'source', source: 'magic' }]);
      } else {
        for (const t of TECH_IDS) if (!isAttackTech(t)) opts.push([techniques[t].name, { kind: 'tech', tech: t }]);
        opts.push([quickLabel({ kind: 'injector' }, ch), { kind: 'injector' }]);
        const consumables = new Set(ch.data.inventory.filter((i) => getDef(i.id).type === 'consumable').map((i) => i.id));
        consumables.add('telepipe');
        for (const id of consumables) opts.push([getDef(id).name, { kind: 'item', item: id }]);
        opts.push(['Empty', { kind: 'empty' }]);
      }
      options = `<div class="detail-title">Assign</div><div class="list short">${opts
        .map(([label, a]) => `<div class="row" data-act="palSet" data-arg='${JSON.stringify(a)}'>${esc(label)}</div>`)
        .join('')}</div>`;
    }
    return `<div class="split"><div class="detail">${grid}</div><div class="detail">${options}</div></div>`;
  }

  private renderTechs(): string {
    const ch = this.ch;
    const mst = ch.stats().mst;
    const rows = TECH_IDS.map((t) => {
      const def = techniques[t];
      let effect: string;
      let cost: string;
      if (isAttackTech(t)) {
        const dmg = (form: 'light' | 'heavy') => Math.round(ch.techDamage(t) * spellForms[form].powerMult);
        effect = `Light ${dmg('light')} · Heavy ${dmg('heavy')}`;
        cost = `${ch.techCost(t, 'light')} / ${ch.techCost(t, 'heavy')} TP`;
      } else {
        effect = def.kind === 'heal' ? `+${restaHeal(mst)} HP` : `${def.buffStat!.toUpperCase()} +${buffPct(t, mst).toFixed(0)}%, ${techScaling.buffDuration} s`;
        cost = `${ch.techCost(t)} TP`;
      }
      return `<tr><td>${def.name}</td><td>${effect}</td><td>${cost}</td><td>${def.desc}</td></tr>`;
    }).join('');
    return `<div class="detail"><table class="stats techs">${rows}</table>
      <div class="dim" style="margin-top:8px">Everyone knows every technique. Your MST (${mst}) decides how hard they hit, how much Resta heals and how strong buffs are; casts also cost a little more TP as MST grows. Attack techniques are cast from a Magic palette row (mouse wheel picks which); put Resta and buffs on Q / E.</div></div>`;
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
      case 'tab':
        this.tab = arg as InvTab;
        this.sel = null;
        this.grinding = null;
        this.grindWeapon = null;
        this.paletteEdit = null;
        break;
      case 'close':
        this.api.closeMenu();
        break;
      case 'quit':
        this.api.quitToTitle();
        break;
      case 'select':
        this.sel = arg;
        // Picking another item leaves the grind flow (it would otherwise keep grinding with the old grinder).
        this.grinding = null;
        this.grindWeapon = null;
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
      case 'magCell':
        this.magCellClick(arg);
        break;
      case 'attr':
        this.fail(this.api.attrSpend(arg as AttributeId));
        break;
      case 'discard':
        this.api.discardItem(arg);
        this.sel = null;
        break;
      case 'grind':
        this.grinding = arg;
        break;
      case 'grindTarget':
        if (this.grinding) this.grindWeapon = arg;
        break;
      case 'grindApply':
        if (this.grinding && this.grindWeapon) {
          const err = this.api.grindItem(this.grindWeapon, this.grinding, arg as GrindTrack);
          this.fail(err);
          if (!err) {
            // Stay on the picker while grinders of this kind remain, so a stack can be spent level by level.
            if (!this.ch.find(this.grinding)) {
              this.sel = null;
              this.grinding = null;
              this.grindWeapon = null;
            }
          }
        }
        break;
      case 'grindBack':
        this.grindWeapon = null;
        break;
      case 'cancelGrind':
        this.grinding = null;
        this.grindWeapon = null;
        break;
      case 'palSlot': {
        const [r, c] = arg.split(',').map(Number);
        this.paletteEdit = [r, c];
        break;
      }
      case 'palSet':
        if (this.paletteEdit) {
          this.api.setPalette(this.paletteEdit[0], this.paletteEdit[1], JSON.parse(arg) as PaletteEdit);
          this.paletteEdit = null;
        }
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
    let list = '';
    let detail = '<div class="dim">Select an item.</div>';
    if (this.mode === 'buy') {
      list = this.stock
        .map((it, i) => {
          const def = getDef(it.id);
          const price = buyPrice(it);
          const ok = ch.data.meseta >= price;
          return `<div class="row ${def.type}${def.rare ? ' rare' : ''}${this.sel === i ? ' sel' : ''}${ok ? '' : ' dimmed'}" data-act="select" data-arg="${i}">${glyph(it)}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it)}<span class="price">${price} M</span></div>`;
        })
        .join('');
      if (typeof this.sel === 'number' && this.stock[this.sel]) {
        const it = this.stock[this.sel];
        const price = buyPrice(it);
        const stackable = it.qty !== undefined;
        detail = `<div class="detail-title">${esc(itemName(it))}</div>${itemInfoHtml(ch, it, this.api.damageFoe())}${compareHtml(ch, it)}
          <div class="choices inline"><button class="btn primary${ch.data.meseta >= price ? '' : ' disabled'}" data-act="buy" data-arg="1">Buy (${price} M)</button>
          ${stackable ? `<button class="btn${ch.data.meseta >= price * 5 ? '' : ' disabled'}" data-act="buy" data-arg="5">Buy 5 (${price * 5} M)</button>` : ''}</div>`;
      }
    } else {
      const row = (it: ItemInstance) => {
        const eq = ch.isEquipped(it.uid);
        return `<div class="row ${getDef(it.id).type}${getDef(it.id).rare ? ' rare' : ''}${this.sel === it.uid ? ' sel' : ''}${eq ? ' dimmed' : ''}" data-act="select" data-arg="${it.uid}">${glyph(it)}${eq ? '<span class="eq">E</span>' : ''}<span class="row-name">${esc(itemName(it))}</span>${verdictMark(ch, it)}<span class="price">${sellPrice(it)} M</span></div>`;
      };
      const [gear, rest] = this.sellGroups();
      list = (gear.length ? `<div class="list-group">Equipment</div>${gear.map(row).join('')}` : '') + (rest.length ? `<div class="list-group">Items</div>${rest.map(row).join('')}` : '');
      const it = typeof this.sel === 'string' ? ch.find(this.sel) : undefined;
      if (it) {
        const eq = ch.isEquipped(it.uid);
        detail = `<div class="detail-title">${esc(itemName(it))}</div>${itemInfoHtml(ch, it, this.api.damageFoe())}${gearSlot(it) ? compareHtml(ch, it) : ''}
          <div class="choices inline"><button class="btn primary${eq ? ' disabled' : ''}" data-act="sell" data-arg="${it.uid}">${eq ? 'Equipped' : `Sell (${sellPrice(it)} M)`}</button></div>`;
      }
    }
    return `<div class="win-title">${this.title}</div>
      <div class="menu-head"><div class="tabs">${tabs}</div><span class="head-gap"></span><button class="btn small" data-act="close">Leave <kbd>Esc</kbd></button></div>
      <div class="split"><div class="list">${list}</div><div class="detail docked">${detail}</div></div>
      <div class="menu-foot"><span>${ch.data.inventory.length} / ${INVENTORY_SIZE} items</span><span class="meseta">${ch.data.meseta.toLocaleString()} <b>M</b></span></div>`;
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
        if ((def.type === 'weapon' || def.type === 'armor' || def.type === 'injector') && bought) {
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
      case 'close':
        this.api.closeMenu();
        break;
    }
  }
}
