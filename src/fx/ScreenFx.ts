import type { FxFlashKind } from './FxCues';
import { retrigger } from './ui/dom';

/**
 * 画面全体のフラッシュ（FX_SPEC.md §4.4）。全面に DOM レイヤーを 1 枚だけ置き、
 * white（閃光）・red-edge（自軍の城が削られた）・gold（報酬）を強さに応じて出す。
 * 連続で光りすぎないよう、回数の制限は FxDirector が行う。
 */
export class ScreenFx {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'fx-screen';
    this.el.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.el);
  }

  flash(kind: FxFlashKind, strength: number): void {
    this.el.dataset.kind = kind;
    this.el.style.setProperty('--fx-strength', String(Math.max(0.1, Math.min(1, strength))));
    retrigger(this.el, 'on');
  }
}
