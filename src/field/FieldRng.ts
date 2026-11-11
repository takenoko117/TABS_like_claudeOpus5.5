/** フィールド生成専用のシード付き乱数（Math.random を使わず、同じシードから同じ結果を出す） */

/** mulberry32: 32bit のシードから 0〜1 の乱数列を作る */
export function fieldRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 複数の整数から 32bit のハッシュを作る */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** min 以上 max 未満の乱数 */
export function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** min 以上 max 以下の整数 */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** 2D の値ノイズ（なめらかな 0〜1）。密度の濃淡に使う */
export function valueNoise2D(seed: number, scale: number): (x: number, z: number) => number {
  const lattice = (ix: number, iz: number) => (hashSeed(seed, ix, iz) & 0xffff) / 0xffff;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const fx = x / scale;
    const fz = z / scale;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = smooth(fx - ix);
    const tz = smooth(fz - iz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
}
