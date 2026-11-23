import {
  B,
  BLOCK_DEFS,
  OW_COLLAPSE_MAX_BLOCKS,
  OW_DEBRIS_MAX,
  OW_DEBRIS_PER_EVENT,
  OW_GRAVITY,
  OW_SHATTER_MAX,
  OW_SHATTER_PER_HEIGHT,
  isSolid,
} from './OpenWorldConfig';
import type { V3, VoxelWorld } from './VoxelWorld';

/** 飛び散る破片 1 つ */
export interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
  life: number;
  maxLife: number;
  size: number;
  /** 回転（描画用） */
  spin: number;
}

/** 支えを失って落ちている塊 */
export interface FallingChunk {
  id: number;
  /** 元の位置のブロック（x, y, z, ブロック ID の順に 4 つずつ） */
  blocks: Int32Array;
  /** 下に別の塊のブロックが無い面（着地の判定に使う。x, y, z の順に 3 つずつ） */
  bottoms: Int32Array;
  /** 元の位置からの落下量（下向きが正） */
  drop: number;
  vy: number;
  /** ここまでは確かめて空いていた整数の落下量 */
  clearDrop: number;
  /** 重心（破片や揺れの位置に使う） */
  center: V3;
}

/** 破壊で起きた出来事（描画・音・統計に渡す） */
export type DestructionEvent =
  | { kind: 'explosion'; pos: V3; radius: number }
  | { kind: 'collapse_start'; chunk: FallingChunk }
  | { kind: 'collapse_land'; chunkId: number; pos: V3; blocks: number; height: number }
  | { kind: 'block_break'; pos: V3; block: number };

/** 破壊の統計 */
export interface DestructionStats {
  blocks: number;
  damageYen: number;
  collapses: number;
  explosions: number;
}

/**
 * ブロックの破壊・爆発・崩落・破片をまとめて扱う。
 * 世界からブロックを取り除いたら、まわりが空中に浮いていないか調べ、浮いた塊は落とす。
 */
export class DestructionSystem {
  readonly debris: Debris[] = [];
  readonly falling: FallingChunk[] = [];
  readonly events: DestructionEvent[] = [];
  readonly stats: DestructionStats = { blocks: 0, damageYen: 0, collapses: 0, explosions: 0 };
  private nextChunkId = 1;
  /** 支え探しで訪れた印（探すたびに番号を進める） */
  private readonly visitMark: Uint32Array;
  private visitStamp = 0;
  /** 支え探しの番号 → 地面に届いたか */
  private readonly searchResult = new Map<number, boolean>();
  private rng: () => number;

  constructor(
    readonly world: VoxelWorld,
    rng: () => number = Math.random,
  ) {
    this.visitMark = new Uint32Array(world.sizeX * world.sizeY * world.sizeZ);
    this.rng = rng;
  }

  /** 1 ブロックを壊す（岩盤は壊れない）。壊れたら true */
  breakBlock(x: number, y: number, z: number, opts: { debris?: number; check?: boolean; push?: V3 } = {}): boolean {
    const id = this.world.get(x, y, z);
    const def = BLOCK_DEFS[id];
    if (!def || id === B.AIR || id === B.WATER || def.hardness === 0) return false;
    this.world.set(x, y, z, this.waterAround(x, y, z) ? B.WATER : B.AIR);
    this.stats.blocks++;
    this.stats.damageYen += def.value;
    const n = opts.debris ?? 3;
    for (let k = 0; k < n; k++) {
      const p = opts.push ?? { x: 0, y: 0, z: 0 };
      this.spawnDebris(x + 0.5, y + 0.5, z + 0.5, p.x + (this.rng() - 0.5) * 5, p.y + 2 + this.rng() * 4, p.z + (this.rng() - 0.5) * 5, def.color);
    }
    this.events.push({ kind: 'block_break', pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, block: id });
    if (opts.check !== false) this.checkSupport([[x, y, z]]);
    return true;
  }

  /** ライフルなどで少しずつ削る。硬さぶん当たったら壊れる */
  damageBlock(x: number, y: number, z: number, amount: number, push?: V3): boolean {
    const hardness = this.world.hardnessAt(x, y, z);
    if (hardness <= 0) return false;
    const i = this.world.index(x, y, z);
    const dmg = (this.world.damage.get(i) ?? 0) + amount;
    if (dmg >= hardness) return this.breakBlock(x, y, z, { debris: 4, push });
    this.world.damage.set(i, dmg);
    // 削れた粉
    this.spawnDebris(x + 0.5, y + 0.5, z + 0.5, (this.rng() - 0.5) * 3, 2 + this.rng() * 2, (this.rng() - 0.5) * 3, BLOCK_DEFS[this.world.get(x, y, z)].color, 0.12);
    return false;
  }

  /** 隣が水なら、壊れたあとに水が流れ込む（上は見ない） */
  private waterAround(x: number, y: number, z: number): boolean {
    const w = this.world;
    return (
      w.get(x + 1, y, z) === B.WATER || w.get(x - 1, y, z) === B.WATER || w.get(x, y, z + 1) === B.WATER || w.get(x, y, z - 1) === B.WATER || w.get(x, y + 1, z) === B.WATER
    );
  }

  /**
   * 爆発。半径内のブロックを硬さに応じて壊し、破片を飛ばし、崩落を調べる。
   * 壊したブロック数を返す。
   */
  explode(center: V3, radius: number): number {
    const w = this.world;
    this.stats.explosions++;
    this.events.push({ kind: 'explosion', pos: { ...center }, radius });
    const removed: [number, number, number][] = [];
    const r = Math.ceil(radius + 1);
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    let debrisBudget = OW_DEBRIS_PER_EVENT;
    let total = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const id = w.get(x, y, z);
          if (id === B.AIR || id === B.WATER) continue;
          const def = BLOCK_DEFS[id];
          if (def.hardness === 0) continue;
          const d = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y, z + 0.5 - center.z);
          // 硬いほど壊れにくく、ふちはでこぼこにする
          const reach = radius * (1.08 - def.hardness * 0.045) + (this.rng() - 0.5) * 0.9;
          if (d > reach) continue;
          w.set(x, y, z, this.waterAround(x, y, z) ? B.WATER : B.AIR);
          this.stats.blocks++;
          this.stats.damageYen += def.value;
          total++;
          removed.push([x, y, z]);
          if (debrisBudget > 0 && this.rng() < 0.45) {
            debrisBudget--;
            const dx = x + 0.5 - center.x;
            const dy = y + 0.5 - center.y;
            const dz = z + 0.5 - center.z;
            const len = Math.hypot(dx, dy, dz) || 1;
            const speed = 8 + this.rng() * 10 * (1 - d / (radius + 1));
            this.spawnDebris(x + 0.5, y + 0.5, z + 0.5, (dx / len) * speed, (dy / len) * speed + 6, (dz / len) * speed, def.color);
          }
        }
      }
    }
    if (removed.length > 0) this.checkSupport(removed);
    return total;
  }

  /**
   * 取り除いたブロックのまわりが、地面（y = 0 の岩盤）まで固いブロックでつながっているか調べる。
   * つながっていない塊は落下させる。
   */
  checkSupport(removed: readonly (readonly [number, number, number])[]): void {
    const w = this.world;
    const seeds: number[] = [];
    for (const [x, y, z] of removed) {
      const nb = [
        [x + 1, y, z],
        [x - 1, y, z],
        [x, y + 1, z],
        [x, y - 1, z],
        [x, y, z + 1],
        [x, y, z - 1],
      ];
      for (const [nx, ny, nz] of nb) {
        if (ny <= 0 || !w.inBounds(nx, ny, nz)) continue;
        if (isSolid(w.data[w.index(nx, ny, nz)])) seeds.push(w.index(nx, ny, nz));
      }
    }
    const checkBase = this.visitStamp + 1;
    for (const seed of seeds) {
      if (this.visitMark[seed] >= checkBase) continue;
      const comp = this.findFloating(seed, checkBase);
      if (comp) this.startFalling(comp);
    }
    // 番号の結果は、この調べものの間だけ要る
    this.searchResult.clear();
  }

  /**
   * seed から固いブロックをたどる。下を先に調べるので、地面に届くならすぐ見つかる。
   * 浮いていれば塊の添字の配列、支えがあれば null。
   */
  private findFloating(seed: number, checkBase: number): number[] | null {
    const w = this.world;
    const stamp = ++this.visitStamp;
    if (this.visitStamp >= 0xfffffff0) this.resetMarks();
    const sx = w.sizeX;
    const layer = w.sizeX * w.sizeZ;
    const stack = [seed];
    const comp: number[] = [];
    this.visitMark[seed] = stamp;
    while (stack.length > 0) {
      const i = stack.pop()!;
      comp.push(i);
      const y = Math.floor(i / layer);
      if (y <= 0) {
        this.searchResult.set(stamp, true);
        return null;
      }
      if (comp.length > OW_COLLAPSE_MAX_BLOCKS) {
        this.searchResult.set(stamp, true);
        return null;
      }
      const x = i % sx;
      const z = Math.floor(i / sx) % w.sizeZ;
      // 積む順の逆に取り出されるので、下を最後に積む
      const cand: number[] = [];
      if (y < w.sizeY - 1) cand.push(i + layer);
      if (z > 0) cand.push(i - sx);
      if (z < w.sizeZ - 1) cand.push(i + sx);
      if (x > 0) cand.push(i - 1);
      if (x < sx - 1) cand.push(i + 1);
      cand.push(i - layer);
      for (const n of cand) {
        if (!isSolid(w.data[n])) continue;
        const mark = this.visitMark[n];
        if (mark === stamp) continue;
        if (mark >= checkBase) {
          // 同じ調べものの中で、先に支えありと分かった塊に触れた
          if (this.searchResult.get(mark)) {
            this.searchResult.set(stamp, true);
            return null;
          }
          continue;
        }
        this.visitMark[n] = stamp;
        stack.push(n);
      }
    }
    this.searchResult.set(stamp, false);
    return comp;
  }

  private resetMarks(): void {
    this.visitMark.fill(0);
    this.visitStamp = 1;
  }

  /** 浮いた塊を世界から抜き出して、落下中の塊にする */
  private startFalling(comp: number[]): void {
    const w = this.world;
    const sx = w.sizeX;
    const layer = w.sizeX * w.sizeZ;
    const blocks = new Int32Array(comp.length * 4);
    const set = new Set(comp);
    const bottoms: number[] = [];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    comp.forEach((i, k) => {
      const x = i % sx;
      const y = Math.floor(i / layer);
      const z = Math.floor(i / sx) % w.sizeZ;
      blocks[k * 4] = x;
      blocks[k * 4 + 1] = y;
      blocks[k * 4 + 2] = z;
      blocks[k * 4 + 3] = w.data[i];
      sumX += x;
      sumY += y;
      sumZ += z;
      if (!set.has(i - layer)) bottoms.push(x, y, z);
    });
    for (const i of comp) {
      const x = i % sx;
      const y = Math.floor(i / layer);
      const z = Math.floor(i / sx) % w.sizeZ;
      w.set(x, y, z, B.AIR);
    }
    const n = comp.length;
    const chunk: FallingChunk = {
      id: this.nextChunkId++,
      blocks,
      bottoms: Int32Array.from(bottoms),
      drop: 0,
      vy: 0,
      clearDrop: 0,
      center: { x: sumX / n + 0.5, y: sumY / n + 0.5, z: sumZ / n + 0.5 },
    };
    this.falling.push(chunk);
    this.stats.collapses++;
    this.events.push({ kind: 'collapse_start', chunk });
  }

  /** 落下量 drop で塊が世界のブロックに重ならないか */
  private fits(chunk: FallingChunk, drop: number): boolean {
    const b = chunk.bottoms;
    for (let k = 0; k < b.length; k += 3) {
      const y = b[k + 1] - drop;
      if (y < 1) return false;
      if (isSolid(this.world.get(b[k], y, b[k + 2]))) return false;
    }
    return true;
  }

  /** 落下中の塊と破片を進める */
  step(dt: number): void {
    for (let c = this.falling.length - 1; c >= 0; c--) {
      const chunk = this.falling[c];
      chunk.vy = Math.min(40, chunk.vy + OW_GRAVITY * dt);
      chunk.drop += chunk.vy * dt;
      let landed = false;
      while (chunk.clearDrop + 1 <= chunk.drop) {
        if (this.fits(chunk, chunk.clearDrop + 1)) chunk.clearDrop++;
        else {
          landed = true;
          break;
        }
      }
      if (landed) {
        this.land(chunk);
        this.falling.splice(c, 1);
      }
    }
    this.stepDebris(dt);
  }

  /** 着地した塊を世界に戻す。落ちた高さに応じて一部が砕ける */
  private land(chunk: FallingChunk): void {
    const w = this.world;
    const drop = chunk.clearDrop;
    const shatter = Math.min(OW_SHATTER_MAX, Math.max(0, (drop - 1) * OW_SHATTER_PER_HEIGHT));
    const b = chunk.blocks;
    const n = b.length / 4;
    let debrisBudget = OW_DEBRIS_PER_EVENT;
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const x = b[k * 4];
      const y = b[k * 4 + 1] - drop;
      const z = b[k * 4 + 2];
      const id = b[k * 4 + 3];
      const def = BLOCK_DEFS[id];
      // ガラスや葉は砕けやすい
      const p = def.hardness <= 1 ? Math.min(1, shatter * 2.5 + 0.2) : shatter;
      const occupied = isSolid(w.get(x, y, z));
      if (occupied || y < 1 || this.rng() < p) {
        this.stats.blocks++;
        this.stats.damageYen += def.value;
        if (debrisBudget > 0 && this.rng() < 0.5) {
          debrisBudget--;
          this.spawnDebris(x + 0.5, y + 0.5, z + 0.5, (this.rng() - 0.5) * 9, 3 + this.rng() * 6, (this.rng() - 0.5) * 9, def.color);
        }
        continue;
      }
      w.set(x, y, z, id);
      placed++;
    }
    this.events.push({
      kind: 'collapse_land',
      chunkId: chunk.id,
      pos: { x: chunk.center.x, y: chunk.center.y - drop, z: chunk.center.z },
      blocks: n,
      height: drop,
    });
    // 砕けて穴が空いた結果、また浮いた部分が出ることがある
    if (placed < n) {
      const seeds: [number, number, number][] = [];
      for (let k = 0; k < n; k += Math.max(1, Math.floor(n / 400))) seeds.push([b[k * 4], b[k * 4 + 1] - drop, b[k * 4 + 2]]);
      this.checkSupport(seeds);
    }
  }

  spawnDebris(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size = 0.22 + this.rng() * 0.22): void {
    if (this.debris.length >= OW_DEBRIS_MAX) {
      // いちばん古いものを入れ替える
      this.debris.shift();
    }
    const life = 3 + this.rng() * 3;
    this.debris.push({ x, y, z, vx, vy, vz, color, life, maxLife: life, size, spin: this.rng() * Math.PI * 2 });
  }

  private stepDebris(dt: number): void {
    const w = this.world;
    let write = 0;
    for (let k = 0; k < this.debris.length; k++) {
      const d = this.debris[k];
      d.life -= dt;
      if (d.life <= 0 || d.y < -5) continue;
      d.vy -= OW_GRAVITY * dt;
      const nx = d.x + d.vx * dt;
      const ny = d.y + d.vy * dt;
      const nz = d.z + d.vz * dt;
      if (w.solidAtPoint(nx, d.y, d.z)) d.vx *= -0.3;
      else d.x = nx;
      if (w.solidAtPoint(d.x, d.y, nz)) d.vz *= -0.3;
      else d.z = nz;
      if (w.solidAtPoint(d.x, ny, d.z)) {
        if (d.vy < 0) {
          // 床で弾んで、こすれて止まる
          d.vy *= -0.25;
          d.vx *= 0.6;
          d.vz *= 0.6;
          if (Math.abs(d.vy) < 1) d.vy = 0;
        } else d.vy = 0;
      } else d.y = ny;
      d.spin += dt * (Math.abs(d.vx) + Math.abs(d.vz)) * 0.8;
      this.debris[write++] = d;
    }
    this.debris.length = write;
  }
}
