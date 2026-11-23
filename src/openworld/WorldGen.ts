import {
  B,
  OW_CITY_MAX,
  OW_CITY_MIN,
  OW_CITY_PITCH,
  OW_GROUND_Y,
  OW_HEIGHT,
  OW_ROAD_COUNT,
  OW_ROAD_WIDTH,
  OW_SEA_LEVEL,
  OW_SIZE_X,
  OW_SIZE_Z,
  type BlockId,
  type VehicleKind,
} from './OpenWorldConfig';
import { VoxelWorld, type V3 } from './VoxelWorld';

/** 種から決まる乱数（mulberry32） */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 格子点の乱数を補間した値ノイズ（0〜1） */
function valueNoise(seed: number, x: number, z: number): number {
  const hash = (ix: number, iz: number): number => {
    let h = (ix * 374761393 + iz * 668265263 + seed * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(seed: number, x: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1 / 48;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(seed + o * 17, x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 道路の起点（x・z 共通）。i 本目の道路は [起点, 起点 + 道幅) */
export const ROAD_ORIGINS: readonly number[] = Array.from({ length: OW_ROAD_COUNT }, (_, i) => OW_CITY_MIN + i * OW_CITY_PITCH);
/** 街の外まで延びる道路の番号（x 方向に延びる道・z 方向に延びる道） */
export const HIGHWAY_X_ROAD = 2;
export const HIGHWAY_Z_ROAD = 3;

/** 座標がどの道路の帯に入っているか（入っていなければ -1）と、帯の中での位置 */
export function roadBand(c: number): { road: number; offset: number } {
  for (let i = 0; i < ROAD_ORIGINS.length; i++) {
    const off = c - ROAD_ORIGINS[i];
    if (off >= 0 && off < OW_ROAD_WIDTH) return { road: i, offset: off };
  }
  return { road: -1, offset: -1 };
}

/** 歩行者が歩く線の座標（各道路の両側の歩道の中心）。小さい順 */
export const SIDEWALK_LINES: readonly number[] = ROAD_ORIGINS.flatMap((o) => [o + 0.5, o + OW_ROAD_WIDTH - 0.5]);

/** 車線の中心。dir は進む向き（+1 / -1） */
export function laneCoord(road: number, axis: 'x' | 'z', dir: number): number {
  const o = ROAD_ORIGINS[road];
  // 右側通行: x 方向に + へ進む車は z の大きい側、z 方向に + へ進む車は x の小さい側
  const high = o + OW_ROAD_WIDTH - 2.5;
  const low = o + 2.5;
  if (axis === 'x') return dir > 0 ? high : low;
  return dir > 0 ? low : high;
}

export interface SpawnVehicle {
  kind: VehicleKind;
  x: number;
  z: number;
  yaw: number;
}

export interface OpenWorldLayout {
  world: VoxelWorld;
  spawn: V3;
  parked: SpawnVehicle[];
  seed: number;
}

/** 区画の種類 */
type LotKind = 'tower' | 'quad' | 'houses' | 'park' | 'parking' | 'landmark';

/** 自然の地形の高さ（街の中は平らにする） */
export function naturalHeight(seed: number, x: number, z: number): number {
  const n = fbm(seed, x, z);
  let h = 8 + n * 16;
  // 北と西の端は山脈
  const edge = Math.min(x, z);
  h += smoothstep(44, 0, edge) * 30 * (0.6 + 0.4 * fbm(seed + 5, x * 2, z * 2));
  // 南は海へ下る
  h -= smoothstep(OW_CITY_MAX + 4, OW_SIZE_Z - 12, z) * 14;
  // 街の近くは平らにならす
  const dx = Math.max(OW_CITY_MIN - x, 0, x - OW_CITY_MAX);
  const dz = Math.max(OW_CITY_MIN - z, 0, z - OW_CITY_MAX);
  const d = Math.hypot(dx, dz);
  const t = smoothstep(0, 30, d);
  h = OW_GROUND_Y + (h - OW_GROUND_Y) * t;
  return Math.max(2, Math.min(OW_HEIGHT - 8, Math.round(h)));
}

function inCity(x: number, z: number): boolean {
  return x >= OW_CITY_MIN && x < OW_CITY_MAX && z >= OW_CITY_MIN && z < OW_CITY_MAX;
}

/** 街の外へ延びる道路の帯に入っているか */
function onHighway(x: number, z: number): { axis: 'x' | 'z'; offset: number } | null {
  const ox = ROAD_ORIGINS[HIGHWAY_X_ROAD];
  const oz = ROAD_ORIGINS[HIGHWAY_Z_ROAD];
  if (z >= ox && z < ox + OW_ROAD_WIDTH && !inCity(x, z)) return { axis: 'x', offset: z - ox };
  if (x >= oz && x < oz + OW_ROAD_WIDTH && !inCity(x, z)) return { axis: 'z', offset: x - oz };
  return null;
}

/** 道路の 1 マスの舗装（歩道・白線・アスファルト） */
function roadSurface(offset: number, along: number): BlockId {
  if (offset === 0 || offset === OW_ROAD_WIDTH - 1) return B.SIDEWALK;
  if (offset === 4 && along % 4 < 2) return B.ROAD_LINE;
  return B.ASPHALT;
}

/**
 * オープンワールドの世界を作る。同じ種なら同じ世界になる。
 */
export function generateOpenWorld(seed = 1): OpenWorldLayout {
  const world = new VoxelWorld(OW_SIZE_X, OW_HEIGHT, OW_SIZE_Z);
  const rng = makeRng(seed);
  const parked: SpawnVehicle[] = [];

  // ---- 地形 ----
  for (let z = 0; z < OW_SIZE_Z; z++) {
    for (let x = 0; x < OW_SIZE_X; x++) {
      const highway = onHighway(x, z);
      const city = inCity(x, z);
      const nat = naturalHeight(seed, x, z);
      const h = city || highway ? OW_GROUND_Y : nat;
      world.setRaw(x, 0, z, B.BEDROCK);
      for (let y = 1; y <= Math.min(h, nat); y++) {
        world.setRaw(x, y, z, y <= Math.min(h, nat) - 4 ? B.STONE : B.DIRT);
      }
      if (highway) {
        // 道路は地形を切り通し、低いところは橋にする
        if (nat < h) bridgeColumn(world, x, z, nat, h, highway.axis === 'x' ? x : z);
        for (let y = h + 1; y <= nat; y++) world.setRaw(x, y, z, B.AIR);
        world.setRaw(x, h, z, roadSurface(highway.offset, highway.axis === 'x' ? x : z));
        if (nat < OW_SEA_LEVEL) for (let y = nat + 1; y <= OW_SEA_LEVEL; y++) if (world.get(x, y, z) === B.AIR) world.setRaw(x, y, z, B.WATER);
        continue;
      }
      if (city) {
        world.setRaw(x, h, z, B.GRASS);
        continue;
      }
      // 表面: 水辺は砂、高い所は岩と雪
      let top: BlockId = B.GRASS;
      if (h <= OW_SEA_LEVEL + 1) top = B.SAND;
      else if (h >= 36) top = B.SNOW;
      else if (h >= 29) top = B.STONE;
      world.setRaw(x, h, z, top);
      for (let y = h + 1; y <= OW_SEA_LEVEL; y++) world.setRaw(x, y, z, B.WATER);
      // 森の木
      if (top === B.GRASS && h > OW_SEA_LEVEL + 1 && x > 3 && z > 3 && x < OW_SIZE_X - 4 && z < OW_SIZE_Z - 4) {
        const forest = fbm(seed + 31, x * 1.3, z * 1.3);
        if (rng() < (forest > 0.55 ? 0.035 : 0.004)) pendingTrees.push([x, h + 1, z]);
      }
    }
  }

  // ---- 街 ----
  for (let z = OW_CITY_MIN; z < OW_CITY_MAX; z++) {
    for (let x = OW_CITY_MIN; x < OW_CITY_MAX; x++) {
      const bx = roadBand(x);
      const bz = roadBand(z);
      if (bx.road < 0 && bz.road < 0) continue;
      let id: BlockId;
      if (bx.road >= 0 && bz.road >= 0) {
        // 交差点: 角は歩道、中はアスファルト
        const edgeX = bx.offset === 0 || bx.offset === OW_ROAD_WIDTH - 1;
        const edgeZ = bz.offset === 0 || bz.offset === OW_ROAD_WIDTH - 1;
        id = edgeX && edgeZ ? B.SIDEWALK : B.ASPHALT;
      } else if (bz.road >= 0) {
        id = roadSurface(bz.offset, x);
      } else {
        id = roadSurface(bx.offset, z);
      }
      world.setRaw(x, OW_GROUND_Y, z, id);
    }
  }

  // 区画ごとの建物
  const center = (OW_ROAD_COUNT - 2) / 2;
  for (let i = 0; i < OW_ROAD_COUNT - 1; i++) {
    for (let j = 0; j < OW_ROAD_COUNT - 1; j++) {
      const x0 = ROAD_ORIGINS[i] + OW_ROAD_WIDTH;
      const z0 = ROAD_ORIGINS[j] + OW_ROAD_WIDTH;
      const size = OW_CITY_PITCH - OW_ROAD_WIDTH;
      const distC = Math.hypot(i - center, j - center);
      let kind: LotKind;
      if (i === 2 && j === 2) kind = 'landmark';
      else {
        const r = rng();
        if (distC < 1.5) kind = r < 0.55 ? 'tower' : r < 0.85 ? 'quad' : 'parking';
        else kind = r < 0.25 ? 'houses' : r < 0.45 ? 'park' : r < 0.6 ? 'parking' : r < 0.8 ? 'quad' : 'tower';
      }
      buildLot(world, rng, kind, x0, z0, size, distC, parked);
      // 区画のふちの街灯
      for (let k = 2; k < size; k += 10) {
        streetLamp(world, x0 + k, z0);
        streetLamp(world, x0 + k, z0 + size - 1);
      }
    }
  }

  // ---- 基地（西の外れ）: 戦車と倉庫 ----
  buildBase(world, rng, 10, ROAD_ORIGINS[HIGHWAY_X_ROAD] - 30, parked);

  for (const [x, y, z] of pendingTrees) if (world.get(x, y - 1, z) === B.GRASS && world.get(x, y, z) === B.AIR) tree(world, rng, x, y, z);
  pendingTrees.length = 0;

  const o = ROAD_ORIGINS[2];
  const spawn = { x: o + OW_ROAD_WIDTH / 2, y: OW_GROUND_Y + 1, z: o + 0.5 };
  return { world, spawn, parked, seed };
}

/** 地形を作る間に見つけた木の位置（街の建物の後で植える） */
const pendingTrees: [number, number, number][] = [];

/** 低い所を通る道路の橋（橋げたと柱） */
function bridgeColumn(world: VoxelWorld, x: number, z: number, nat: number, h: number, along: number): void {
  world.setRaw(x, h - 1, z, B.CONCRETE_DARK);
  if (along % 10 === 0) for (let y = Math.max(1, nat); y < h - 1; y++) world.setRaw(x, y, z, B.CONCRETE);
}

function buildLot(
  world: VoxelWorld,
  rng: () => number,
  kind: LotKind,
  x0: number,
  z0: number,
  size: number,
  distC: number,
  parked: SpawnVehicle[],
): void {
  const g = OW_GROUND_Y;
  // 敷地の床
  const floor: BlockId = kind === 'park' || kind === 'houses' ? B.GRASS : kind === 'parking' ? B.ASPHALT : B.SIDEWALK;
  for (let z = z0; z < z0 + size; z++) for (let x = x0; x < x0 + size; x++) world.setRaw(x, g, z, floor);

  const tallness = Math.max(0.15, 1 - distC / 3.2);
  const walls: BlockId[] = [B.CONCRETE, B.CONCRETE_DARK, B.WALL_BLUE, B.WALL_TAN, B.BRICK, B.PLASTER, B.WALL_GREEN];
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  if (kind === 'tower') {
    const floors = 3 + Math.floor(rng() * 4 + tallness * 6);
    building(world, rng, x0 + 2, z0 + 2, size - 4, size - 4, floors, pick(walls));
  } else if (kind === 'quad') {
    const half = Math.floor((size - 3) / 2);
    for (const [ox, oz] of [
      [1, 1],
      [2 + half, 1],
      [1, 2 + half],
      [2 + half, 2 + half],
    ]) {
      const floors = 2 + Math.floor(rng() * (2 + tallness * 5));
      building(world, rng, x0 + ox, z0 + oz, half, half, floors, pick(walls));
    }
  } else if (kind === 'houses') {
    const w = 8;
    for (const [ox, oz] of [
      [2, 2],
      [size - w - 2, 2],
      [2, size - w - 2],
      [size - w - 2, size - w - 2],
    ]) {
      house(world, x0 + ox, z0 + oz, w, w, pick([B.PLASTER, B.WALL_TAN, B.BRICK, B.PLANK]));
    }
    tree(world, rng, x0 + Math.floor(size / 2), g + 1, z0 + Math.floor(size / 2));
  } else if (kind === 'park') {
    // 池と木
    const cx = x0 + size / 2;
    const cz = z0 + size / 2;
    for (let z = z0; z < z0 + size; z++) {
      for (let x = x0; x < x0 + size; x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d < 4.5) {
          world.setRaw(x, g, z, B.WATER);
          world.setRaw(x, g - 1, z, B.SAND);
        } else if (d < 5.5) world.setRaw(x, g, z, B.SAND);
      }
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng();
      tree(world, rng, Math.floor(cx + Math.cos(a) * 8.5), g + 1, Math.floor(cz + Math.sin(a) * 8.5));
    }
  } else if (kind === 'parking') {
    for (let x = x0 + 2; x < x0 + size - 1; x += 4) {
      for (let z = z0 + 2; z < z0 + 8; z++) world.setRaw(x, g, z, B.ROAD_LINE);
      for (let z = z0 + size - 8; z < z0 + size - 2; z++) world.setRaw(x, g, z, B.ROAD_LINE);
    }
    for (let x = x0 + 4; x < x0 + size - 2; x += 4) {
      if (rng() < 0.45) parked.push({ kind: 'car', x: x + 0.0, z: z0 + 5, yaw: 0 });
      if (rng() < 0.45) parked.push({ kind: 'car', x: x + 0.0, z: z0 + size - 5, yaw: Math.PI });
    }
  } else {
    landmark(world, x0, z0, size);
  }
}

/**
 * 中が空洞のビル。4 段ごとに床、壁には窓、屋上には室外機。
 * 1 階の壁を壊すと上の階が支えを失って崩れる。
 */
export function building(world: VoxelWorld, rng: () => number, x0: number, z0: number, w: number, d: number, floors: number, wall: BlockId): void {
  const g = OW_GROUND_Y;
  const h = Math.min(floors * 4, OW_HEIGHT - g - 4);
  const doorSide = Math.floor(rng() * 4);
  const windowStep = rng() < 0.5 ? 3 : 2;
  for (let y = g + 1; y <= g + h; y++) {
    const ly = y - g - 1;
    const isFloor = ly % 4 === 3;
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        const edgeX = x === x0 || x === x0 + w - 1;
        const edgeZ = z === z0 || z === z0 + d - 1;
        if (!edgeX && !edgeZ) {
          if (isFloor) world.setRaw(x, y, z, B.CONCRETE);
          continue;
        }
        const along = edgeX && !edgeZ ? z - z0 : x - x0;
        const corner = edgeX && edgeZ;
        let id: BlockId = wall;
        if (!corner && !isFloor && (ly % 4 === 1 || ly % 4 === 2) && along % windowStep !== 0) id = B.GLASS;
        // 入口
        if (ly < 2 && !corner) {
          const side = z === z0 ? 0 : z === z0 + d - 1 ? 1 : x === x0 ? 2 : 3;
          const mid = side < 2 ? x0 + Math.floor(w / 2) : z0 + Math.floor(d / 2);
          const pos = side < 2 ? x : z;
          if (side === doorSide && (pos === mid || pos === mid - 1)) id = B.AIR;
        }
        world.setRaw(x, y, z, id);
      }
    }
  }
  // 屋上と手すり
  const top = g + h + 1;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      world.setRaw(x, top, z, B.ROOF);
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      if (edge) world.setRaw(x, top + 1, z, wall);
    }
  }
  // 室外機
  if (w > 5 && d > 5 && top + 2 < OW_HEIGHT) {
    const ax = x0 + 2 + Math.floor(rng() * (w - 5));
    const az = z0 + 2 + Math.floor(rng() * (d - 5));
    for (let x = ax; x < ax + 2; x++) for (let z = az; z < az + 2; z++) world.setRaw(x, top + 1, z, B.METAL);
  }
}

/** 赤い屋根の家（2 階建て、ピラミッド型の屋根） */
function house(world: VoxelWorld, x0: number, z0: number, w: number, d: number, wall: BlockId): void {
  const g = OW_GROUND_Y;
  const h = 6;
  for (let y = g + 1; y <= g + h; y++) {
    const ly = y - g - 1;
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
        if (ly === 2) {
          world.setRaw(x, y, z, edge ? wall : B.PLANK);
          continue;
        }
        if (!edge) continue;
        const corner = (x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1);
        let id: BlockId = wall;
        if (!corner && (ly === 1 || ly === 4) && (x + z) % 3 === 0) id = B.GLASS;
        if (z === z0 && x === x0 + Math.floor(w / 2) && ly < 2) id = B.AIR;
        world.setRaw(x, y, z, id);
      }
    }
  }
  for (let k = 0; k * 2 < Math.min(w, d); k++) {
    const y = g + h + 1 + k;
    for (let z = z0 - 1 + k; z <= z0 + d - k; z++) {
      for (let x = x0 - 1 + k; x <= x0 + w - k; x++) {
        const edge = x === x0 - 1 + k || x === x0 + w - k || z === z0 - 1 + k || z === z0 + d - k;
        if (edge || k * 2 + 2 >= Math.min(w, d)) world.setRaw(x, y, z, B.ROOF_RED);
      }
    }
  }
}

/** 街の真ん中の鉄塔（崩しがいのある目印） */
function landmark(world: VoxelWorld, x0: number, z0: number, size: number): void {
  const g = OW_GROUND_Y;
  const cx = x0 + Math.floor(size / 2);
  const cz = z0 + Math.floor(size / 2);
  // 台座
  for (let z = cz - 6; z <= cz + 6; z++) for (let x = cx - 6; x <= cx + 6; x++) world.setRaw(x, g + 1, z, B.CONCRETE);
  const top = OW_HEIGHT - 6;
  for (let y = g + 2; y <= top; y++) {
    const t = (y - g) / (top - g);
    const half = Math.max(1, Math.round(5 * (1 - t) + 1));
    // 4 本の脚と、4 段ごとの梁
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) world.setRaw(cx + sx * half, y, cz + sz * half, B.METAL);
    if (y % 5 === 0) {
      for (let k = -half; k <= half; k++) {
        world.setRaw(cx + k, y, cz - half, B.METAL);
        world.setRaw(cx + k, y, cz + half, B.METAL);
        world.setRaw(cx - half, y, cz + k, B.METAL);
        world.setRaw(cx + half, y, cz + k, B.METAL);
      }
    }
  }
  // 展望台
  const deck = g + 30;
  for (let z = cz - 4; z <= cz + 4; z++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      world.setRaw(x, deck, z, B.CONCRETE);
      const edge = Math.abs(x - cx) === 4 || Math.abs(z - cz) === 4;
      if (edge) {
        world.setRaw(x, deck + 1, z, B.GLASS);
        world.setRaw(x, deck + 2, z, B.GLASS);
      }
      world.setRaw(x, deck + 3, z, B.ROOF_RED);
    }
  }
  world.setRaw(cx, top + 1, cz, B.LAMP);
}

function streetLamp(world: VoxelWorld, x: number, z: number): void {
  if (world.get(x, OW_GROUND_Y + 1, z) !== B.AIR) return;
  for (let y = OW_GROUND_Y + 1; y <= OW_GROUND_Y + 4; y++) world.setRaw(x, y, z, B.METAL);
  world.setRaw(x, OW_GROUND_Y + 5, z, B.LAMP);
}

function tree(world: VoxelWorld, rng: () => number, x: number, y: number, z: number): void {
  const h = 4 + Math.floor(rng() * 3);
  if (y + h + 2 >= OW_HEIGHT) return;
  for (let k = 0; k < h; k++) world.setRaw(x, y + k, z, B.WOOD);
  const r = 2;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz + dy * dy > r * r + 1) continue;
        const px = x + dx;
        const py = y + h - 1 + dy;
        const pz = z + dz;
        if (world.get(px, py, pz) === B.AIR) world.setRaw(px, py, pz, B.LEAVES);
      }
    }
  }
}

/** 基地: コンクリートの広場・倉庫・戦車 */
function buildBase(world: VoxelWorld, rng: () => number, x0: number, z0: number, parked: SpawnVehicle[]): void {
  const w = 30;
  const d = 30;
  const g = OW_GROUND_Y;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      for (let y = 1; y < g; y++) if (world.get(x, y, z) === B.AIR || world.get(x, y, z) === B.WATER) world.setRaw(x, y, z, B.DIRT);
      for (let y = g + 1; y < OW_HEIGHT; y++) world.setRaw(x, y, z, B.AIR);
      world.setRaw(x, g, z, B.CONCRETE_DARK);
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      if (edge && !(z === z0 + d - 1 && x >= x0 + 12 && x < x0 + 18)) for (let y = g + 1; y <= g + 3; y++) world.setRaw(x, y, z, B.METAL);
    }
  }
  building(world, rng, x0 + 3, z0 + 3, 10, 10, 2, B.WALL_GREEN);
  parked.push({ kind: 'tank', x: x0 + 20, z: z0 + 10, yaw: -Math.PI / 2 });
  parked.push({ kind: 'tank', x: x0 + 20, z: z0 + 21, yaw: -Math.PI / 2 });
}
