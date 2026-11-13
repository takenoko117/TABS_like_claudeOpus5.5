/** 同時に飛ばしておける数（多すぎると重く、読めない） */
const FLOAT_TEXT_MAX = 12;
const FLOAT_TEXT_SECONDS = 0.9;

/**
 * HUD 上に「+120」「-80」などの小さな数字を飛ばす（FX_SPEC.md §4.5）。
 * 戦場の 3D 座標用の DamageOverlay とは別に、画面（client 座標）に出す。
 */
export class FloatText {
  private readonly layer: HTMLElement;
  private live = 0;

  constructor(parent: HTMLElement = document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'fx-float-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);
  }

  /**
   * 文字を出す。from から to へ流れる（to を省略すると上に浮く）。
   * kind: 'gain'（緑）/ 'loss'（赤）/ 'gold' など CSS のクラス名
   */
  spawn(text: string, from: { x: number; y: number }, kind = 'gain', to?: { x: number; y: number }): void {
    if (this.live >= FLOAT_TEXT_MAX) return;
    const el = document.createElement('span');
    el.className = `fx-float ${kind}`;
    el.textContent = text;
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.setProperty('--dx', `${to ? to.x - from.x : 0}px`);
    el.style.setProperty('--dy', `${to ? to.y - from.y : -38}px`);
    el.style.animationDuration = `${FLOAT_TEXT_SECONDS}s`;
    this.layer.appendChild(el);
    this.live++;
    const done = () => {
      if (!el.isConnected) return;
      el.remove();
      this.live--;
    };
    el.addEventListener('animationend', done, { once: true });
    // アニメーションが走らない環境（reduced-motion など）でも必ず消す
    window.setTimeout(done, FLOAT_TEXT_SECONDS * 1000 + 200);
  }

  /** 要素の中心（client 座標） */
  static centerOf(el: Element | null | undefined): { x: number; y: number } | null {
    const r = el?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
