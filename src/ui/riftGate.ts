import { forgeMult, type Character } from '../game/character';
import { BOSSES } from '../game/data/bosses';
import { maxAffixTier } from '../game/data/itemAffixes';
import { areas } from '../game/data/areas';
import { UNIQUES } from '../game/data/uniques';
import { RIFT_GEN } from '../game/riftGen';
import { bossUniques, circleName, firstKillOwed, hasFound } from '../game/riftCircles';
import {
  CACHE_NAME, enterBlock, isRoomKind, MAP_EDGES, MAP_IDS, MAP_NODES, mapCfg, nodeBoss, nodeCost, nodeName, nodeRegion, nodeRoll, nodeShown,
  nodeStatus, QUARTERS, resonance, type MapNode, type NodeKind, type RiftMapSave,
} from '../game/riftMap';
import { modText, RIFT_MODS, riftBossHp, riftIlvl, riftLoot, riftName, riftSave, riftThreat, type RiftInfo } from '../game/rifts';
import type { RiftBiome } from '../game/riftTypes';
import { esc, type Menu } from './Menus';
import { kindLine } from './uniquesTab';

// The Rift Gate in Pioneer 2, and a rift's teleporters (DESIGN.md "Endgame: Falz Rifts" > "The Rift Map"): the map
// of nodes (rings are tiers, quarters the four bosses, the Heart at the centre) beside the picked node's details,
// and Enter. Return goes back into a node left open. What each boss drops in each Rift Circle is on the inventory's
// Uniques tab.

export interface RiftGateApi {
  readonly char: Character;
  /** The node run open this session (not complete), if any. */
  openRift(): RiftInfo | null;
  /** Enter a node (the menu only offers it when enterBlock allows). */
  enter(id: string): void;
  returnToRift(): void;
  closeMenu(): void;
}

const REGION_COL: Record<RiftBiome, string> = { forest: '#74e06c', caves: '#43d6e0', mines: '#ffa53a', ruins: '#b78cff' };
const REGION_NAME: Record<RiftBiome, string> = { forest: 'Forest', caves: 'Caves', mines: 'Mines', ruins: 'Ruins' };
const HAZARDS: Record<RiftBiome, string> = {
  forest: 'trees',
  caves: 'vents or a poison marsh',
  mines: 'crushers, lasers, slag and belts on power switches',
  ruins: 'light pylons',
};
const PIN_COL = '#ffe08a';
const HEART_COL = '#d27bff';
const ROMAN = ['', 'I', 'II', 'III'];
/** Node sizes on the map (its radius). */
const SIZE: Record<NodeKind, number> = { room: 11, vault: 13, gauntlet: 12.5, boss: 16, pinnacle: 17, heart: 26 };

const f1 = (v: number) => Math.round(v * 10) / 10;
const pol = (r: number, deg: number): [number, number] => [f1(r * Math.cos((deg * Math.PI) / 180)), f1(r * Math.sin((deg * Math.PI) / 180))];
const pctOf = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
const hp = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`);

function shape(kind: NodeKind, r: number): string {
  if (kind === 'vault') return `<path d="M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z"/>`;
  if (kind === 'gauntlet') return `<path d="M${[0, 1, 2, 3, 4, 5].map((i) => pol(r, i * 60).join(' ')).join('L')}Z"/>`;
  if (kind === 'pinnacle') {
    const a = f1(r * 0.32);
    return `<path d="M0 ${-r}L${a} ${-a}L${r} 0L${a} ${a}L0 ${r}L${-a} ${a}L${-r} 0L${-a} ${-a}Z"/>`;
  }
  return `<circle r="${r}"/>`;
}

function nodeColor(n: MapNode): string {
  if (n.kind === 'pinnacle') return PIN_COL;
  if (n.kind === 'heart') return HEART_COL;
  return REGION_COL[nodeRegion(n)!];
}

/** The rings, bands, quarter tints and labels under the nodes. */
function backdrop(): string {
  const arc = (R: number, a1: number, a2: number) => {
    const [x1, y1] = pol(R, a1);
    const [x2, y2] = pol(R, a2);
    return `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`;
  };
  const labels: [number, string][] = [[454, 'CIRCLE I · TIERS 1-3'], [336, 'CIRCLE II · TIERS 4-6'], [204, 'CIRCLE III · TIERS 7-10']];
  let s = `<defs><radialGradient id="rm-heart"><stop offset="0" stop-color="${HEART_COL}" stop-opacity=".6"/><stop offset=".55" stop-color="#7a3cff" stop-opacity=".18"/><stop offset="1" stop-color="#7a3cff" stop-opacity="0"/></radialGradient>`;
  labels.forEach(([R], i) => (s += `<path id="rm-cl${i}" d="${arc(R, -79, -11)}"/>`));
  s += '</defs><circle r="470" class="rm-band"/><circle r="348" class="rm-band b2"/><circle r="217" class="rm-band b3"/>';
  for (const q of QUARTERS) {
    const [x1, y1] = pol(470, q.ang - 45);
    const [x2, y2] = pol(470, q.ang + 45);
    s += `<path d="M0 0L${x1} ${y1}A470 470 0 0 1 ${x2} ${y2}Z" fill="${REGION_COL[q.region]}" fill-opacity=".05"/>`;
  }
  for (const a of [-45, 45, 135, 225]) {
    const [x1, y1] = pol(44, a);
    const [x2, y2] = pol(470, a);
    s += `<line class="rm-spoke" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  const rings = [...new Set(MAP_IDS.map((id) => MAP_NODES[id]).filter((n) => isRoomKind(n.kind)).map((n) => n.r))];
  for (const r of rings) s += `<circle r="${r}" class="rm-ring"/>`;
  s += '<circle r="348" class="rm-bound"/><circle r="217" class="rm-bound"/><circle r="470" class="rm-bound rim"/>';
  labels.forEach(([, t], i) => (s += `<text class="rm-clabel"><textPath href="#rm-cl${i}" startOffset="50%" text-anchor="middle">${t}</textPath></text>`));
  s += '<circle r="96" fill="url(#rm-heart)"/>';
  const rim: [string, number, number, number][] = [['FOREST · DRAGON', 0, -487, 0], ['CAVES · DE ROL LE', 487, 0, 90], ['MINES · WARDEN', 0, 487, 0], ['RUINS · DARK FALZ', -487, 0, -90]];
  rim.forEach(([t, x, y, rot], i) => {
    s += `<text class="rm-rim" x="${x}" y="${y}" fill="${REGION_COL[QUARTERS[i].region]}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot} ${x} ${y})">${t}</text>`;
  });
  return s + '<text class="rm-hlabel" x="0" y="47" text-anchor="middle">THE HEART</text>';
}
const BACKDROP = backdrop();

/** The map: edges between shown nodes, then the nodes (state, kind, tier or circle inside, the picked one ringed). */
function mapSvg(save: { map: RiftMapSave }, sel: string, all: boolean): string {
  const map = save.map;
  const shown = (id: string) => all || nodeShown(map, id);
  let edges = '';
  for (const e of MAP_EDGES) {
    if (!shown(e.a) || !shown(e.b)) continue;
    const a = MAP_NODES[e.a];
    const b = MAP_NODES[e.b];
    const sa = nodeStatus(map, e.a);
    const sb = nodeStatus(map, e.b);
    let cls = 'rm-e';
    if (e.kind === 'req' || e.kind === 'seal') cls += ` ${e.kind}${sa === 'cleared' ? ' met' : ''}`;
    else if (sa === 'cleared' && sb === 'cleared') cls += ' walked';
    else if (sa === 'cleared' || sb === 'cleared') cls += ' reach';
    else cls += ' dim';
    const [ax, ay] = pol(a.r, a.ang);
    const [bx, by] = pol(b.r, b.ang);
    edges += e.kind === 'cross'
      ? `<path class="${cls}" d="M${ax} ${ay} A${a.r} ${a.r} 0 0 1 ${bx} ${by}"/>`
      : `<line class="${cls}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`;
  }
  let nodes = '';
  // Rooms first, landmarks on top.
  const order = [...MAP_IDS].sort((a, b) => Number(isRoomKind(MAP_NODES[b].kind)) - Number(isRoomKind(MAP_NODES[a].kind)));
  for (const id of order) {
    if (!shown(id)) continue;
    const n = MAP_NODES[id];
    const st = nodeStatus(map, id);
    const col = nodeColor(n);
    const r = SIZE[n.kind];
    const fill = st === 'cleared' ? col : st === 'open' ? '#0d2366' : '#0a1438';
    const stroke = st === 'cleared' ? '#eef5ff' : col;
    const sop = st === 'locked' ? 0.4 : st === 'cleared' ? 0.75 : 1;
    const txt = st === 'cleared' ? '#06102e' : st === 'open' ? '#eef5ff' : col;
    const label = isRoomKind(n.kind) ? String(n.tier) : n.kind === 'boss' || n.kind === 'pinnacle' ? ROMAN[n.circle] : '';
    let extra = '';
    if (isRoomKind(n.kind) && st !== 'locked' && nodeRoll(map, id).mods.length >= 3) extra = `<circle class="rm-yel" r="${r + 4}"/>`;
    if (n.kind === 'heart') extra = `<circle r="${r - 7}" fill="none" stroke="${col}" stroke-opacity=".7" stroke-width="1.2"/><circle r="${r - 14}" fill="${col}" fill-opacity="${st === 'locked' ? 0.25 : 0.7}"/>`;
    const [x, y] = pol(n.r, n.ang);
    nodes += `<g class="rm-n ${st}${sel === id ? ' sel' : ''}" data-act="node" data-arg="${id}" transform="translate(${x} ${y})"><title>${esc(tip(map, n))}</title>`
      + `<circle class="rm-halo" r="${r + 6}" stroke="${col}"/>`
      + `<g fill="${fill}" stroke="${stroke}" stroke-opacity="${sop}" stroke-width="${st === 'open' ? 2.4 : 1.4}">${shape(n.kind, r)}</g>${extra}`
      + (label ? `<text text-anchor="middle" dominant-baseline="central" font-size="${n.tier >= 10 && isRoomKind(n.kind) ? 9.5 : 11}" fill="${txt}" fill-opacity="${st === 'locked' ? 0.6 : 1}">${label}</text>` : '')
      + `<circle class="rm-selr" r="${r + 9}"/></g>`;
  }
  return `<svg class="rm-svg" viewBox="-505 -505 1010 1010" role="img" aria-label="Rift Map">${BACKDROP}${edges}${nodes}</svg>`;
}

function tip(map: RiftMapSave, n: MapNode): string {
  const st = nodeStatus(map, n.id);
  if (isRoomKind(n.kind)) {
    const r = nodeRoll(map, n.id);
    return `${nodeName(n.id)} · ${CACHE_NAME[r.cache]} cache · ${r.mods.length} modifier${r.mods.length === 1 ? '' : 's'} · ${st}`;
  }
  return `${nodeName(n.id)} · tier ${n.tier} · ${st === 'cleared' ? 'killed' : st}`;
}

export class RiftMapMenu implements Menu {
  cls = 'rift-gate';
  closable = true;
  private sel: string;
  /** Show the whole map, not just what's in reach. */
  private all = false;

  constructor(private api: RiftGateApi) {
    const map = riftSave(api.char.data).map!;
    // The node last picked, else the deepest room still open, else the way in.
    const open = MAP_IDS.filter((id) => isRoomKind(MAP_NODES[id].kind) && nodeStatus(map, id) === 'open').sort((a, b) => MAP_NODES[b].tier - MAP_NODES[a].tier);
    this.sel = map.sel && MAP_NODES[map.sel] ? map.sel : open[0] ?? 'N1';
  }

  render(): string {
    const save = riftSave(this.api.char.data);
    const map = save.map!;
    const open = this.api.openRift();
    const openRow = open
      ? `<div class="rift-open"><span>Open: <b>${esc(open.boss ? nodeName(open.node) : riftName(open))}</b>${open.mods.length ? ` · ${open.mods.length} modifier${open.mods.length > 1 ? 's' : ''}` : ''}</span>
        <button class="btn small" data-act="return">Return</button></div>`
      : '';
    const res = QUARTERS.map((q) => {
      const v = resonance(save, q.boss);
      const pips = Array.from({ length: mapCfg.resonanceCap }, (_, i) => `<i class="rm-pip${i < v ? ' on' : ''}"></i>`).join('');
      return `<div class="rm-res" style="color:${REGION_COL[q.region]}" title="Resonance: every room node cleared in the ${REGION_NAME[q.region]} quarter adds one; a ${esc(BOSSES[q.boss].name)} replay takes ${mapCfg.resonanceCost}">
        <b>${esc(BOSSES[q.boss].name)}</b><span class="rm-pips">${pips}</span></div>`;
    }).join('');
    return `<div class="menu-head"><div class="win-title">Rift Gate</div><span class="head-gap"></span>
        <button class="btn small${this.all ? '' : ' ghost'}" data-act="all">${this.all ? 'Show what is in reach' : 'Show the whole map'}</button>
        <button class="btn small" data-act="close">Close</button></div>
      <p class="menu-text">Rings are tiers, 1 at the rim to 10 at the centre; each quarter is a boss's. Clearing a node opens what it links to, and every node stays open to run again: rooms roll new modifiers and a new cache each clear.
        ${save.clears} cleared · deepest tier ${save.tier}.</p>
      ${openRow}
      <div class="rm-body"><div class="rm-mapcol"><div class="rm-map">${mapSvg({ map }, this.sel, this.all)}</div>
        <div class="rm-resbar">${res}</div></div>
        <div class="rm-detail">${this.detail(this.sel, !!open)}</div></div>`;
  }

  private detail(id: string, hasOpen: boolean): string {
    const n = MAP_NODES[id];
    if (isRoomKind(n.kind)) return this.roomDetail(n, hasOpen);
    if (n.kind === 'boss') return this.bossDetail(n, hasOpen);
    return this.gatedDetail(n);
  }

  private stateChip(n: MapNode): string {
    const map = riftSave(this.api.char.data).map!;
    const st = nodeStatus(map, n.id);
    const times = map.nodes[n.id]?.n ?? 0;
    if (st === 'cleared') return `<span class="rm-chip cleared">${isRoomKind(n.kind) ? 'Cleared' : 'Killed'}${times > 1 ? ` ${times}×` : ''}</span>`;
    if (st === 'open') return `<span class="rm-chip open">${n.kind === 'boss' ? 'Open · first kill' : 'Open'}</span>`;
    return `<span class="rm-chip">${isRoomKind(n.kind) ? 'Locked' : 'Sealed'}</span>`;
  }

  private enterBtn(n: MapNode, hasOpen: boolean): string {
    const save = riftSave(this.api.char.data);
    const open = this.api.openRift();
    if (open?.node === n.id) return '<div class="rm-act"><button class="btn primary" data-act="return">Return<span class="btn-sub">Back into the node you have open</span></button></div>';
    const block = enterBlock(save, n.id);
    const sub = hasOpen ? 'The node you have open collapses' : '';
    if (block) return `<div class="rm-act"><button class="btn disabled">${n.kind === 'boss' || isRoomKind(n.kind) ? 'Enter' : 'Sealed'}</button><div class="dim">${esc(block)}</div></div>`;
    return `<div class="rm-act"><button class="btn primary" data-act="enter" data-arg="${n.id}">Enter${sub ? `<span class="btn-sub">${sub}</span>` : ''}</button></div>`;
  }

  private roomDetail(n: MapNode, hasOpen: boolean): string {
    const ch = this.api.char;
    const save = riftSave(ch.data);
    const map = save.map!;
    const roll = nodeRoll(map, n.id);
    const region = nodeRegion(n)!;
    const boss = nodeBoss(n)!;
    const loot = riftLoot({ tier: n.tier, mods: roll.mods });
    const ilvl = riftIlvl(n.tier);
    const mult = n.kind === 'vault' ? mapCfg.vaultMult : 1;
    const cache =
      roll.cache === 'photons'
        ? `+${mapCfg.spheres * mult} Photon Spheres and a ${pctOf(100 * Math.min(1, mapCfg.crystal * mult))} chance of a Crystal`
        : `+${mapCfg.cache * mult} ${roll.cache === 'weapons' ? 'rare weapons' : roll.cache === 'armour' ? 'rare frames or barriers' : 'units'}`;
    const length = n.kind === 'vault'
      ? 'One big room: three champion packs, one after another, guard the vault. About 2 min.'
      : n.kind === 'gauntlet'
        ? `Hold one big room for ${RIFT_GEN.hold.time} s against waves that keep coming, then clear the rest.`
        : 'Three fight rooms (now and then a bonus room), then the Guardian room. About 4 min.';
    const threat = riftThreat(n.tier, ch.maxHp, ch.damageTaken('strike'), ch.damageTaken('area'));
    const mods = roll.mods.length
      ? `<ul class="rm-mods">${roll.mods.map((m) => `<li><span><b>${esc(RIFT_MODS[m].name)}</b> ${esc(modText(m, roll.second))}</span><em>+${RIFT_MODS[m].qty}% / +${RIFT_MODS[m].rar}%</em></li>`).join('')}</ul>`
      : '<div class="dim">No modifiers: the tier alone.</div>';
    const kind = n.kind === 'vault' ? 'Vault' : n.kind === 'gauntlet' ? 'Gauntlet' : 'Room';
    return `<div class="rm-eyebrow">${kind} · Tier ${n.tier} · Circle ${circleName(n.circle)}</div>
      <div class="rm-title">${esc(nodeName(n.id))}</div>
      <div class="rm-chips">${this.stateChip(n)}<span class="rm-chip" style="color:${REGION_COL[region]}">${esc(BOSSES[boss].name)}'s quarter</span></div>
      <dl class="rm-facts">
        <dt>Length</dt><dd>${esc(length)}</dd>
        <dt>Look</dt><dd>${esc(areas[roll.look].name)}: ${esc(HAZARDS[region])}. Waves from every expedition.</dd>
        <dt>Cache</dt><dd><b>${CACHE_NAME[roll.cache]}</b>: ${esc(cache)}${n.kind === 'gauntlet' ? `, and one more for every ${mapCfg.killsPerPiece} kills` : ''}, on top of the end drop.</dd>
        <dt>Loot</dt><dd>Item level ${ilvl} · affixes up to tier ${maxAffixTier(ilvl)} · Rift-forged +${Math.round((forgeMult({ ilvl }) - 1) * 100)}%</dd>
        <dt>Finds</dt><dd>Item quantity +${loot.qty}% · rarity +${loot.rar}%</dd>
        <dt>On you</dt><dd>A heavy hit takes about ${pctOf(threat.heavy)} of your HP (the hardest ${pctOf(threat.hardest)}), a shot ${pctOf(threat.chip)}</dd>
        <dt>Feeds</dt><dd>${esc(BOSSES[boss].name)} Resonance +1 (now ${resonance(save, boss)}/${mapCfg.resonanceCap})</dd>
      </dl>
      <div class="rm-sub">Modifiers</div>${mods}
      ${this.enterBtn(n, hasOpen)}`;
  }

  private bossDetail(n: MapNode, hasOpen: boolean): string {
    const ch = this.api.char;
    const save = riftSave(ch.data);
    const boss = nodeBoss(n)!;
    const region = nodeRegion(n)!;
    const owed = firstKillOwed(save, boss, n.circle);
    const own = bossUniques(boss, n.circle, n.circle);
    const uq = own
      .map((id) => `<li class="${hasFound(ch.data, id) ? 'got' : ''}" title="${esc(`${UNIQUES[id].effect}. Cost: ${UNIQUES[id].cost}.`)}"><b>${esc(UNIQUES[id].name)}</b><span>${esc(kindLine(id))}</span></li>`)
      .join('');
    const cost = nodeCost(save, n.id);
    const replay = owed
      ? 'The first kill in this circle always drops one of these (one you lack first), and takes no Resonance.'
      : cost
        ? `Each fight takes ${cost} ${BOSSES[boss].name} Resonance, from rooms cleared in its quarter. A kill drops one of its uniques now and then.`
        : 'Its first kill takes no Resonance. A kill drops one of its uniques now and then.';
    const opens = n.circle < 3 ? `Tier ${n.tier + 1} in the ${REGION_NAME[region]} quarter` : 'A seal of the Heart; with its neighbour, a pinnacle';
    return `<div class="rm-eyebrow">Boss · Tier ${n.tier} · Circle ${circleName(n.circle)}</div>
      <div class="rm-title">${esc(BOSSES[boss].name)} · Circle ${circleName(n.circle)}</div>
      <div class="rm-chips">${this.stateChip(n)}<span class="rm-chip" style="color:${REGION_COL[region]}">${REGION_NAME[region]} arena</span></div>
      <dl class="rm-facts">
        <dt>Fight</dt><dd>Its own arena with Hell's third phase and its Hell mechanic.</dd>
        <dt>HP</dt><dd>${hp(riftBossHp({ bossRegion: region, tier: n.tier, mods: [] }))}</dd>
        <dt>Opens</dt><dd>${esc(opens)}</dd>
      </dl>
      <div class="rm-sub">Circle ${circleName(n.circle)} uniques</div><ul class="rm-uq">${uq}</ul>
      <div class="dim">${esc(replay)}${n.circle > 1 ? ` Earlier circles' uniques can drop here too.` : ''}</div>
      ${this.enterBtn(n, hasOpen)}`;
  }

  private gatedDetail(n: MapNode): string {
    const map = riftSave(this.api.char.data).map!;
    const heart = n.kind === 'heart';
    const reqs = n.req!.map((id) => `<li class="${nodeStatus(map, id) === 'cleared' ? 'ok' : ''}">${esc(nodeName(id))}</li>`).join('');
    const where = heart ? 'The centre of the map, the end of the game.' : `Between two quarters, past their Circle ${circleName(n.circle)} bosses.`;
    return `<div class="rm-eyebrow">${heart ? 'The Heart · final node' : `Pinnacle · Tier ${n.tier} · Circle ${circleName(n.circle)}`}</div>
      <div class="rm-title">${esc(nodeName(n.id))}</div>
      <div class="rm-chips">${this.stateChip(n)}<span class="rm-chip">Boss still to come</span></div>
      <p>${esc(where)} A new boss will stand here, with uniques of its own.</p>
      <div class="rm-sub">${heart ? 'Four seals' : 'Opens when both are dead'}</div><ul class="rm-req">${reqs}</ul>`;
  }

  onAction(act: string, arg: string): void {
    const save = riftSave(this.api.char.data);
    switch (act) {
      case 'close':
        this.api.closeMenu();
        break;
      case 'all':
        this.all = !this.all;
        break;
      case 'node':
        this.sel = arg;
        save.map!.sel = arg;
        break;
      case 'enter':
        if (!enterBlock(save, arg)) this.api.enter(arg);
        break;
      case 'return':
        this.api.returnToRift();
        break;
    }
  }

  onKey(e: KeyboardEvent): boolean {
    // Enter goes into the picked node (when it can be entered).
    if (e.key !== 'Enter') return false;
    if (this.api.openRift()?.node === this.sel) this.api.returnToRift();
    else if (!enterBlock(riftSave(this.api.char.data), this.sel)) this.api.enter(this.sel);
    else return false;
    return true;
  }
}
