import { B } from '../openworld/OpenWorldConfig';
import { VoxelWorld, type V3 } from '../openworld/VoxelWorld';
import type { GifuLandmark, GifuTown } from './GifuTown';
import {
  OSM_AREAS,
  OSM_BUILDINGS,
  OSM_PLATFORMS,
  OSM_POINTS,
  OSM_RAILS,
  OSM_WAYS,
  STATION_SIZE_X,
  STATION_SIZE_Z,
  type OsmBuilding,
} from './GifuStationData';
import { TAG_GROUND, TAG_STATION_SIZE_Y } from './TagConfig';

/**
 * 鬼ごっこの舞台「JR 岐阜駅」。OpenStreetMap の実際の形（GifuStationData）をブロックに焼き直したもの。
 * 1 ブロック = 1.5 m（高さも同じ縮尺）。x = 東、z = 南、y = 上。Three.js に依存しない。
 *
 *  北      岐阜シティ・タワー43・岐阜スカイウイング37・じゅうろくプラザ・県道岐阜停車場線
 *          北口駅前広場（信長ゆめ広場・黄金の信長像・大屋根・バス／タクシー乗り場・丸窓電車モ513）
 *          U 字のペデストリアンデッキ「杜の架け橋」（2 階の高さ。駅の 2 階の改札へつながる）
 *  中央    東海道本線・高山本線の高架（3 階に島式ホーム 3 面。下は 1 階の通路とお店）
 *  南      南口の広場
 *
 * 駅舎の中（OSM に無い部分）は、公開されている案内（1 階が通路とお店、2 階が改札、3 階がホーム）をもとに組んだ。
 */

// ---- 高さ（すべて「この y に立つ」高さ。床のブロックはその 1 つ下） ----
/** 地面に立つ高さ */
const G = TAG_GROUND;
const SURF = G - 1;
/** 2 階（改札のコンコース・ペデストリアンデッキ）に立つ高さ（地面 + 6 m） */
export const STATION_F2 = G + 4;
/** 高架の線路の上に立つ高さ（地面 + 10.5 m） */
export const STATION_TRACK = G + 7;
/** 3 階（ホーム）に立つ高さ（線路 + 1.5 m） */
export const STATION_PLATFORM = G + 8;
/** ホームの屋根の床ブロックの高さ */
const PLATFORM_ROOF_Y = STATION_PLATFORM + 3;
/** 北口の大屋根の高さ（デッキの上を通れるように 2 階 + 3 m） */
const CANOPY_Y = G + 6;
/** デッキの屋根 */
const DECK_ROOF_Y = STATION_F2 + 3;

// ---- 位置（ブロック座標。GifuStationData の原点から） ----
/** 改札のある駅の中央部（2 階のコンコースを張る x の範囲。実寸で駅の中心から西 34 m 〜 東 35 m） */
const CONCOURSE_X0 = 200;
const CONCOURSE_X1 = 246;
/** 1 階のお店（アスティ岐阜）を並べる x の範囲 */
const SHOPS_X0 = 150;
const SHOPS_X1 = 312;
/** ミサイルで狭まっていく中心（北口の広場と駅の中央） */
const ZONE_CENTER = { x: 214, z: 148 };
/** 高層ビルの塔の部分（OSM の外形は低層部を含むので、塔の位置を足す） */
const TOWER_INSET: Record<string, { side: number; podium: number }> = {
  '岐阜シティ・タワー43': { side: 27, podium: 10 },
};
/** 塔が building:part として別にあるビルの、低層部の高さ（ブロック） */
const PODIUM_ONLY: Record<string, number> = {
  '岐阜スカイウイング37': 12,
};
/** 停車中の電車の長さ（ブロック。313 系 4 両 ≒ 80 m） */
const TRAIN_LENGTH = 54;

type Cell = (x: number, z: number) => void;

class Plan {
  readonly sx = STATION_SIZE_X;
  readonly sz = STATION_SIZE_Z;
  /** 地面の表面のブロック */
  readonly surf: Uint8Array;
  /** 車道か */
  readonly road: Uint8Array;
  /** 建物の番号 + 1（0 は無し） */
  readonly bld: Int32Array;
  /** 高架の下か */
  readonly via: Uint8Array;
  /** ホームか */
  readonly plat: Uint8Array;
  /** デッキの番号 + 1（0 は無し） */
  readonly deck: Int32Array;
  /** 2 階のコンコースか */
  readonly conc: Uint8Array;

  constructor() {
    const n = this.sx * this.sz;
    this.surf = new Uint8Array(n).fill(B.SIDEWALK);
    this.road = new Uint8Array(n);
    this.bld = new Int32Array(n);
    this.via = new Uint8Array(n);
    this.plat = new Uint8Array(n);
    this.deck = new Int32Array(n);
    this.conc = new Uint8Array(n);
  }

  in(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.sx && z < this.sz;
  }

  i(x: number, z: number): number {
    return x + z * this.sx;
  }
}

/** 多角形の内側のマス（マスの中心で判定） */
export function polyCells(p: readonly number[], sx: number, sz: number, fn: Cell): void {
  const n = p.length / 2;
  if (n < 3) return;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let k = 0; k < n; k++) {
    zMin = Math.min(zMin, p[k * 2 + 1]);
    zMax = Math.max(zMax, p[k * 2 + 1]);
  }
  const xs: number[] = [];
  for (let z = Math.max(0, Math.floor(zMin)); z <= Math.min(sz - 1, Math.ceil(zMax)); z++) {
    const cz = z + 0.5;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2];
      const az = p[k * 2 + 1];
      const bx = p[((k + 1) % n) * 2];
      const bz = p[((k + 1) % n) * 2 + 1];
      if ((az <= cz && cz < bz) || (bz <= cz && cz < az)) xs.push(ax + ((cz - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(sx - 1, Math.floor(xs[k + 1] - 0.5)); x++) fn(x, z);
    }
  }
}

/** 折れ線から幅 width の帯のマス。d は中心線からの距離、s は線に沿った長さ */
export function lineCells(p: readonly number[], width: number, sx: number, sz: number, fn: (x: number, z: number, d: number, s: number) => void): void {
  const r = width / 2;
  let s0 = 0;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k];
    const az = p[k + 1];
    const bx = p[k + 2];
    const bz = p[k + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(sx - 1, Math.ceil(Math.max(ax, bx) + r));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - r));
    const z1 = Math.min(sz - 1, Math.ceil(Math.max(az, bz) + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        const pz = z + 0.5 - az;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / len2)) : 0;
        const d = Math.hypot(px - t * dx, pz - t * dz);
        if (d <= r) fn(x, z, d, s0 + t * len);
      }
    }
    s0 += len;
  }
}

/** 同じ座標なら同じ並びになる 0〜1 の値 */
function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 建物の外壁の色 */
function wallColor(b: OsmBuilding, index: number): number {
  const pick = (list: number[]): number => list[Math.floor(hash(index, 7) * list.length)];
  if (b.n.includes('タワー43')) return B.PLASTER;
  if (b.n.includes('スカイウイング') || b.n.includes('ライオンズ')) return B.CONCRETE;
  if (b.n.includes('じゅうろく')) return B.PLASTER;
  if (b.n.includes('交番')) return B.WALL_BLUE;
  switch (b.k) {
    case 'apartments':
      return pick([B.PLASTER, B.WALL_TAN, B.CONCRETE, B.BRICK]);
    case 'hotel':
      return pick([B.WALL_TAN, B.PLASTER, B.BRICK, B.CONCRETE_DARK]);
    case 'commercial':
    case 'public':
    case 'government':
      return pick([B.CONCRETE, B.WALL_BLUE, B.CONCRETE_DARK, B.PLASTER]);
    case 'parking':
      return B.CONCRETE_DARK;
    case 'retail':
      return pick([B.WALL_TAN, B.CONCRETE, B.WALL_GREEN, B.PLASTER]);
    default:
      return pick([B.PLASTER, B.WALL_TAN, B.CONCRETE, B.WALL_GREEN, B.BRICK, B.WALL_BLUE]);
  }
}

/** JR 岐阜駅のステージを作る（いつも同じ形。オンラインの全員が同じ駅を作る） */
export function generateGifuStation(): GifuTown {
  const SY = TAG_STATION_SIZE_Y;
  const world = new VoxelWorld(STATION_SIZE_X, SY, STATION_SIZE_Z);
  const plan = new Plan();
  const { sx, sz } = plan;
  const set = (x: number, y: number, z: number, id: number): void => {
    if (plan.in(x, z) && y >= 0 && y < SY) world.setRaw(x, y, z, id);
  };
  const fill = (x: number, z: number, y0: number, y1: number, id: number): void => {
    for (let y = y0; y <= y1; y++) set(x, y, z, id);
  };

  // 1. 地面の表面（広場・緑地・道路）
  for (const a of OSM_AREAS) {
    polyCells(a.p, sx, sz, (x, z) => {
      const i = plan.i(x, z);
      if (a.k === 'park') plan.surf[i] = (x + z) % 2 === 0 ? B.SIDEWALK : B.CONCRETE;
      else if (a.k === 'paved') plan.surf[i] = B.CONCRETE;
      else plan.surf[i] = B.GRASS;
    });
  }
  for (const w of OSM_WAYS) {
    if (w.k !== 'walk') continue;
    lineCells(w.p, w.w, sx, sz, (x, z) => {
      const i = plan.i(x, z);
      if (plan.surf[i] === B.GRASS) plan.surf[i] = B.SIDEWALK;
    });
  }
  for (const w of OSM_WAYS) {
    if (w.k !== 'road') continue;
    const center = w.w >= 9;
    lineCells(w.p, w.w, sx, sz, (x, z, d, s) => {
      const i = plan.i(x, z);
      plan.road[i] = 1;
      // 広い道は中央に白い破線
      plan.surf[i] = center && d < 0.55 && Math.floor(s / 3) % 2 === 0 ? B.ROAD_LINE : plan.surf[i] === B.ROAD_LINE ? B.ROAD_LINE : B.ASPHALT;
    });
  }

  // 2. 高架（線路の帯とホーム。線路と線路のすき間も埋めて 1 枚の高架にする）
  for (const r of OSM_RAILS) lineCells(r.p, 6, sx, sz, (x, z) => (plan.via[plan.i(x, z)] = 1));
  for (const p of OSM_PLATFORMS) {
    polyCells(p, sx, sz, (x, z) => {
      plan.via[plan.i(x, z)] = 1;
      plan.plat[plan.i(x, z)] = 1;
    });
  }
  for (let x = 0; x < sx; x++) {
    const col: number[] = [];
    for (let z = 0; z < sz; z++) if (plan.via[plan.i(x, z)]) col.push(z);
    for (let k = 0; k + 1 < col.length; k++) {
      if (col[k + 1] - col[k] > 1 && col[k + 1] - col[k] <= 7) for (let z = col[k] + 1; z < col[k + 1]; z++) plan.via[plan.i(x, z)] = 1;
    }
  }

  // 3. 建物の敷地（高架の下には建てない。屋根だけのものは別）
  OSM_BUILDINGS.forEach((b, idx) => {
    if (b.k === 'roof' || b.k === 'part') return;
    polyCells(b.p, sx, sz, (x, z) => {
      const i = plan.i(x, z);
      if (!plan.via[i]) plan.bld[i] = idx + 1;
    });
  });

  // 4. 2 階のコンコース（駅の中央部の高架の下）
  for (let x = CONCOURSE_X0; x <= CONCOURSE_X1; x++) for (let z = 0; z < sz; z++) if (plan.via[plan.i(x, z)]) plan.conc[plan.i(x, z)] = 1;

  // 5. 土台と地面
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      set(x, 0, z, B.BEDROCK);
      fill(x, z, 1, SURF - 2, B.STONE);
      set(x, SURF - 1, z, B.DIRT);
      const i = plan.i(x, z);
      set(x, SURF, z, plan.via[i] && !plan.road[i] ? B.CONCRETE : plan.surf[i]);
    }
  }

  // 6. 建物
  OSM_BUILDINGS.forEach((b, idx) => {
    if (b.k === 'roof' || b.k === 'part') return;
    buildBuilding(world, plan, b, idx, SY);
  });
  // 塔の部分（building:part）。岐阜スカイウイング37 の住宅棟など
  OSM_BUILDINGS.forEach((b, idx) => {
    if (b.k !== 'part') return;
    const top = Math.min(SY - 4, G + b.h - 1);
    const cells: [number, number][] = [];
    polyCells(b.p, sx, sz, (x, z) => cells.push([x, z]));
    const own = new Set(cells.map(([x, z]) => plan.i(x, z)));
    for (const [x, z] of cells) {
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !own.has(plan.i(x + dx, z + dz)));
      for (let y = G; y <= top; y++) set(x, y, z, edge ? facade(x, y, z, B.CONCRETE, idx) : B.CONCRETE);
      set(x, top + 1, z, edge ? B.CONCRETE : B.ROOF);
    }
  });

  // 7. 高架橋（橋脚・床・線路・ホーム・防音壁）
  buildViaduct(world, plan, set, fill);

  // 8. 2 階の改札（コンコース）と、ホーム・地上への階段
  buildConcourse(world, plan, set, fill);

  // 9. ペデストリアンデッキ（杜の架け橋・スクエア43 など）と、駅の出入口
  buildDecks(world, plan, set, fill);
  buildEntrances(world, plan, set);
  deckRails(world, plan, set, fill);

  // 10. 屋根（ホームの屋根・北口の大屋根）
  OSM_BUILDINGS.forEach((b) => {
    if (b.k !== 'roof') return;
    const onTrack = b.l >= 1;
    const y = onTrack ? PLATFORM_ROOF_Y : CANOPY_Y;
    polyCells(b.p, sx, sz, (x, z) => {
      const i = plan.i(x, z);
      if (!onTrack && (plan.via[i] || plan.deck[i])) return;
      set(x, y, z, onTrack ? B.ROOF : B.PLASTER);
      if (onTrack) {
        // ホームの真ん中に柱
        if (plan.plat[i] && x % 8 === 0 && plan.plat[plan.i(x, z - 1)] && plan.plat[plan.i(x, z + 1)] && world.get(x, STATION_PLATFORM, z) === B.AIR) {
          fill(x, z, STATION_PLATFORM, y - 1, B.METAL);
        }
      } else if (x % 8 === 0 && z % 6 === 0 && !plan.deck[i] && world.get(x, G, z) === B.AIR) {
        fill(x, z, G, y - 1, B.METAL);
      }
    });
  });

  // 11. 黄金の信長像・丸窓電車モ513・木
  const statue = OSM_POINTS.find((p) => p.n.includes('信長')) ?? { x: 212, z: 112 };
  buildStatue(set, fill, Math.floor(statue.x), Math.floor(statue.z));
  const tram = OSM_POINTS.find((p) => p.n.includes('モ513'));
  if (tram) buildTram(set, fill, Math.floor(tram.x), Math.floor(tram.z));
  for (const p of OSM_POINTS) if (p.n === 'tree') buildTree(world, set, fill, Math.floor(p.x), Math.floor(p.z));
  for (const a of OSM_AREAS) {
    if (a.k !== 'forest') continue;
    polyCells(a.p, sx, sz, (x, z) => {
      if (x % 4 === 0 && z % 4 === (x % 8 === 0 ? 0 : 2)) buildTree(world, set, fill, x, z);
    });
  }

  // 12. ハヤトの目的地（地面の、上が空いている所）
  const nav: { x: number; z: number }[] = [];
  for (let z = 2; z < sz - 2; z += 4) {
    for (let x = 2; x < sx - 2; x += 4) {
      if (world.solidAt(x, SURF, z) && !world.solidAt(x, G, z) && !world.solidAt(x, G + 1, z) && !world.solidAt(x, G + 2, z)) nav.push({ x: x + 0.5, z: z + 0.5 });
    }
  }

  // 13. 出発地点（信長像のまわり）
  const playerSpawns: V3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (let r = 8; r >= 4; r--) {
      const x = Math.floor(statue.x + Math.cos(a) * r);
      const z = Math.floor(statue.z + Math.sin(a) * r);
      if (!world.solidAt(x, G, z) && !world.solidAt(x, G + 1, z)) {
        playerSpawns.push({ x: x + 0.5, y: G, z: z + 0.5 });
        break;
      }
    }
  }
  if (playerSpawns.length === 0) playerSpawns.push({ x: statue.x + 6.5, y: G, z: statue.z + 0.5 });

  const landmarks = stationLandmarks(plan, statue);
  world.dirtyChunks.clear();
  world.dirtyColumns.clear();
  return { world, navPoints: nav, playerSpawns, landmarks, pristine: world.data.slice(), areas: [], zoneCenter: ZONE_CENTER };
}

/** 窓のある外壁（3 m ごとの階に窓の帯） */
function facade(x: number, y: number, z: number, wall: number, idx: number): number {
  const floor = (y - G) % 2;
  if (floor === 0) return wall;
  const along = (x + z) % 3;
  return along === 0 && hash(idx, 3) < 0.6 ? wall : B.GLASS;
}

function buildBuilding(world: VoxelWorld, plan: Plan, b: OsmBuilding, idx: number, sizeY: number): void {
  const own = idx + 1;
  const cells: [number, number][] = [];
  polyCells(b.p, plan.sx, plan.sz, (x, z) => {
    if (plan.bld[plan.i(x, z)] === own) cells.push([x, z]);
  });
  if (cells.length === 0) return;
  const wall = wallColor(b, idx);
  const isEdge = (x: number, z: number): boolean =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !plan.in(x + dx, z + dz) || plan.bld[plan.i(x + dx, z + dz)] !== own);
  // 塔と低層部に分けるビル
  const inset = TOWER_INSET[b.n];
  let towerOf: ((x: number, z: number) => boolean) | null = null;
  if (inset) {
    const xs = cells.map((c) => c[0]);
    const zs = cells.map((c) => c[1]);
    const x1 = Math.max(...xs);
    const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
    // 塔は駅前広場（東）寄り。スクエア43 のデッキがつながる側
    towerOf = (x, z) => x > x1 - inset.side && Math.abs(z + 0.5 - zc) <= inset.side / 2;
  }
  const tall = (PODIUM_ONLY[b.n] ?? b.h) > 60;
  const small = b.h <= 6 && cells.length < 400;
  const roofColor = hash(idx, 11) < 0.5 ? B.ROOF : B.ROOF_RED;
  for (const [x, z] of cells) {
    const tower = towerOf ? towerOf(x, z) : true;
    const h = towerOf && !tower ? inset!.podium : (PODIUM_ONLY[b.n] ?? b.h);
    const top = Math.min(sizeY - 4, G + h - 1);
    const edge = isEdge(x, z) || (towerOf !== null && tower && !(towerOf(x + 1, z) && towerOf(x - 1, z) && towerOf(x, z + 1) && towerOf(x, z - 1)));
    for (let y = G; y <= top; y++) world.setRaw(x, y, z, edge ? facade(x, y, z, wall, idx) : wall);
    if (small) world.setRaw(x, top + 1, z, roofColor);
    else world.setRaw(x, top + 1, z, edge ? wall : B.ROOF);
    // 高層ビルの屋上の灯り
    if (tall && !edge && (x * 7 + z * 13) % 41 === 0) world.setRaw(x, top + 2, z, B.LAMP);
  }
}

type SetFn = (x: number, y: number, z: number, id: number) => void;
type FillFn = (x: number, z: number, y0: number, y1: number, id: number) => void;

function buildViaduct(world: VoxelWorld, plan: Plan, set: SetFn, fill: FillFn): void {
  const { sx, sz } = plan;
  const deckY = STATION_TRACK - 1;
  // 線路（レールの下は砂利）
  const rail = new Uint8Array(sx * sz);
  for (const r of OSM_RAILS) {
    lineCells(r.p, 3, sx, sz, (x, z, d) => {
      const i = plan.i(x, z);
      rail[i] = Math.max(rail[i], d < 0.6 ? 2 : 1);
    });
  }
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = plan.i(x, z);
      if (!plan.via[i]) continue;
      // 高架の下は空ける（建物は建てていない）
      for (let y = G; y < deckY; y++) world.setRaw(x, y, z, B.AIR);
      set(x, deckY, z, rail[i] === 2 ? B.METAL : rail[i] === 1 ? B.STONE : B.CONCRETE);
      // 梁（2 階のコンコースの上は天井を高くするため無し）
      if (!plan.conc[i]) set(x, deckY - 1, z, B.CONCRETE);
      if (plan.plat[i]) {
        // ホーム（線路より 1 段高い）。端の 1 列は黄色い点字ブロック
        const nearEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => plan.in(x + dx, z + dz) && !plan.plat[plan.i(x + dx, z + dz)]);
        set(x, STATION_TRACK, z, nearEdge ? B.SAND : B.CONCRETE);
      }
      // 外側の防音壁（ホームの無い所）
      const outer = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => plan.in(x + dx, z + dz) && !plan.via[plan.i(x + dx, z + dz)]);
      if (outer && !plan.plat[i]) set(x, STATION_TRACK, z, B.CONCRETE);
      // 橋脚（道路の上には立てない）
      if (!plan.road[i] && !plan.conc[i] && x % 7 === 3 && z % 6 === 1) fill(x, z, G, deckY - 2, B.CONCRETE);
    }
  }
  // 停車中の電車（本線の長い 2 本。白い車体にオレンジの帯の 313 系）
  const mains = OSM_RAILS.filter((r) => r.main === 1)
    .map((r) => ({ r, len: railLength(r.p) }))
    .sort((a, c) => c.len - a.len)
    .slice(0, 2);
  const mid = (CONCOURSE_X0 + CONCOURSE_X1) / 2;
  mains.forEach(({ r }, n) => {
    lineCells(r.p, 2.2, sx, sz, (x, z) => {
      const i = plan.i(x, z);
      const off = x - mid + (n === 0 ? -8 : 10);
      if (plan.plat[i] || !plan.via[i] || Math.abs(off) > TRAIN_LENGTH / 2) return;
      // 両どうしのすき間
      if (Math.floor((off + TRAIN_LENGTH / 2) / 13.5) !== Math.floor((off + TRAIN_LENGTH / 2 + 0.9) / 13.5)) return;
      set(x, STATION_TRACK, z, B.WALL_TAN);
      set(x, STATION_TRACK + 1, z, x % 2 === 0 ? B.GLASS : B.METAL);
      set(x, STATION_TRACK + 2, z, B.METAL);
    });
  });

  // 1 階のお店（アスティ岐阜）。通路を残して箱を並べる
  for (let z = 0; z < sz; z++) {
    for (let x = SHOPS_X0; x <= SHOPS_X1; x++) {
      const i = plan.i(x, z);
      if (!plan.via[i] || plan.road[i] || plan.conc[i]) continue;
      // 高架の端から 3 マス以上内側だけ
      let inner = true;
      for (let d = 1; d <= 3 && inner; d++) {
        for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const j = plan.i(x + dx, z + dz);
          if (!plan.in(x + dx, z + dz) || !plan.via[j] || plan.road[j]) inner = false;
        }
      }
      if (!inner) continue;
      const lx = (x - SHOPS_X0) % 14;
      const lz = z % 12;
      if (lx >= 10 || lz >= 8) continue;
      const front = lx === 0 || lx === 9 || lz === 0 || lz === 7;
      const shop = Math.floor((x - SHOPS_X0) / 14) * 31 + Math.floor(z / 12);
      const wall = [B.PLASTER, B.WALL_TAN, B.WALL_BLUE, B.WALL_GREEN, B.BRICK][shop % 5];
      for (let y = G; y <= G + 3; y++) world.setRaw(x, y, z, front && y >= G && y <= G + 1 && (lx + lz) % 3 !== 0 ? B.GLASS : wall);
      if (front && lx === 0 && lz === 3) world.setRaw(x, G + 2, z, B.LAMP);
    }
  }
}

function railLength(p: readonly number[]): number {
  let len = 0;
  for (let k = 0; k + 3 < p.length; k += 2) len += Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
  return len;
}

function buildConcourse(world: VoxelWorld, plan: Plan, set: SetFn, fill: FillFn): void {
  const { sz } = plan;
  const slab = STATION_F2 - 1;
  let zMinAll = Infinity;
  let zMaxAll = -Infinity;
  for (let x = CONCOURSE_X0; x <= CONCOURSE_X1; x++) {
    for (let z = 0; z < sz; z++) {
      const i = plan.i(x, z);
      if (!plan.conc[i]) continue;
      zMinAll = Math.min(zMinAll, z);
      zMaxAll = Math.max(zMaxAll, z);
      set(x, slab, z, (x + z) % 2 === 0 ? B.PLASTER : B.CONCRETE);
      // 東西の端はガラスの壁
      if (x === CONCOURSE_X0 || x === CONCOURSE_X1) fill(x, z, STATION_F2, STATION_F2 + 1, B.GLASS);
      // 1 階の通路の柱
      if (x % 6 === 2 && z % 8 === 4) fill(x, z, G, slab - 1, B.CONCRETE);
    }
  }
  if (!Number.isFinite(zMinAll)) return;
  // 改札（中央改札口）。1 マスおきに改札機を置き、すき間を通れる
  const gateZ = Math.round(zMinAll + (zMaxAll - zMinAll) * 0.28);
  for (let x = CONCOURSE_X0 + 3; x <= CONCOURSE_X1 - 3; x++) {
    if (plan.conc[plan.i(x, gateZ)] && x % 2 === 0) set(x, STATION_F2, gateZ, B.METAL);
  }
  // 駅の案内の灯り
  for (let x = CONCOURSE_X0 + 4; x <= CONCOURSE_X1 - 4; x += 8) set(x, STATION_F2 + 1, gateZ, B.LAMP);

  // ホームへの階段（ホームごとに 1 か所、東向きに上る）
  const sxStair = Math.round((CONCOURSE_X0 + CONCOURSE_X1) / 2) - 2;
  for (const p of OSM_PLATFORMS) {
    const zs: number[] = [];
    polyCells(p, plan.sx, plan.sz, (x, z) => {
      if (x === sxStair + 3 && plan.conc[plan.i(sxStair, z)]) zs.push(z);
    });
    if (zs.length < 4) continue;
    zs.sort((a, c) => a - c);
    const zc = zs[Math.floor(zs.length / 2) - 1];
    for (const z of [zc, zc + 1]) {
      for (let k = 0; k < 3; k++) {
        const x = sxStair + k;
        // 段の上は頭がつかえないように空ける
        for (let y = STATION_F2; y <= STATION_PLATFORM + 2; y++) world.setRaw(x, y, z, B.AIR);
        fill(x, z, STATION_F2, STATION_F2 + k, B.METAL);
      }
      // 階段の手前（コンコース側）の天井も空ける
      for (let y = STATION_F2; y <= STATION_TRACK; y++) world.setRaw(sxStair - 1, y, z, B.AIR);
    }
    // ホームの上の階段の穴のまわりに手すり
    for (let k = -1; k < 3; k++) {
      for (const z of [zc - 1, zc + 2]) if (plan.plat[plan.i(sxStair + k, z)]) set(sxStair + k, STATION_PLATFORM, z, B.METAL);
    }
  }

}

/** 地上から 2 階へ上る階段の x（北口・南口に 2 か所ずつ。幅 3） */
const ENTRANCE_STAIRS_X = [Math.round((CONCOURSE_X0 + CONCOURSE_X1) / 2) - 12, Math.round((CONCOURSE_X0 + CONCOURSE_X1) / 2) + 10];

/**
 * 駅の出入口。杜の架け橋（2 階のデッキ）から 2 階の改札までのすき間に通路を渡し、
 * 北口・南口に地上から 2 階へ上る階段を置く。
 */
function buildEntrances(world: VoxelWorld, plan: Plan, set: SetFn): void {
  const stairCol = (x: number): boolean => ENTRANCE_STAIRS_X.some((x0) => x >= x0 - 1 && x <= x0 + 3);
  for (let x = CONCOURSE_X0; x <= CONCOURSE_X1; x++) {
    if (stairCol(x)) continue;
    let edge = -1;
    for (let z = 0; z < plan.sz; z++) {
      if (plan.conc[plan.i(x, z)]) {
        edge = z;
        break;
      }
    }
    if (edge < 0) continue;
    // 北へたどって、デッキに当たればそこまで床を渡す
    let reach = -1;
    for (let d = 1; d <= 16; d++) {
      const z = edge - d;
      if (z < 0 || plan.bld[plan.i(x, z)]) break;
      if (plan.deck[plan.i(x, z)]) {
        reach = z;
        break;
      }
    }
    if (reach < 0) continue;
    for (let z = reach + 1; z < edge; z++) {
      plan.deck[plan.i(x, z)] = -1;
      set(x, STATION_F2 - 1, z, (x + z) % 2 === 0 ? B.PLANK : B.CONCRETE);
      for (let y = STATION_F2; y <= STATION_F2 + 1; y++) world.setRaw(x, y, z, B.AIR);
    }
  }
  for (const x0 of ENTRANCE_STAIRS_X) {
    stairsZ(world, set, x0, x0 + 2, -1, plan);
    stairsZ(world, set, x0, x0 + 2, 1, plan);
  }
}

/** コンコースの北（dir = -1）か南（dir = 1）の端から、地面まで下りる階段。幅 x0..x1 */
function stairsZ(world: VoxelWorld, set: SetFn, x0: number, x1: number, dir: number, plan: Plan): void {
  for (let x = x0; x <= x1; x++) {
    // この列のコンコースの端（高架が斜めなので列ごとに違う）
    let edge = -1;
    for (let z = 0; z < plan.sz; z++) {
      if (!plan.conc[plan.i(x, z)]) continue;
      if (dir < 0) {
        edge = z;
        break;
      }
      edge = z;
    }
    if (edge < 0) continue;
    const z0 = edge + dir;
    for (let k = 0; k < 4; k++) {
      const z = z0 + dir * k;
      if (!plan.in(x, z)) continue;
      // 2 階の床と同じ高さの踊り場 → 1 段ずつ下りる
      const top = STATION_F2 - 1 - k;
      for (let y = G; y <= top; y++) set(x, y, z, k === 0 ? B.CONCRETE : B.PLASTER);
      for (let y = top + 1; y <= STATION_F2 + 2; y++) world.setRaw(x, y, z, B.AIR);
    }
  }
}

function buildDecks(world: VoxelWorld, plan: Plan, set: SetFn, fill: FillFn): void {
  const { sx, sz } = plan;
  const slab = STATION_F2 - 1;
  const decks = OSM_WAYS.filter((w) => w.k === 'deck');
  decks.forEach((w, k) => {
    lineCells(w.p, w.w, sx, sz, (x, z, d, s) => {
      const i = plan.i(x, z);
      if (plan.bld[i] || plan.conc[i]) return;
      plan.deck[i] = k + 1;
      set(x, slab, z, (x + z) % 2 === 0 ? B.PLANK : B.CONCRETE);
      for (let y = STATION_F2; y <= STATION_F2 + 1; y++) if (world.get(x, y, z) !== B.AIR && !plan.via[i]) world.setRaw(x, y, z, B.AIR);
      // デッキの柱
      if (d < 0.7 && Math.floor(s) % 8 === 0 && !plan.road[i]) fill(x, z, G, slab - 1, B.CONCRETE);
      else if (d < 0.7 && Math.floor(s) % 8 === 0) fill(x, z, G + 3, slab - 1, B.CONCRETE);
    });
  });
  // 端の階段（ほかのデッキ・建物・駅につながっていない端だけ）
  decks.forEach((w, k) => {
    const n = w.p.length / 2;
    for (const [e, f] of [
      [0, 1],
      [n - 1, n - 2],
    ]) {
      if (n < 2) continue;
      const ex = w.p[e * 2];
      const ez = w.p[e * 2 + 1];
      const dx = ex - w.p[f * 2];
      const dz = ez - w.p[f * 2 + 1];
      const cx = Math.floor(ex);
      const cz = Math.floor(ez);
      if (!plan.in(cx, cz)) continue;
      let joined = false;
      for (let oz = -3; oz <= 3 && !joined; oz++) {
        for (let ox = -3; ox <= 3 && !joined; ox++) {
          if (!plan.in(cx + ox, cz + oz)) continue;
          const j = plan.i(cx + ox, cz + oz);
          if ((plan.deck[j] && plan.deck[j] !== k + 1) || plan.bld[j] || plan.conc[j] || plan.via[j]) joined = true;
        }
      }
      if (joined) continue;
      // 向きは x か z のどちらか強い方
      const ax = Math.abs(dx) >= Math.abs(dz);
      const sxn = ax ? Math.sign(dx) : 0;
      const szn = ax ? 0 : Math.sign(dz);
      // デッキの外へ出た最初のマスから下りる
      let d0 = 1;
      while (d0 < 6 && plan.in(cx + sxn * d0, cz + szn * d0) && plan.deck[plan.i(cx + sxn * d0, cz + szn * d0)]) d0++;
      for (let side = -1; side <= 1; side++) {
        for (let s = 0; s < 3; s++) {
          const x = cx + sxn * (d0 + s) + (ax ? 0 : side);
          const z = cz + szn * (d0 + s) + (ax ? side : 0);
          if (!plan.in(x, z) || plan.bld[plan.i(x, z)]) continue;
          const top = STATION_F2 - 2 - s;
          fill(x, z, G, top, B.CONCRETE);
          for (let y = top + 1; y <= STATION_F2 + 1; y++) world.setRaw(x, y, z, B.AIR);
        }
      }
    }
  });
}

/** デッキの手すり（ガラス）と屋根（杜の架け橋は屋根つき）。端の階段の入口は空けたまま */
function deckRails(world: VoxelWorld, plan: Plan, set: SetFn, fill: FillFn): void {
  const { sx, sz } = plan;
  // 手すり（ガラス）と屋根（杜の架け橋は屋根つき）
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = plan.i(x, z);
      if (!plan.deck[i]) continue;
      const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
        if (!plan.in(x + dx, z + dz)) return true;
        const j = plan.i(x + dx, z + dz);
        return !plan.deck[j] && !plan.bld[j] && !plan.conc[j];
      });
      if (rim && world.get(x, STATION_F2, z) === B.AIR && !stairBelow(world, plan, x, z)) set(x, STATION_F2, z, B.GLASS);
      if (!plan.via[i] && world.get(x, CANOPY_Y, z) === B.AIR) {
        set(x, DECK_ROOF_Y, z, B.METAL);
        if (rim && (x + z) % 6 === 0) fill(x, z, STATION_F2, DECK_ROOF_Y - 1, B.METAL);
      }
    }
  }
}

/** となりに下りの階段がある（手すりを付けない） */
function stairBelow(world: VoxelWorld, plan: Plan, x: number, z: number): boolean {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const nz = z + dz;
    if (!plan.in(nx, nz) || plan.deck[plan.i(nx, nz)] || plan.bld[plan.i(nx, nz)]) continue;
    const top = STATION_F2 - 2;
    if (world.solidAt(nx, top, nz) && !world.solidAt(nx, top + 1, nz)) return true;
  }
  return false;
}

/** 黄金の信長像（台座を含めて約 12 m。右手に火縄銃、マントをなびかせる） */
function buildStatue(set: SetFn, fill: FillFn, sx: number, sz: number): void {
  for (let z = sz - 3; z <= sz + 3; z++) for (let x = sx - 3; x <= sx + 3; x++) set(x, G - 1, z, B.GRASS);
  for (let z = sz - 2; z <= sz + 2; z++) for (let x = sx - 2; x <= sx + 2; x++) set(x, G, z, B.STONE);
  for (let z = sz - 1; z <= sz + 1; z++) for (let x = sx - 1; x <= sx + 1; x++) fill(x, z, G + 1, G + 3, B.STONE);
  const g = G + 4;
  fill(sx - 1, sz, g, g, B.GOLD); // 脚
  fill(sx + 1, sz, g, g, B.GOLD);
  for (let x = sx - 1; x <= sx + 1; x++) fill(x, sz, g + 1, g + 2, B.GOLD); // 胴
  for (let x = sx - 1; x <= sx + 1; x++) set(x, g + 1, sz + 1, B.GOLD); // マント
  set(sx, g + 3, sz, B.GOLD); // 頭
  fill(sx + 2, sz - 1, g + 1, g + 3, B.GOLD); // 火縄銃
}

/** 丸窓電車モ510 形 513 号（岐阜の路面電車。駅前に保存されている） */
function buildTram(set: SetFn, fill: FillFn, cx: number, cz: number): void {
  for (let x = cx - 5; x <= cx + 5; x++) {
    for (const z of [cz - 1, cz + 1]) set(x, G - 1, z, B.METAL);
    set(x, G - 1, cz, B.CONCRETE);
  }
  for (let x = cx - 4; x <= cx + 4; x++) {
    for (let z = cz - 1; z <= cz + 1; z++) {
      set(x, G, z, B.ROOF_RED);
      const side = z !== cz;
      set(x, G + 1, z, side && x % 2 === 0 && Math.abs(x - cx) < 4 ? B.GLASS : B.PLASTER);
      set(x, G + 2, z, B.ROOF);
    }
  }
  // 丸窓（前後の窓）
  set(cx - 4, G + 1, cz, B.GLASS);
  set(cx + 4, G + 1, cz, B.GLASS);
  fill(cx, cz, G + 3, G + 3, B.METAL); // パンタグラフ
}

function buildTree(world: VoxelWorld, set: SetFn, fill: FillFn, x: number, z: number): void {
  if (world.get(x, G, z) !== B.AIR || world.get(x, G - 1, z) === B.ASPHALT) return;
  fill(x, z, G, G + 2, B.WOOD);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let y = G + 2; y <= G + 4; y++) {
        if ((Math.abs(dx) + Math.abs(dz) === 2 && y !== G + 3) || (dx === 0 && dz === 0 && y < G + 3)) continue;
        if (world.get(x + dx, y, z + dz) === B.AIR) set(x + dx, y, z + dz, B.LEAVES);
      }
    }
  }
}

function stationLandmarks(plan: Plan, statue: { x: number; z: number }): GifuLandmark[] {
  const center = (p: readonly number[]): { x: number; z: number } => {
    let x = 0;
    let z = 0;
    for (let k = 0; k < p.length; k += 2) {
      x += p[k];
      z += p[k + 1];
    }
    const n = p.length / 2;
    return { x: Math.max(8, Math.min(plan.sx - 8, x / n)), z: Math.max(4, Math.min(plan.sz - 4, z / n)) };
  };
  const list: GifuLandmark[] = [];
  const named: [string, string][] = [
    ['岐阜シティ・タワー43', 'タワー43'],
    ['岐阜スカイウイング37', 'スカイウイング37'],
    ['じゅうろくプラザ', 'じゅうろくプラザ'],
  ];
  for (const [key, label] of named) {
    const b = OSM_BUILDINGS.find((o) => o.n === key);
    if (b) list.push({ name: label, ...center(b.p) });
  }
  const cx = (CONCOURSE_X0 + CONCOURSE_X1) / 2;
  let zMin = plan.sz;
  let zMax = 0;
  for (let z = 0; z < plan.sz; z++) {
    if (plan.via[plan.i(Math.round(cx), z)]) {
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
  }
  list.push({ name: 'JR岐阜駅', x: cx, z: (zMin + zMax) / 2 });
  list.push({ name: '北口', x: cx, z: zMin - 6 });
  list.push({ name: '南口', x: cx, z: Math.min(plan.sz - 4, zMax + 6) });
  list.push({ name: '信長像', x: statue.x, z: statue.z });
  const tram = OSM_POINTS.find((p) => p.n.includes('モ513'));
  if (tram) list.push({ name: '丸窓電車', x: tram.x, z: tram.z + 4 });
  const morinoKakehashi = OSM_WAYS.filter((w) => w.k === 'deck').sort((a, b) => b.p.length - a.p.length)[0];
  if (morinoKakehashi) list.push({ name: '杜の架け橋', ...center(morinoKakehashi.p) });
  return list;
}
