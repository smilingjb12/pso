import { attributeCfg, BUILD_VERSION, formulas, magCfg, spellForms, type AttackType, type Race } from './config';
import type { Look } from './models/heroine';
import {
  ATTRIBUTE_INFO,
  ATTRIBUTES,
  attributePointsEarned,
  buildTitle,
  KITS,
  leadAttribute,
  MAX_LEVEL,
  noAttributes,
  statsAtLevel,
  xpToNext,
  type AttributeId,
  type AttributePoints,
  type KitDef,
  type KitId,
  type PaletteRow,
  type StatKey,
  type Stats,
} from './data/stats';
import {
  armorLines,
  ATTR_LABEL,
  ATTRS,
  getDef,
  grindCap,
  INJECTOR_MODS,
  INJECTOR_REQ_STAT,
  INVENTORY_SIZE,
  isStackable,
  RACE_SUFFIX,
  raceCap,
  specials,
  stackCap,
  weaponKinds,
  type ArmorItemDef,
  type Attr,
  type InjectorMod,
  type ItemDef,
  type SpecialId,
  type WeaponItemDef,
  type WeaponKindDef,
} from './data/items';
import { ATTACK_TECHS, isAttackTech, techAttackPower, techTpCost, type TechId } from './data/techniques';
import { describeInjector, injectorDef } from './injectors';
import { hasPassive, magBonuses, magPointsFree, newMag, readMag, type MagData, type MagPassive } from './mag';

// Persistent character state plus derived-stat helpers. No rendering here.

export interface ItemInstance {
  uid: string;
  id: string;
  qty?: number;
  /** Grind levels in all: Edge levels plus the race (Bane) levels below. */
  grind?: number;
  /** Grind levels spent on each race (each adds formulas.banePerGrind %). */
  bane?: Partial<Record<Race, number>>;
  attrs?: Partial<Record<Attr, number>>;
  special?: SpecialId;
  /** Injectors: the rolled mod, and doses ready (undefined = full). */
  mod?: InjectorMod;
  charge?: number;
}

/** Save format. Saves from before classes were removed (versions 1-3) are deleted, not migrated. */
export const SAVE_VERSION = 4;
/** Content a save has seen (1: the Ruins, which moved Nightmare behind Dark Falz). Older saves are upgraded on load. */
export const CONTENT_VERSION = 1;

export interface CharacterData {
  version: typeof SAVE_VERSION;
  name: string;
  /** The starting kit picked at creation: Lv 1 stats, starting gear and palette. */
  kit: KitId;
  /** Appearance chosen at creation. */
  appearance?: Look;
  /** Attribute points spent (permanent). */
  attributes: AttributePoints;
  /** BUILD_VERSION these attribute points and Mag squares were spent under (a newer one refunds them). */
  build: number;
  /** CONTENT_VERSION the save was last loaded under (missing on saves from before the Ruins). */
  content?: number;
  level: number;
  xp: number; // progress toward next level
  meseta: number;
  inventory: ItemInstance[];
  equipped: Partial<Record<GearSlot, string>>;
  palette: PaletteRow[];
  /** Attack technique the magic source casts (cycled with the mouse wheel). */
  selectedTech?: TechId;
  /** The Mag's talent grid (permanent squares). */
  mag: MagData;
  stats: {
    kills: number;
    deaths: number;
    dragonKills: number;
    playSeconds: number;
    deRolLeKills?: number;
    wardenKills?: number;
    falzKills?: number;
    /** Pylons lit (the first one explains them). */
    pylonsLit?: number;
    /** Opened Nightmare by beating the Warden before the Ruins existed: it stays open without Dark Falz. */
    nightmareKept?: boolean;
    dashes?: number;
    /** Bosses beaten on Hard (each opens the next Hard expedition and a shop tier). */
    hardKills?: { dragon?: number; derolle?: number; warden?: number; falz?: number };
  };
}

let uidCounter = 0;
/** Equip-requirement failure text; shows the base + Mag value the check actually used. */
function reqReason(stat: StatKey, req: number, have: number): string {
  return `Requires ${stat.toUpperCase()} ${req} (you have ${have}; gear bonuses don't count)`;
}

export function newUid(): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function makeItem(id: string, extra: Partial<ItemInstance> = {}): ItemInstance {
  const def = getDef(id);
  const inst: ItemInstance = { uid: newUid(), id, ...extra };
  if (isStackable(def) && inst.qty === undefined) inst.qty = 1;
  return inst;
}

/**
 * The prefix says what an item does (a rolled special or injector mod), the suffix what it's for: a
 * weapon's best race % once it reaches half its tier's cap ("Heat Brand of Beasts +3"). A rare's fixed
 * special is part of its name already, so only rolled ones are prefixed.
 */
export function itemName(inst: ItemInstance): string {
  const def = getDef(inst.id);
  let name = def.name;
  if (def.type === 'injector' && inst.mod) name = `${INJECTOR_MODS[inst.mod].name} ${name}`;
  if (def.type === 'weapon') {
    if (inst.special && !def.special) name = `${specials[inst.special].name} ${name}`;
    const race = topRace(inst);
    if (race && race.pct * 2 >= raceCap(def.tier)) name += ` ${RACE_SUFFIX[race.race]}`;
    if (inst.grind) name += ` +${inst.grind}`;
  }
  if (inst.qty !== undefined && inst.qty > 1) name += ` x${inst.qty}`;
  return name;
}

/** The weapon's highest race % (the first in ATTRS order on a tie), or null if it has none. */
function topRace(inst: ItemInstance): { race: Race; pct: number } | null {
  let best: { race: Race; pct: number } | null = null;
  for (const a of ATTRS) {
    if (a === 'hit') continue;
    const pct = weaponRace(inst, a);
    if (pct > (best?.pct ?? 0)) best = { race: a, pct };
  }
  return best;
}

/** "A.Beast 25% · Hit 10%": race % with Bane levels counted, then Hit %. */
export function attrText(inst: ItemInstance): string {
  return ATTRS.map((a): [Attr, number] => [a, a === 'hit' ? (inst.attrs?.hit ?? 0) : weaponRace(inst, a)])
    .filter(([, v]) => v)
    .map(([a, v]) => `${ATTR_LABEL[a]} ${v}%`)
    .join(' · ');
}

/** "Grind 4/7 · Edge 2 · Machine 2" (Edge and race levels only once there are some). */
export function grindText(inst: ItemInstance): string {
  const def = getDef(inst.id);
  if (def.type !== 'weapon') return '';
  const parts = [`Grind ${inst.grind ?? 0}/${grindCap(def)}`];
  if (inst.grind) {
    const edge = edgeLevels(inst);
    if (edge) parts.push(`Edge ${edge}`);
    for (const [r, n] of Object.entries(inst.bane ?? {})) if (n) parts.push(`${ATTR_LABEL[r as Race]} ${n}`);
  }
  return parts.join(' · ');
}

export function itemSpecial(inst: ItemInstance): SpecialId | undefined {
  const def = getDef(inst.id);
  return def.type === 'weapon' ? (inst.special ?? def.special) : undefined;
}

export function sellPrice(inst: ItemInstance): number {
  const def = getDef(inst.id);
  let p = def.price / 4;
  if (def.type === 'weapon') {
    p += (inst.grind ?? 0) * 60;
    const attrSum = Object.values(inst.attrs ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    p += attrSum * 8;
    if (inst.special && !def.special) p += 150;
  }
  if (inst.mod) p *= 1.4;
  return Math.max(1, Math.floor(p)) * (inst.qty ?? 1);
}

/** Where a grind level goes: Edge (the weapon's own stats, against everything) or one race (Bane). */
export type GrindTrack = 'edge' | Race;

/** Grind levels spent on Edge: all of them minus the race (Bane) levels. */
export function edgeLevels(inst: ItemInstance): number {
  const bane = Object.values(inst.bane ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  return Math.max(0, (inst.grind ?? 0) - bane);
}

/** A weapon's % against `race`: its rolled attribute plus its Bane levels. */
export function weaponRace(inst: ItemInstance, race: Race): number {
  return (inst.attrs?.[race] ?? 0) + (inst.bane?.[race] ?? 0) * formulas.banePerGrind;
}

/**
 * What `edge` grind levels add to a weapon: a share of its own ATP and ATA, and of its MST (only weapons
 * that already give MST, so grinding a blade or a gun doesn't feed support techs).
 */
export function grindBonus(def: WeaponItemDef, edge: number): { atp: number; ata: number; mst: number } {
  return {
    atp: Math.round(edge * formulas.edgeAtpPct * ((def.atpMin + def.atpMax) / 2)),
    ata: Math.round(edge * formulas.edgeAtaPct * def.ata),
    mst: def.mst ? Math.round(edge * formulas.edgeMstPct * def.mst) : 0,
  };
}

/** What a grinder would do to a weapon on one track (the grind picker shows one per track). */
export interface GrindPreview {
  track: GrindTrack;
  /** Levels added: the grinder's amount, or fewer if a cap is in the way (0 = can't). */
  levels: number;
  /** Levels the grinder has beyond the cap, lost if it is used here. */
  wasted: number;
  /** Why no level fits ('' when some do). */
  reason: string;
  /** The weapon after grinding (a copy with its own uid, for simulateEquip). */
  after: ItemInstance;
}

/**
 * Spending `amount` grind levels on `track`, all on the same one. Every weapon has grindCap() levels in all;
 * a race also stops at the tier's roll cap (rolled % + Bane), so a good roll needs fewer levels.
 */
export function grindPreview(inst: ItemInstance, track: GrindTrack, amount: number): GrindPreview {
  const def = getDef(inst.id);
  const after: ItemInstance = { ...inst, uid: newUid(), attrs: inst.attrs && { ...inst.attrs }, bane: inst.bane && { ...inst.bane } };
  if (def.type !== 'weapon') return { track, levels: 0, wasted: amount, reason: 'Not a weapon', after };
  const cur = inst.grind ?? 0;
  let room = grindCap(def) - cur;
  let reason = room > 0 ? '' : 'Fully ground';
  if (track !== 'edge' && room > 0) {
    const cap = raceCap(def.tier);
    room = Math.min(room, formulas.banePerGrind > 0 ? Math.floor((cap - weaponRace(inst, track)) / formulas.banePerGrind) : 0);
    if (room <= 0) reason = `${ATTR_LABEL[track]} is at this tier's cap (${cap}%)`;
  }
  const levels = Math.max(0, Math.min(amount, room));
  if (levels) {
    after.grind = cur + levels;
    if (track !== 'edge') after.bane = { ...after.bane, [track]: (after.bane?.[track] ?? 0) + levels };
  }
  return { track, levels, wasted: amount - levels, reason, after };
}

/** The weapon used when nothing is equipped. */
const BARE_HANDS: WeaponItemDef = {
  id: '__bare', type: 'weapon', name: 'Bare hands', kind: 'saber', tier: 0,
  atpMin: 5, atpMax: 10, ata: 10, req: 0, price: 0,
};

export class Character {
  /** Set when loading refunded every attribute point and Mag square (the build rules changed: BUILD_VERSION). */
  readonly refunded: boolean = false;

  constructor(public data: CharacterData) {
    data.mag = readMag(data.mag);
    data.attributes = { ...noAttributes(), ...data.attributes };
    if (data.build !== BUILD_VERSION) {
      this.refunded = Object.values(data.attributes).some((n) => n > 0) || data.mag.cells.length > 0;
      data.attributes = noAttributes();
      data.mag = newMag();
      data.build = BUILD_VERSION;
    }
    // The Ruins moved Nightmare behind Dark Falz: characters who had already opened it keep it.
    if ((data.content ?? 0) < 1) {
      if ((data.stats.wardenKills ?? 0) > 0) data.stats.nightmareKept = true;
      data.content = CONTENT_VERSION;
    }
  }

  static create(name: string, kitId: KitId, appearance?: Look): Character {
    const kit = KITS[kitId];
    const weapon = makeItem(kit.startWeapon);
    const frame = makeItem('frame_1');
    const injector = makeItem(kit.startInjector);
    const data: CharacterData = {
      version: SAVE_VERSION,
      name,
      kit: kitId,
      appearance: appearance && { ...appearance, colors: appearance.colors && Object.keys(appearance.colors).length ? { ...appearance.colors } : undefined },
      attributes: noAttributes(),
      build: BUILD_VERSION,
      content: CONTENT_VERSION,
      level: 1,
      xp: 0,
      meseta: 300,
      inventory: [weapon, frame, injector, ...kit.startItems.map(([id, qty]) => makeItem(id, { qty }))],
      equipped: { weapon: weapon.uid, frame: frame.uid, injector: injector.uid },
      palette: kit.palette.map((row) => ({ mouse: row.mouse, quick: [{ ...row.quick[0] }, { ...row.quick[1] }] })),
      mag: newMag(),
      stats: { kills: 0, deaths: 0, dragonKills: 0, playSeconds: 0 },
    };
    return new Character(data);
  }

  get kit(): KitDef {
    return KITS[this.data.kit] ?? KITS.vanguard;
  }

  get level() {
    return this.data.level;
  }

  // -------------------------------------------------------- attributes

  /** Attribute points earned so far (none at Lv 1). */
  get attributePointsEarned(): number {
    return attributePointsEarned(this.data.level, attributeCfg.pointsPerLevel);
  }

  /** Unspent attribute points. */
  get attributePoints(): number {
    const spent = ATTRIBUTES.reduce((n, a) => n + this.data.attributes[a], 0);
    return Math.max(0, this.attributePointsEarned - spent);
  }

  /** Put points into an attribute (permanent). Returns why not, or null when spent. */
  spendAttribute(attr: AttributeId, n = 1): string | null {
    if (!ATTRIBUTE_INFO[attr]) return 'No such attribute';
    if (n < 1 || n > this.attributePoints) return 'No attribute points left. Level up to earn more.';
    this.data.attributes[attr] += n;
    return null;
  }

  /** The attribute with the most points (the kit's on a tie): the title and the Mag's first form follow it. */
  get leadAttribute(): AttributeId {
    return leadAttribute(this.data.kit, this.data.attributes);
  }

  /** "Vanguard", "Ranger", "Mystic" or "Guardian". */
  get title(): string {
    return buildTitle(this.data.kit, this.data.attributes);
  }

  /** Builds that fight with techniques: MIND leads, or a cane, rod or wand is in hand (damage tables show the selected tech). */
  get prefersMagic(): boolean {
    return this.leadAttribute === 'mind' || this.weaponKind().reqStat === 'mst';
  }

  /** The stat drops and shops lean toward: the equipped weapon's (ATP blades, ATA guns, MST staves). */
  lootBias(): 'atp' | 'ata' | 'mst' {
    return this.weaponKind().reqStat;
  }

  // ------------------------------------------------------------- stats

  get mag(): MagData {
    return (this.data.mag ??= newMag());
  }

  /** Unspent Mag points. */
  get magPoints(): number {
    return magPointsFree(this.mag, this.data.level);
  }

  hasMagPassive(p: MagPassive): boolean {
    return hasPassive(this.mag, p);
  }

  /** Level-up stats: the kit's start, the shared growth and attribute points. */
  baseStats(): Stats {
    return statsAtLevel(this.kit, this.data.level, this.data.attributes);
  }

  /** Base + Mag: what equipment requirements check (the Mag is part of you; gear bonuses don't count). */
  reqStats(): Stats {
    const s = this.baseStats();
    for (const [k, v] of Object.entries(magBonuses(this.mag))) s[k as StatKey] += v;
    return s;
  }

  /** Stats including Mag and equipment (not runtime buffs). Weapon ATP is rolled per hit, not included. */
  stats(): Stats {
    const s = this.reqStats();
    const w = this.weaponDef();
    const g = grindBonus(w, this.weaponEdge());
    s.ata += w.ata + g.ata;
    s.mst += (w.mst ?? 0) + g.mst;
    for (const slot of ['frame', 'barrier'] as const) {
      const inst = this.equippedItem(slot);
      if (!inst) continue;
      const def = getDef(inst.id);
      if (def.type === 'armor') {
        s.dfp += def.dfp;
        s.evp += def.evp;
        s.atp += def.atp ?? 0;
        s.ata += def.ata ?? 0;
        s.mst += def.mst ?? 0;
        s.tp += def.tp ?? 0;
      }
    }
    return s;
  }

  get maxHp() {
    return this.baseStats().hp;
  }

  get maxTp() {
    return this.stats().tp;
  }

  xpToNext(): number {
    return xpToNext(this.data.level);
  }

  /** Adds XP; returns number of levels gained. */
  addXp(amount: number): number {
    let gained = 0;
    this.data.xp += amount;
    while (this.data.level < MAX_LEVEL && this.data.xp >= xpToNext(this.data.level)) {
      this.data.xp -= xpToNext(this.data.level);
      this.data.level++;
      gained++;
    }
    return gained;
  }

  // ------------------------------------------------------------ weapon

  weaponInstance(): ItemInstance | undefined {
    return this.equippedItem('weapon');
  }

  weaponDef(): WeaponItemDef {
    const inst = this.weaponInstance();
    if (!inst) return BARE_HANDS;
    const def = getDef(inst.id);
    return def.type === 'weapon' ? def : BARE_HANDS;
  }

  weaponKind(): WeaponKindDef {
    return weaponKinds[this.weaponDef().kind];
  }

  /** Grind levels the equipped weapon has on Edge. */
  weaponEdge(): number {
    const inst = this.weaponInstance();
    return inst ? edgeLevels(inst) : 0;
  }

  weaponSpecial(): SpecialId | undefined {
    const inst = this.weaponInstance();
    return inst ? itemSpecial(inst) : undefined;
  }

  /** The equipped weapon's Hit % or race % (rolled plus Bane levels). */
  weaponAttr(attr: Attr): number {
    const inst = this.weaponInstance();
    if (!inst) return 0;
    return attr === 'hit' ? (inst.attrs?.hit ?? 0) : weaponRace(inst, attr);
  }

  /** Weapon ATP range including grind. */
  weaponAtp(): [number, number] {
    const w = this.weaponDef();
    const g = grindBonus(w, this.weaponEdge()).atp;
    return [w.atpMin + g, w.atpMax + g];
  }

  // --------------------------------------------------------- inventory

  find(uid: string): ItemInstance | undefined {
    return this.data.inventory.find((i) => i.uid === uid);
  }

  equippedItem(slot: GearSlot): ItemInstance | undefined {
    const uid = this.data.equipped[slot];
    return uid ? this.find(uid) : undefined;
  }

  /** The equipped injector (key 1). */
  injector(): ItemInstance | undefined {
    return this.equippedItem('injector');
  }

  isEquipped(uid: string): boolean {
    return GEAR_SLOTS.some((s) => this.data.equipped[s] === uid);
  }

  /** Is an item with this id worn in any gear slot? */
  hasEquipped(id: string): boolean {
    return GEAR_SLOTS.some((s) => this.equippedItem(s)?.id === id);
  }

  countOf(id: string): number {
    return this.data.inventory.filter((i) => i.id === id).reduce((n, i) => n + (i.qty ?? 1), 0);
  }

  get full(): boolean {
    return this.data.inventory.length >= INVENTORY_SIZE;
  }

  /** Can this instance be added without exceeding capacity? */
  canAdd(inst: ItemInstance): boolean {
    const def = getDef(inst.id);
    if (isStackable(def)) {
      const stack = this.data.inventory.find((i) => i.id === inst.id);
      if (stack && (stack.qty ?? 1) + (inst.qty ?? 1) <= stackCap(def)) return true;
      if (stack) return false; // single stack per item type, like PSO
    }
    return !this.full;
  }

  addItem(inst: ItemInstance): boolean {
    if (!this.canAdd(inst)) return false;
    const def = getDef(inst.id);
    if (isStackable(def)) {
      const stack = this.data.inventory.find((i) => i.id === inst.id);
      if (stack) {
        stack.qty = (stack.qty ?? 1) + (inst.qty ?? 1);
        return true;
      }
    }
    this.data.inventory.push(inst);
    return true;
  }

  /** Remove qty from a stack (or the whole item). Unequips if needed. */
  removeItem(uid: string, qty = 1): ItemInstance | undefined {
    const idx = this.data.inventory.findIndex((i) => i.uid === uid);
    if (idx < 0) return undefined;
    const inst = this.data.inventory[idx];
    if (inst.qty !== undefined && inst.qty > qty) {
      inst.qty -= qty;
      return { ...inst, uid: newUid(), qty };
    }
    this.data.inventory.splice(idx, 1);
    this.unequip(uid);
    return inst;
  }

  /** Remove one item of a given def id (first stack). */
  consume(id: string): boolean {
    const inst = this.data.inventory.find((i) => i.id === id);
    if (!inst) return false;
    this.removeItem(inst.uid, 1);
    return true;
  }

  /** Whether the item can be worn now; `need` is set when only a stat requirement is in the way. */
  canEquip(inst: ItemInstance): { ok: boolean; reason?: string; need?: { stat: StatKey; req: number } } {
    const def = getDef(inst.id);
    const have = this.reqStats();
    if (def.type === 'weapon') {
      const stat = weaponKinds[def.kind].reqStat;
      if (have[stat] < def.req) return { ok: false, reason: reqReason(stat, def.req, have[stat]), need: { stat, req: def.req } };
      return { ok: true };
    }
    if (def.type === 'armor') {
      const line = armorLines[def.line];
      if (line.reqStat && have[line.reqStat] < def.req)
        return { ok: false, reason: reqReason(line.reqStat, def.req, have[line.reqStat]), need: { stat: line.reqStat, req: def.req } };
      return { ok: true };
    }
    if (def.type === 'injector') {
      const stat = INJECTOR_REQ_STAT[def.kind];
      if (have[stat] < def.req) return { ok: false, reason: reqReason(stat, def.req, have[stat]), need: { stat, req: def.req } };
      return { ok: true };
    }
    return { ok: false, reason: 'Not equippable' };
  }

  /** Equip into its slot (replacing what was there). */
  equip(uid: string): { ok: boolean; reason?: string } {
    const inst = this.find(uid);
    if (!inst) return { ok: false, reason: 'No such item' };
    const check = this.canEquip(inst);
    if (!check.ok) return check;
    const slot = gearSlot(inst);
    if (slot) this.data.equipped[slot] = uid;
    return { ok: true };
  }

  unequip(uid: string): void {
    const e = this.data.equipped;
    for (const s of GEAR_SLOTS) if (e[s] === uid) delete e[s];
  }

  /** Apply a grinder to a weapon: all its levels go to `track` (Edge or a race), as many as fit. */
  grind(weaponUid: string, grinderUid: string, track: GrindTrack = 'edge'): { ok: boolean; reason?: string; levels?: number; wasted?: number } {
    const w = this.find(weaponUid);
    const g = this.find(grinderUid);
    if (!w || !g) return { ok: false, reason: 'Missing item' };
    const gd = getDef(g.id);
    if (getDef(w.id).type !== 'weapon' || gd.type !== 'grinder') return { ok: false, reason: 'Invalid' };
    const p = grindPreview(w, track, gd.amount);
    if (!p.levels) return { ok: false, reason: p.reason };
    w.grind = p.after.grind;
    if (p.after.bane) w.bane = p.after.bane;
    this.removeItem(grinderUid, 1);
    return { ok: true, levels: p.levels, wasted: p.wasted };
  }

  // -------------------------------------------------------- techniques

  /**
   * TP for one cast of this tech in this form at the current MST (support techs always cost the light
   * price). Combat adds Clarity on top.
   */
  techCost(tech: TechId, form: AttackType = 'light'): number {
    let mult = isAttackTech(tech) ? spellForms[form].tpMult : 1;
    if (isAttackTech(tech) && this.hasMagPassive('efficiency')) mult *= magCfg.efficiencyTpMult;
    return Math.round(techTpCost(tech, this.stats().mst) * mult);
  }

  /** Attack damage of one cast before its form, perfect streak and crits: MST and the weapon's technique boost. */
  techDamage(tech: TechId): number {
    return techAttackPower(tech, this.stats().mst) * this.weaponKind().techBoost;
  }

  /** The attack technique the magic source casts. */
  selectedTech(): TechId {
    const sel = this.data.selectedTech;
    return sel && ATTACK_TECHS.includes(sel) ? sel : ATTACK_TECHS[0];
  }

  /** Step the selected attack technique (mouse wheel). */
  cycleTech(dir: number): TechId {
    const n = ATTACK_TECHS.length;
    const i = ATTACK_TECHS.indexOf(this.selectedTech());
    this.data.selectedTech = ATTACK_TECHS[(i + Math.sign(dir) + n) % n];
    return this.data.selectedTech;
  }
}

// ------------------------------------------------------------ comparison

/** One injector slot (key 1), Mate or Fluid: the sustain budget for a floor. */
export type GearSlot = 'weapon' | 'frame' | 'barrier' | 'injector';
export const GEAR_SLOTS: GearSlot[] = ['weapon', 'frame', 'barrier', 'injector'];

/** The slot an item goes in, or null if it isn't gear. */
export function gearSlot(inst: ItemInstance): GearSlot | null {
  const def = getDef(inst.id);
  if (def.type === 'weapon') return 'weapon';
  if (def.type === 'armor') return def.slot;
  if (def.type === 'injector') return 'injector';
  return null;
}

export function fitsSlot(inst: ItemInstance, slot: GearSlot): boolean {
  return gearSlot(inst) === slot;
}

/** Stats that equipment changes. */
export interface GearSnapshot {
  atp: [number, number];
  ata: number;
  dfp: number;
  evp: number;
  /** Flat stats armor can add. */
  bonusAtp: number;
  mst: number;
  tp: number;
  attrs: Record<Attr, number>;
  special: string;
}

export interface CompareRow {
  label: string;
  before: string;
  after: string;
  /** Change in the compared value (positive = better). */
  delta: number;
}

function snapshot(ch: Character): GearSnapshot {
  const s = ch.stats();
  const sp = ch.weaponSpecial();
  return {
    atp: ch.weaponAtp(),
    ata: s.ata,
    dfp: s.dfp,
    evp: s.evp,
    bonusAtp: s.atp,
    mst: s.mst,
    tp: s.tp,
    attrs: Object.fromEntries(ATTRS.map((a) => [a, ch.weaponAttr(a)])) as Record<Attr, number>,
    special: sp ? specials[sp].name : '—',
  };
}

/** A throwaway copy of `ch` with `inst` equipped in `slot` (it may come from outside the inventory, e.g. shop stock). */
export function simulateEquip(ch: Character, inst: ItemInstance, slot: GearSlot): Character {
  const sim = new Character(JSON.parse(JSON.stringify(ch.data)) as CharacterData);
  if (!sim.find(inst.uid)) sim.data.inventory.push({ ...inst });
  sim.data.equipped[slot] = inst.uid;
  return sim;
}

/**
 * What equipping `inst` would change, against what is in its slot now.
 * Works for items not in the inventory yet (shop stock). Requirements are
 * ignored here; callers show canEquip() separately.
 */
export function compareEquip(ch: Character, inst: ItemInstance): { slot: GearSlot; current?: ItemInstance; rows: CompareRow[] } | null {
  const slot = gearSlot(inst);
  if (!slot || injectorDef(inst)) return null;
  const before = snapshot(ch);
  const after = snapshot(simulateEquip(ch, inst, slot));
  const rows: CompareRow[] = [];
  const num = (label: string, a: number, b: number) => rows.push({ label, before: `${a}`, after: `${b}`, delta: b - a });
  if (slot === 'weapon') {
    const avg = (r: [number, number]) => (r[0] + r[1]) / 2;
    rows.push({ label: 'ATP', before: `${before.atp[0]}-${before.atp[1]}`, after: `${after.atp[0]}-${after.atp[1]}`, delta: avg(after.atp) - avg(before.atp) });
    num('ATA', before.ata, after.ata);
    if (before.mst !== after.mst) num('MST', before.mst, after.mst);
    for (const a of ATTRS) if (before.attrs[a] || after.attrs[a]) rows.push({ label: ATTR_LABEL[a], before: `${before.attrs[a]}%`, after: `${after.attrs[a]}%`, delta: after.attrs[a] - before.attrs[a] });
    if (before.special !== after.special) rows.push({ label: 'Special', before: before.special, after: after.special, delta: 0 });
  } else {
    num('DFP', before.dfp, after.dfp);
    num('EVP', before.evp, after.evp);
    // Line bonuses: only listed when they change.
    const extra: [string, number, number][] = [['ATP', before.bonusAtp, after.bonusAtp], ['ATA', before.ata, after.ata], ['MST', before.mst, after.mst], ['TP', before.tp, after.tp]];
    for (const [label, a, b] of extra) if (a !== b) num(label, a, b);
  }
  return { slot, current: ch.equippedItem(slot), rows };
}

/** How much one point of each armor stat is worth, in rough % of fight outcome (see items.ts). */
const ARMOR_WEIGHT: Record<string, number> = { DFP: 1.5, EVP: 0.3, ATP: 0.7, ATA: 0.5, MST: 0.4, TP: 0.2 };

/** Quick verdict for list rows: +1 better, -1 worse, 0 same (by the slot's headline stats). */
export function gearVerdict(ch: Character, inst: ItemInstance): number {
  const c = compareEquip(ch, inst);
  if (!c || ch.isEquipped(inst.uid)) return 0;
  return rowsVerdict(c.slot, c.rows);
}

function rowsVerdict(slot: GearSlot, rows: CompareRow[]): number {
  if (slot !== 'weapon') return Math.sign(rows.reduce((t, r) => t + r.delta * (ARMOR_WEIGHT[r.label] ?? 1), 0));
  // Weapons: ATP first; on a tie, attributes and gaining (or losing) a special decide.
  if (rows[0].delta) return Math.sign(rows[0].delta);
  const sp = rows.find((r) => r.label === 'Special');
  const spDelta = sp ? (sp.before === '—' ? 1 : sp.after === '—' ? -1 : 0) : 0;
  return Math.sign(rows.slice(1).reduce((t, r) => t + r.delta, 0) + spDelta * 10);
}

/** How a drop on the floor reads for this character: its look on the ground and the pickup prompt's note. */
export interface DropVerdict {
  /** junk: nothing about it beats what is equipped; upgrade: better and equippable now. */
  look: 'plain' | 'junk' | 'upgrade';
  /** The inventory's mark: up ▲, down ▼, same =, no ✖ ('' for items that aren't gear). */
  mark: '' | 'up' | 'down' | 'same' | 'no';
  /** "Needs MST 110 (you have 95)" or the stat changes ("ATP +14 · +Heat"). */
  note: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** The changed stats of a comparison, headline first: "ATP +14 · ATA −3 · +Heat". */
function changesText(rows: CompareRow[], max = 4): string {
  const parts: string[] = [];
  for (const r of rows) {
    if (r.label === 'Special') parts.push(r.before === '—' ? `+${r.after}` : r.after === '—' ? `no ${r.before}` : `${r.before} → ${r.after}`);
    else if (Math.round(r.delta)) parts.push(`${r.label} ${signed(Math.round(r.delta))}${r.after.endsWith('%') ? '%' : ''}`);
  }
  return parts.slice(0, max).join(' · ');
}

/**
 * Verdict for an item lying on the ground. Junk is gear where no stat beats what is equipped (worth only its
 * sell price). Requirements don't make an item junk: a locked upgrade stays plain, so it is still worth
 * carrying until the stat catches up.
 */
export function dropVerdict(ch: Character, inst: ItemInstance): DropVerdict {
  const def = getDef(inst.id);
  let stat: StatKey | null = null;
  if (def.type === 'weapon') stat = weaponKinds[def.kind].reqStat;
  else if (def.type === 'armor') stat = armorLines[def.line].reqStat;
  else if (def.type === 'injector') stat = INJECTOR_REQ_STAT[def.kind];
  else return { look: 'plain', mark: '', note: '' };
  const have = stat ? ch.reqStats()[stat] : 0;
  const locked = stat && have < def.req ? `Needs ${stat.toUpperCase()} ${def.req} (you have ${have})` : '';
  const c = compareEquip(ch, inst);
  // Injectors aren't compared (two slots, either kind).
  if (!c) return { look: 'plain', mark: locked ? 'no' : '', note: locked };
  const v = rowsVerdict(c.slot, c.rows);
  const changes = changesText(c.rows);
  const better = c.rows.some((r) => (r.label === 'Special' ? r.after !== '—' : Math.round(r.delta) > 0));
  if (!better) return { look: 'junk', mark: v < 0 ? 'down' : 'same', note: changes ? `Downgrade: ${changes}` : 'Same as equipped' };
  if (locked) return { look: 'plain', mark: 'no', note: v > 0 ? `${locked} · ${changes}` : locked };
  return { look: v > 0 ? 'upgrade' : 'plain', mark: v > 0 ? 'up' : v < 0 ? 'down' : 'same', note: changes };
}

/** "DFP +13  EVP +4  ATP +2" */
export function armorStatText(def: ArmorItemDef): string {
  const parts = [`DFP +${def.dfp}`, `EVP +${def.evp}`];
  if (def.atp) parts.push(`ATP +${def.atp}`);
  if (def.ata) parts.push(`ATA +${def.ata}`);
  if (def.mst) parts.push(`MST +${def.mst}`);
  if (def.tp) parts.push(`TP +${def.tp}`);
  return parts.join('  ');
}

export function describeItem(inst: ItemInstance, ch?: Character): string[] {
  const def: ItemDef = getDef(inst.id);
  const lines: string[] = [];
  switch (def.type) {
    case 'weapon': {
      const kind = weaponKinds[def.kind];
      const g = grindBonus(def, edgeLevels(inst));
      lines.push(`${kind.label}${def.rare ? ' · ★ RARE' : ''}`);
      // What the kind itself does (reach, Poise, technique boost, TP on hit) is common knowledge: only this item's numbers.
      lines.push(`ATP ${def.atpMin + g.atp}-${def.atpMax + g.atp}  ATA ${def.ata + g.ata}${def.mst ? `  MST +${def.mst + g.mst}` : ''}`);
      lines.push(grindText(inst));
      const sp = itemSpecial(inst);
      if (sp) lines.push(`Special: ${specials[sp].name}`);
      const at = attrText(inst);
      if (at) lines.push(at);
      if (def.req) lines.push(`Req: ${kind.reqStat.toUpperCase()} ${def.req}`);
      break;
    }
    case 'armor': {
      const line = armorLines[def.line];
      lines.push(`${line.label} ${def.slot === 'frame' ? 'Frame' : 'Barrier'}${def.rare ? ' · ★ RARE' : ''}`);
      lines.push(armorStatText(def));
      if (def.line !== 'basic') lines.push(line.desc);
      if (line.reqStat && def.req) lines.push(`Req: ${line.reqStat.toUpperCase()} ${def.req}`);
      break;
    }
    case 'consumable':
      lines.push(`Carry up to ${stackCap(def)}${def.fieldOnly ? ' · field only' : ''} · use it from the Items tab or a Q / E quick slot`);
      break;
    case 'injector':
      lines.push(...describeInjector(inst, ch));
      break;
    case 'grinder':
      lines.push(`Grinds a weapon +${def.amount} (weapons take ${grindCap({ tier: 1 })}-${grindCap({ tier: 9 })} levels, rares 2 more)`);
      lines.push(`Edge, per level: +${Math.round(formulas.edgeAtpPct * 100)}% of the weapon's ATP and ATA, +${Math.round(formulas.edgeMstPct * 100)}% of its MST (canes, rods, wands)`);
      lines.push(`A race, per level: +${formulas.banePerGrind}% damage against it, up to the tier's attribute cap`);
      break;
  }
  if (def.desc) lines.push(def.desc);
  if (ch && (def.type === 'weapon' || def.type === 'armor' || def.type === 'injector')) {
    const c = ch.canEquip(inst);
    if (!c.ok) lines.push(`✖ ${c.reason}`);
  }
  return lines;
}
