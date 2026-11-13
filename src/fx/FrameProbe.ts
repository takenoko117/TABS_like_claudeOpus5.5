/** 計測の窓（直近のフレーム数） */
const PROBE_WINDOW = 240;

export interface FrameStats {
  frames: number;
  avg: number;
  p95: number;
  max: number;
}

/**
 * フレーム時間の計測（決定事項 R5）。演出を足しても重くなっていないことを数値で確かめるために使う。
 * URL に `?perf=1` を付けると画面の隅に平均・95 パーセンタイル・最大（ミリ秒）を出す。
 */
export class FrameProbe {
  private readonly samples: number[] = [];
  private cursor = 0;

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.samples.length < PROBE_WINDOW) this.samples.push(ms);
    else {
      this.samples[this.cursor] = ms;
      this.cursor = (this.cursor + 1) % PROBE_WINDOW;
    }
  }

  stats(): FrameStats {
    const n = this.samples.length;
    if (n === 0) return { frames: 0, avg: 0, p95: 0, max: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      frames: n,
      avg: sum / n,
      p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
      max: sorted[n - 1],
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.cursor = 0;
  }
}
