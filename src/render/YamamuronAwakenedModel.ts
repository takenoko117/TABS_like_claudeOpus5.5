import type { Team } from '../units/UnitTypes';
import { VoxelGrid } from './VoxelModel';

/**
 * ヤマムロン強化モード専用のボクセル造形。
 * 通常形態より細かいボクセルで、裾野の神域から山頂の宝珠までを手続き的に彫り出す。
 *
 * 山の座標系: グリッド中心が山の軸、y = 0 が地面。
 *   胴体 = 基壇・樹海・山肌・溶岩流・参道・注連縄・鳥居・八葉の冠
 *   頭   = 火口の上に浮かぶ宝珠
 */

export interface AwakenedPartSpec {
  grid: VoxelGrid;
  voxelSize: number;
  pivot: readonly [number, number, number];
}

const VOXEL_SIZE = 0.042;
const GRID_SIZE = 72;
const GRID_HEIGHT = 60;
const CENTER = (GRID_SIZE - 1) / 2;
/** 山体（基壇の上から火口の縁まで）の高さと、裾野・火口の半径 */
const MOUNT_HEIGHT = 50;
const FOOT_RADIUS = 27;
const RIM_RADIUS = 9.5;
/** 骨盤の高さに相当するグリッド上の段（ここを原点にすると山の裾が地面に接する） */
const PELVIS_LEVEL = 19;
/** 宝珠の下端を、頭の原点から何段上に浮かせるか */
const JEWEL_FLOAT = 25;

const PLINTH_DARK = 0x4a4f57;
const PLINTH_LIGHT = 0x8a9099;
const GOLD = 0xffd43b;
const GOLD_DARK = 0xb8860b;
const VERMILION = 0xd9321f;
const VERMILION_DARK = 0x8f1d12;
const LAVA_DEEP = 0xff2200;
const LAVA_HOT = 0xffe066;
const LAVA_CORE = 0xfff3b0;
const SNOW = 0xffffff;
const SNOW_SHADE = 0xcfe0f5;
const FOREST_DARK = 0x143627;
const FOREST_LIGHT = 0x2d6a4f;
const ROCK_DARK = 0x24262c;
const ROPE_LIGHT = 0xd8b45a;
const ROPE_DARK = 0xa17f36;

function mix(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 富士山らしく裾へ向かって広がる凹曲線の、高さ割合 t における半径 */
function profileRadius(t: number): number {
  return RIM_RADIUS + (FOOT_RADIUS - RIM_RADIUS) * Math.pow(1 - t, 1.5);
}

/** 火口から流れ下る 8 本の溶岩流の中心線からの距離（弧長）。流れの外なら Infinity */
function lavaOffset(theta: number, t: number, dist: number): number {
  let best = Infinity;
  for (let k = 0; k < 8; k++) {
    if (t < 0.08 + 0.06 * (k % 3)) continue;
    const center = (k * Math.PI) / 4 + t * 1.1 + 0.18 * Math.sin(t * 14 + k);
    best = Math.min(best, Math.abs(wrapAngle(theta - center)) * dist);
  }
  return best;
}

const ROAD_START = 0.06;
const ROAD_END = 0.66;
const ROAD_TURNS = 2;

function roadAngle(t: number): number {
  return ((t - ROAD_START) / (ROAD_END - ROAD_START)) * ROAD_TURNS * Math.PI * 2;
}

function isSnow(theta: number, t: number): boolean {
  return t > 0.62 + 0.06 * Math.sin(theta * 5) + 0.03 * Math.sin(theta * 13);
}

function teamRock(team: Team): readonly [number, number, number] {
  if (team === 0) return [0x7a1f20, 0xba181b, 0xe5383b];
  if (team === 1) return [0x172c6b, 0x1d4ed8, 0x3b82f6];
  if (team === 2) return [0x7a350c, 0xd97706, 0xf59e0b];
  return [0x054a37, 0x059669, 0x10b981];
}

/** 三段の石の基壇（金の縁取り付き） */
function carvePlinth(g: VoxelGrid): void {
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const d = Math.hypot(x - CENTER, z - CENTER);
      if (d > 34.5) continue;
      const trim = Math.abs(d - 33.8) < 0.7;
      g.set(x, 0, z, trim ? GOLD : (x + z) % 4 === 0 ? PLINTH_LIGHT : PLINTH_DARK);
      if (d <= 31.5) g.set(x, 1, z, Math.abs(d - 30.8) < 0.7 ? GOLD_DARK : PLINTH_LIGHT);
    }
  }
}

/** 山体本体: 尾根の起伏・地層・雪冠・溶岩流の溝・金の参道 */
function carveMountain(g: VoxelGrid, team: Team): void {
  const rock = teamRock(team);
  for (let y = 2; y <= MOUNT_HEIGHT; y++) {
    const t = (y - 2) / (MOUNT_HEIGHT - 2);
    const baseR = profileRadius(t);
    const stratum = rock[Math.floor(y / 3) % 3];
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const dx = x - CENTER;
        const dz = z - CENTER;
        const d = Math.hypot(dx, dz);
        if (d > baseR + 4) continue;
        const theta = Math.atan2(dz, dx);
        const fade = 1 - t * 0.7;
        const ridge = Math.sin(theta * 9 + y * 0.09);
        let r = baseR + fade * (1.3 * ridge + 0.6 * Math.sin(theta * 23 - y * 0.17));

        const lava = lavaOffset(theta, t, d);
        const lavaWidth = 0.9 + (1 - t) * 1.4;
        const inLava = lava < lavaWidth;
        if (inLava) r -= 1;

        const onRoadBand = t >= ROAD_START && t <= ROAD_END;
        let roadArc = Infinity;
        if (onRoadBand) {
          const a = roadAngle(t);
          roadArc = Math.abs(wrapAngle(theta - a)) * d;
          if (roadArc < 2.2 && !inLava) r += 1;
        }

        if (d > r) continue;
        // 表層だけ色分けする（内部は見えない）
        if (d < r - 2.5) {
          g.set(x, y, z, ROCK_DARK);
          continue;
        }

        let color: number;
        if (inLava) {
          const core = lava < 0.5;
          color = core ? LAVA_CORE : mix(LAVA_DEEP, LAVA_HOT, Math.pow(t, 0.7) + (hash(x, y, z) - 0.5) * 0.25);
        } else if (roadArc < 2.2) {
          color = roadArc > 1.5 ? GOLD : (x + y + z) % 3 === 0 ? PLINTH_LIGHT : 0xe7d9a8;
        } else if (t < 0.12) {
          color = hash(x, y, z) > 0.5 ? FOREST_DARK : FOREST_LIGHT;
        } else if (isSnow(theta, t)) {
          color = ridge < -0.2 ? SNOW_SHADE : hash(x, y, z) > 0.8 ? SNOW_SHADE : SNOW;
        } else {
          // 地層の縞と尾根の陰影
          color = mix(stratum, ROCK_DARK, ridge < -0.35 ? 0.55 : hash(x, y, z) * 0.25);
        }
        g.set(x, y, z, color);
      }
    }
  }
}

/** 山頂: 溶岩の湖をたたえた火口と、八葉の黄金の冠 */
function carveSummit(g: VoxelGrid): void {
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const dx = x - CENTER;
      const dz = z - CENTER;
      const d = Math.hypot(dx, dz);
      if (d > RIM_RADIUS + 3) continue;
      // すり鉢状に掘り、底を溶岩で満たす
      for (let y = MOUNT_HEIGHT - 6; y <= MOUNT_HEIGHT; y++) {
        const openR = RIM_RADIUS - 2.4 + (y - (MOUNT_HEIGHT - 6)) * 0.28;
        if (d >= openR) continue;
        if (y === MOUNT_HEIGHT - 6) g.set(x, y, z, d < 1.8 ? LAVA_CORE : d < 3 ? LAVA_HOT : LAVA_DEEP);
        else g.set(x, y, z, 0);
      }
      if (d < RIM_RADIUS - 1 || d > RIM_RADIUS + 1.6) continue;
      const theta = Math.atan2(dz, dx);
      const crest = 1 + 5 * Math.pow(Math.abs(Math.cos(theta * 4)), 3);
      for (let i = 1; i <= crest; i++) {
        const tip = i > crest - 1;
        g.set(x, MOUNT_HEIGHT + i, z, tip ? 0xff2a55 : i % 2 === 0 ? GOLD : GOLD_DARK);
      }
    }
  }
}

/** 山の腰を一周する注連縄と、そこから垂れる紙垂 */
function carveShimenawa(g: VoxelGrid): void {
  const y0 = 23;
  const ropeR = profileRadius((y0 - 2) / (MOUNT_HEIGHT - 2)) + 1.8;
  const steps = 900;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const cx = CENTER + Math.cos(a) * ropeR;
    const cz = CENTER + Math.sin(a) * ropeR;
    const twist = Math.sin(a * 36) > 0;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        for (let oz = -2; oz <= 2; oz++) {
          if (ox * ox + oy * oy + oz * oz > 3.2) continue;
          g.set(Math.round(cx + ox), y0 + oy, Math.round(cz + oz), twist ? ROPE_LIGHT : ROPE_DARK);
        }
      }
    }
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (let i = 0; i < 9; i++) {
      const y = y0 - 3 - i;
      const r = profileRadius((y - 2) / (MOUNT_HEIGHT - 2)) + 3.0;
      // 雷のようなジグザグに折る
      const side = Math.floor(i / 2) % 2 === 0 ? 0 : 1.4;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      for (let w = -1; w <= 1; w++) {
        const x = CENTER + Math.cos(a) * r + tx * (side + w * 0.9);
        const z = CENTER + Math.sin(a) * r + tz * (side + w * 0.9);
        g.set(Math.round(x), y, Math.round(z), SNOW);
      }
    }
  }
}

/** 地面から見た表層の高さ（最も高い非空ボクセルの段）を返す */
function topAt(g: VoxelGrid, x: number, z: number): number {
  for (let y = GRID_HEIGHT - 1; y >= 0; y--) {
    if (g.get(x, y, z) !== 0) return y;
  }
  return -1;
}

/** 参道に沿って並ぶ石灯籠 */
function placeLanterns(g: VoxelGrid): void {
  const count = 24;
  for (let i = 0; i < count; i++) {
    const t = ROAD_START + ((i + 0.5) / count) * (ROAD_END - ROAD_START);
    const a = roadAngle(t);
    const r = profileRadius(t) + 1.5;
    const x = Math.round(CENTER + Math.cos(a) * r);
    const z = Math.round(CENTER + Math.sin(a) * r);
    const y = topAt(g, x, z);
    if (y < 0) continue;
    g.set(x, y + 1, z, PLINTH_LIGHT);
    g.set(x, y + 2, z, LAVA_HOT);
    g.set(x, y + 3, z, PLINTH_DARK);
  }
}

/** 裾野の樹海に針葉樹を植える */
function plantForest(g: VoxelGrid): void {
  const count = 140;
  for (let i = 0; i < count; i++) {
    const a = hash(i, 11, 3) * Math.PI * 2;
    const r = 20 + hash(i, 7, 29) * 7;
    const x = Math.round(CENTER + Math.cos(a) * r);
    const z = Math.round(CENTER + Math.sin(a) * r);
    const base = topAt(g, x, z);
    if (base < 2 || base > 9) continue;
    if (g.get(x, base, z) !== FOREST_DARK && g.get(x, base, z) !== FOREST_LIGHT) continue;
    const h = 3 + Math.floor(hash(i, 2, 17) * 3);
    for (let j = 1; j <= h; j++) {
      const leaf = j % 2 === 0 ? FOREST_LIGHT : FOREST_DARK;
      g.set(x, base + j, z, leaf);
      if (j <= h - 1) {
        g.set(x + 1, base + j, z, leaf);
        g.set(x - 1, base + j, z, leaf);
        g.set(x, base + j, z + 1, leaf);
        g.set(x, base + j, z - 1, leaf);
      }
    }
  }
}

/** 四方の参道口に立つ朱塗りの大鳥居 */
function placeTorii(g: VoxelGrid): void {
  for (let dir = 0; dir < 4; dir++) {
    const cos = Math.round(Math.cos((dir * Math.PI) / 2));
    const sin = Math.round(Math.sin((dir * Math.PI) / 2));
    const radial = 31;
    // u: 接線方向, v: 放射方向
    const put = (u: number, y: number, v: number, c: number): void => {
      const rx = radial + v;
      const x = Math.round(CENTER + cos * rx - sin * u);
      const z = Math.round(CENTER + sin * rx + cos * u);
      g.set(x, y, z, c);
    };
    const top = 18;
    for (const side of [-7, 7]) {
      for (let y = 2; y <= top - 2; y++) {
        for (let u = 0; u <= 1; u++) {
          for (let v = 0; v <= 1; v++) put(side + u, y, v, y <= 3 ? ROCK_DARK : VERMILION);
        }
      }
    }
    // 貫（下の横木）
    for (let u = -9; u <= 10; u++) {
      put(u, top - 5, 0, VERMILION_DARK);
      put(u, top - 5, 1, VERMILION_DARK);
    }
    // 島木と笠木（反り上がる黒い最上段）
    for (let u = -11; u <= 12; u++) {
      const off = Math.abs(u - 0.5);
      const lift = off > 10 ? 2 : off > 8 ? 1 : 0;
      for (let v = -1; v <= 2; v++) {
        put(u, top - 1 + lift, v, VERMILION);
        put(u, top + lift, v, ROCK_DARK);
      }
    }
    // 額束（中央の金の扁額）
    for (let y = top - 4; y <= top - 2; y++) {
      for (let u = 0; u <= 1; u++) {
        put(u, y, 0, GOLD);
        put(u, y, 1, GOLD_DARK);
      }
    }
  }
}

/** 強化形態の胴体（山全体）を生成する */
export function buildAwakenedMountain(team: Team): AwakenedPartSpec {
  const g = new VoxelGrid(GRID_SIZE, GRID_HEIGHT, GRID_SIZE);
  carvePlinth(g);
  carveMountain(g, team);
  carveSummit(g);
  carveShimenawa(g);
  placeLanterns(g);
  plantForest(g);
  placeTorii(g);
  return { grid: g, voxelSize: VOXEL_SIZE, pivot: [CENTER + 0.5, PELVIS_LEVEL, CENTER + 0.5] };
}

/** 強化形態の頭（火口の上に浮かぶ神火の宝珠と蓮座・光背）を生成する */
export function buildAwakenedJewel(): AwakenedPartSpec {
  const size = 27;
  const height = 27;
  const c = (size - 1) / 2;
  const g = new VoxelGrid(size, height, size);

  // 先端の尖った宝珠
  const jewelBase = 3;
  const jewelH = 20;
  for (let y = 0; y < jewelH; y++) {
    const t = y / (jewelH - 1);
    const r = 7.2 * Math.sin(Math.PI * Math.pow(t, 0.72)) + 0.4;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, z - c);
        if (d > r) continue;
        const swirl = Math.sin(Math.atan2(z - c, x - c) * 3 + t * 9) > 0.55;
        const body = t < 0.5 ? mix(LAVA_DEEP, GOLD, t * 2) : mix(GOLD, SNOW, (t - 0.5) * 2);
        g.set(x, jewelBase + y, z, swirl ? mix(body, SNOW, 0.6) : body);
      }
    }
  }

  // 八弁の蓮座
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, z - c);
      const theta = Math.atan2(z - c, x - c);
      const petal = 8.2 + 2.6 * Math.abs(Math.cos(theta * 4));
      if (d <= petal) g.set(x, 2, z, d > petal - 1.3 ? 0xff2a55 : GOLD);
      if (d <= petal - 2.4) g.set(x, 3, z, GOLD_DARK);
    }
  }

  // 光背（宝珠を背後から囲む金の輪）
  const haloY = jewelBase + jewelH * 0.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - haloY);
      if (d < 11 || d > 12.6) continue;
      const a = Math.atan2(y - haloY, x - c);
      g.set(x, y, Math.round(c), Math.sin(a * 12) > 0.3 ? 0xff7700 : GOLD);
    }
  }

  return { grid: g, voxelSize: VOXEL_SIZE, pivot: [c + 0.5, -JEWEL_FLOAT, c + 0.5] };
}
