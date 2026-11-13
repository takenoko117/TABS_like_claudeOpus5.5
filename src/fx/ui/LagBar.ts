/** 減ったぶんが白く残るまでの秒数と、そのあと縮む速さ（1 秒あたりの割合） */
export const LAG_BAR_HOLD = 0.45;
export const LAG_BAR_SPEED = 0.6;

/**
 * HP バーの遅延ゲージの計算部分（DOM なし）。
 * 本体（value）はすぐ減り、遅れゲージ（lag）は少し待ってから縮む。回復は両方すぐ上がる。
 */
export class LagGauge {
  value: number;
  lag: number;
  private hold = 0;

  constructor(initial = 1) {
    this.value = initial;
    this.lag = initial;
  }

  /** 比率（0〜1）を伝える。戻り値は減った量（減っていなければ 0） */
  set(ratio: number): number {
    const r = Math.max(0, Math.min(1, ratio));
    const drop = this.value - r;
    if (r < this.value) {
      // 減った: 遅れゲージは今の位置に残して待つ
      this.lag = Math.max(this.lag, this.value);
      this.hold = LAG_BAR_HOLD;
    }
    this.value = r;
    if (this.lag < r) this.lag = r;
    return drop > 0 ? drop : 0;
  }

  snap(ratio: number): void {
    this.value = this.lag = Math.max(0, Math.min(1, ratio));
    this.hold = 0;
  }

  update(dt: number): void {
    if (this.lag <= this.value) return;
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    this.lag = Math.max(this.value, this.lag - LAG_BAR_SPEED * dt);
  }
}

/**
 * HP バーの要素に遅延ゲージを付ける。既存の塗り（fill）の後ろに白いゲージを差し込む（FX_SPEC.md §4.5）。
 */
export class LagBar {
  private readonly gauge = new LagGauge(1);
  private readonly lagEl: HTMLElement;
  private started = false;

  constructor(
    private readonly track: HTMLElement,
    private readonly fill: HTMLElement,
  ) {
    this.lagEl = document.createElement('b');
    this.lagEl.className = 'fx-lag';
    track.insertBefore(this.lagEl, fill);
  }

  /** 比率を伝えて 1 フレーム進める。戻り値は今回減った量 */
  update(ratio: number, dt: number): number {
    let drop = 0;
    if (!this.started) {
      this.started = true;
      this.gauge.snap(ratio);
    } else drop = this.gauge.set(ratio);
    this.gauge.update(dt);
    this.fill.style.width = `${this.gauge.value * 100}%`;
    this.lagEl.style.width = `${this.gauge.lag * 100}%`;
    return drop;
  }

  reset(): void {
    this.started = false;
  }

  get isConnected(): boolean {
    return this.track.isConnected && this.lagEl.isConnected;
  }
}
