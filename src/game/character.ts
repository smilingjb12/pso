import { formulas, magCfg, spellForms, type AttackType } from './config';
import type { Look, LookColors } from './models/heroine';
import { classes, statsAtLevel, xpToNext, MAX_LEVEL, type PaletteRow, type QuickAction, type StatKey, type Stats } from './data/classes';
import {
  armorLines,
  ATTR_LABEL,
  ATTRS,
  CLASS_ARMOR_LINE,
  getDef,
  INJECTOR_MODS,
  INJECTOR_REQ_STAT,
  itemDefs,
  INVENTORY_SIZE,
  isStackable,
  legacyDiskRefund,
  LEGACY_REFUND,
  specials,
  stackCap,
  weaponKinds,
  type ArmorItemDef,
  type Attr,
  type ClassId,
  type InjectorMod,
  type ItemDef,
  type SpecialId,
  type WeaponItemDef,
  type WeaponKindDef,
} from './data/items';
import { ATTACK_TECHS, isAttackTech, techAttackPower, techTpCost, type TechId } from './data/techniques';
import { describeInjector, injectorDef } from './injectors';
import { hasPassive, magBonuses, magPointsFree, migrateMag, newMag, type MagData, type MagPassive } from './mag';

// Persistent character state plus derived-stat helpers. No rendering here.

export interface ItemInstance {
  uid: string;
  id: string;
  qty?: number;
  grind?: number;
  attrs?: Partial<Record<Attr, number>>;
  special?: SpecialId;
  /** Injectors: the rolled mod, and doses ready (undefined = full). */
  mod?: InjectorMod;
  charge?: number;
}

export interface CharacterData {
  /** 2: weapon race % halved (see migrateAttrs). */
  version: 1 | 2;
  name: string;
  classId: ClassId;
  /** Appearance chosen at creation. */
  appearance?: Look;
  /** Legacy: look id and colours from earlier saves (see playerLook()). */
  look?: string;
  colors?: LookColors;
  level: number;
  xp: number; // progress toward next level
  meseta: number;
  inventory: ItemInstance[];
  equipped: Partial<Record<GearSlot, string>>;
  /** Legacy: technique levels learned from disks. Disks are gone (every class knows every technique); dropped on load. */
  techs?: Partial<Record<TechId, number>>;
  palette: PaletteRow[];
  /** Attack technique the magic source casts (cycled with the mouse wheel). */
  selectedTech?: TechId;
  /** The Mag's talent grid. Older saves (none, or the old fed-stat Mag) get a fresh grid on load. */
  mag?: MagData;
  /** deRolLeKills arrived with the Caves; older saves lack it. */
  stats: {
    kills: number;
    deaths: number;
    dragonKills: number;
    playSeconds: number;
    deRolLeKills?: number;
    wardenKills?: number;
    dashes?: number;
    /** Bosses beaten on Hard (each opens the next Hard expedition and a shop tier). */
    hardKills?: { dragon?: number; derolle?: number; warden?: number };
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

export function itemName(inst: ItemInstance): string {
  const def = getDef(inst.id);
  let name = def.type === 'injector' && inst.mod ? `${INJECTOR_MODS[inst.mod].name} ${def.name}` : def.name;
  if (def.type === 'weapon' && inst.grind) name += ` +${inst.grind}`;
  if (inst.qty !== undefined && inst.qty > 1) name += ` x${inst.qty}`;
  return name;
}

export function attrText(inst: ItemInstance): string {
  if (!inst.attrs) return '';
  return Object.entries(inst.attrs)
    .filter(([, v]) => v)
    .map(([k, v]) => `${ATTR_LABEL[k as Attr]} ${v}%`)
    .join(' · ');
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

/**
 * What `grind` levels add to a weapon: ATP and ATA on every weapon, MST only on weapons that
 * already give MST (so Hunters' and Rangers' support techs don't grow with grinding).
 */
export function grindBonus(def: WeaponItemDef, grind: number): { atp: number; ata: number; mst: number } {
  return {
    atp: Math.round(grind * formulas.atpPerGrind),
    ata: Math.floor(grind * formulas.ataPerGrind),
    mst: def.mst ? Math.round(grind * formulas.mstPerGrind) : 0,
  };
}

/** The weapon used when nothing is equipped. */
const BARE_HANDS: WeaponItemDef = {
  id: '__bare', type: 'weapon', name: 'Bare hands', kind: 'saber', tier: 0,
  atpMin: 5, atpMax: 10, ata: 10, maxGrind: 0, req: 0, price: 0,
};

/** Old saves had one armor line (frame_2..4 / barrier_2..4); map them onto the class's own line. */
function migrateArmor(data: CharacterData): void {
  for (const it of data.inventory) {
    const m = /^(frame|barrier)_([2-4])$/.exec(it.id);
    if (m) it.id = `${m[1]}_${CLASS_ARMOR_LINE[data.classId]}_${m[2]}`;
    if (!itemDefs[it.id]) it.id = it.id.startsWith('barrier') ? 'barrier_1' : 'frame_1';
  }
}

/**
 * Old saves had three-slot rows of attacks / techs / items. Rebuild the class's default rows,
 * carry their items and support techs over to the quick slots, and select the first attack tech.
 */
function migratePalette(data: CharacterData): void {
  const old = data.palette as unknown;
  if (!Array.isArray(old) || !old.length || !Array.isArray(old[0])) return;
  const actions = (old as { kind: string; item?: string; tech?: TechId }[][]).flat();
  const quick: QuickAction[] = [];
  for (const a of actions) {
    if (a.kind === 'item' && a.item) quick.push({ kind: 'item', item: a.item });
    else if (a.kind === 'tech' && a.tech) {
      if (isAttackTech(a.tech)) data.selectedTech ??= a.tech;
      else quick.push({ kind: 'tech', tech: a.tech });
    }
  }
  const empty: QuickAction = { kind: 'empty' };
  data.palette = classes[data.classId].palette.map((row, r) => ({
    mouse: row.mouse,
    quick: [quick[r * 2] ?? empty, quick[r * 2 + 1] ?? empty],
  }));
}

/** Technique disks were removed: refund leftover ones (what selling them paid) and forget learned levels. */
function migrateDisks(data: CharacterData): void {
  delete data.techs;
  data.inventory = data.inventory.filter((i) => {
    const refund = legacyDiskRefund(i.id);
    if (refund === null) return true;
    data.meseta += refund * (i.qty ?? 1);
    return false;
  });
}

/**
 * The injector rework removed mates, fluids, cures and revive items: refund them at their old price,
 * point palette slots that used them at the matching injector, and hand out the starter injectors.
 */
function migrateConsumables(data: CharacterData): void {
  if (!data.inventory.some((i) => itemDefs[i.id]?.type === 'injector')) {
    const [mate, fluid] = [makeItem('mate_1'), makeItem('fluid_1')];
    data.inventory.push(mate, fluid);
    data.equipped.inj1 = mate.uid;
    data.equipped.inj2 = fluid.uid;
  }
  let refund = 0;
  data.inventory = data.inventory.filter((i) => {
    if (!(i.id in LEGACY_REFUND)) return true;
    refund += LEGACY_REFUND[i.id] * (i.qty ?? 1);
    return false;
  });
  data.meseta += refund;
  for (const it of data.inventory) {
    const def = itemDefs[it.id];
    if (def?.type === 'consumable' && (it.qty ?? 1) > stackCap(def)) it.qty = stackCap(def);
  }
  // Mate-like palette items go to the Mate injector's slot, fluid-like ones to the Fluid one.
  const slotOf = (kind: 'mate' | 'fluid'): 0 | 1 => {
    const i = INJECTOR_SLOTS.findIndex((s) => {
      const def = itemDefs[data.inventory.find((it) => it.uid === data.equipped[s])?.id ?? ''];
      return def?.type === 'injector' && def.kind === kind;
    });
    return (i < 0 ? (kind === 'mate' ? 0 : 1) : i) as 0 | 1;
  };
  const LEGACY_KIND: Record<string, 'mate' | 'fluid'> = { monomate: 'mate', dimate: 'mate', monofluid: 'fluid', difluid: 'fluid' };
  for (const row of data.palette) {
    row.quick = row.quick.map((q): QuickAction => {
      if (q.kind !== 'item' || !(q.item in LEGACY_REFUND)) return q;
      const kind = LEGACY_KIND[q.item];
      return kind ? { kind: 'injector', slot: slotOf(kind) } : { kind: 'empty' };
    }) as PaletteRow['quick'];
  }
}

/** Race % rolls were halved (they boost techs too now): halve them on older saves' weapons, to the nearest 5. Hit % is unchanged. */
function migrateAttrs(data: CharacterData): void {
  if (data.version >= 2) return;
  for (const it of data.inventory) {
    if (!it.attrs) continue;
    for (const a of ATTRS) {
      const v = it.attrs[a];
      if (a !== 'hit' && v) it.attrs[a] = Math.max(5, Math.round(v / 10) * 5);
    }
  }
  data.version = 2;
}

export class Character {
  constructor(public data: CharacterData) {
    data.mag = migrateMag(data.mag);
    migratePalette(data);
    // Before armor: that migration turns any unknown item id into a starter frame.
    migrateConsumables(data);
    migrateDisks(data);
    migrateArmor(data);
    migrateAttrs(data);
  }

  static create(name: string, classId: ClassId, appearance?: Look): Character {
    const cls = classes[classId];
    const weapon = makeItem(cls.startWeapon);
    const frame = makeItem('frame_1');
    const injectors = cls.startInjectors.map((id) => makeItem(id));
    const data: CharacterData = {
      version: 2,
      name,
      classId,
      appearance: appearance && { ...appearance, colors: appearance.colors && Object.keys(appearance.colors).length ? { ...appearance.colors } : undefined },
      level: 1,
      xp: 0,
      meseta: 300,
      inventory: [weapon, frame, ...injectors, ...cls.startItems.map(([id, qty]) => makeItem(id, { qty }))],
      equipped: { weapon: weapon.uid, frame: frame.uid, inj1: injectors[0]?.uid, inj2: injectors[1]?.uid },
      palette: cls.palette.map((row) => ({ mouse: row.mouse, quick: [{ ...row.quick[0] }, { ...row.quick[1] }] })),
      mag: newMag(),
      stats: { kills: 0, deaths: 0, dragonKills: 0, playSeconds: 0 },
    };
    return new Character(data);
  }

  get cls() {
    return classes[this.data.classId];
  }

  get level() {
    return this.data.level;
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

  /** Level-up stats only. */
  baseStats(): Stats {
    return statsAtLevel(this.cls, this.data.level);
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
    const g = grindBonus(w, this.weaponGrind());
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

  weaponGrind(): number {
    return this.weaponInstance()?.grind ?? 0;
  }

  weaponSpecial(): SpecialId | undefined {
    const inst = this.weaponInstance();
    return inst ? itemSpecial(inst) : undefined;
  }

  weaponAttr(attr: Attr): number {
    return this.weaponInstance()?.attrs?.[attr] ?? 0;
  }

  /** Weapon ATP range including grind. */
  weaponAtp(): [number, number] {
    const w = this.weaponDef();
    const g = grindBonus(w, this.weaponGrind()).atp;
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

  /** The injector in slot 0 or 1 (keys 1 / 2). */
  injector(slot: 0 | 1): ItemInstance | undefined {
    return this.equippedItem(INJECTOR_SLOTS[slot]);
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
      const kind = weaponKinds[def.kind];
      if (!kind.classes.includes(this.data.classId)) return { ok: false, reason: `${this.cls.name}s cannot use ${kind.label}s` };
      const stat = kind.reqStat;
      if (have[stat] < def.req) return { ok: false, reason: reqReason(stat, def.req, have[stat]), need: { stat, req: def.req } };
      return { ok: true };
    }
    if (def.type === 'armor') {
      const line = armorLines[def.line];
      if (!line.classes.includes(this.data.classId)) return { ok: false, reason: `${this.cls.name}s cannot wear ${line.label} armor` };
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

  /** Equip into its slot; an injector goes to `slot` if given (else the first free injector slot). */
  equip(uid: string, slot?: GearSlot): { ok: boolean; reason?: string } {
    const inst = this.find(uid);
    if (!inst) return { ok: false, reason: 'No such item' };
    const check = this.canEquip(inst);
    if (!check.ok) return check;
    const def = getDef(inst.id);
    const e = this.data.equipped;
    if (def.type === 'weapon') e.weapon = uid;
    else if (def.type === 'armor') e[def.slot] = uid;
    else if (def.type === 'injector') {
      const to = slot && fitsSlot(inst, slot) ? slot : (INJECTOR_SLOTS.find((s) => !e[s]) ?? 'inj1');
      this.unequip(uid);
      e[to] = uid;
    }
    return { ok: true };
  }

  unequip(uid: string): void {
    const e = this.data.equipped;
    for (const s of GEAR_SLOTS) if (e[s] === uid) delete e[s];
  }

  /** Apply a grinder to a weapon. */
  grind(weaponUid: string, grinderUid: string): { ok: boolean; reason?: string } {
    const w = this.find(weaponUid);
    const g = this.find(grinderUid);
    if (!w || !g) return { ok: false, reason: 'Missing item' };
    const wd = getDef(w.id);
    const gd = getDef(g.id);
    if (wd.type !== 'weapon' || gd.type !== 'grinder') return { ok: false, reason: 'Invalid' };
    const cur = w.grind ?? 0;
    if (cur >= wd.maxGrind) return { ok: false, reason: 'Already at max grind' };
    w.grind = Math.min(wd.maxGrind, cur + gd.amount);
    this.removeItem(grinderUid, 1);
    return { ok: true };
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

export type GearSlot = 'weapon' | 'frame' | 'barrier' | 'inj1' | 'inj2';
export const GEAR_SLOTS: GearSlot[] = ['weapon', 'frame', 'barrier', 'inj1', 'inj2'];
/** Injector slots, used with keys 1 and 2. Either takes a Mate or a Fluid injector. */
export const INJECTOR_SLOTS = ['inj1', 'inj2'] as const;

/** The slot an item goes in (an injector's first slot), or null if it isn't gear. */
export function gearSlot(inst: ItemInstance): GearSlot | null {
  const def = getDef(inst.id);
  if (def.type === 'weapon') return 'weapon';
  if (def.type === 'armor') return def.slot;
  if (def.type === 'injector') return 'inj1';
  return null;
}

export function fitsSlot(inst: ItemInstance, slot: GearSlot): boolean {
  const s = gearSlot(inst);
  return s === slot || (s === 'inj1' && slot === 'inj2');
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
  /** junk: the class can't use it, or nothing about it beats what is equipped; upgrade: better and equippable now. */
  look: 'plain' | 'junk' | 'upgrade';
  /** The inventory's mark: up ▲, down ▼, same =, no ✖ ('' for items that aren't gear). */
  mark: '' | 'up' | 'down' | 'same' | 'no';
  /** "Hunters can't use Rods", "Needs MST 110 (you have 95)" or the stat changes ("ATP +14 · +Heat"). */
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
 * Verdict for an item lying on the ground. Junk is gear the class can never use, or gear where no stat
 * beats what is equipped (worth only its sell price). Requirements don't make an item junk: a locked
 * upgrade stays plain, so it is still worth carrying until the stat catches up.
 */
export function dropVerdict(ch: Character, inst: ItemInstance): DropVerdict {
  const def = getDef(inst.id);
  const who = `${ch.cls.name}s`;
  let stat: StatKey | null = null;
  if (def.type === 'weapon') {
    const kind = weaponKinds[def.kind];
    if (!kind.classes.includes(ch.data.classId)) return { look: 'junk', mark: 'no', note: `${who} can't use ${kind.label}s` };
    stat = kind.reqStat;
  } else if (def.type === 'armor') {
    const line = armorLines[def.line];
    if (!line.classes.includes(ch.data.classId)) return { look: 'junk', mark: 'no', note: `${who} can't wear ${line.label} armor` };
    stat = line.reqStat;
  } else if (def.type === 'injector') stat = INJECTOR_REQ_STAT[def.kind];
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
      const g = grindBonus(def, inst.grind ?? 0);
      lines.push(`${kind.label}${def.rare ? ' · ★ RARE' : ''}`);
      // What the kind itself does (reach, Poise, technique boost, TP on hit) is common knowledge: only this item's numbers.
      lines.push(`ATP ${def.atpMin + g.atp}-${def.atpMax + g.atp}  ATA ${def.ata + g.ata}${def.mst ? `  MST +${def.mst + g.mst}` : ''}`);
      lines.push(`Grind ${inst.grind ?? 0}/${def.maxGrind}`);
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
      lines.push(`Classes: ${line.classes.map((c) => classes[c].name).join(', ')}`);
      break;
    }
    case 'consumable':
      lines.push(`Carry up to ${stackCap(def)}${def.fieldOnly ? ' · field only' : ''} · use it from a Q / E quick slot`);
      break;
    case 'injector':
      lines.push(...describeInjector(inst, ch));
      break;
    case 'grinder':
      lines.push(`Grinds a weapon +${def.amount}`);
      lines.push(`Each grind: ATP +${formulas.atpPerGrind}, ATA +${formulas.ataPerGrind}, MST +${formulas.mstPerGrind} (canes, rods, wands)`);
      break;
  }
  if (def.desc) lines.push(def.desc);
  if (ch && (def.type === 'weapon' || def.type === 'armor' || def.type === 'injector')) {
    const c = ch.canEquip(inst);
    if (!c.ok) lines.push(`✖ ${c.reason}`);
  }
  return lines;
}
