import { FIELD_COLS, FIELD_ROWS, GROUND, WATER, cellIndex } from './FieldTypes';

/** 通行コストの種類（0: 通常, 1: 巨体） */
export type PathMode = 0 | 1;

/** グリッドのマスの数（グリッドの横幅は戦場によって変わるので毎回求める） */
function gridSize(): number {
  return FIELD_COLS * FIELD_ROWS;
}

/**
 * マスの通行コスト（Infinity なら通れない）。§8 の地面・水域の効果をそのまま反映する。
 * blocked: そのマスを塞いでいる地物の区画の数。pit: 奈落のマスなら 1。
 */
export function cellCost(ground: number, water: number, blocked: number, pit: number, mode: PathMode): number {
  if (pit) return Infinity;
  if (water === WATER.lava) return Infinity;
  let c = 1;
  if (blocked > 0) {
    if (mode === 0) return Infinity;
    c += 5; // 巨体は踏み倒して進む
  }
  switch (water) {
    case WATER.deep:
      c *= mode === 1 ? 3 : 14;
      break;
    case WATER.quicksand:
      c *= mode === 1 ? 1.5 : 30;
      break;
    case WATER.swamp:
      c *= mode === 1 ? 1.8 : 2.5;
      break;
    case WATER.shallow:
      c *= mode === 1 ? 1.5 : 2.2;
      break;
    case WATER.ice:
      c *= 1.4;
      break;
  }
  if (ground === GROUND.road || ground === GROUND.bridge) c *= 0.85;
  else if (ground === GROUND.rubble) c *= 1.3;
  return c;
}

/** コスト配列を作る */
export function buildCostGrid(
  ground: Uint8Array,
  water: Uint8Array,
  blocked: Uint8Array,
  pit: Uint8Array,
  mode: PathMode,
  out: Float32Array = new Float32Array(gridSize()),
): Float32Array {
  for (let k = 0; k < gridSize(); k++) out[k] = cellCost(ground[k], water[k], blocked[k], pit[k], mode);
  return out;
}

class MinHeap {
  private readonly idx: number[] = [];
  private readonly key: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(i: number, k: number): void {
    this.idx.push(i);
    this.key.push(k);
    let c = this.idx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[p] <= this.key[c]) break;
      this.swap(p, c);
      c = p;
    }
  }
  pop(): number {
    const top = this.idx[0];
    const li = this.idx.pop()!;
    const lk = this.key.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = li;
      this.key[0] = lk;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < this.idx.length && this.key[l] < this.key[m]) m = l;
        if (r < this.idx.length && this.key[r] < this.key[m]) m = r;
        if (m === c) break;
        this.swap(m, c);
        c = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.key[a], this.key[b]] = [this.key[b], this.key[a]];
  }
}

const NB: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 目的のマスから全マスへの距離場（Dijkstra）。
 * 斜め移動は、角の両側のマスが通れるときだけ許す。
 */
export function distanceField(cost: Float32Array, goal: number, out: Float32Array = new Float32Array(gridSize())): Float32Array {
  out.fill(Infinity);
  if (goal < 0 || goal >= gridSize()) return out;
  const heap = new MinHeap();
  out[goal] = 0;
  heap.push(goal, 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    const d = out[cur];
    const ci = cur % FIELD_COLS;
    const cj = (cur - ci) / FIELD_COLS;
    for (const [di, dj, w] of NB) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= FIELD_COLS || nj >= FIELD_ROWS) continue;
      const n = cellIndex(ni, nj);
      const c = cost[n];
      if (!Number.isFinite(c)) continue;
      if (di !== 0 && dj !== 0) {
        if (!Number.isFinite(cost[cellIndex(ci + di, cj)]) || !Number.isFinite(cost[cellIndex(ci, cj + dj)])) continue;
      }
      // 自分のマスのコストと次のマスのコストの平均を辺の重みにする
      const nd = d + w * (c + (Number.isFinite(cost[cur]) ? cost[cur] : c)) * 0.5;
      if (nd < out[n]) {
        out[n] = nd;
        heap.push(n, nd);
      }
    }
  }
  return out;
}

/** k×k の正方形がそのマスを左下として置けるか（幅 k m の道の判定に使う） */
export function fitMask(pass: Uint8Array, k: number): Uint8Array {
  const out = new Uint8Array(gridSize());
  for (let j = 0; j + k <= FIELD_ROWS; j++) {
    for (let i = 0; i + k <= FIELD_COLS; i++) {
      let ok = 1;
      for (let dj = 0; dj < k && ok; dj++) for (let di = 0; di < k; di++) if (!pass[cellIndex(i + di, j + dj)]) { ok = 0; break; }
      out[cellIndex(i, j)] = ok;
    }
  }
  return out;
}

/** 4近傍の塗りつぶし（seed が 1 のマスから mask 内に広がる） */
export function flood(mask: Uint8Array, seeds: (i: number, j: number) => boolean): Uint8Array {
  const out = new Uint8Array(gridSize());
  const queue: number[] = [];
  for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
    const k = cellIndex(i, j);
    if (mask[k] && seeds(i, j)) {
      out[k] = 1;
      queue.push(k);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    const ci = cur % FIELD_COLS;
    const cj = (cur - ci) / FIELD_COLS;
    for (let n = 0; n < 4; n++) {
      const ni = ci + NB[n][0];
      const nj = cj + NB[n][1];
      if (ni < 0 || nj < 0 || ni >= FIELD_COLS || nj >= FIELD_ROWS) continue;
      const nk = cellIndex(ni, nj);
      if (out[nk] || !mask[nk]) continue;
      out[nk] = 1;
      queue.push(nk);
    }
  }
  return out;
}

/**
 * 左右の陣地を結ぶ「幅 k m の道」が、中央帯のいちばん狭い所で何本並べて通れるかを数える。
 * 中央帯の各列で、両陣地から届くマスの連続区間ごとに、幅 k の道が何本入るかを足し、その最小値を返す。
 */
export function countCrossingRoutes(pass: Uint8Array, k: number): number {
  const fit = fitMask(pass, k);
  const fromLeft = flood(fit, (i) => i <= 3);
  const fromRight = flood(fit, (i) => i >= FIELD_COLS - k - 3);
  let minLanes = Infinity;
  const mid = Math.floor(FIELD_COLS / 2);
  for (let i = mid - 7; i <= mid + 6; i++) {
    let lanes = 0;
    let run = 0;
    for (let j = 0; j <= FIELD_ROWS; j++) {
      const kk = cellIndex(i, Math.min(j, FIELD_ROWS - 1));
      const ok = j < FIELD_ROWS && fromLeft[kk] && fromRight[kk];
      if (ok) run++;
      else if (run > 0) {
        // 置ける位置が run 個 = 道の幅 run + k - 1 マス
        lanes += Math.floor((run + k - 1) / k);
        run = 0;
      }
    }
    minLanes = Math.min(minLanes, lanes);
  }
  return Number.isFinite(minLanes) ? minLanes : 0;
}
