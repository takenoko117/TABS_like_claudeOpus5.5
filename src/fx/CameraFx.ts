import {
  FX_SHAKE_FREQUENCY,
  FX_SHAKE_MAX_OFFSET,
  FX_SHAKE_MAX_ROLL,
  FX_SPRING_DAMPING,
  FX_SPRING_OMEGA,
  FX_TRAUMA_DECAY,
  FX_TRAUMA_MAX,
} from './FxCues';

/** カメラに加える一時的なずれ（描画の間だけ足す） */
export interface CameraOffset {
  x: number;
  y: number;
  z: number;
  /** ロール（ラジアン） */
  roll: number;
  /** FOV の倍率（1 未満で寄る） */
  fovScale: number;
}

/** 1 次元のなめらかなノイズ（値ノイズ＋スムーズステップ）。-1〜1。乱数を使わず決定的 */
export function smoothNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u);
}

function hash(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 減衰つきのばね（目標 0 へ戻る）。方向キックとズームパンチに使う */
class Spring {
  value = 0;
  velocity = 0;
  step(dt: number): void {
    // 長いフレームでも暴れないよう細かく刻む
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const acc = -FX_SPRING_OMEGA * FX_SPRING_OMEGA * this.value - 2 * FX_SPRING_DAMPING * FX_SPRING_OMEGA * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3) {
      this.value = 0;
      this.velocity = 0;
    }
  }
  /** 一瞬押し出す（速度を与える） */
  impulse(amount: number): void {
    this.velocity += amount * FX_SPRING_OMEGA;
  }
  reset(): void {
    this.value = 0;
    this.velocity = 0;
  }
}

/**
 * トラウマ式のカメラの揺れ・方向キック・ズームパンチ（FX_SPEC.md §4.2）。
 * トラウマは足し算で溜まり、揺れ幅は trauma² になる。小さな衝撃は目立たず、続くと育つ。
 */
export class CameraFx {
  trauma = 0;
  private time = 0;
  private readonly kickX = new Spring();
  private readonly kickZ = new Spring();
  private readonly zoom = new Spring();
  /** 揺れの倍率（設定で下げる） */
  shakeScale = 1;

  addTrauma(amount: number): void {
    if (!(amount > 0)) return;
    this.trauma = Math.min(FX_TRAUMA_MAX, this.trauma + amount);
  }

  /** 衝撃の向き（水平の単位ベクトルでなくてもよい）にカメラを押す */
  kick(dirX: number, dirZ: number, amount: number): void {
    if (!(amount > 0)) return;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    this.kickX.impulse((dirX / len) * amount);
    this.kickZ.impulse((dirZ / len) * amount);
  }

  /** FOV を一瞬狭めて戻す（amount = 0.05 で 5% 程度寄る） */
  zoomPunch(amount: number): void {
    if (!(amount > 0)) return;
    this.zoom.impulse(amount);
  }

  /** 実際の揺れ幅（0〜1）。trauma² */
  get shakeAmount(): number {
    return this.trauma * this.trauma * this.shakeScale;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - FX_TRAUMA_DECAY * dt);
    this.kickX.step(dt);
    this.kickZ.step(dt);
    this.zoom.step(dt);
  }

  /** 今のフレームのずれ */
  offset(out: CameraOffset = { x: 0, y: 0, z: 0, roll: 0, fovScale: 1 }): CameraOffset {
    const s = this.shakeAmount;
    const t = this.time * FX_SHAKE_FREQUENCY;
    out.x = s * FX_SHAKE_MAX_OFFSET * smoothNoise(t, 1) + this.kickX.value;
    out.y = s * FX_SHAKE_MAX_OFFSET * smoothNoise(t, 2) * 0.7;
    out.z = s * FX_SHAKE_MAX_OFFSET * smoothNoise(t, 3) + this.kickZ.value;
    out.roll = s * FX_SHAKE_MAX_ROLL * smoothNoise(t, 4);
    out.fovScale = 1 - Math.max(-0.5, Math.min(0.5, this.zoom.value));
    return out;
  }

  /** 何か動いているか（止まっていれば描画で何も足さなくてよい） */
  get active(): boolean {
    return this.shakeAmount > 1e-5 || this.kickX.value !== 0 || this.kickZ.value !== 0 || this.zoom.value !== 0;
  }

  reset(): void {
    this.trauma = 0;
    this.kickX.reset();
    this.kickZ.reset();
    this.zoom.reset();
  }
}
