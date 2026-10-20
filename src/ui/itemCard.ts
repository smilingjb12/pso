import {
  bestCrafted, compareEquip, craftRecipe, decidingRow, describeItem, rowPct, gearSlot, grindBonus, grindLevels, itemName, itemSpecial, ownAffixes, rarityLine, rarityOf,
  simulateEquip, statDef, unitSlots, type Character, type CompareRow, type ItemInstance,
} from '../game/character';
import { PHOTON_RARITY } from '../game/crafting';
import { estimateDamage, type Foe } from '../game/dps';
import { affixText, ITEM_AFFIXES, penaltyText, type AffixRoll, type ItemAffixId } from '../game/data/itemAffixes';
import { getDef, specials, type ArmorItemDef } from '../game/data/items';
import { UNIQUES, type UniqueId } from '../game/data/uniques';
import { STAT_LABEL, statValue, type StatKey } from '../game/data/stats';
import { techniques } from '../game/data/techniques';
import { injectorDef } from '../game/injectors';
import { isGear, itemRequirement } from '../game/itemTypes';

// One item card for every item, and the comparison folded into it: when the item isn't the one worn, every number
// carries its change against the equipped piece, and what only the equipped piece gives is listed as "You'd lose".
// Layout: header (name, type line, requirement chip), the verdict line, stat tiles (flat affixes folded in, shown as
// a blue +N), the remaining affixes (a dot per role: offence, defence, utility, downside), a rare's dormant ones
// (greyed), chips (special, unit slots), a weapon's damage table, then a one-line flavour text.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** Affix dot: green for a plain gain, red for a downside affix (a gain paired with a penalty). */
const dotOf = (id: ItemAffixId): 'good' | 'bad' => (ITEM_AFFIXES[id].penalty ? 'bad' : 'good');

/** A tile: label, the item's value (text and number for deltas) and how much of it came from affixes. */
interface Tile {
  key: string;
  label: string;
  text: string;
  value: number;
  /** Part of the value from affixes (shown as a blue +N), 0 if none. */
  fromAffix: number;
}

/** Flat stats an item's affixes add, penalties included (a downside's damage taken raises both damage-taken tiles). */
function flatOf(rolls: AffixRoll[]): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  for (const r of rolls) {
    const d = ITEM_AFFIXES[r.id];
    if (d.stat) out[d.stat] = (out[d.stat] ?? 0) + r.v;
    if (d.penalty && r.p) for (const k of d.penalty.stat === 'dr' ? (['strike', 'area'] as const) : [d.penalty.stat]) out[k] = (out[k] ?? 0) - r.p;
  }
  return out;
}

/** A tile's change or affix part in the stat's own terms: "+12", "+0.4%" (crit chance), "−3%" (damage taken, less is better). */
function tileDelta(key: string, d: number): string {
  if (key === 'lck') return `${d > 0 ? '+' : '−'}${+(Math.abs(d) / 10).toFixed(1)}%`;
  if (key === 'strike' || key === 'area') return `${d > 0 ? '−' : '+'}${Math.abs(Math.round(d))}%`;
  return signed(Math.round(d));
}

/** The stat tiles of an item. Flat affixes of a tile's stat fold into it. */
function tilesOf(inst: ItemInstance): Tile[] {
  const def = statDef(inst);
  const rolls = ownAffixes(inst);
  const flat = flatOf(rolls);
  const tile = (key: StatKey, base: number): Tile => {
    const add = flat[key] ?? 0;
    return { key, label: STAT_LABEL[key], text: statValue(key, base + add), value: base + add, fromAffix: add };
  };
  if (def.type === 'weapon') {
    // The weapon's own range (flat Weapon damage affixes fold in); Weapon damage % stays a line: it multiplies the whole hit.
    const g = grindBonus(def, grindLevels(inst));
    const add = flat.atp ?? 0;
    const lo = def.atpMin + g.atp + add;
    const hi = def.atpMax + g.atp + add;
    const out: Tile[] = [{ key: 'atp', label: STAT_LABEL.atp, text: `${lo}-${hi}`, value: (lo + hi) / 2, fromAffix: add }];
    const mst = (def.bonus?.mst ?? 0) + g.mst;
    if (mst || flat.mst) out.push(tile('mst', mst));
    return out;
  }
  if (def.type === 'armor') {
    const out: Tile[] = [tile('strike', def.dr), tile('area', def.dr)];
    for (const k of ['atp', 'mst', 'lck', 'tp', 'hp'] as StatKey[]) if (def.bonus?.[k]) out.push(tile(k, def.bonus[k]!));
    return out;
  }
  return [];
}

/** The affix lines of an item: everything not folded into a tile. */
function linesOf(inst: ItemInstance, tileKeys: Set<string>): AffixRoll[] {
  return ownAffixes(inst).filter((r) => {
    const d = ITEM_AFFIXES[r.id];
    return !(d.stat && tileKeys.has(d.stat) && !d.penalty);
  });
}

/** How an affix line compares with the equipped item: 'new', a change, or nothing (same). */
function lineDelta(r: AffixRoll, inst: ItemInstance, other: ItemInstance | undefined): string {
  if (!other) return '';
  const def = ITEM_AFFIXES[r.id];
  const theirs = ownAffixes(other);
  // Flat stats compare as totals (penalties included): HP +8 against a Frail HP −6 is +14.
  if (def.stat && !def.penalty) {
    const mine = flatOf(ownAffixes(inst))[def.stat] ?? 0;
    const was = flatOf(theirs)[def.stat] ?? 0;
    const hits = (x: AffixRoll) => {
      const pen = ITEM_AFFIXES[x.id].penalty?.stat;
      return ITEM_AFFIXES[x.id].stat === def.stat || pen === def.stat || (pen === 'dr' && (def.stat === 'strike' || def.stat === 'area'));
    };
    if (!theirs.some(hits)) return '<span class="ic-new">new</span>';
    const d = mine - was;
    return d ? `<span class="ic-d ${d > 0 ? 'up' : 'down'}">${tileDelta(def.stat, d)}</span>` : '<span class="ic-d same">same</span>';
  }
  const was = theirs.find((x) => x.id === r.id);
  if (!was) return '<span class="ic-new">new</span>';
  const d = r.v - was.v;
  return d ? `<span class="ic-d ${d > 0 ? 'up' : 'down'}">${signed(d)}</span>` : '<span class="ic-d same">same</span>';
}

/** A unique's effect (good) and cost (bad), as affix-style lines. */
function uniqueHtml(id: UniqueId, lost = false): string {
  const u = UNIQUES[id];
  const line = (dot: 'good' | 'bad', text: string) => `<div class="ic-aff${lost ? ' lost' : ''}"><i class="ic-dot ${dot}"></i><span class="ic-txt">${esc(text)}</span></div>`;
  return line('good', u.effect) + line('bad', u.cost);
}

function affixLineHtml(r: AffixRoll, delta: string, state: '' | 'lost' | 'dormant' = ''): string {
  const def = ITEM_AFFIXES[r.id];
  const main = esc(def.text(r.v));
  const pen = def.penalty && r.p ? ` <span class="ic-pen">· ${esc(penaltyText(def.penalty.stat, r.p))}</span>` : '';
  return `<div class="ic-aff${state ? ` ${state}` : ''}"><i class="ic-dot ${dotOf(r.id)}"></i><span class="ic-txt">${main}${pen}</span>${delta}</div>`;
}

/** The weapon's damage per second (and % against the equipped weapon). */
function damageHtml(ch: Character, inst: ItemInstance, foe: Foe, equipped: boolean): string {
  const caster = ch.prefersMagic;
  const now = estimateDamage(ch, foe, caster);
  const est = equipped ? now : estimateDamage(simulateEquip(ch, inst, 'weapon'), foe, caster);
  const pct = (v: number, was: number) => {
    if (equipped) return '';
    const p = Math.round((v / Math.max(0.001, was) - 1) * 100);
    return p ? ` <i class="ic-d ${p > 0 ? 'up' : 'down'}">${signed(p)}%</i>` : '';
  };
  const cells =
    `${est.spell !== null && now.spell !== null ? `<td>${Math.round(est.spell)}${pct(est.spell, now.spell)}</td>` : ''}<td>${Math.round(est.weapon)}${pct(est.weapon, now.weapon)}</td>`;
  const spellHead = est.spell !== null ? `<th title="Chained heavy casts of your selected technique (the mouse wheel changes it)">Heavy ${techniques[est.tech].name}</th>` : '';
  const how = 'An estimate against one enemy: counts weapon damage, tech damage, crits, talents and swing / cast speed. Leaves out perfect chains, specials, buffs and TP.';
  return `<div class="ic-sec" title="${esc(how)}">Damage / sec vs. a typical ${esc(foe.label)} enemy</div>
    <table class="dps ic-dps"><tr><th></th>${spellHead}<th title="The best light / heavy mix of a 3-hit combo on one enemy">Weapon</th></tr><tr><td>Per second</td>${cells}</tr></table>`;
}

/**
 * "▲ +12%" in its colour and what it measures: the deciding row (damage / sec, or armour's overall rating when the
 * damage is the same), with armour's rating alongside when damage decides.
 */
function verdictParts(ch: Character, rows: CompareRow[]): { badge: string; what: string } {
  const d = decidingRow(rows);
  const p = d ? rowPct(d) : 0;
  const cls = p > 0 ? 'up' : p < 0 ? 'down' : 'same';
  const badge = `<b class="ic-d ${cls}">${p > 0 ? `▲ +${p}%` : p < 0 ? `▼ −${-p}%` : '= same'}</b>`;
  const dmg = ch.prefersMagic ? 'damage / sec (technique)' : 'damage / sec';
  const tie = rows.find((r) => r.tie);
  const tp = tie ? rowPct(tie) : 0;
  const what = d?.tie ? `overall, same ${dmg}` : tie && tp ? `${dmg} · overall ${tp > 0 ? '+' : '−'}${Math.abs(tp)}%` : dmg;
  return { badge, what };
}

/** The verdict line: the one number that decides ▲ / ▼ (damage / sec; for armour its overall rating when that is the same). */
function verdictHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  const c = compareEquip(ch, inst, foe);
  if (!c?.rows.some((r) => r.key)) return '';
  const { badge, what } = verdictParts(ch, c.rows);
  const vs = c.current ? `vs. ${esc(itemName(c.current))}` : `vs. no ${c.slot}`;
  return `<div class="ic-verdict">${badge}<span>${what}, ${vs}</span></div>${craftedHtml(ch, inst, foe)}`;
}

/** The same verdict for the item crafted to its best with photons, and the recipe (nothing if photons can't improve it). */
function craftedHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  const best = bestCrafted(ch, inst, foe);
  if (!best) return '';
  const own = [...(inst.affixes ?? []), ...(inst.dormant ?? [])];
  const how = [...best.swaps.map((s) => `Crystal: ${s.out} → ${s.in}`), ...best.affixes.filter((r) => !own.includes(r)).map((r) => `Max: ${affixText(r)}`)];
  const { badge, what } = verdictParts(ch, best.rows);
  return `<div class="ic-verdict" title="${esc(how.join('\n'))}">${badge}<span>${what}, fully crafted (${esc(craftRecipe(best))})</span></div>`;
}

/**
 * The card for `inst`. Gear that isn't worn compares itself with the piece in its slot: tile deltas, new / changed
 * affixes, and what you'd lose. Equipped gear (and everything else) shows its plain numbers.
 */
export function itemCardHtml(ch: Character, inst: ItemInstance, foe: Foe): string {
  const def = getDef(inst.id);
  const rarity = rarityOf(inst);
  const nameCls = rarity === 'unique' ? 'rare' : rarity === 'rare' ? 'r-rare' : rarity === 'magic' ? 'r-magic' : '';
  const gear = isGear(def);
  const slot = gearSlot(inst);
  const equipped = ch.isEquipped(inst.uid);
  const other = gear && slot && !equipped && !injectorDef(inst) ? ch.equippedItem(slot) : undefined;
  const compare = gear && !equipped && !injectorDef(inst);

  // Header: name, type line, requirement chip (red, with your level, when it isn't met).
  const need = itemRequirement(def);
  const check: ReturnType<Character['canEquip']> = gear ? ch.canEquip(inst) : { ok: true };
  const req = need ? `<span class="ic-req${check.need ? ' bad' : ''}"${check.need ? ` title="You are Lv ${ch.level}"` : ''}>Req Lv ${need.level}</span>` : '';
  let html = `<div class="ic-name ${nameCls}">${esc(itemName(inst))}</div>`;
  // Photons: how rare they are under the name, and what they do as the card's text.
  const sub = def.type === 'photon' ? PHOTON_RARITY[def.craft] : rarityLine(inst);
  html += `<div class="ic-sub"><span>${esc(sub)}</span>${req}</div>`;
  if (def.type === 'photon') html += `<div class="ic-lines">${esc(def.desc ?? '')}</div>`;
  if (equipped && gear) html += '<div class="ic-verdict"><span class="ic-eq">Equipped</span></div>';
  else if (compare) html += verdictHtml(ch, inst, foe);

  // Tiles.
  const tiles = tilesOf(inst);
  const otherTiles = other ? new Map(tilesOf(other).map((t) => [t.key, t])) : null;
  if (tiles.length) {
    html += `<div class="ic-tiles">${tiles
      .map((t) => {
        const aff = t.fromAffix ? `<i class="ic-aff-add${t.fromAffix < 0 ? ' neg' : ''}" title="From affixes">${tileDelta(t.key, t.fromAffix)}</i>` : '';
        let d = '';
        if (otherTiles) {
          const delta = t.value - (otherTiles.get(t.key)?.value ?? 0);
          d = Math.abs(delta) >= 0.5 ? `<i class="ic-d ${delta > 0 ? 'up' : 'down'}">${tileDelta(t.key, delta)}</i>` : '';
        }
        return `<div class="ic-tile"><span>${t.label}</span><b>${t.text}</b>${aff}${d}</div>`;
      })
      .join('')}</div>`;
  }

  // Affixes, then what only the equipped piece gives.
  const tileKeys = new Set(tiles.map((t) => t.key));
  const lines = linesOf(inst, tileKeys);
  if (lines.length) html += `<div class="ic-sec">Affixes</div>${lines.map((r) => affixLineHtml(r, compare ? lineDelta(r, inst, other) : '')).join('')}`;
  // A rare's dormant affixes: nothing until a Photon Crystal swaps one in.
  if (inst.dormant?.length) {
    html += `<div class="ic-sec" title="Dormant affixes do nothing until a Photon Crystal swaps one with an active affix of the same kind (prefix or suffix)">Dormant</div>${inst.dormant
      .map((r) => affixLineHtml(r, '', 'dormant'))
      .join('')}`;
  }
  const unique = def.unique;
  if (unique) html += `<div class="ic-sec">Unique</div>${uniqueHtml(unique)}`;
  if (other) {
    const mine = new Set(ownAffixes(inst).map((r) => r.id));
    const mineStats = new Set(ownAffixes(inst).map((r) => ITEM_AFFIXES[r.id].stat).filter(Boolean));
    const lost = linesOf(other, tileKeys).filter((r) => {
      const d = ITEM_AFFIXES[r.id];
      if (mine.has(r.id)) return false;
      // A flat stat the new item also has (as an affix) was compared on that line.
      return !(d.stat && !d.penalty && mineStats.has(d.stat));
    });
    const sp = itemSpecial(other);
    const lostSpecial = sp && sp !== itemSpecial(inst) ? `<div class="ic-aff lost"><i class="ic-dot good"></i><span class="ic-txt">Special: ${specials[sp].name}</span></div>` : '';
    const theirs = getDef(other.id).unique;
    const lostUnique = theirs && theirs !== unique ? uniqueHtml(theirs, true) : '';
    if (lost.length || lostSpecial || lostUnique) html += `<div class="ic-sec">You'd lose</div>${lostUnique}${lostSpecial}${lost.map((r) => affixLineHtml(r, '', 'lost')).join('')}`;
  }

  // Chips: special, unit slots.
  const chips: string[] = [];
  const sp = itemSpecial(inst);
  if (sp) chips.push(`<span class="ic-chip special">${specials[sp].name}</span>`);
  if (def.type === 'armor' && (def as ArmorItemDef).slot === 'frame') {
    const n = unitSlots(inst);
    const pips = Array.from({ length: Math.max(n, 1) }, (_, i) => `<i class="ic-pip${i < n ? ' on' : ''}"></i>`).join('');
    let d = '';
    if (other) {
      const delta = n - unitSlots(other);
      d = delta ? ` <i class="ic-d ${delta > 0 ? 'up' : 'down'}">${signed(delta)}</i>` : ' <i class="ic-d same">same</i>';
    }
    chips.push(`<span class="ic-chip" title="How many of your Mag's units this frame activates">Unit slots ${n ? pips : 'none'}${d}</span>`);
  }
  if (chips.length) html += `<div class="ic-chips">${chips.join('')}</div>`;

  // Everything else (injectors, consumables, photons, units): their own lines.
  if (!tiles.length) {
    const rest = describeItem(inst, ch).filter((l) => !l.startsWith('Req:') && l !== rarityLine(inst) && l !== def.desc);
    const affixTexts = new Set(ownAffixes(inst).map(affixText));
    const plain = rest.filter((l) => !affixTexts.has(l));
    if (def.type === 'unit' && !unique) html += `<div class="ic-sec">Affix</div>${ownAffixes(inst).map((r) => affixLineHtml(r, '')).join('')}`;
    if (plain.length) html += `<div class="ic-lines">${plain.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
  }

  if (def.type === 'weapon') html += damageHtml(ch, inst, foe, equipped);

  // Anything other than a stat requirement in the way.
  if (gear && !check.ok && !check.need) html += `<div class="ic-warn">✖ ${esc(check.reason ?? "Can't equip")}</div>`;
  if (def.desc && def.type !== 'photon') html += `<div class="ic-flavour">${esc(def.desc)}</div>`;
  return `<div class="ic">${html}</div>`;
}

