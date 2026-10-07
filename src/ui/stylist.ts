import type { WeaponKind } from '../game/data/items';
import type { Look } from '../game/models/heroine';
import { getStage, LookEditor } from './lookEditor';
import type { Menu } from './Menus';

// The Pioneer 2 stylist: change your appearance at any time, for free.
// Same steps as character creation, minus class and name.

export interface StylistApi {
  look: Look;
  weapon: WeaponKind | null;
  apply(look: Look): void;
  cancel(): void;
}

export class StylistMenu implements Menu {
  cls = 'title';
  layer = 'stage-layer';
  closable = false; // Esc steps back through the editor instead
  private editor: LookEditor;
  private layerEl: HTMLElement | null = null;

  constructor(private api: StylistApi) {
    this.editor = new LookEditor(['body', 'hair', 'face', 'colors', 'review'], { look: api.look }, 'Apply');
  }

  render(): string {
    return `<div class="stylist-head"><div class="stylist-name">Stylist</div><div class="stylist-sub">“Let's find a new you. Take your time!”</div></div>${this.editor.render()}`;
  }

  afterRender(panel: HTMLElement): void {
    this.layerEl = panel.parentElement;
    this.sync();
    this.editor.afterRender(panel, () => this.sync());
  }

  private sync(): void {
    if (!this.layerEl) return;
    const stage = getStage();
    stage.leftInset = 0.44;
    stage.setLook(this.editor.stageLook(), this.api.weapon);
    stage.spin = this.editor.spin;
    stage.setView(this.editor.stageView());
    stage.show(this.layerEl);
  }

  onClose(): void {
    getStage().hide();
  }

  onKey(e: KeyboardEvent): boolean {
    const { handled, result } = this.editor.onKey(e);
    this.handle(result);
    return handled;
  }

  onAction(act: string, arg: string): void {
    this.handle(this.editor.onAction(act, arg));
  }

  private handle(r: 'finish' | 'cancel' | null): void {
    if (r === 'finish') this.api.apply(this.editor.result());
    else if (r === 'cancel') this.api.cancel();
  }
}
