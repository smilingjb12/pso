import { BOSS_IDS, BOSSES } from '../game/data/bosses';
import type { CharacterData } from '../game/character';
import type { Difficulty } from '../game/difficulty';
import { itemDefs, type WeaponKind } from '../game/data/items';
import { buildTitle, leadAttribute, type KitId } from '../game/data/stats';
import { magForm, magPointsFree, readMag } from '../game/mag';
import { DEFAULT_APPEARANCE, playerLook, type Look } from '../game/models/heroine';
import { getStage, kitWeapon, LookEditor } from './lookEditor';
import { esc, type Menu } from './Menus';

// Title screen: save slots, with the selected character standing on a
// teleporter pad. "Create character" opens the creation wizard. Starting a
// character asks for the difficulty first (Diablo style: the whole session is
// played on it; Nightmare opens once Dark Falz falls on Normal, Hell once it falls on Nightmare).

export type { Difficulty };

const DIFFS: { id: Difficulty; name: string; sub: string; lock: string }[] = [
  { id: 'normal', name: 'Normal', sub: 'Lv 1-42', lock: '' },
  { id: 'nightmare', name: 'Nightmare', sub: 'Lv 42-82', lock: 'Defeat Dark Falz on Normal to unlock' },
  { id: 'hell', name: 'Hell', sub: 'Lv 82-122', lock: 'Defeat Dark Falz on Nightmare to unlock' },
];

/** Nightmare opens once the last boss (Dark Falz) has fallen on Normal (characters who opened it with the Warden, before the Ruins, keep it). */
export function nightmareOpen(c: CharacterData): boolean {
  return BOSS_IDS.some((b) => BOSSES[b].opensNightmare && (c.stats.bossKills[b] ?? 0) > 0) || !!c.stats.nightmareKept;
}

/** Hell opens once the last boss (Dark Falz) has fallen on Nightmare. */
export function hellOpen(c: CharacterData): boolean {
  return BOSS_IDS.some((b) => BOSSES[b].opensNightmare && (c.stats.hardKills?.[b] ?? 0) > 0);
}

/** Difficulties this character can pick, easiest first. */
export function openDifficulties(c: CharacterData): Difficulty[] {
  return DIFFS.map((d) => d.id).filter((d) => d === 'normal' || (d === 'nightmare' ? nightmareOpen(c) : hellOpen(c)));
}

export interface TitleApi {
  slots(): (CharacterData | null)[];
  load(slot: number, difficulty: Difficulty): void;
  create(slot: number, name: string, kit: KitId, appearance: Look): void;
  remove(slot: number): void;
}

export class TitleMenu implements Menu {
  cls = 'title';
  layer = 'stage-layer';
  closable = false;
  private sel = 0;
  private confirmDelete = false;
  /** The difficulty step is showing for the selected slot. */
  private picking = false;
  private diff: Difficulty = 'normal';
  private editor: LookEditor | null = null;
  private layerEl: HTMLElement | null = null;

  constructor(readonly api: TitleApi) {
    const first = api.slots().findIndex((s) => s);
    this.sel = first >= 0 ? first : 0;
  }

  render(): string {
    return this.editor ? logo(true) + this.editor.render() : this.renderSlots();
  }

  private renderDifficulty(cur: CharacterData): string {
    const open = openDifficulties(cur);
    const rows = DIFFS.map((d) => {
      const locked = !open.includes(d.id);
      const cls = `slot-row diff-row${d.id === this.diff ? ' sel' : ''}${locked ? ' disabled' : ''}`;
      const sub = locked ? d.lock : d.sub;
      return `<div class="${cls}" data-act="diff" data-arg="${d.id}"><span class="slot-name">${d.name}</span><span class="diff-sub">${sub}</span></div>`;
    }).join('');
    return `<div class="win slot-win"><div class="win-title">Difficulty</div><div class="slot-list">${rows}</div>
      <div class="win-actions"><button class="btn primary big" data-act="enter">Enter ▶</button><button class="btn ghost" data-act="back">Back</button></div></div>`;
  }

  private renderSlots(): string {
    const slots = this.api.slots();
    const rows = slots
      .map((s, i) => {
        const on = i === this.sel ? ' sel' : '';
        const num = String(i + 1).padStart(2, '0');
        if (!s) return `<div class="slot-row empty${on}" data-act="sel" data-arg="${i}"><span class="slot-num">${num}</span><span class="slot-name dim">— Empty —</span></div>`;
        return `<div class="slot-row${on}" data-act="sel" data-arg="${i}"><span class="slot-num">${num}</span>
          <span class="slot-name">${esc(s.name)}</span><span class="slot-cls">${buildTitle(s.kit, s.attributes)}</span><span class="slot-lv">Lv ${s.level}</span></div>`;
      })
      .join('');
    const cur = slots[this.sel];
    let buttons: string;
    if (this.picking && cur) {
      buttons = '';
    } else if (this.confirmDelete && cur) {
      buttons = `<div class="confirm">Delete <b>${esc(cur.name)}</b>? This cannot be undone.</div>
        <div class="win-actions"><button class="btn danger" data-act="doDelete">Delete</button><button class="btn" data-act="cancelDelete">Cancel</button></div>`;
    } else if (cur) {
      buttons = `<div class="win-actions"><button class="btn primary big" data-act="load">Start ▶</button><button class="btn ghost" data-act="delete">Delete</button></div>`;
    } else {
      buttons = `<div class="win-actions"><button class="btn primary big" data-act="new">Create character ▶</button></div>`;
    }
    const plate = cur
      ? `<div class="win nameplate"><div class="np-name">${esc(cur.name)}</div>
          <div class="np-sub">${buildTitle(cur.kit, cur.attributes)}</div>
          <div class="np-grid"><span>Level</span><b>${cur.level}</b><span>Meseta</span><b>${cur.meseta.toLocaleString()}</b>
          <span>Play time</span><b>${formatTime(cur.stats.playSeconds)}</b><span>Dragons</span><b>${cur.stats.bossKills.dragon ?? 0}</b></div></div>`
      : `<div class="win nameplate empty"><div class="np-name dim">No data</div><div class="np-sub">Create a character in this slot.</div></div>`;
    if (this.picking && cur) {
      return `${logo()}${this.renderDifficulty(cur)}${plate}
        <div class="key-hints"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> Enter</span><span><kbd>Esc</kbd> Back</span><span>Drag to turn</span></div>`;
    }
    return `${logo()}
      <div class="win slot-win"><div class="win-title">Select character</div><div class="slot-list">${rows}</div>${buttons}</div>
      ${plate}
      <div class="key-hints"><span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>Enter</kbd> ${cur ? 'Start' : 'Create'}</span><span>Drag to turn</span></div>`;
  }

  private syncStage(): void {
    if (!this.layerEl) return;
    const stage = getStage();
    const ed = this.editor;
    if (ed) {
      stage.leftInset = 0.44;
      stage.setLook(ed.stageLook(), kitWeapon(ed.kit));
      stage.spin = ed.spin;
      stage.setView(ed.stageView());
    } else {
      const cur = this.api.slots()[this.sel];
      stage.leftInset = 0.36;
      const curMag = cur ? readMag(cur.mag) : null;
      const mag = cur && curMag ? magForm(curMag, leadAttribute(cur.kit, cur.attributes)) : null;
      const glow = !!cur && !!curMag && magPointsFree(curMag, cur.level) > 0;
      stage.setLook(cur ? playerLook(cur) : null, cur ? heldWeapon(cur) : null, mag && { stage: mag.stage, color: mag.color, theme: mag.theme, glow });
      stage.spin = false;
      stage.setView('body');
    }
    stage.show(this.layerEl);
  }

  afterRender(panel: HTMLElement): void {
    this.layerEl = panel.parentElement;
    this.syncStage();
    this.editor?.afterRender(panel, () => this.syncStage());
  }

  onClose(): void {
    getStage().hide();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.editor) {
      const { handled, result } = this.editor.onKey(e);
      this.handleResult(result);
      return handled;
    }
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return false;
    if (this.picking) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const cur = this.api.slots()[this.sel];
        if (cur) {
          const open = openDifficulties(cur);
          const i = open.indexOf(this.diff);
          this.diff = open[(i + (e.key === 'ArrowDown' ? 1 : open.length - 1)) % open.length];
        }
        return true;
      }
      if (e.key === 'Enter') {
        this.onAction('enter', '');
        return true;
      }
      if (e.key === 'Escape') {
        this.picking = false;
        return true;
      }
      return false;
    }
    const n = this.api.slots().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.confirmDelete = false;
      return true;
    }
    if (e.key === 'Enter') {
      this.onAction(this.api.slots()[this.sel] ? 'load' : 'new', '');
      return true;
    }
    if (e.key === 'Delete' && this.api.slots()[this.sel]) {
      this.confirmDelete = true;
      return true;
    }
    return false;
  }

  onAction(act: string, arg: string): void {
    if (this.editor) {
      this.handleResult(this.editor.onAction(act, arg));
      return;
    }
    switch (act) {
      case 'sel':
        this.sel = Number(arg);
        this.confirmDelete = false;
        break;
      case 'load': {
        // Pick the difficulty next; start on the hardest one this character has open.
        const cur = this.api.slots()[this.sel];
        if (!cur) break;
        const open = openDifficulties(cur);
        this.diff = open[open.length - 1];
        this.picking = true;
        break;
      }
      case 'diff': {
        const cur = this.api.slots()[this.sel];
        if (cur && openDifficulties(cur).includes(arg as Difficulty)) this.diff = arg as Difficulty;
        break;
      }
      case 'enter':
        this.picking = false;
        this.api.load(this.sel, this.diff);
        break;
      case 'back':
        this.picking = false;
        break;
      case 'delete':
        this.confirmDelete = true;
        break;
      case 'cancelDelete':
        this.confirmDelete = false;
        break;
      case 'doDelete':
        this.api.remove(this.sel);
        this.confirmDelete = false;
        break;
      case 'new':
        this.editor = new LookEditor(['kit', 'body', 'hair', 'face', 'colors', 'name'], { look: DEFAULT_APPEARANCE }, 'Start');
        break;
    }
  }

  private handleResult(r: 'finish' | 'cancel' | null): void {
    const ed = this.editor;
    if (!ed || !r) return;
    if (r === 'cancel') this.editor = null;
    else this.api.create(this.sel, ed.name.trim(), ed.kit, ed.result());
  }
}

/** The kind of weapon a saved character has in hand (the kit's starter if none is equipped). */
function heldWeapon(c: CharacterData): WeaponKind {
  const id = c.inventory.find((i) => i.uid === c.equipped.weapon)?.id;
  const def = id ? itemDefs[id] : undefined;
  return def?.type === 'weapon' ? def.kind : kitWeapon(c.kit);
}

export function logo(small = false): string {
  return `<div class="logo${small ? ' small' : ''}"><div class="logo-main">PHANTASY<i>✦</i>STAR<sup>-like</sup></div><div class="logo-tag">a three.js gameplay prototype</div></div>`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
