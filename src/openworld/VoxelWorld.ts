import { BLOCK_DEFS, B, OW_CHUNK, isSolid } from './OpenWorldConfig';

/** 3 次元の点（Three.js に依存しないための最小の型） */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** 光線がブロックに当たった結果 */
export interface RayHit {
  /** 当たったブロックの座標 */
  x: number;
  y: number;
  z: number;
  /** 当たった面の外向きの向き（置くときはここに足す） */
  nx: number;
  ny: number;
  nz: number;
  /** 光線の始点からの距離 */
  dist: number;
  block: number;
}

/**
 * ボクセルの世界（ブロックの格子）。
 * 書き換えると、描画の作り直しが要るチャンクとミニマップの列を記録する。
 */
export class VoxelWorld {
  readonly data: Uint8Array;
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;
  /** 作り直しが要るチャンク（chunkIndex の集合） */
  readonly dirtyChunks = new Set<number>();
  /** ミニマップの描き直しが要る列（x + z * sizeX の集合） */
  readonly dirtyColumns = new Set<number>();
  /** ライフルで削った途中の傷（添字 → 受けたダメージ） */
  readonly damage = new Map<number, number>();

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
  ) {
    this.data = new Uint8Array(sizeX * sizeY * sizeZ);
    this.chunksX = Math.ceil(sizeX / OW_CHUNK);
    this.chunksY = Math.ceil(sizeY / OW_CHUNK);
    this.chunksZ = Math.ceil(sizeZ / OW_CHUNK);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  index(x: number, y: number, z: number): number {
    return x + this.sizeX * (z + this.sizeZ * y);
  }

  /** 範囲外は空気（ただし y < 0 は岩盤）として返す */
  get(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (!this.inBounds(x, y, z)) return B.AIR;
    return this.data[this.index(x, y, z)];
  }

  solidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.get(x, y, z));
  }

  /** 実数座標の点がブロックの中にあるか */
  solidAtPoint(x: number, y: number, z: number): boolean {
    return this.solidAt(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /** 生成中に使う、記録なしの書き込み */
  setRaw(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = id;
  }

  /** 書き換えて、描画の作り直しを記録する。変わったら true */
  set(x: number, y: number, z: number, id: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.data[i] === id) return false;
    this.data[i] = id;
    this.damage.delete(i);
    this.markDirty(x, y, z);
    return true;
  }

  /** 書き換えた位置のチャンクと、境目なら隣のチャンクも作り直しにする */
  private markDirty(x: number, y: number, z: number): void {
    const cx = Math.floor(x / OW_CHUNK);
    const cy = Math.floor(y / OW_CHUNK);
    const cz = Math.floor(z / OW_CHUNK);
    this.dirtyChunks.add(this.chunkIndex(cx, cy, cz));
    const lx = x - cx * OW_CHUNK;
    const ly = y - cy * OW_CHUNK;
    const lz = z - cz * OW_CHUNK;
    if (lx === 0 && cx > 0) this.dirtyChunks.add(this.chunkIndex(cx - 1, cy, cz));
    if (lx === OW_CHUNK - 1 && cx < this.chunksX - 1) this.dirtyChunks.add(this.chunkIndex(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) this.dirtyChunks.add(this.chunkIndex(cx, cy - 1, cz));
    if (ly === OW_CHUNK - 1 && cy < this.chunksY - 1) this.dirtyChunks.add(this.chunkIndex(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) this.dirtyChunks.add(this.chunkIndex(cx, cy, cz - 1));
    if (lz === OW_CHUNK - 1 && cz < this.chunksZ - 1) this.dirtyChunks.add(this.chunkIndex(cx, cy, cz + 1));
    this.dirtyColumns.add(x + z * this.sizeX);
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + this.chunksX * (cz + this.chunksZ * cy);
  }

  chunkCoords(index: number): [number, number, number] {
    const cx = index % this.chunksX;
    const rest = Math.floor(index / this.chunksX);
    return [cx, Math.floor(rest / this.chunksZ), rest % this.chunksZ];
  }

  /** 列のいちばん上の固いブロックの y（無ければ -1） */
  topSolidY(x: number, z: number, fromY = this.sizeY - 1): number {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return -1;
    for (let y = Math.min(fromY, this.sizeY - 1); y >= 0; y--) {
      if (isSolid(this.data[this.index(x, y, z)])) return y;
    }
    return -1;
  }

  /** 列のいちばん上の空気でないブロック（水も含む）。ミニマップ用 */
  topVisible(x: number, z: number): { y: number; id: number } {
    for (let y = this.sizeY - 1; y >= 0; y--) {
      const id = this.data[this.index(x, y, z)];
      if (id !== B.AIR) return { y, id };
    }
    return { y: -1, id: B.AIR };
  }

  /**
   * ブロックの格子を光線でたどる（DDA）。最初に当たった固いブロックを返す。
   * 水は通り抜ける。
   */
  raycast(origin: V3, dir: V3, maxDist: number): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ : Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;
    // 始点がブロックの中なら、そのブロックを返す
    const first = this.get(x, y, z);
    if (isSolid(first)) return { x, y, z, nx: 0, ny: 1, nz: 0, dist: 0, block: first };
    while (t <= maxDist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
      if (t > maxDist) break;
      // 世界の外（上空・横）に出たら打ち切る
      if (y >= this.sizeY && dy >= 0) break;
      if ((x < 0 && dx <= 0) || (z < 0 && dz <= 0) || (x >= this.sizeX && dx >= 0) || (z >= this.sizeZ && dz >= 0)) break;
      const id = this.get(x, y, z);
      if (isSolid(id)) return { x, y, z, nx, ny, nz, dist: t, block: id };
    }
    return null;
  }

  /** ブロックの硬さ（0 は壊れない） */
  hardnessAt(x: number, y: number, z: number): number {
    return BLOCK_DEFS[this.get(x, y, z)]?.hardness ?? 0;
  }
}
