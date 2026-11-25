import { B } from '../openworld/OpenWorldConfig';
import type { VoxelWorld } from '../openworld/VoxelWorld';
import { makeRng } from '../openworld/WorldGen';
import { TAG_AREA_SWAPS, TAG_GROUND } from './TagConfig';

/**
 * 鬼ごっこの町の「入れ替わる区画」（手続き生成）。
 * 岐阜の町の市街地を大通りで 3 × 3 の区画に分け、毎回いくつかの区画を別の景色（森・湖・遺跡・雪原・荒野・田んぼ・神社）に作り替える。
 * 区画のまわりの大通りは残すので、どこからでも入れる。金華山にかかる区画は入れ替えない。
 * 同じ種なら同じ町になる（オンラインの全員が同じ町を作る）。Three.js に依存しない。
 */

/** 地面の表面のブロックの高さ（この上に立つ） */
const SURF = TAG_GROUND - 1;

export type TagAreaKind = 'forest' | 'lake' | 'ruins' | 'snow' | 'wasteland' | 'paddy' | 'shrine';

/** 景色の名前（ミニマップと開始時の知らせに出す） */
export const TAG_AREA_NAMES: Readonly<Record<TagAreaKind, string>> = {
  forest: '森',
  lake: '湖',
  ruins: '遺跡',
  snow: '雪原',
  wasteland: '荒野',
  paddy: '田んぼ',
  shrine: '神社',
};

const AREA_KINDS = Object.keys(TAG_AREA_NAMES) as TagAreaKind[];

/** 区画の列（x の範囲。大通りと大通りのあいだ）と行（z の範囲。東西の通りのあいだ） */
const AREA_COLS: readonly [number, number][] = [
  [20, 59],
  [66, 97],
  [104, 175],
];
const AREA_ROWS: readonly [number, number][] = [
  [31, 53],
  [57, 83],
  [87, 141],
];
/** 入れ替えない区画（金華山と岐阜城）[列, 行] */
const FIXED_AREAS: readonly [number, number][] = [
  [2, 0],
  [2, 1],
];

export interface TagArea {
  kind: TagAreaKind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 入れ替えられる区画の一覧（[x0, x1, z0, z1]、両端を含む） */
export function swappableAreas(): { x0: number; x1: number; z0: number; z1: number }[] {
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  AREA_ROWS.forEach(([z0, z1], row) => {
    AREA_COLS.forEach(([x0, x1], col) => {
      if (FIXED_AREAS.some(([c, r]) => c === col && r === row)) return;
      out.push({ x0, x1, z0, z1 });
    });
  });
  return out;
}

/** 種から、どの区画をどの景色にするか決める（区画も景色も重ならない） */
export function chooseAreas(variant: number): TagArea[] {
  const rng = makeRng(variant * 2654435761 + 97);
  const spots = swappableAreas();
  const kinds = [...AREA_KINDS];
  const out: TagArea[] = [];
  for (let k = 0; k < TAG_AREA_SWAPS && spots.length > 0 && kinds.length > 0; k++) {
    const spot = spots.splice(Math.floor(rng() * spots.length), 1)[0];
    const kind = kinds.splice(Math.floor(rng() * kinds.length), 1)[0];
    out.push({ kind, ...spot });
  }
  return out;
}

/** 書き込み係（はみ出しは無視。山の上は書き換えない） */
class Painter {
  constructor(
    readonly w: VoxelWorld,
    readonly area: TagArea,
    private readonly keep: (x: number, z: number) => boolean,
  ) {}

  inside(x: number, z: number, margin = 0): boolean {
    const a = this.area;
    return x >= a.x0 + margin && x <= a.x1 - margin && z >= a.z0 + margin && z <= a.z1 - margin && !this.keep(x, z);
  }

  set(x: number, y: number, z: number, id: number): void {
    if (this.inside(x, z)) this.w.setRaw(x, y, z, id);
  }

  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id: number): void {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }

  /** 空いていれば置く（木の葉などが重なっても、先に置いた物を消さない） */
  soft(x: number, y: number, z: number, id: number): void {
    if (this.inside(x, z) && this.w.get(x, y, z) === B.AIR) this.w.setRaw(x, y, z, id);
  }

  /** そこに物を置いても通り道（十字の小道）をふさがないか */
  free(x: number, z: number, r = 0): boolean {
    const a = this.area;
    const cx = Math.floor((a.x0 + a.x1) / 2);
    const cz = Math.floor((a.z0 + a.z1) / 2);
    return Math.abs(x - cx) > 2 + r && Math.abs(z - cz) > 2 + r && this.inside(x, z, 2 + r);
  }
}

/**
 * 選んだ区画を作り替える。区画の中の古いナビ点と目印を消し、新しいナビ点と、景色の名前の目印を足す。
 * keep(x, z) が true の所（山）は触らない。
 */
export function applyAreas(
  world: VoxelWorld,
  areas: readonly TagArea[],
  nav: { x: number; z: number }[],
  landmarks: { name: string; x: number; z: number }[],
  keep: (x: number, z: number) => boolean,
  variant: number,
): void {
  const rng = makeRng(variant * 40503 + 7);
  for (const area of areas) {
    const p = new Painter(world, area, keep);
    const inArea = (x: number, z: number) => x >= area.x0 && x <= area.x1 && z >= area.z0 && z <= area.z1 && !keep(Math.floor(x), Math.floor(z));
    // 古い町を片付ける（地面より上を空にし、地面を均す）
    for (let z = area.z0; z <= area.z1; z++) {
      for (let x = area.x0; x <= area.x1; x++) {
        if (keep(x, z)) continue;
        for (let y = TAG_GROUND; y < world.sizeY; y++) world.setRaw(x, y, z, B.AIR);
        world.setRaw(x, SURF - 1, z, B.DIRT);
        world.setRaw(x, SURF, z, B.GRASS);
      }
    }
    for (let k = nav.length - 1; k >= 0; k--) if (inArea(nav[k].x, nav[k].z)) nav.splice(k, 1);
    for (let k = landmarks.length - 1; k >= 0; k--) if (inArea(landmarks[k].x, landmarks[k].z)) landmarks.splice(k, 1);
    BUILDERS[area.kind](p, rng);
    // 十字の小道（どの景色でも、区画の四方の大通りどうしを結ぶ）
    crossPath(p, PATH_BLOCK[area.kind]);
    // ナビ点: 4 m おきの、立てる所（足もとが水でなく、頭の上まで空いている）
    for (let z = area.z0 + 1; z <= area.z1 - 1; z += 4) {
      for (let x = area.x0 + 1; x <= area.x1 - 1; x += 4) {
        if (keep(x, z)) continue;
        const floor = world.get(x, SURF, z);
        if (floor === B.WATER || floor === B.AIR) continue;
        if (world.solidAt(x, TAG_GROUND, z) || world.solidAt(x, TAG_GROUND + 1, z)) continue;
        nav.push({ x: x + 0.5, z: z + 0.5 });
      }
    }
    landmarks.push({ name: TAG_AREA_NAMES[area.kind], x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 });
  }
}

/** 景色ごとの小道のブロック */
const PATH_BLOCK: Readonly<Record<TagAreaKind, number>> = {
  forest: B.DIRT,
  lake: B.PLANK,
  ruins: B.TILE,
  snow: B.SNOW,
  wasteland: B.DIRT,
  paddy: B.DIRT,
  shrine: B.TILE,
};

/** 区画の真ん中を通る、幅 3 の十字の小道（上の物はどける。水の上は橋になる） */
function crossPath(p: Painter, block: number): void {
  const a = p.area;
  const cx = Math.floor((a.x0 + a.x1) / 2);
  const cz = Math.floor((a.z0 + a.z1) / 2);
  const lay = (x: number, z: number) => {
    if (!p.inside(x, z)) return;
    p.set(x, SURF, z, block);
    for (let y = TAG_GROUND; y < TAG_GROUND + 4; y++) p.set(x, y, z, B.AIR);
  };
  for (let x = a.x0; x <= a.x1; x++) for (let dz = -1; dz <= 1; dz++) lay(x, cz + dz);
  for (let z = a.z0; z <= a.z1; z++) for (let dx = -1; dx <= 1; dx++) lay(cx + dx, z);
}

type Rng = () => number;
const ri = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** 広葉樹（幹と葉の塊） */
function tree(p: Painter, x: number, z: number, trunk: number): void {
  const y = TAG_GROUND;
  p.fill(x, x, y, y + trunk - 1, z, z, B.WOOD);
  const cy = y + trunk;
  for (let dy = 0; dy <= 2; dy++) {
    const r = dy === 2 ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1) continue;
      p.soft(x + dx, cy + dy, z + dz, B.LEAVES);
    }
  }
}

/** 針葉樹（細長い三角。雪が積もる） */
function pine(p: Painter, x: number, z: number, height: number, snow: boolean): void {
  const y = TAG_GROUND;
  p.fill(x, x, y, y + height - 1, z, z, B.WOOD);
  for (let k = 0; k < height - 1; k++) {
    const r = Math.max(0, Math.floor((height - 1 - k) / 2));
    const yy = y + 2 + k;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
      p.soft(x + dx, yy, z + dz, snow && k % 2 === 1 ? B.SNOW : B.LEAVES);
    }
  }
  p.soft(x, y + height + 1, z, snow ? B.SNOW : B.LEAVES);
}

/** 区画の中を一定の間隔（ゆらぎつき）でたどり、置けそうな所で fn を呼ぶ */
function scatter(p: Painter, rng: Rng, step: number, chance: number, r: number, fn: (x: number, z: number) => void): void {
  const a = p.area;
  for (let z = a.z0 + 2; z <= a.z1 - 2; z += step) {
    for (let x = a.x0 + 2; x <= a.x1 - 2; x += step) {
      if (rng() > chance) continue;
      const tx = x + ri(rng, -1, 1);
      const tz = z + ri(rng, -1, 1);
      if (p.free(tx, tz, r)) fn(tx, tz);
    }
  }
}

/** 景色ごとの作り方 */
const BUILDERS: Readonly<Record<TagAreaKind, (p: Painter, rng: Rng) => void>> = {
  /** 森: 木がびっしり。茂みと切り株。隠れやすいが、見通しが悪い */
  forest(p, rng) {
    const a = p.area;
    for (let z = a.z0; z <= a.z1; z++) for (let x = a.x0; x <= a.x1; x++) if (rng() < 0.12) p.set(x, SURF, z, B.DIRT);
    scatter(p, rng, 5, 0.75, 1, (x, z) => tree(p, x, z, ri(rng, 3, 5)));
    scatter(p, rng, 4, 0.35, 0, (x, z) => {
      p.soft(x, TAG_GROUND, z, B.LEAVES);
      if (rng() < 0.5) p.soft(x + 1, TAG_GROUND, z, B.LEAVES);
    });
    scatter(p, rng, 9, 0.3, 0, (x, z) => p.soft(x, TAG_GROUND, z, B.WOOD));
  },

  /** 湖: 浅い水（ゆっくりしか進めない）と砂浜、木の橋と小島 */
  lake(p, rng) {
    const a = p.area;
    const cx = (a.x0 + a.x1) / 2;
    const cz = (a.z0 + a.z1) / 2;
    const rx = (a.x1 - a.x0) / 2 - 3;
    const rz = (a.z1 - a.z0) / 2 - 3;
    for (let z = a.z0; z <= a.z1; z++) {
      for (let x = a.x0; x <= a.x1; x++) {
        const d = Math.hypot((x - cx) / rx, (z - cz) / rz) + Math.sin(x * 0.4) * Math.cos(z * 0.3) * 0.08;
        if (d < 1) {
          p.set(x, SURF - 1, z, B.SAND);
          p.set(x, SURF, z, B.WATER);
        } else if (d < 1.18) {
          p.set(x, SURF, z, B.SAND);
        }
      }
    }
    // 小島（木が 1 本）
    for (let k = 0; k < 2; k++) {
      const ix = Math.round(cx + (k === 0 ? -1 : 1) * rx * 0.5);
      const iz = Math.round(cz + (k === 0 ? 1 : -1) * rz * 0.45);
      p.fill(ix - 2, ix + 2, SURF, SURF, iz - 2, iz + 2, B.GRASS);
      tree(p, ix, iz, 3);
    }
    // 岸の木
    scatter(p, rng, 6, 0.5, 1, (x, z) => {
      if (p.w.get(x, SURF, z) === B.GRASS) tree(p, x, z, ri(rng, 3, 4));
    });
  },

  /** 遺跡: 崩れた石の壁と柱、倒れた柱、真ん中の石畳の広場 */
  ruins(p, rng) {
    const a = p.area;
    for (let z = a.z0; z <= a.z1; z++) for (let x = a.x0; x <= a.x1; x++) if (rng() < 0.35) p.set(x, SURF, z, B.STONE);
    const cx = Math.floor((a.x0 + a.x1) / 2);
    const cz = Math.floor((a.z0 + a.z1) / 2);
    p.fill(cx - 6, cx + 6, SURF, SURF, cz - 6, cz + 6, B.TILE);
    // 広場のまわりの柱
    for (const [dx, dz] of [
      [-6, -6],
      [6, -6],
      [-6, 6],
      [6, 6],
    ]) {
      p.fill(cx + dx, cx + dx, TAG_GROUND, TAG_GROUND + ri(rng, 3, 6), cz + dz, cz + dz, B.STONE);
    }
    // 崩れた壁（ところどころ欠けて、高さもまちまち）
    scatter(p, rng, 8, 0.7, 1, (x, z) => {
      const along = rng() < 0.5;
      const len = ri(rng, 4, 8);
      const wall = rng() < 0.5 ? B.STONE : B.BRICK;
      for (let k = 0; k < len; k++) {
        const wx = along ? x + k : x;
        const wz = along ? z : z + k;
        if (!p.free(wx, wz) || rng() < 0.2) continue;
        const h = ri(rng, 1, 4);
        p.fill(wx, wx, TAG_GROUND, TAG_GROUND + h - 1, wz, wz, wall);
      }
    });
    // 倒れた柱と、お宝の金のブロック
    scatter(p, rng, 11, 0.5, 1, (x, z) => {
      const along = rng() < 0.5;
      for (let k = 0; k < 5; k++) p.soft(along ? x + k : x, TAG_GROUND, along ? z : z + k, B.STONE);
    });
    scatter(p, rng, 13, 0.4, 0, (x, z) => p.soft(x, TAG_GROUND, z, B.GOLD));
  },

  /** 雪原: 雪の地面と雪をかぶった針葉樹、雪の山、かまくら、凍った池 */
  snow(p, rng) {
    const a = p.area;
    for (let z = a.z0; z <= a.z1; z++) for (let x = a.x0; x <= a.x1; x++) p.set(x, SURF, z, B.SNOW);
    scatter(p, rng, 6, 0.6, 1, (x, z) => pine(p, x, z, ri(rng, 4, 6), true));
    // 雪の山（ぽこぽこした低い丘）
    scatter(p, rng, 7, 0.4, 1, (x, z) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) p.soft(x + dx, TAG_GROUND, z + dz, B.SNOW);
      p.soft(x, TAG_GROUND + 1, z, B.SNOW);
    });
    // かまくら（中に入れる）
    scatter(p, rng, 14, 0.5, 3, (x, z) => {
      for (let dy = 0; dy <= 2; dy++) {
        const r = dy === 2 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const shell = Math.abs(dx) === r || Math.abs(dz) === r || dy === 2;
          if (shell) p.soft(x + dx, TAG_GROUND + dy, z + dz, B.SNOW);
        }
      }
      // 入り口
      p.set(x, TAG_GROUND, z + 2, B.AIR);
      p.set(x, TAG_GROUND + 1, z + 2, B.AIR);
    });
    // 凍った池（すべらないが、氷の上は見通しがよい）
    const fx = ri(rng, a.x0 + 4, a.x1 - 10);
    const fz = ri(rng, a.z0 + 4, a.z1 - 8);
    for (let z = fz; z < fz + 6; z++) for (let x = fx; x < fx + 8; x++) if (p.free(x, z, -2)) p.set(x, SURF, z, B.GLASS);
  },

  /** 荒野: 砂の地面と、段々のメサ（登れる）、サボテン、岩 */
  wasteland(p, rng) {
    const a = p.area;
    for (let z = a.z0; z <= a.z1; z++) for (let x = a.x0; x <= a.x1; x++) p.set(x, SURF, z, rng() < 0.2 ? B.DIRT : B.SAND);
    // メサ（下ほど広い段々の台地。1 段ずつ登れる）
    scatter(p, rng, 13, 0.75, 4, (x, z) => {
      const h = ri(rng, 3, 7);
      const r0 = ri(rng, 3, 5);
      for (let k = 0; k < h; k++) {
        const r = Math.max(1, r0 - Math.floor(k / 2));
        const id = k % 3 === 2 ? B.SAND : B.STONE;
        p.fill(x - r, x + r, TAG_GROUND + k, TAG_GROUND + k, z - r + 1, z + r - 1, id);
      }
    });
    // サボテン
    scatter(p, rng, 5, 0.3, 0, (x, z) => {
      const h = ri(rng, 2, 4);
      p.fill(x, x, TAG_GROUND, TAG_GROUND + h - 1, z, z, B.LEAVES);
      if (h >= 3) p.soft(x + 1, TAG_GROUND + 1, z, B.LEAVES);
    });
    scatter(p, rng, 6, 0.3, 0, (x, z) => p.soft(x, TAG_GROUND, z, B.STONE));
  },

  /** 田んぼ: 水を張った田（ゆっくりしか進めない）とあぜ道、農家とかかし */
  paddy(p, rng) {
    const a = p.area;
    for (let z = a.z0 + 1; z <= a.z1 - 1; z++) {
      for (let x = a.x0 + 1; x <= a.x1 - 1; x++) {
        // 7 × 6 の田を、幅 1 のあぜ道で区切る
        const ridge = (x - a.x0) % 8 === 0 || (z - a.z0) % 7 === 0;
        if (ridge) {
          p.set(x, SURF, z, B.DIRT);
        } else {
          p.set(x, SURF - 1, z, B.DIRT);
          p.set(x, SURF, z, B.WATER);
        }
      }
    }
    // 稲（田のところどころに、背の低い緑）
    scatter(p, rng, 3, 0.25, 0, (x, z) => {
      if (p.w.get(x, SURF, z) === B.WATER) p.soft(x, TAG_GROUND, z, B.LEAVES);
    });
    // 農家（板の壁と赤い屋根。入り口つき）
    scatter(p, rng, 18, 0.6, 4, (x, z) => {
      p.fill(x - 3, x + 3, SURF, SURF, z - 2, z + 2, B.DIRT);
      for (let y = TAG_GROUND; y < TAG_GROUND + 3; y++) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -3; dx <= 3; dx++) {
          const edge = Math.abs(dx) === 3 || Math.abs(dz) === 2;
          if (edge) p.set(x + dx, y, z + dz, B.PLANK);
        }
      }
      p.set(x, TAG_GROUND, z + 2, B.AIR);
      p.set(x, TAG_GROUND + 1, z + 2, B.AIR);
      for (let k = 0; k < 3; k++) p.fill(x - 3, x + 3, TAG_GROUND + 3 + k, TAG_GROUND + 3 + k, z - 2 + k, z + 2 - k, B.ROOF_RED);
    });
    // かかし
    scatter(p, rng, 12, 0.5, 1, (x, z) => {
      p.fill(x, x, TAG_GROUND, TAG_GROUND + 2, z, z, B.WOOD);
      p.soft(x - 1, TAG_GROUND + 1, z, B.PLANK);
      p.soft(x + 1, TAG_GROUND + 1, z, B.PLANK);
      p.soft(x, TAG_GROUND + 3, z, B.PLASTER);
    });
  },

  /** 神社: 石畳の参道と赤い鳥居、拝殿、石灯籠、鎮守の森 */
  shrine(p, rng) {
    const a = p.area;
    const cx = Math.floor((a.x0 + a.x1) / 2);
    const cz = Math.floor((a.z0 + a.z1) / 2);
    // 鎮守の森（まわり）
    scatter(p, rng, 5, 0.6, 2, (x, z) => {
      if (Math.abs(x - cx) > 9 || Math.abs(z - cz) > 9) tree(p, x, z, ri(rng, 4, 6));
    });
    // 拝殿（北側。正面は南で開いている）
    const sz = cz - 6;
    p.fill(cx - 5, cx + 5, SURF, SURF, sz - 4, sz + 3, B.TILE);
    for (let y = TAG_GROUND; y < TAG_GROUND + 4; y++) {
      for (let z = sz - 3; z <= sz + 2; z++) for (let x = cx - 4; x <= cx + 4; x++) {
        const edge = Math.abs(x - cx) === 4 || z === sz - 3;
        if (edge) p.set(x, y, z, B.WOOD);
      }
    }
    for (let k = 0; k < 3; k++) p.fill(cx - 5 + k, cx + 5 - k, TAG_GROUND + 4 + k, TAG_GROUND + 4 + k, sz - 4, sz + 3, B.ROOF);
    // 鳥居（参道の上。くぐれる）
    for (const tz of [cz + 4, a.z1 - 4]) {
      if (!p.inside(cx, tz)) continue;
      for (const tx of [cx - 3, cx + 3]) p.fill(tx, tx, TAG_GROUND, TAG_GROUND + 4, tz, tz, B.ROOF_RED);
      p.fill(cx - 4, cx + 4, TAG_GROUND + 5, TAG_GROUND + 5, tz, tz, B.ROOF_RED);
      p.fill(cx - 3, cx + 3, TAG_GROUND + 3, TAG_GROUND + 3, tz, tz, B.ROOF_RED);
    }
    // 石灯籠（参道の両脇）
    for (let z = cz + 1; z <= a.z1 - 3; z += 5) {
      for (const lx of [cx - 3, cx + 3]) {
        if (!p.inside(lx, z)) continue;
        p.fill(lx, lx, TAG_GROUND, TAG_GROUND + 1, z, z, B.STONE);
        p.set(lx, TAG_GROUND + 2, z, B.LAMP);
      }
    }
  },
};
