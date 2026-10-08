import { armorLines, INJECTOR_REQ_STAT, MAX_STACK, weaponKinds, type ItemDef } from './data/items';
import type { StatKey } from './data/stats';

// What each item type does in the inventory: where it is worn, what wearing it requires and how it stacks.
// Adding a type to ItemDef is a compile error here until it has a row. Menu text per type is ITEM_TEXT in
// character.ts.

/** One injector slot (key 1), Mate or Fluid: the sustain budget for a floor. */
export type GearSlot = 'weapon' | 'frame' | 'barrier' | 'injector';
export const GEAR_SLOTS: GearSlot[] = ['weapon', 'frame', 'barrier', 'injector'];

export type ItemType = ItemDef['type'];
export type ItemDefOf<T extends ItemType> = Extract<ItemDef, { type: T }>;

/** An equip requirement: base + Mag `stat` must reach `req`. */
export interface Requirement {
  stat: StatKey;
  req: number;
}

export interface ItemTypeHandler<D extends ItemDef = ItemDef> {
  /** The gear slot it is worn in, or null for items that stay in the bag. */
  slot(def: D): GearSlot | null;
  /** What wearing it requires, or null if anyone can. */
  requirement(def: D): Requirement | null;
  /** Most one stack holds, or 0 when each one takes its own inventory row. */
  maxStack(def: D): number;
}

const need = (stat: StatKey | null, req: number): Requirement | null => (stat && req ? { stat, req } : null);

export const ITEM_TYPES: { [T in ItemType]: ItemTypeHandler<ItemDefOf<T>> } = {
  weapon: { slot: () => 'weapon', requirement: (d) => need(weaponKinds[d.kind].reqStat, d.req), maxStack: () => 0 },
  armor: { slot: (d) => d.slot, requirement: (d) => need(armorLines[d.line].reqStat, d.req), maxStack: () => 0 },
  injector: { slot: () => 'injector', requirement: (d) => need(INJECTOR_REQ_STAT[d.kind], d.req), maxStack: () => 0 },
  consumable: { slot: () => null, requirement: () => null, maxStack: (d) => d.maxStack ?? MAX_STACK },
  grinder: { slot: () => null, requirement: () => null, maxStack: () => MAX_STACK },
};

/** The handler for `def`'s type. */
export function itemType<D extends ItemDef>(def: D): ItemTypeHandler<D> {
  return ITEM_TYPES[def.type] as unknown as ItemTypeHandler<D>;
}

/** The slot an item is worn in, or null if it isn't gear. */
export function itemSlot(def: ItemDef): GearSlot | null {
  return itemType(def).slot(def);
}

/** Weapons, armour and injectors: worn in a slot, one per inventory row. */
export function isGear(def: ItemDef): boolean {
  return itemSlot(def) !== null;
}

/** What wearing it requires (base + Mag), or null if nothing. */
export function itemRequirement(def: ItemDef): Requirement | null {
  return itemType(def).requirement(def);
}

export function isStackable(def: ItemDef): boolean {
  return itemType(def).maxStack(def) > 0;
}

/** Most of one item you can carry in its stack. */
export function stackCap(def: ItemDef): number {
  return itemType(def).maxStack(def) || MAX_STACK;
}
