import { retrigger } from './dom';

/**
 * 表示上の数値をなめらかに目標へ追従させる計算部分（DOM なし）。
 * 指数的に近づき、最後は必ず目標にぴったり止まる。
 */
export class NumberTween {
  shown: number;
  target: number;

  /** halfLife: 差が半分になるまでの秒数 */
  constructor(
    initial = 0,
    private readonly halfLife = 0.08,
  ) {
    this.shown = initial;
    this.target = initial;
  }

  /** 目標を変える。戻り値は変化量（増えたら正） */
  set(value: number): number {
    const delta = value - this.target;
    this.target = value;
    return delta;
  }

  /** 一気に合わせる（ランの切り替えなど） */
  snap(value: number): void {
    this.shown = value;
    this.target = value;
  }

  update(dt: number): number {
    const diff = this.target - this.shown;
    if (diff === 0) return this.shown;
    const k = 1 - Math.pow(0.5, Math.max(0, dt) / this.halfLife);
    this.shown += diff * k;
    // 1 未満の差は丸めて止める（表示が整数のため）
    if (Math.abs(this.target - this.shown) < 0.5) this.shown = this.target;
    return this.shown;
  }

  get settled(): boolean {
    return this.shown === this.target;
  }
}

/**
 * 数値表示の要素に付ける。増えたら緑、減ったら赤に一瞬光り、数字はなめらかに追従する（FX_SPEC.md §4.5）。
 */
export class TweenNumber {
  private readonly tween: NumberTween;
  private last = '';
  private started = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly format: (n: number) => string = (n) => Math.round(n).toLocaleString(),
    halfLife = 0.08,
    /** これより小さい変化では光らせない（資金の毎秒の収入などで光りっぱなしにしない） */
    private readonly flashThreshold = 0,
  ) {
    this.tween = new NumberTween(0, halfLife);
  }

  /** 目標の値を伝え、表示を 1 フレーム進める */
  update(value: number, dt: number): void {
    if (!this.started) {
      this.started = true;
      this.tween.snap(value);
    } else {
      const delta = this.tween.set(value);
      if (delta !== 0 && Math.abs(delta) > this.flashThreshold) {
        this.el.classList.remove(delta > 0 ? 'fx-down' : 'fx-up');
        retrigger(this.el, delta > 0 ? 'fx-up' : 'fx-down');
      }
    }
    const text = this.format(this.tween.update(dt));
    if (text !== this.last) {
      this.last = text;
      this.el.textContent = text;
    }
  }

  /** 次の update で一気に合わせる */
  reset(): void {
    this.started = false;
  }
}
