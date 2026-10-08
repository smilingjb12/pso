import { KITS, noAttributes, STAT_LABEL, statsAtLevel, type KitId, type StatKey } from '../game/data/stats';
import { getDef, type WeaponKind } from '../game/data/items';
import { armorLook, CREATION_CHOICES, EVOLUTIONS, OUTFITS, PALETTES, type ChosenKey, type Look, type LookColors } from '../game/models/heroine';
import { esc } from './Menus';
import { MenuStage, type StageView } from './MenuStage';

// Step-by-step appearance editor over the 3D stage. Used by character
// creation (with kit and name steps) and by the stylist in Pioneer 2.

export type StepId = 'kit' | 'body' | 'hair' | 'colors' | 'face' | 'name' | 'review';

interface StepDef {
  title: string;
  hint: string;
  view: StageView;
  spin?: boolean;
}
const STEP_DEFS: Record<StepId, StepDef> = {
  kit: { title: 'Kit', hint: 'There are no classes: every level gives attribute points (POW, DEX, MIND, DEF) and a Mag square, and where they go decides how you fight. The kit only sets your starting gear and Lv 1 stats. Your armour dresses you.', view: 'body' },
  body: { title: 'Body', hint: 'Pick her proportions.', view: 'body' },
  hair: { title: 'Hair', hint: 'Style and colour.', view: 'upper' },
  colors: { title: 'Colours', hint: 'Colour scheme. Your clothes come from your armour; preview its better frames below to see the glow colour. She turns so you can see her back.', view: 'body', spin: true },
  face: { title: 'Face gear', hint: 'Something over the eyes or the mouth, or nothing at all.', view: 'upper' },
  name: { title: 'Name', hint: 'Name your character and check everything before you set out.', view: 'body' },
  review: { title: 'Review', hint: 'Check the new look. Changes are free, and you can come back any time.', view: 'body' },
};

type ColorKey = keyof LookColors;
const SWATCHES: Record<ColorKey, number[]> = {
  hair: [0xe88c78, 0xdcdcea, 0x1a181e, 0xf2d27a, 0xc8343a, 0x2a3a6e, 0x7ad8c0, 0xb8a0e8],
  main: [0x3c4150, 0x3a2c60, 0x26386a, 0xf0f0f4, 0x8c1a32, 0x1c1c24, 0x1f6a4c, 0x1f5a6a],
  second: [0xe6e1d8, 0xe2def0, 0xf4f6fa, 0xd8b048, 0xb02a3c, 0x202028, 0x8ad0f0, 0xf0a0c0],
  accent: [0x3cb4c4, 0xb478ff, 0x4ae8ff, 0xff4ab0, 0xffc040, 0x50f0a0, 0xff5050, 0xe8f0ff],
};
const COLOR_LABEL: Record<ColorKey, string> = { hair: 'Hair colour', main: 'Outfit colour', second: 'Trim colour', accent: 'Glow colour' };
const STAGE_STATS: StatKey[] = ['hp', 'tp', 'atp', 'dfp', 'mst', 'ata', 'evp'];

export const hex6 = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const choice = (key: ChosenKey) => CREATION_CHOICES.find((c) => c.key === key)!;

export function kitWeapon(kit: KitId): WeaponKind {
  return (getDef(KITS[kit].startWeapon) as { kind: WeaponKind }).kind;
}

let stage: MenuStage | null = null;
/** The shared 3D stage behind the title screen, creation and the stylist. */
export function getStage(): MenuStage {
  return (stage ??= new MenuStage());
}

export type EditorResult = 'finish' | 'cancel' | null;

export class LookEditor {
  step = 0;
  look: Look;
  colors: LookColors;
  name = '';
  error = '';
  private viewOverride: StageView | null = null;

  constructor(
    readonly steps: StepId[],
    init: { look: Look; kit?: KitId; name?: string },
    readonly finishLabel: string,
    public kit: KitId = init.kit ?? 'vanguard',
  ) {
    this.look = { ...init.look };
    this.colors = { ...init.look.colors };
    delete this.look.colors;
    this.name = init.name ?? '';
  }

  get stepId(): StepId {
    return this.steps[this.step];
  }

  /** Armour stage previewed on the stage (null: the armour actually worn). */
  previewEvo: number | null = null;

  /** The look as it stands, colours included (the armour's outfit and stage are not part of it). */
  result(): Look {
    const look: Look = { ...this.look, colors: Object.keys(this.colors).length ? { ...this.colors } : undefined };
    delete look.evo;
    return look;
  }

  /** The outfit and stage shown: the kit's starter armour at creation, else the frame worn (from the initial look). */
  private gear(): { outfit: string; evo: number } {
    return this.steps.includes('kit') ? armorLook(KITS[this.kit].attribute) : { outfit: this.look.outfit, evo: this.look.evo ?? 0 };
  }

  /** What the 3D stage shows: the look in its armour, or the previewed armour stage. */
  stageLook(): Look {
    const gear = this.gear();
    return { ...this.result(), ...gear, evo: this.previewEvo ?? gear.evo };
  }

  stageView(): StageView {
    return this.viewOverride ?? STEP_DEFS[this.stepId].view;
  }

  get spin(): boolean {
    return !!STEP_DEFS[this.stepId].spin;
  }

  // ------------------------------------------------------------ render

  render(): string {
    const def = STEP_DEFS[this.stepId];
    const bar = this.steps
      .map(
        (id, i) =>
          `<button class="step${i === this.step ? ' on' : ''}${i < this.step ? ' done' : ''}" data-act="goStep" data-arg="${i}"><span class="step-n">${i < this.step ? '✓' : i + 1}</span>${STEP_DEFS[id].title}</button>`,
      )
      .join('<span class="step-line"></span>');
    const last = this.step === this.steps.length - 1;
    return `<div class="stepbar">${bar}</div>
      <div class="win wiz-win"><div class="win-title">${def.title}</div>
        <div class="wiz-hint">${def.hint}</div>
        <div class="wiz-body">${this.body()}</div>
        <div class="win-actions spread"><button class="btn ghost" data-act="prev">◀ ${this.step === 0 ? 'Cancel' : 'Back'}</button>
          <span class="step-count">${this.step + 1} / ${this.steps.length}</span>
          <button class="btn primary" data-act="${last ? 'finish' : 'next'}">${last ? `${this.finishLabel} ▶` : 'Next ▶'}</button></div>
      </div>
      <div class="view-btns">${(['body', 'upper', 'face'] as StageView[])
        .map((v) => `<button class="chip${this.stageView() === v ? ' sel' : ''}" data-act="view" data-arg="${v}">${{ body: 'Full body', upper: 'Upper body', face: 'Face' }[v]}</button>`)
        .join('')}</div>
      <div class="key-hints"><span>Drag to turn</span><span><kbd>Enter</kbd> ${last ? this.finishLabel : 'Next'}</span><span><kbd>Esc</kbd> Back</span></div>`;
  }

  private body(): string {
    switch (this.stepId) {
      case 'kit':
        return this.kitCards();
      case 'body':
        return this.options('body', 'cards');
      case 'hair':
        return this.options('hair', 'cards') + this.colorRow('hair');
      case 'colors':
        return (
          this.options('palette', 'chips') + this.colorRow('main') + this.colorRow('second') + this.colorRow('accent') +
          section('Armour preview') + this.armorPreview()
        );
      case 'face':
        return this.options('face', 'cards');
      case 'name':
        return `<label class="field big"><span>Name</span><input id="charName" maxlength="12" value="${esc(this.name)}" autocomplete="off" placeholder="Enter a name" /></label>
          ${this.error ? `<div class="error">${this.error}</div>` : ''}${this.summary()}`;
      case 'review':
        return this.summary();
    }
  }

  private kitCards(): string {
    const ids = Object.keys(KITS) as KitId[];
    const lv1 = (id: KitId) => statsAtLevel(KITS[id], 1, noAttributes());
    const max = Object.fromEntries(STAGE_STATS.map((k) => [k, Math.max(...ids.map((id) => lv1(id)[k]))])) as Record<StatKey, number>;
    return `<div class="opt-grid one">${ids
      .map((id) => {
        const k = KITS[id];
        const s1 = lv1(id);
        const bars = STAGE_STATS.map((st) => `<div class="sbar"><span>${STAT_LABEL[st]}</span><i style="--v:${(s1[st] / max[st]).toFixed(3)}"></i></div>`).join('');
        return `<div class="opt class-opt${this.kit === id ? ' sel' : ''}" data-act="kit" data-arg="${id}" style="--c:${hex6(k.color)}">
          <div class="opt-name">${k.name} <span class="opt-tag">kit</span></div>
          <div class="opt-desc">${k.desc}</div><div class="sbars">${bars}</div></div>`;
      })
      .join('')}</div><div class="dim small-note">Bars: Lv 1 stats, relative to the best kit. After Lv 1 only your attribute points, Mag and gear count.</div>`;
  }

  /** Chips that show the outfit at each armour stage (preview only). */
  private armorPreview(): string {
    const gear = this.gear();
    const evo = EVOLUTIONS[gear.outfit];
    const cur = this.previewEvo ?? gear.evo;
    const chips = evo.stages
      .map((st, i) => `<button class="chip${cur === i ? ' sel' : ''}" data-act="evo" data-arg="${i}" title="${esc(st.desc)}">${i === gear.evo ? '● ' : ''}${esc(st.name)}</button>`)
      .join('');
    return `<div class="chips">${chips}</div><div class="dim small-note">${esc(OUTFITS[gear.outfit].name)} · ● = the armour you wear now. Better frames of the same line unlock the rest.</div>`;
  }

  private options(key: ChosenKey, style: 'cards' | 'chips'): string {
    const c = choice(key);
    const items = c.options
      .map((id) => {
        const n = c.names[id];
        const sel = this.look[key] === id ? ' sel' : '';
        if (style === 'chips') {
          const dot = key === 'palette' ? `<i class="pal-dot" style="--a:${hex6(PALETTES[id].hair)};--b:${hex6(PALETTES[id].main)};--c:${hex6(PALETTES[id].accent)}"></i>` : '';
          return `<button class="chip${sel}" data-act="opt" data-arg="${key}:${id}" title="${esc(n.desc ?? '')}">${dot}${esc(n.name)}</button>`;
        }
        return `<div class="opt${sel}" data-act="opt" data-arg="${key}:${id}"><div class="opt-name">${esc(n.name)}</div><div class="opt-desc">${esc(n.desc ?? '')}</div></div>`;
      })
      .join('');
    return style === 'chips' ? `<div class="chips">${items}</div>` : `<div class="opt-grid">${items}</div>`;
  }

  private colorRow(key: ColorKey): string {
    const cur = this.colors[key] ?? PALETTES[this.look.palette][key];
    const sw = SWATCHES[key]
      .map((c) => `<button class="swatch${c === cur ? ' sel' : ''}" style="--sw:${hex6(c)}" data-act="color" data-arg="${key}:${c}" title="${hex6(c)}"></button>`)
      .join('');
    return `<div class="color-row"><span class="color-label">${COLOR_LABEL[key]}</span><div class="swatches">${sw}
      <label class="swatch custom" title="Custom colour" style="--sw:${hex6(cur)}"><input type="color" data-color="${key}" value="${hex6(cur)}" /></label></div>
      <button class="btn small ghost${this.colors[key] === undefined ? ' disabled' : ''}" data-act="color" data-arg="${key}:default">Reset</button></div>`;
  }

  private summary(): string {
    const at = (id: StepId) => this.steps.indexOf(id);
    const line = (label: string, value: string, step: number) =>
      `<div class="sum-row" data-act="goStep" data-arg="${step}"><span>${label}</span><b>${value}</b><i>edit</i></div>`;
    const name = (key: ChosenKey) => esc(choice(key).names[this.look[key]].name);
    const dots = (Object.keys(this.colors) as ColorKey[]).map((k) => `<i class="dotc" style="--sw:${hex6(this.colors[k]!)}"></i>`).join('');
    return `<div class="summary">
      ${at('kit') >= 0 ? line('Kit', KITS[this.kit].name, at('kit')) : ''}
      ${line('Body', name('body'), at('body'))}
      ${line('Hair', name('hair'), at('hair'))}
      ${line('Colours', `${name('palette')} ${dots}`, at('colors'))}
      ${line('Face gear', name('face'), at('face'))}
      <div class="sum-row static"><span>Outfit</span><b>${esc(OUTFITS[this.gear().outfit].name)}</b><i>from armour</i></div>
    </div>`;
  }

  // ------------------------------------------------------------ input

  /** Wire inputs after a render; `changed` refreshes the stage without re-rendering. */
  afterRender(panel: HTMLElement, changed: () => void): void {
    panel.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((inp) => {
      inp.addEventListener('input', () => {
        this.colors[inp.dataset.color as ColorKey] = parseInt(inp.value.slice(1), 16);
        (inp.parentElement as HTMLElement).style.setProperty('--sw', inp.value);
        changed();
      });
    });
    const input = panel.querySelector('#charName') as HTMLInputElement | null;
    if (input) {
      input.addEventListener('input', () => (this.name = input.value));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (panel.querySelector('[data-act="finish"]') as HTMLElement).click();
        if (e.key === 'Escape') input.blur();
      });
      if (!this.name) input.focus();
    }
  }

  onKey(e: KeyboardEvent): { handled: boolean; result: EditorResult } {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return { handled: false, result: null };
    const last = this.step === this.steps.length - 1;
    const map: Record<string, string> = { Enter: last ? 'finish' : 'next', Escape: 'prev' };
    if (e.key === 'ArrowRight' && !last) map.ArrowRight = 'next';
    if (e.key === 'ArrowLeft' && this.step > 0) map.ArrowLeft = 'prev';
    const act = map[e.key];
    if (!act) return { handled: false, result: null };
    return { handled: true, result: this.onAction(act, '') };
  }

  onAction(act: string, arg: string): EditorResult {
    switch (act) {
      case 'view':
        this.viewOverride = arg as StageView;
        break;
      case 'goStep':
        this.goto(Number(arg));
        break;
      case 'next':
        this.goto(this.step + 1);
        break;
      case 'prev':
        if (this.step === 0) return 'cancel';
        this.goto(this.step - 1);
        break;
      case 'kit':
        this.kit = arg as KitId;
        break;
      case 'evo':
        this.previewEvo = Number(arg) === this.gear().evo ? null : Number(arg);
        break;
      case 'opt': {
        const [key, val] = arg.split(':') as [ChosenKey, string];
        // A new colour scheme starts from its own colours.
        if (key === 'palette' && this.look.palette !== val) this.colors = {};
        this.look[key] = val;
        break;
      }
      case 'color': {
        const [key, val] = arg.split(':') as [ColorKey, string];
        if (val === 'default') delete this.colors[key];
        else this.colors[key] = Number(val);
        break;
      }
      case 'finish':
        if (this.steps.includes('name') && !this.name.trim()) {
          this.error = 'Enter a name';
          this.goto(this.steps.indexOf('name'));
          return null;
        }
        return 'finish';
    }
    return null;
  }

  private goto(i: number): void {
    this.step = Math.max(0, Math.min(this.steps.length - 1, i));
    this.viewOverride = null;
    // The armour preview only lasts while on the colours step.
    if (this.stepId !== 'colors') this.previewEvo = null;
  }
}

function section(t: string): string {
  return `<div class="wiz-section">${t}</div>`;
}
