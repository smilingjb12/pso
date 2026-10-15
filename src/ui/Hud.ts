import * as THREE from 'three';
import type { Race } from '../game/config';
import type { StatusTimer } from '../game/combat/types';
import { ATTR_LABEL } from '../game/data/items';
import { statusIcon } from './icons';

// DOM overlay HUD. Kept dumb: the game pushes state in every frame.

export interface PaletteSlotView {
  key: string;
  label: string;
  /** Inline SVG icon. */
  icon: string;
  /** Small number in the corner (the Art's TP cost). */
  count?: string;
  kind: 'basic' | 'art' | 'empty';
  disabled?: boolean;
  /** What the slot refills (Resta): it pulses when that gauge is low between fights. */
  restores?: 'hp' | 'tp';
  /** Share of the Art's cooldown still to go (0 = ready): a dark sweep over the hex. */
  cooldown?: number;
}

/**
 * Hex positions in the cluster, PSO-style (2026-10-14, the Arts redesign). Slots: 0 LMB (the basic chain),
 * 1 RMB, 2 Q, 3 E, 4 R (the Art bar), Q / E / R left to right along the top like the keys.
 */
const HEX_LAYOUT = [
  { slot: 2, pos: 'far', color: 'purple' },
  { slot: 0, pos: 'left', color: 'yellow' },
  { slot: 3, pos: 'top', color: 'green' },
  { slot: 4, pos: 'right', color: 'blue' },
  { slot: 1, pos: 'bottom', color: 'red' },
] as const;

export interface HudState {
  hp: number;
  maxHp: number;
  /** Max HP before Corruption took its share (the bar's full width); defaults to maxHp. */
  trueMaxHp?: number;
  /** Barrier shield HP (absorbed before HP). */
  shield: number;
  tp: number;
  maxTp: number;
  level: number;
  /** No fight in progress (no active room, no engaged boss): the time to top up. */
  calm: boolean;
  /** LMB (the basic chain), then the Art bar: RMB, Q, E, R. */
  palette: PaletteSlotView[];
  comboHits: number; // number of steps started in the current chain (0..3)
  comboStreak: number; // the last this-many of them were perfect chains
  comboWindow: boolean;
  comboBroken: boolean;
  /** No enemy HP is shown (PSO didn't); just the name and its attribute. */
  target: {
    name: string;
    race: Race | null;
    statuses: StatusTimer[];
    /** Elite affixes as chips, in their aura colour. */
    affixes: { name: string; color: string }[];
    champion: boolean;
  } | null;
  boss: { name: string; race: Race | null; weak: boolean } | null;
  area: string;
  roomInfo: string | null;
  prompt: string | null;
  buffs: string[];
  /** Status ailments (poison, paralysis) as chips. */
  statuses: { label: string; cls: string }[];
  cast: number | null; // 0..1
  /**
   * Hard crowd control on the player (paralysis): seconds left of the total, shown as a ring in the middle of the
   * screen, WoW style. `hint`: a way out (a Sol injector).
   */
  cc: { label: string; left: number; total: number; hint: string | null } | null;
  /** The injector (key 1): doses ready (fractional) out of the most it holds. */
  injector: { kind: 'mate' | 'fluid'; doses: number; charge: number; name: string; mod: string | null } | null;
  /** Dash charges ready, the most there can be, and progress (0..1) toward the next. */
  dash: { charges: number; max: number; refill: number };
  /** The Mag's photon blast and its gauge (0..1; it fires by itself when full, in a fight); null without one. */
  photonBlast: { name: string; charge: number } | null;
}

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  drift: number;
}

/** HP bar colour bands (fraction of max): green above OK, amber above LOW, red below. */
const HP_OK = 0.6;
const HP_LOW = 0.25;
/** Between fights, healing slots pulse below these fractions. */
const NUDGE_HP = 0.6;
const NUDGE_TP = 0.35;
/** Damage trail: how long the lost chunk lingers, then how fast it drains (fraction of the bar per second). */
const TRAIL_HOLD = 0.5;
const TRAIL_DRAIN = 0.8;

const STATUS_LABEL: Record<string, string> = { stun: 'Stunned', freeze: 'Frozen', burn: 'Burning', poison: 'Poisoned' };

const el = (cls: string, parent: HTMLElement, html = ''): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
};

export class Hud {
  readonly root: HTMLDivElement;
  /** Crowd-control ring in the middle of the screen (paralysis). */
  private ccEl!: HTMLDivElement;
  private ccFill!: SVGCircleElement;
  private ccTime!: HTMLDivElement;
  private ccLabel!: HTMLDivElement;
  private ccHint!: HTMLDivElement;
  private ccKey = '';
  private action: HTMLDivElement;
  private vitals: HTMLDivElement;
  private dashEl!: HTMLDivElement;
  private pbEl!: HTMLDivElement;
  private pbFill!: HTMLElement;
  private dashCells: HTMLDivElement[] = [];
  private hpBar: HTMLDivElement;
  private hpFill: HTMLDivElement;
  /** Corruption's share of max HP, at the right end of the bar. */
  private hpCorrupt: HTMLDivElement;
  private hpTrail: HTMLDivElement;
  /** Barrier shield: a pale layer over the left of the HP bar, as wide as the shield is a share of max HP. */
  private hpShield!: HTMLDivElement;
  private hpText: HTMLDivElement;
  private tpRow: HTMLDivElement;
  private tpFill: HTMLDivElement;
  private tpTrail: HTMLDivElement;
  private tpText: HTMLDivElement;
  private lvEl: HTMLDivElement;
  /** Injector gauge: a cell per dose. */
  private injEl!: { root: HTMLDivElement; cells: HTMLDivElement; key: string };
  /** Damage-trail state per gauge: where the trail sits (0..1), the last value, and how long the trail still lingers. */
  private trail = { hp: { k: 1, last: 1, hold: 0 }, tp: { k: 1, last: 1, hold: 0 } };
  private buffsEl: HTMLDivElement;
  private statusChips: HTMLDivElement;
  private lastStatusKey = '';
  private lowHpEl: HTMLDivElement;
  private hexes: HTMLDivElement[] = [];
  private pips: HTMLDivElement[] = [];
  private castBar: HTMLDivElement;
  private castFill: HTMLDivElement;
  private targetBox: HTMLDivElement;
  private targetName: HTMLDivElement;
  private targetAttr: HTMLDivElement;
  private targetStatus: HTMLDivElement;
  private targetAffixes: HTMLDivElement;
  private targetAffixKey = '';
  private targetStatusEls = new Map<string, HTMLDivElement>();
  private bossBox: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossAttr: HTMLDivElement;
  private reticle: HTMLDivElement;
  private areaEl: HTMLDivElement;
  private roomEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private toasts: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private bannerT = 0;
  private log: HTMLDivElement;
  private overlay: HTMLDivElement;
  private saveInd: HTMLDivElement;
  private floats: FloatText[] = [];
  private lastPaletteKey = '';
  private tmp = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = el('hud', parent);
    // Red screen-edge glow at low HP; first child so it sits under the rest of the HUD.
    this.lowHpEl = el('lowhp', this.root);
    this.saveInd = el(
      'save-ind',
      parent,
      `<svg viewBox="0 0 24 24"><path d="M5 2h10l4 4v16H5z" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="13" width="8" height="6" fill="currentColor"/><rect x="8" y="4" width="6" height="4" fill="currentColor"/></svg>Saved`,
    );

    // Centre bottom, just under the character where peripheral vision reaches:
    // cast bar, combo pips, then HP/TP. Status chips and buffs hang off to the right.
    const center = el('action', this.root);
    this.action = center;
    this.castBar = el('castbar', center);
    this.castFill = el('fill', this.castBar);
    const pipRow = el('pips', center);
    for (let i = 0; i < 3; i++) this.pips.push(el('pip', pipRow));

    this.vitals = el('vitals', center);
    // Level tab riding the frame's bottom-right edge.
    this.lvEl = el('vlevel', this.vitals);
    // Dash charges: a matching tab on the bottom-left edge, one chevron per charge.
    this.dashEl = el('vdash', this.vitals);
    // Photon blast gauge: a tab in the middle of the bottom edge, once a blast is picked.
    this.pbEl = el('vpb', this.vitals);
    el('pb-key', this.pbEl, 'PB');
    this.pbFill = el('fill', el('pb-bar', this.pbEl));
    const gauge = (kind: 'hp' | 'tp') => {
      const row = el(`vrow v-${kind}`, this.vitals);
      el('vlabel', row, kind.toUpperCase());
      const bar = el('vbar', row);
      const trail = el('trail', bar);
      const fill = el('fill', bar);
      // Quarter ticks so 75 / 50 / 25 % read at a glance.
      el('ticks', bar);
      const text = el('vtext', row);
      return { row, bar, trail, fill, text };
    };
    const hp = gauge('hp');
    const tp = gauge('tp');
    [this.hpBar, this.hpTrail, this.hpFill, this.hpText] = [hp.bar, hp.trail, hp.fill, hp.text];
    this.hpShield = document.createElement('div');
    this.hpShield.className = 'shield';
    hp.bar.insertBefore(this.hpShield, hp.fill.nextSibling);
    this.hpCorrupt = document.createElement('div');
    this.hpCorrupt.className = 'corrupt';
    hp.bar.insertBefore(this.hpCorrupt, this.hpShield.nextSibling);
    [this.tpRow, this.tpTrail, this.tpFill, this.tpText] = [tp.row, tp.trail, tp.fill, tp.text];
    // Injector: one cell per dose; the next dose fills up as you deal damage.
    const vinj = el('vinj', this.vitals);
    // The level tab sits on top of the injector cells (2026-10-10, the user's layout).
    vinj.appendChild(this.lvEl);
    const injRoot = el('inj', vinj);
    this.injEl = { root: injRoot, cells: el('inj-cells', injRoot), key: '' };
    const side = el('vside', this.vitals);
    this.statusChips = el('vchips', side);
    this.buffsEl = el('vbuffs', side);

    // PSO-style hexagon action palette (bottom-right).
    const cluster = el('hexpal', this.root);
    for (const h of HEX_LAYOUT) {
      this.hexes[h.slot] = el(`hex hex-${h.pos} hex-${h.color}`, cluster, '<div class="hex-ring"><div class="hex-face"><div class="hex-key"></div><div class="hex-icon"></div><div class="hex-cd"></div><div class="hex-count"></div></div></div>');
    }

    this.targetBox = el('target', this.root);
    // One line: name, attribute (plain coloured text, so it doesn't read as an affix chip), status badges at the right.
    const targetHead = el('target-head', this.targetBox);
    this.targetName = el('target-name', targetHead);
    this.targetAttr = el('attr-tag', targetHead);
    this.targetStatus = el('target-status', targetHead);
    this.targetAffixes = el('target-affixes', this.targetBox);

    this.bossBox = el('bossbar', this.root);
    this.bossName = el('boss-name', this.bossBox);
    this.bossAttr = el('attr-tag', this.bossBox);

    this.reticle = el('reticle', this.root);
    this.ccEl = el('cc', this.root,
      `<svg class="cc-ring" viewBox="0 0 100 100"><circle class="cc-track" cx="50" cy="50" r="44"/><circle class="cc-fill" cx="50" cy="50" r="44" pathLength="100"/></svg>` +
        `<div class="cc-icon">${statusIcon('stun')}</div><div class="cc-time"></div><div class="cc-label"></div><div class="cc-hint"></div>`);
    this.ccFill = this.ccEl.querySelector('.cc-fill') as SVGCircleElement;
    this.ccTime = this.ccEl.querySelector('.cc-time') as HTMLDivElement;
    this.ccLabel = this.ccEl.querySelector('.cc-label') as HTMLDivElement;
    this.ccHint = this.ccEl.querySelector('.cc-hint') as HTMLDivElement;
    const areaBox = el('areabox', this.root);
    this.areaEl = el('area-name', areaBox);
    this.roomEl = el('room-info', areaBox);
    this.promptEl = el('prompt', this.root);
    this.toasts = el('toasts', this.root);
    this.bannerEl = el('banner', this.root);
    this.log = el('log', this.root);


    this.overlay = el('overlay', parent);
  }

  private fillHex(hex: HTMLDivElement, key: string, icon: string, count: string, label: string, dim: boolean): void {
    (hex.querySelector('.hex-key') as HTMLElement).textContent = key;
    (hex.querySelector('.hex-icon') as HTMLElement).innerHTML = icon;
    (hex.querySelector('.hex-count') as HTMLElement).textContent = count;
    hex.title = label;
    hex.classList.toggle('dim', dim);
  }

  /** Flash a palette hex when its key is pressed (0 LMB, 1-4 RMB / Q / E / R). */
  pulseSlot(i: number): void {
    const hex = this.hexes[i];
    if (!hex) return;
    hex.classList.remove('pressed');
    void hex.offsetWidth; // restart the animation
    hex.classList.add('pressed');
  }

  /** Brief "saving" indicator (a memory-card glyph) in the top-right corner. */
  saveBlip(): void {
    this.saveInd.classList.remove('show');
    void this.saveInd.offsetWidth; // restart the animation
    this.saveInd.classList.add('show');
  }

  showOverlay(html: string | null): void {
    this.overlay.style.display = html ? 'flex' : 'none';
    if (html) this.overlay.innerHTML = html;
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  set logVisible(v: boolean) {
    this.log.style.display = v ? 'block' : 'none';
  }

  pushLog(line: string): void {
    el('log-line', this.log, line);
    while (this.log.children.length > 8) this.log.removeChild(this.log.firstChild!);
  }

  /** Toasts sit at the bottom edge while a menu window is open. */
  set menuOpen(v: boolean) {
    this.root.classList.toggle('menu-open', v);
  }

  toast(html: string, cls = ''): void {
    const t = el(`toast ${cls}`, this.toasts, html);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.toasts.children.length > 4) this.toasts.removeChild(this.toasts.firstChild!);
  }

  banner(text: string, cls = ''): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `banner show ${cls}`;
    this.bannerT = 2.2;
  }

  /** Spawn floating text at a world position. */
  float(pos: THREE.Vector3, text: string, cls: string): void {
    const d = el(`float ${cls}`, this.root, text);
    this.floats.push({ el: d, pos: pos.clone(), t: 0, life: 0.9, drift: (Math.random() - 0.5) * 30 });
  }

  /** Tried to dash with no charge: the empty chevrons flash. */
  dashEmpty(): void {
    this.dashEl.classList.remove('empty-flash');
    void this.dashEl.offsetWidth; // restart the animation
    this.dashEl.classList.add('empty-flash');
  }

  private setDash(d: HudState['dash']): void {
    if (this.dashCells.length !== d.max) {
      this.dashEl.innerHTML = '';
      this.dashCells = [];
      for (let i = 0; i < d.max; i++) this.dashCells.push(el('dc', this.dashEl));
    }
    this.dashCells.forEach((c, i) => {
      const k = i < d.charges ? 1 : i === d.charges ? d.refill : 0;
      c.style.setProperty('--k', k.toFixed(3));
      c.classList.toggle('full', k >= 1);
    });
  }

  clearFloats(): void {
    for (const f of this.floats) f.el.remove();
    this.floats = [];
  }


  /** The crowd-control ring: shown while paralysed, its arc and the seconds counting down. */
  private updateCc(cc: HudState['cc']): void {
    this.ccEl.classList.toggle('on', !!cc);
    if (!cc) {
      this.ccKey = '';
      return;
    }
    const frac = Math.max(0, Math.min(1, cc.left / Math.max(0.01, cc.total)));
    this.ccFill.style.strokeDashoffset = `${100 - frac * 100}`;
    this.ccTime.textContent = cc.left.toFixed(1);
    const key = `${cc.label}|${cc.hint ?? ''}`;
    if (key !== this.ccKey) {
      this.ccKey = key;
      this.ccLabel.textContent = cc.label;
      this.ccHint.textContent = cc.hint ?? '';
    }
  }
  update(realDt: number, s: HudState, camera: THREE.Camera, lockPos: THREE.Vector3 | null): void {
    const hpK = s.maxHp > 0 ? Math.max(0, s.hp / s.maxHp) : 0;
    const tpK = s.maxTp > 0 ? Math.max(0, s.tp / s.maxTp) : 0;
    // With Corruption the bar keeps its full width (true max HP) and the lost share shows at its right end.
    const barFull = Math.max(s.maxHp, s.trueMaxHp ?? s.maxHp);
    this.setGauge(this.hpFill, this.hpTrail, this.trail.hp, barFull > 0 ? Math.max(0, s.hp / barFull) : 0, realDt);
    this.hpCorrupt.style.width = `${barFull > 0 ? ((barFull - s.maxHp) / barFull) * 100 : 0}%`;
    this.setGauge(this.tpFill, this.tpTrail, this.trail.tp, tpK, realDt);
    this.hpText.textContent = `${Math.ceil(s.hp)}/${s.maxHp}${s.shield >= 1 ? ` +${Math.ceil(s.shield)}` : ''}`;
    this.hpShield.style.width = `${Math.min(1, barFull > 0 ? s.shield / barFull : 0) * 100}%`;
    this.tpText.textContent = `${Math.ceil(s.tp)}/${s.maxTp}`;
    this.tpRow.style.display = s.maxTp > 0 ? '' : 'none';
    const lv = String(s.level);
    if (this.lvEl.dataset.lv !== lv) {
      this.lvEl.dataset.lv = lv;
      this.lvEl.innerHTML = `<span>Lv.</span>${lv}`;
    }
    this.setInjector(this.injEl, s.injector);
    this.setDash(s.dash);
    this.pbEl.style.display = s.photonBlast ? '' : 'none';
    if (s.photonBlast) {
      this.pbFill.style.width = `${Math.round(s.photonBlast.charge * 100)}%`;
      this.pbEl.classList.toggle('ready', s.photonBlast.charge >= 1);
      this.pbEl.title = `${s.photonBlast.name}: fires by itself when full, in a fight`;
    }
    const low = hpK < HP_LOW;
    this.hpBar.dataset.band = low ? 'low' : hpK < HP_OK ? 'mid' : 'ok';
    this.vitals.classList.toggle('danger', low && s.hp > 0);
    // Topped up with nothing going on: the block fades back. Anything missing brings it forward again.
    const full = hpK >= 1 && (s.maxTp === 0 || tpK >= 1);
    this.action.classList.toggle('rest', s.calm && full && s.cast === null && !s.statuses.length && !s.buffs.length);
    this.lowHpEl.classList.toggle('on', low && s.hp > 0);
    // 0 at the 25% threshold, 1 at empty: the glow gets stronger the closer to death.
    if (low) this.lowHpEl.style.setProperty('--sev', (1 - hpK / HP_LOW).toFixed(2));
    this.buffsEl.textContent = s.buffs.join('  ');
    const sk = s.statuses.map((x) => x.label).join('|');
    if (sk !== this.lastStatusKey) {
      this.lastStatusKey = sk;
      this.statusChips.innerHTML = s.statuses.map((x) => `<span class="chip ${x.cls}">${x.label}</span>`).join('');
    }

    // The cooldown sweeps change every frame; everything else only when it changes.
    const key = JSON.stringify(s.palette.map((p) => ({ ...p, cooldown: (p.cooldown ?? 0) > 0 })));
    if (key !== this.lastPaletteKey) {
      this.lastPaletteKey = key;
      s.palette.forEach((p, i) => this.fillHex(this.hexes[i], p.key, p.icon, p.count ?? '', p.label, p.disabled || p.kind === 'empty'));
    }
    s.palette.forEach((p, i) => this.hexes[i].style.setProperty('--cd', (p.cooldown ?? 0).toFixed(3)));
    // Between fights, point at the fix: slots that refill a low gauge pulse.
    s.palette.forEach((p, i) => {
      const need = (p.restores === 'hp' && hpK < NUDGE_HP) || (p.restores === 'tp' && tpK < NUDGE_TP);
      this.hexes[i].classList.toggle('nudge', s.calm && !p.disabled && need);
    });

    this.pips.forEach((p, i) => {
      p.classList.toggle('on', i < s.comboHits);
      p.classList.toggle('perfect', i < s.comboHits && i >= s.comboHits - s.comboStreak);
      p.classList.toggle('next', i === s.comboHits && s.comboWindow);
      p.classList.toggle('broken', s.comboBroken && i === s.comboHits);
    });

    this.updateCc(s.cc);
    this.castBar.style.visibility = s.cast !== null ? 'visible' : 'hidden';
    if (s.cast !== null) this.castFill.style.width = `${s.cast * 100}%`;

    if (s.target && !s.boss) {
      this.targetBox.style.display = 'block';
      this.targetName.textContent = s.target.name;
      this.setAttr(this.targetAttr, s.target.race);
      this.setTargetStatus(s.target.statuses);
      this.setAffixes(s.target.affixes, s.target.champion);
    } else {
      this.targetBox.style.display = 'none';
      this.setTargetStatus([]);
    }
    if (s.boss) {
      this.bossBox.style.display = 'block';
      this.bossName.textContent = s.boss.name + (s.boss.weak ? '  — WEAK POINT!' : '');
      this.setAttr(this.bossAttr, s.boss.race);
      this.bossBox.classList.toggle('weak', s.boss.weak);
    } else {
      this.bossBox.style.display = 'none';
    }

    this.areaEl.textContent = s.area;
    this.roomEl.textContent = s.roomInfo ?? '';
    this.promptEl.style.display = s.prompt ? 'block' : 'none';
    if (s.prompt) this.promptEl.innerHTML = s.prompt;

    if (this.bannerT > 0) {
      this.bannerT -= realDt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('show');
    }

    if (lockPos && this.project(lockPos, camera)) {
      this.reticle.style.display = 'block';
      this.reticle.style.transform = `translate(${this.tmp.x}px, ${this.tmp.y}px) translate(-50%, -50%)`;
    } else {
      this.reticle.style.display = 'none';
    }

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += realDt;
      if (f.t >= f.life) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      if (!this.project(f.pos, camera)) {
        f.el.style.display = 'none';
        continue;
      }
      const k = f.t / f.life;
      f.el.style.display = 'block';
      f.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      const pop = k < 0.12 ? 1 + (0.12 - k) * 5 : 1;
      f.el.style.transform = `translate(${this.tmp.x + f.drift * k}px, ${this.tmp.y - 50 * k}px) translate(-50%, -50%) scale(${pop})`;
    }
  }

  /**
   * Set a gauge's fill and drag its damage trail behind it: a lost chunk stays
   * lit for a moment, then drains down to the new value. Gains snap.
   */
  private setGauge(fill: HTMLDivElement, trailEl: HTMLDivElement, tr: { k: number; last: number; hold: number }, k: number, dt: number): void {
    if (k < tr.last - 1e-4) tr.hold = 0; // a fresh hit re-arms the hold, so a flurry reads as one big chunk
    tr.last = k;
    if (k >= tr.k) tr.k = k;
    else if (tr.hold < TRAIL_HOLD) tr.hold += dt;
    else tr.k = Math.max(k, tr.k - TRAIL_DRAIN * dt);
    fill.style.width = `${k * 100}%`;
    trailEl.style.width = `${tr.k * 100}%`;
  }

  private setInjector(v: { root: HTMLDivElement; cells: HTMLDivElement; key: string }, inj: HudState['injector']): void {
    v.root.style.display = inj ? '' : 'none';
    if (!inj) return;
    const key = `${inj.kind}:${inj.doses}:${inj.name}`;
    if (key !== v.key) {
      v.key = key;
      v.root.className = `inj inj-${inj.kind}`;
      v.root.title = `${inj.name} — restores ${inj.kind === 'mate' ? 'HP' : 'TP'}`;
      v.cells.innerHTML = '<i></i>'.repeat(inj.doses);
    }
    const cells = v.cells.children;
    for (let d = 0; d < cells.length; d++) {
      const k = Math.max(0, Math.min(1, inj.charge - d));
      (cells[d] as HTMLElement).style.setProperty('--k', k.toFixed(3));
      cells[d].classList.toggle('full', k >= 1);
    }
    v.root.classList.toggle('empty', inj.charge < 1);
  }

  /** Affix chips under the target's name. */
  private setAffixes(list: { name: string; color: string }[], champion: boolean): void {
    const key = `${champion}|${list.map((a) => a.name).join(',')}`;
    if (key === this.targetAffixKey) return;
    this.targetAffixKey = key;
    this.targetBox.classList.toggle('champion', champion);
    const chips = list.map((a) => `<span class="affix-chip" style="--c:${a.color}">${a.name}</span>`).join('');
    this.targetAffixes.innerHTML = list.length ? `<div class="affix-chips">${chips}</div>` : '';
  }

  /** Attribute tag (Native / A.Beast / Machine / Dark) under a target's name. */
  private setAttr(tag: HTMLDivElement, race: Race | null): void {
    tag.style.display = race ? '' : 'none';
    if (!race) return;
    tag.textContent = ATTR_LABEL[race];
    tag.className = `attr-tag attr-${race}`;
  }

  /**
   * One badge per status on the target. The ring around the glyph drains
   * clockwise like a clock as the status runs out (full ring = just applied),
   * with the seconds left underneath; the badge blinks in its last half second.
   */
  private setTargetStatus(list: StatusTimer[]): void {
    const live = new Set<string>();
    for (const st of list) {
      live.add(st.kind);
      let b = this.targetStatusEls.get(st.kind);
      if (!b) {
        b = el(`st st-${st.kind}`, this.targetStatus, `<div class="st-glyph">${statusIcon(st.kind)}</div><div class="st-sec"></div>`);
        b.title = STATUS_LABEL[st.kind];
        this.targetStatusEls.set(st.kind, b);
      }
      const k = st.total > 0 ? Math.min(1, st.left / st.total) : 0;
      b.style.setProperty('--k', k.toFixed(3));
      (b.lastChild as HTMLElement).textContent = st.left < 10 ? st.left.toFixed(1) : String(Math.ceil(st.left));
      b.classList.toggle('ending', st.left < 0.5);
    }
    for (const [kind, b] of this.targetStatusEls) {
      if (live.has(kind)) continue;
      b.remove();
      this.targetStatusEls.delete(kind);
    }
  }

  /** Project world -> screen into this.tmp; false if behind camera. */
  private project(p: THREE.Vector3, camera: THREE.Camera): boolean {
    this.tmp.copy(p).project(camera);
    if (this.tmp.z > 1) return false;
    this.tmp.x = (this.tmp.x * 0.5 + 0.5) * window.innerWidth;
    this.tmp.y = (-this.tmp.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }
}
