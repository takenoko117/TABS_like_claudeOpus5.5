import { B } from '../openworld/OpenWorldConfig';
import { VoxelWorld, type V3 } from '../openworld/VoxelWorld';
import { makeRng } from '../openworld/WorldGen';
import { TAG_GROUND, TAG_SIZE_X, TAG_SIZE_Y, TAG_SIZE_Z } from './TagConfig';

/**
 * 鬼ごっこの舞台「岐阜の町（お昼）」のボクセル版。
 * 映像用の Blender ステージ（gifu_stage.blend）の配置をもとに、大きめのブロックで組み直したもの。
 *
 *  北 (z = 0)  長良川の北岸 ─ 長良川（金華橋・長良橋が架かる）
 *              中心市街地（金華橋通り・中央通り・長良橋通り・柳ケ瀬のアーケード）／ 北東に金華山と岐阜城
 *              駅前広場（黄金の信長像・タワー43・スカイウイング37）
 *  南          JR 岐阜駅と東海道本線の高架
 *
 * x = 東、z = 南、y = 上。1 ブロック = 1 m。Three.js に依存しない。
 */

export interface GifuLandmark {
  name: string;
  x: number;
  z: number;
}

export interface GifuTown {
  world: VoxelWorld;
  /** ハヤトがうろつく目的地（道路・広場・山道の上） */
  navPoints: { x: number; z: number }[];
  /** プレイヤーの出発地点（駅前広場の信長像のまわり） */
  playerSpawns: V3[];
  /** ミニマップに名前を出す場所 */
  landmarks: GifuLandmark[];
  /** 作りたての町のブロック（ロケットで壊れた町を元に戻すため） */
  pristine: Uint8Array;
}

/** 地面の表面のブロックの高さ（この上に立つ） */
const SURF = TAG_GROUND - 1;

// ---- 区画の位置（向きの説明はファイル冒頭） ----
/** 長良川の範囲（北岸の河原〜南岸の河原） */
const RIVER_Z0 = 6;
const RIVER_Z1 = 25;
/** 金華山の頂上と広がり */
const MOUNT_X = 154;
const MOUNT_Z = 56;
const MOUNT_R = 46;
const MOUNT_PEAK = 37;
/** 南北の大通り [x0, x1, z0, z1]（金華橋通り・中央通り・長良橋通り） */
const AVENUES: readonly [number, number, number, number][] = [
  [14, 19, 0, 147],
  [60, 65, 26, 169],
  [98, 103, 0, 147],
];
/** 南北の細い通り */
const STREETS_NS: readonly [number, number, number, number][] = [
  [38, 40, 26, 147],
  [80, 82, 26, 147],
  [120, 122, 96, 147],
  [146, 148, 100, 147],
];
/** 東西の通り [z0, z1, x0, x1] */
const STREETS_EW: readonly [number, number, number, number][] = [
  [26, 30, 0, 123],
  [54, 56, 0, 123],
  [84, 86, 0, 123],
  [112, 116, 0, 175],
  [142, 147, 0, 175],
];
/** 金華橋・長良橋 [x0, x1, 橋桁の色] */
const BRIDGES: readonly [number, number, number][] = [
  [14, 19, B.WALL_GREEN],
  [98, 103, B.WALL_BLUE],
];
/** 柳ケ瀬のアーケード（東西に延びる屋根つきの商店街） */
const ARCADE = { x0: 41, x1: 59, z0: 68, z1: 71 };
/** 駅前広場・駅・高架 */
const PLAZA_Z0 = 148;
const PLAZA_Z1 = 169;
const STATUE = { x: 62, z: 158 };
const STATION = { x0: 28, x1: 136, z0: 171, z1: 181 };
const VIADUCT = { z0: 183, z1: 189 };

type Rng = () => number;

class Builder {
  constructor(readonly w: VoxelWorld) {}

  set(x: number, y: number, z: number, id: number): void {
    this.w.setRaw(x, y, z, id);
  }

  /** 箱を塗る（両端を含む） */
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id: number): void {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.w.setRaw(x, y, z, id);
  }
}

/** 金華山の地面の高さ（山でなければ SURF） */
export function mountainHeight(x: number, z: number): number {
  const d = Math.hypot(x - MOUNT_X, (z - MOUNT_Z) * 1.1) / MOUNT_R;
  if (d >= 1) return SURF;
  // なだらかな円すい（どこでも 1 段ずつ登れる傾き）に、ゆるい起伏を足す
  const bump = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 1.2 * (1 - d);
  return Math.max(SURF, Math.round(SURF + MOUNT_PEAK * Math.pow(1 - d, 1.15) + bump));
}

function onMountain(x: number, z: number): boolean {
  return mountainHeight(x, z) > SURF;
}

function inRect(x: number, z: number, r: readonly [number, number, number, number], ew = false): boolean {
  return ew ? z >= r[0] && z <= r[1] && x >= r[2] && x <= r[3] : x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3];
}

/** 道路か（橋の上を含む） */
function isRoad(x: number, z: number): boolean {
  if (z >= RIVER_Z0 && z <= RIVER_Z1) return BRIDGES.some(([x0, x1]) => x >= x0 && x <= x1);
  return AVENUES.some((r) => inRect(x, z, r)) || STREETS_NS.some((r) => inRect(x, z, r)) || STREETS_EW.some((r) => inRect(x, z, r, true));
}

/** 長良川の川底の高さ（川でなければ SURF） */
function riverBed(z: number): number {
  if (z < RIVER_Z0 || z > RIVER_Z1) return SURF;
  const fromEdge = Math.min(z - RIVER_Z0, RIVER_Z1 - z);
  return Math.max(2, SURF - fromEdge);
}

/** 岐阜の町を作る。同じ種なら同じ町になる（オンラインの全員が同じ町を作る） */
export function generateGifuTown(seed = 1): GifuTown {
  const world = new VoxelWorld(TAG_SIZE_X, TAG_SIZE_Y, TAG_SIZE_Z);
  const b = new Builder(world);
  const rng = makeRng(seed * 7919 + 13);
  const nav: { x: number; z: number }[] = [];

  // 1. 土台と地形（川・山）
  for (let z = 0; z < TAG_SIZE_Z; z++) {
    for (let x = 0; x < TAG_SIZE_X; x++) {
      b.set(x, 0, z, B.BEDROCK);
      const mh = mountainHeight(x, z);
      const bed = riverBed(z);
      if (mh > SURF) {
        b.fill(x, x, 1, mh - 3, z, z, B.STONE);
        b.fill(x, x, mh - 2, mh - 1, z, z, B.DIRT);
        b.set(x, mh, z, B.GRASS);
      } else if (bed < SURF) {
        b.fill(x, x, 1, bed - 1, z, z, B.STONE);
        b.set(x, bed, z, B.SAND);
        for (let y = bed + 1; y <= SURF - 1; y++) b.set(x, y, z, B.WATER);
      } else {
        b.fill(x, x, 1, SURF - 2, z, z, B.STONE);
        b.set(x, SURF - 1, z, B.DIRT);
        // 河原は砂、ほかは草
        b.set(x, SURF, z, z === RIVER_Z0 - 1 || z === RIVER_Z1 + 1 ? B.SAND : B.GRASS);
      }
    }
  }

  // 2. 道路
  for (let z = 0; z < TAG_SIZE_Z; z++) {
    for (let x = 0; x < TAG_SIZE_X; x++) {
      if (!isRoad(x, z) || onMountain(x, z)) continue;
      const onBridge = z >= RIVER_Z0 && z <= RIVER_Z1;
      if (!onBridge) b.set(x, SURF, z, B.ASPHALT);
      if (x % 4 === 0 && z % 4 === 0) nav.push({ x: x + 0.5, z: z + 0.5 });
    }
  }
  // 大通りの中央線
  for (const [x0, x1, z0, z1] of AVENUES) {
    const cx = Math.floor((x0 + x1) / 2);
    for (let z = z0; z <= z1; z++) if (z % 4 < 2 && !(z >= RIVER_Z0 && z <= RIVER_Z1) && !onMountain(cx, z)) b.set(cx, SURF, z, B.ROAD_LINE);
  }

  // 3. 橋（金華橋・長良橋）
  for (const [x0, x1, color] of BRIDGES) buildBridge(b, x0, x1, color);

  // 4. 北岸の家並み
  for (let x = 2; x < TAG_SIZE_X - 6; x += 7 + Math.floor(rng() * 3)) {
    if (BRIDGES.some(([x0, x1]) => x + 5 >= x0 - 1 && x <= x1 + 1) || onMountain(x + 2, 2)) continue;
    buildHouse(b, rng, x, 0, 5, 4);
  }

  // 5. 市街地の区画（道路で区切られた長方形ごとにビルを詰める）
  const lots = findLots();
  for (const lot of lots) buildLot(b, rng, lot, nav);

  // 6. 柳ケ瀬のアーケード
  buildArcade(b);

  // 7. 金華山の森と岐阜城
  buildMountain(b, rng, nav);

  // 8. 駅前広場・信長像・タワー43・スカイウイング37・岐阜駅・高架
  buildStationArea(b, rng, nav);

  // 9. 街路樹（大通りの両脇）
  for (const [x0, x1, z0, z1] of AVENUES) {
    for (let z = Math.max(z0, 32); z <= Math.min(z1, 140); z += 9) {
      for (const tx of [x0 - 1, x1 + 1]) {
        if (world.get(tx, TAG_GROUND, z) === B.AIR && world.get(tx, SURF, z) !== B.ASPHALT && !onMountain(tx, z)) buildTree(b, tx, TAG_GROUND, z, 3);
      }
    }
  }

  const playerSpawns: V3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    playerSpawns.push({ x: STATUE.x + 0.5 + Math.cos(a) * 9, y: TAG_GROUND, z: STATUE.z + 0.5 + Math.sin(a) * 6 });
  }
  const landmarks: GifuLandmark[] = [
    { name: '長良川', x: 60, z: 15 },
    { name: '金華橋', x: 17, z: 15 },
    { name: '長良橋', x: 101, z: 15 },
    { name: '金華山', x: MOUNT_X, z: MOUNT_Z + 14 },
    { name: '岐阜城', x: MOUNT_X, z: MOUNT_Z },
    { name: '柳ケ瀬', x: 50, z: 69 },
    { name: '信長像', x: STATUE.x, z: STATUE.z },
    { name: 'タワー43', x: 25, z: 155 },
    { name: 'スカイウイング37', x: 112, z: 155 },
    { name: 'JR岐阜駅', x: 82, z: 176 },
  ];
  world.dirtyChunks.clear();
  world.dirtyColumns.clear();
  return { world, navPoints: nav, playerSpawns, landmarks, pristine: world.data.slice() };
}

/** 道路で囲まれた長方形の区画を探す（市街地・山の南の住宅地） */
function findLots(): { x0: number; x1: number; z0: number; z1: number }[] {
  const lots: { x0: number; x1: number; z0: number; z1: number }[] = [];
  // 道路の端で区切る
  const xCuts = [-1, ...[...AVENUES, ...STREETS_NS].flatMap(([x0, x1]) => [x0, x1]), TAG_SIZE_X].sort((a, c) => a - c);
  const zCuts = [...STREETS_EW.flatMap(([z0, z1]) => [z0, z1])].sort((a, c) => a - c);
  for (let i = 0; i + 1 < xCuts.length; i += 2) {
    const x0 = xCuts[i] + 1;
    const x1 = xCuts[i + 1] - 1;
    if (x1 - x0 < 4) continue;
    for (let j = 1; j + 1 < zCuts.length; j += 2) {
      const z0 = zCuts[j] + 1;
      const z1 = zCuts[j + 1] - 1;
      if (z1 - z0 < 4) continue;
      lots.push({ x0, x1, z0, z1 });
    }
  }
  return lots;
}

/** 区画にビル・公園・駐車場を詰める */
function buildLot(b: Builder, rng: Rng, lot: { x0: number; x1: number; z0: number; z1: number }, nav: { x: number; z: number }[]): void {
  // 外周は歩道
  for (let z = lot.z0; z <= lot.z1; z++) {
    for (let x = lot.x0; x <= lot.x1; x++) {
      if (onMountain(x, z) || isRoad(x, z)) continue;
      const edge = x === lot.x0 || x === lot.x1 || z === lot.z0 || z === lot.z1;
      if (edge) b.set(x, SURF, z, B.SIDEWALK);
    }
  }
  const residential = lot.x0 >= 124;
  // 駅に近いほど・中央通りに近いほど高いビル
  const centerness = Math.max(0, 1 - Math.abs((lot.x0 + lot.x1) / 2 - 62) / 70) * 0.5 + Math.max(0, ((lot.z0 + lot.z1) / 2 - 30) / 120) * 0.5;
  let z = lot.z0 + 1;
  while (z <= lot.z1 - 3) {
    const depth = Math.min(lot.z1 - 1 - z + 1, 6 + Math.floor(rng() * 7));
    let x = lot.x0 + 1;
    while (x <= lot.x1 - 3) {
      const width = Math.min(lot.x1 - 1 - x + 1, 6 + Math.floor(rng() * 7));
      const x1 = x + width - 1;
      const z1 = z + depth - 1;
      // 柳ケ瀬のアーケードの通りは空けておく
      const hitsArcade = x1 >= ARCADE.x0 && x <= ARCADE.x1 && z1 >= ARCADE.z0 - 7 && z <= ARCADE.z1 + 7;
      const mountainy = onMountain(x, z) || onMountain(x1, z1) || onMountain(x, z1) || onMountain(x1, z);
      if (width >= 3 && depth >= 3 && !mountainy && !hitsArcade) {
        const r = rng();
        if (residential) {
          buildHouse(b, rng, x, z, Math.min(width, 6), Math.min(depth, 6));
        } else if (r < 0.08) {
          buildPark(b, rng, x, x1, z, z1, nav);
        } else if (r < 0.14) {
          // 駐車場（低い塀のない空き地）。隠れる場所にはならないが、走り抜けられる
          b.fill(x, x1, SURF, SURF, z, z1, B.ASPHALT);
          for (let px = x; px <= x1; px += 3) b.fill(px, px, SURF, SURF, z, z1, B.ROAD_LINE);
          nav.push({ x: (x + x1) / 2 + 0.5, z: (z + z1) / 2 + 0.5 });
        } else {
          const hMin = 5 + Math.round(centerness * 6);
          const hMax = 10 + Math.round(centerness * 18);
          buildBuilding(b, rng, x, x1, z, z1, hMin + Math.floor(rng() * (hMax - hMin + 1)));
        }
      }
      // 建物の間は 2 ブロックの路地（隠れ場所）
      x = x1 + 3;
    }
    z += depth + 2;
  }
}

const WALLS = [B.CONCRETE, B.WALL_TAN, B.WALL_BLUE, B.BRICK, B.PLASTER, B.CONCRETE_DARK, B.WALL_GREEN];

/** 窓のあるビル */
function buildBuilding(b: Builder, rng: Rng, x0: number, x1: number, z0: number, z1: number, height: number): void {
  const wall = WALLS[Math.floor(rng() * WALLS.length)];
  const glassy = rng() < 0.3;
  const top = TAG_GROUND + height - 1;
  for (let y = TAG_GROUND; y <= top; y++) {
    const floor = (y - TAG_GROUND) % 3;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edgeX = x === x0 || x === x1;
        const edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) {
          // 中は 3 階ごとに床を入れるだけ（中身は見えないので空洞でよいが、光線の判定を軽くするため詰める）
          b.set(x, y, z, wall);
          continue;
        }
        const corner = edgeX && edgeZ;
        const along = edgeZ ? x : z;
        const isWindow = !corner && floor === 1 && (glassy ? true : along % 2 === 0);
        b.set(x, y, z, isWindow ? B.GLASS : wall);
      }
    }
  }
  // 屋上と手すり
  b.fill(x0, x1, top, top, z0, z1, B.ROOF);
  for (let x = x0; x <= x1; x++) {
    b.set(x, top + 1, z0, wall);
    b.set(x, top + 1, z1, wall);
  }
  for (let z = z0; z <= z1; z++) {
    b.set(x0, top + 1, z, wall);
    b.set(x1, top + 1, z, wall);
  }
  // 1 階の入口（色の違うブロック）
  const doorX = Math.floor((x0 + x1) / 2);
  b.set(doorX, TAG_GROUND, z1, B.CONCRETE_DARK);
  b.set(doorX, TAG_GROUND + 1, z1, B.CONCRETE_DARK);
}

/** 赤い屋根の家 */
function buildHouse(b: Builder, rng: Rng, x0: number, z0: number, w: number, d: number): void {
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  const wall = rng() < 0.6 ? B.PLASTER : B.WALL_TAN;
  const h = 3;
  for (let y = TAG_GROUND; y < TAG_GROUND + h; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        const win = edge && y === TAG_GROUND + 1 && (x + z) % 3 === 0 && !(x === x0 && z === z0);
        b.set(x, y, z, win ? B.GLASS : wall);
      }
    }
  }
  // 切妻の屋根
  const roof = rng() < 0.5 ? B.ROOF_RED : B.TILE;
  const half = Math.ceil(d / 2);
  for (let k = 0; k < half; k++) {
    const y = TAG_GROUND + h + k;
    b.fill(x0, x1, y, y, z0 + k, z0 + k, roof);
    b.fill(x0, x1, y, y, z1 - k, z1 - k, roof);
    if (z0 + k + 1 <= z1 - k - 1) b.fill(x0, x1, y, y, z0 + k + 1, z1 - k - 1, wall);
  }
}

/** 公園（芝生と木） */
function buildPark(b: Builder, rng: Rng, x0: number, x1: number, z0: number, z1: number, nav: { x: number; z: number }[]): void {
  b.fill(x0, x1, SURF, SURF, z0, z1, B.GRASS);
  for (let k = 0; k < 3; k++) {
    const tx = x0 + 1 + Math.floor(rng() * Math.max(1, x1 - x0 - 1));
    const tz = z0 + 1 + Math.floor(rng() * Math.max(1, z1 - z0 - 1));
    buildTree(b, tx, TAG_GROUND, tz, 3 + Math.floor(rng() * 2));
  }
  nav.push({ x: (x0 + x1) / 2 + 0.5, z: (z0 + z1) / 2 + 0.5 });
}

/** 木（幹と葉の塊） */
function buildTree(b: Builder, x: number, y: number, z: number, trunk: number): void {
  b.fill(x, x, y, y + trunk - 1, z, z, B.WOOD);
  const cy = y + trunk;
  for (let dy = 0; dy <= 2; dy++) {
    const r = dy === 2 ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1) continue;
        if (b.w.get(x + dx, cy + dy, z + dz) === B.AIR) b.set(x + dx, cy + dy, z + dz, B.LEAVES);
      }
    }
  }
}

/** 橋（路面・欄干・橋桁・橋脚） */
function buildBridge(b: Builder, x0: number, x1: number, color: number): void {
  for (let z = RIVER_Z0 - 1; z <= RIVER_Z1 + 1; z++) {
    if (onMountain(x0, z)) continue;
    b.fill(x0, x1, SURF, SURF, z, z, B.ASPHALT);
    if (z % 4 < 2) b.set(Math.floor((x0 + x1) / 2), SURF, z, B.ROAD_LINE);
    // 欄干
    b.set(x0 - 1, SURF, z, B.CONCRETE);
    b.set(x1 + 1, SURF, z, B.CONCRETE);
    b.set(x0 - 1, TAG_GROUND, z, color);
    b.set(x1 + 1, TAG_GROUND, z, color);
    // 橋桁（路面の下の色つきの梁）
    b.fill(x0 - 1, x1 + 1, SURF - 1, SURF - 1, z, z, color);
  }
  // 橋脚
  for (const pz of [RIVER_Z0 + 6, RIVER_Z1 - 6]) {
    b.fill(x0, x1, 1, SURF - 2, pz, pz + 1, B.STONE);
  }
}

/** 柳ケ瀬のアーケード（両側の低い商店と、ガラスの屋根） */
function buildArcade(b: Builder): void {
  const { x0, x1, z0, z1 } = ARCADE;
  b.fill(x0, x1, SURF, SURF, z0, z1, B.PLANK);
  const roofY = TAG_GROUND + 5;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) b.set(x, roofY, z, z === z0 - 1 || z === z1 + 1 ? B.METAL : B.GLASS);
    // 柱
    if (x % 5 === 1) {
      b.fill(x, x, TAG_GROUND, roofY - 1, z0 - 1, z0 - 1, B.METAL);
      b.fill(x, x, TAG_GROUND, roofY - 1, z1 + 1, z1 + 1, B.METAL);
    }
  }
  // 両側の商店（入口は開いている）
  for (const [sz0, sz1] of [
    [z0 - 6, z0 - 2],
    [z1 + 2, z1 + 6],
  ] as const) {
    for (let x = x0; x <= x1; x += 6) {
      const sx1 = Math.min(x1, x + 4);
      const wall = WALLS[(x * 7) % WALLS.length];
      b.fill(x, sx1, TAG_GROUND, TAG_GROUND + 3, sz0, sz1, wall);
      // 店先の看板（色の帯）
      const front = sz0 < z0 ? sz1 : sz0;
      b.fill(x, sx1, TAG_GROUND + 3, TAG_GROUND + 3, front, front, x % 12 === x0 % 12 ? B.ROOF_RED : B.LAMP);
      b.fill(x + 1, sx1 - 1, TAG_GROUND, TAG_GROUND + 1, front, front, B.GLASS);
    }
  }
  // 入口の門（「柳ケ瀬」の看板のかわりの赤い梁）
  b.fill(x0, x0, roofY + 1, roofY + 1, z0 - 1, z1 + 1, B.ROOF_RED);
  b.fill(x1, x1, roofY + 1, roofY + 1, z0 - 1, z1 + 1, B.ROOF_RED);
}

/** 金華山の森・山道と、頂上の岐阜城 */
function buildMountain(b: Builder, rng: Rng, nav: { x: number; z: number }[]): void {
  const w = b.w;
  // 頂上を平らにする
  const top = mountainHeight(MOUNT_X, MOUNT_Z);
  for (let dz = -6; dz <= 6; dz++) {
    for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx + dz * dz > 40) continue;
      const x = MOUNT_X + dx;
      const z = MOUNT_Z + dz;
      for (let y = top + 1; y < TAG_SIZE_Y; y++) w.setRaw(x, y, z, B.AIR);
      b.fill(x, x, top - 2, top - 1, z, z, B.STONE);
      b.set(x, top, z, B.STONE);
    }
  }
  // 森（まばらにすると見通しがよすぎるので、山道以外は詰める）
  for (let z = 2; z < TAG_SIZE_Z - 2; z += 4) {
    for (let x = 2; x < TAG_SIZE_X - 2; x += 4) {
      const tx = x + Math.floor(rng() * 3) - 1;
      const tz = z + Math.floor(rng() * 3) - 1;
      const h = mountainHeight(tx, tz);
      if (h <= SURF + 1) continue;
      const d = Math.hypot(tx - MOUNT_X, tz - MOUNT_Z);
      if (d < 9) continue;
      if (w.get(tx, h, tz) !== B.GRASS) continue;
      if (rng() < 0.62) buildTree(b, tx, h + 1, tz, 2 + Math.floor(rng() * 2));
      else nav.push({ x: tx + 0.5, z: tz + 0.5 });
    }
  }
  // 岐阜城（3 層の天守）
  const base = top + 1;
  const tiers: [number, number][] = [
    [4, 3],
    [3, 3],
    [2, 3],
  ];
  let y = base;
  b.fill(MOUNT_X - 5, MOUNT_X + 5, y, y, MOUNT_Z - 5, MOUNT_Z + 5, B.STONE);
  y++;
  for (const [r, h] of tiers) {
    b.fill(MOUNT_X - r, MOUNT_X + r, y, y + h - 2, MOUNT_Z - r, MOUNT_Z + r, B.PLASTER);
    // 窓
    for (let k = -r + 1; k <= r - 1; k += 2) {
      b.set(MOUNT_X + k, y + 1, MOUNT_Z + r, B.WOOD);
      b.set(MOUNT_X + k, y + 1, MOUNT_Z - r, B.WOOD);
    }
    b.fill(MOUNT_X - r - 1, MOUNT_X + r + 1, y + h - 1, y + h - 1, MOUNT_Z - r - 1, MOUNT_Z + r + 1, B.TILE);
    y += h;
  }
  // 金のしゃちほこ
  b.set(MOUNT_X - 1, y, MOUNT_Z, B.GOLD);
  b.set(MOUNT_X + 1, y, MOUNT_Z, B.GOLD);
  nav.push({ x: MOUNT_X + 0.5, z: MOUNT_Z + 6.5 });
}

/** 駅前広場・黄金の信長像・タワー43・スカイウイング37・JR 岐阜駅・東海道本線の高架 */
function buildStationArea(b: Builder, rng: Rng, nav: { x: number; z: number }[]): void {
  // 広場の石畳
  for (let z = PLAZA_Z0; z <= PLAZA_Z1; z++) {
    for (let x = 0; x < TAG_SIZE_X; x++) {
      if (onMountain(x, z)) continue;
      b.set(x, SURF, z, (x + z) % 2 === 0 ? B.SIDEWALK : B.CONCRETE);
      if (x % 6 === 0 && z % 6 === 0) nav.push({ x: x + 0.5, z: z + 0.5 });
    }
  }
  // 信長像（台座と金の像。右手を上げ、左手に火縄銃）
  const { x: sx, z: sz } = STATUE;
  b.fill(sx - 2, sx + 2, TAG_GROUND, TAG_GROUND + 2, sz - 2, sz + 2, B.STONE);
  b.fill(sx - 3, sx + 3, SURF, SURF, sz - 3, sz + 3, B.GRASS);
  const g = TAG_GROUND + 3;
  b.fill(sx - 1, sx + 1, g, g + 1, sz, sz, B.GOLD); // 脚
  b.fill(sx - 1, sx + 1, g + 2, g + 4, sz - 1, sz + 1, B.GOLD); // 胴（マント）
  b.set(sx, g + 5, sz, B.GOLD); // 頭
  b.fill(sx + 2, sx + 2, g + 4, g + 6, sz, sz, B.GOLD); // 上げた右手
  b.fill(sx - 2, sx - 2, g + 1, g + 4, sz + 1, sz + 1, B.GOLD); // 火縄銃
  // 広場の植え込み
  for (let x = 6; x < 170; x += 14) {
    if (Math.abs(x - sx) < 8 || onMountain(x, PLAZA_Z0 + 3)) continue;
    buildTree(b, x, TAG_GROUND, PLAZA_Z0 + 3, 3);
    buildTree(b, x + 5, TAG_GROUND, PLAZA_Z1 - 2, 3);
  }
  // バス停の屋根
  for (let x = 70; x <= 90; x += 10) {
    b.fill(x, x + 5, TAG_GROUND + 3, TAG_GROUND + 3, PLAZA_Z1 - 6, PLAZA_Z1 - 5, B.METAL);
    b.fill(x, x, TAG_GROUND, TAG_GROUND + 2, PLAZA_Z1 - 6, PLAZA_Z1 - 6, B.METAL);
    b.fill(x + 5, x + 5, TAG_GROUND, TAG_GROUND + 2, PLAZA_Z1 - 6, PLAZA_Z1 - 6, B.METAL);
  }
  // タワー43（岐阜シティ・タワー43）とスカイウイング37
  buildTower(b, 20, 29, 150, 159, 44, B.CONCRETE);
  buildTower(b, 106, 115, 150, 159, 38, B.WALL_TAN);

  // JR 岐阜駅（白い駅舎と、中央のガラスのアトリウム。3 か所の通り抜けの改札口）
  const st = STATION;
  b.fill(st.x0, st.x1, SURF, SURF, st.z0, st.z1, B.CONCRETE);
  b.fill(st.x0, st.x1, TAG_GROUND, TAG_GROUND + 7, st.z0, st.z1, B.PLASTER);
  for (let x = st.x0; x <= st.x1; x++) {
    for (const y of [TAG_GROUND + 2, TAG_GROUND + 5]) if (x % 2 === 0) b.set(x, y, st.z0, B.GLASS);
  }
  b.fill(st.x0, st.x1, TAG_GROUND + 8, TAG_GROUND + 8, st.z0 - 1, st.z1, B.ROOF);
  const atriumX0 = 72;
  const atriumX1 = 92;
  b.fill(atriumX0, atriumX1, TAG_GROUND, TAG_GROUND + 11, st.z0, st.z1, B.GLASS);
  b.fill(atriumX0 - 1, atriumX1 + 1, TAG_GROUND + 12, TAG_GROUND + 12, st.z0 - 3, st.z1, B.METAL);
  // 大庇
  b.fill(st.x0 + 10, st.x1 - 10, TAG_GROUND + 4, TAG_GROUND + 4, st.z0 - 3, st.z0 - 1, B.METAL);
  // 通り抜け（改札口のかわりの通路）。駅の裏の高架下へ抜けられる
  for (const cx of [48, 82, 118]) {
    b.fill(cx - 2, cx + 2, TAG_GROUND, TAG_GROUND + 3, st.z0, st.z1, B.AIR);
    b.fill(cx - 2, cx + 2, SURF, SURF, st.z0, st.z1, B.SIDEWALK);
    nav.push({ x: cx + 0.5, z: (st.z0 + st.z1) / 2 + 0.5 });
  }
  // 駅の裏（高架の下までの道）
  for (let z = st.z1 + 1; z < TAG_SIZE_Z; z++) {
    for (let x = 0; x < TAG_SIZE_X; x++) if (!onMountain(x, z)) b.set(x, SURF, z, B.ASPHALT);
  }
  for (let x = 4; x < TAG_SIZE_X; x += 12) nav.push({ x: x + 0.5, z: st.z1 + 1.5 });

  // 東海道本線の高架橋と電車
  const deckY = TAG_GROUND + 6;
  for (let x = 0; x < TAG_SIZE_X; x++) {
    if (onMountain(x, VIADUCT.z0)) continue;
    b.fill(x, x, deckY, deckY, VIADUCT.z0, VIADUCT.z1, B.CONCRETE);
    b.set(x, deckY + 1, VIADUCT.z0, B.CONCRETE);
    b.set(x, deckY + 1, VIADUCT.z1, B.CONCRETE);
    b.set(x, deckY + 1, VIADUCT.z0 + 2, B.METAL);
    b.set(x, deckY + 1, VIADUCT.z1 - 2, B.METAL);
    if (x % 10 === 3) {
      b.fill(x, x + 1, TAG_GROUND, deckY - 1, VIADUCT.z0 + 1, VIADUCT.z0 + 1, B.CONCRETE);
      b.fill(x, x + 1, TAG_GROUND, deckY - 1, VIADUCT.z1 - 1, VIADUCT.z1 - 1, B.CONCRETE);
    }
  }
  // 313 系の電車（白い車体にオレンジの帯）。4 両
  const trainZ0 = VIADUCT.z0 + 1;
  const trainZ1 = VIADUCT.z0 + 3;
  for (let car = 0; car < 4; car++) {
    const cx0 = 30 + car * 21 + Math.floor(rng() * 2);
    const cx1 = cx0 + 19;
    b.fill(cx0, cx1, deckY + 2, deckY + 4, trainZ0, trainZ1, B.PLASTER);
    b.fill(cx0, cx1, deckY + 2, deckY + 2, trainZ0, trainZ1, B.WALL_TAN);
    for (let x = cx0 + 1; x < cx1; x += 2) {
      b.set(x, deckY + 3, trainZ0, B.GLASS);
      b.set(x, deckY + 3, trainZ1, B.GLASS);
    }
  }
}

/** 高層ビル（ガラスの壁と、角の柱） */
function buildTower(b: Builder, x0: number, x1: number, z0: number, z1: number, height: number, frame: number): void {
  const top = Math.min(TAG_SIZE_Y - 3, TAG_GROUND + height - 1);
  for (let y = TAG_GROUND; y <= top; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edgeX = x === x0 || x === x1;
        const edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) {
          b.set(x, y, z, frame);
          continue;
        }
        const corner = edgeX && edgeZ;
        const along = edgeZ ? x : z;
        const band = (y - TAG_GROUND) % 4 === 0;
        b.set(x, y, z, corner || band || along % 3 === 0 ? frame : B.GLASS);
      }
    }
  }
  b.fill(x0 + 2, x1 - 2, top + 1, top + 2, z0 + 2, z1 - 2, B.METAL);
  b.set(Math.floor((x0 + x1) / 2), top + 3, Math.floor((z0 + z1) / 2), B.LAMP);
}

/** 点の真下にある、立てる面の高さ（その面の上の y）。無ければ 1 */
export function floorBelow(world: VoxelWorld, x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  for (let yy = Math.min(Math.floor(y), world.sizeY - 1); yy >= 0; yy--) {
    if (world.solidAt(ix, yy, iz)) return yy + 1;
  }
  return 1;
}

/** ロケットで壊れた町を作りたてに戻す（毎回の鬼ごっこの始まりに呼ぶ） */
export function resetGifuTown(town: GifuTown): void {
  const w = town.world;
  w.data.set(town.pristine);
  w.dirtyChunks.clear();
  w.dirtyColumns.clear();
  w.damage.clear();
}

/** 列のいちばん下の、立てる地面の高さ（木の葉や橋の上ではなく地面。無ければ -1） */
export function groundAt(world: VoxelWorld, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  for (let y = 1; y < world.sizeY - 2; y++) {
    if (world.solidAt(ix, y - 1, iz) && !world.solidAt(ix, y, iz) && !world.solidAt(ix, y + 1, iz)) return y;
  }
  return -1;
}
