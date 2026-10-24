import type { Vector3 } from 'three';
import type { Particle } from './Particle';

/**
 * 粒子の近傍探索用の空間ハッシュ（固定長テーブル + カウンティングソート方式）。
 * 毎ステップ build() で再構築し、query() で近傍の粒子インデックスを取得する。
 */
export class SpatialHash {
  spacing: number;
  private tableSize = 0;
  private cellStart = new Int32Array(0);
  private cellEntries = new Int32Array(0);
  /** 重複除去用のスタンプ（粒子ごとに最後に列挙したクエリ番号を保持） */
  private stamps = new Int32Array(0);
  private stamp = 0;
  /** 直近の query() の結果 */
  queryIds = new Int32Array(0);
  queryCount = 0;

  constructor(spacing: number, maxObjects = 1024) {
    this.spacing = spacing;
    this.allocate(maxObjects);
  }

  private allocate(n: number): void {
    this.tableSize = 2 * n + 1;
    this.cellStart = new Int32Array(this.tableSize + 1);
    this.cellEntries = new Int32Array(n);
    this.stamps = new Int32Array(n);
    this.queryIds = new Int32Array(n);
    this.stamp = 0;
  }

  private hash(xi: number, yi: number, zi: number): number {
    const h = Math.imul(xi, 92837111) ^ Math.imul(yi, 689287499) ^ Math.imul(zi, 283923481);
    return (h >>> 0) % this.tableSize;
  }

  private coord(v: number): number {
    return Math.floor(v / this.spacing);
  }

  build(particles: readonly Particle[]): void {
    const n = particles.length;
    if (n > this.cellEntries.length) {
      this.allocate(Math.max(n, this.cellEntries.length * 2));
    }
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const p = particles[i].pos;
      start[this.hash(this.coord(p.x), this.coord(p.y), this.coord(p.z))]++;
    }
    // 累積和でセルの開始位置を求める
    let acc = 0;
    for (let i = 0; i < this.tableSize; i++) {
      acc += start[i];
      start[i] = acc;
    }
    start[this.tableSize] = acc;
    for (let i = 0; i < n; i++) {
      const p = particles[i].pos;
      const h = this.hash(this.coord(p.x), this.coord(p.y), this.coord(p.z));
      start[h]--;
      this.cellEntries[start[h]] = i;
    }
  }

  /** pos から maxDist 以内のセルに含まれる粒子を列挙する（結果は queryIds / queryCount） */
  query(pos: Vector3, maxDist: number): void {
    const x0 = this.coord(pos.x - maxDist);
    const y0 = this.coord(pos.y - maxDist);
    const z0 = this.coord(pos.z - maxDist);
    const x1 = this.coord(pos.x + maxDist);
    const y1 = this.coord(pos.y + maxDist);
    const z1 = this.coord(pos.z + maxDist);
    this.queryCount = 0;
    this.stamp++;
    if (this.stamp === 0x7fffffff) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    for (let xi = x0; xi <= x1; xi++) {
      for (let yi = y0; yi <= y1; yi++) {
        for (let zi = z0; zi <= z1; zi++) {
          const h = this.hash(xi, yi, zi);
          const end = this.cellStart[h + 1];
          for (let k = this.cellStart[h]; k < end; k++) {
            const id = this.cellEntries[k];
            // ハッシュ衝突で同じ粒子が複数回列挙されるのを防ぐ
            if (this.stamps[id] === this.stamp) continue;
            this.stamps[id] = this.stamp;
            this.queryIds[this.queryCount++] = id;
          }
        }
      }
    }
  }
}
