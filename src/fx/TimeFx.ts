import { FX_HITSTOP_MAX, FX_HITSTOP_MIN_GAP } from './FxCues';

/** 止まっていたぶんを取り戻すとき、1 フレームで余分に進める割合 */
const CATCH_UP_RATE = 0.5;

/**
 * ヒットストップとスロー（FX_SPEC.md §4.3）。
 * - 描画ストップ（既定）: 戦場は進めたまま、見た目（ラグドールの姿勢・粒子・カメラ）だけを一瞬止め、あとで追いつく。
 * - 戦場ストップ: 戦場に渡す時間そのものを止める。1 人用モードだけ（`battleScale(true)`）。
 *   オンライン対戦はロックステップ同期なので、`battleScale(false)` は常に 1 を返し、戦場の時間には触れない。
 */
export class TimeFx {
  private stopTimer = 0;
  private slowTimer = 0;
  private slowScaleValue = 1;
  /** 描画ストップで止めていた演出の時間（あとで少し速めて取り戻す） */
  private debt = 0;
  /** 次のヒットストップを受け付けるまでの残り秒数 */
  private gapTimer = 0;

  /** ヒットストップを要求する（重なったら長い方。上限あり） */
  hitStop(seconds: number): void {
    if (!(seconds > 0)) return;
    // 止まっている最中なら長い方に延ばす。明けた直後は受け付けない
    if (this.stopTimer <= 0 && this.gapTimer > 0) return;
    this.stopTimer = Math.min(FX_HITSTOP_MAX, Math.max(this.stopTimer, seconds));
  }

  /** スローを要求する（重なったら長い方・遅い方） */
  slow(seconds: number, scale: number): void {
    if (!(seconds > 0)) return;
    const was = this.slowTimer > 0 ? this.slowScaleValue : 1;
    this.slowTimer = Math.max(this.slowTimer, seconds);
    this.slowScaleValue = Math.max(0.05, Math.min(was, scale));
  }

  update(realDt: number): void {
    if (this.stopTimer > 0) {
      this.stopTimer = Math.max(0, this.stopTimer - realDt);
      if (this.stopTimer === 0) this.gapTimer = FX_HITSTOP_MIN_GAP;
    } else if (this.gapTimer > 0) this.gapTimer = Math.max(0, this.gapTimer - realDt);
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - realDt);
      if (this.slowTimer === 0) this.slowScaleValue = 1;
    }
  }

  /** 見た目を止めている最中か */
  get frozen(): boolean {
    return this.stopTimer > 0;
  }

  get slowing(): boolean {
    return this.slowTimer > 0;
  }

  /** 戦場に渡す時間の倍率。戦場ストップが許されないとき（対戦・観戦）は必ず 1 */
  battleScale(allowBattleStop: boolean): number {
    if (!allowBattleStop) return 1;
    if (this.stopTimer > 0) return 0;
    return this.slowTimer > 0 ? this.slowScaleValue : 1;
  }

  /**
   * 演出（粒子・カメラ）に渡す時間。止まっている間は 0 を返して借りを作り、明けたら少し速めて返す。
   * スロー中は演出もゆっくりにする（対戦では戦場は普通に進み、見た目の演出だけが遅くなる）。
   */
  fxDt(realDt: number): number {
    if (this.stopTimer > 0) {
      this.debt += realDt;
      return 0;
    }
    const base = realDt * (this.slowTimer > 0 ? this.slowScaleValue : 1);
    if (this.debt <= 0) return base;
    const extra = Math.min(this.debt, realDt * CATCH_UP_RATE);
    this.debt -= extra;
    return base + extra;
  }

  reset(): void {
    this.stopTimer = 0;
    this.slowTimer = 0;
    this.slowScaleValue = 1;
    this.debt = 0;
    this.gapTimer = 0;
  }
}
