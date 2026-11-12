import { fieldRng, randInt, randRange, pick } from './FieldRng';
import { VOXEL, type PropKind, type PropPlacement } from './FieldTypes';

/**
 * 地物のボクセル形状を乱数で組み立てる（§6.3）。
 * 座標はボクセル単位の整数。x・z はおおむね 0 を中心に、y は地面（0）から上へ。
 */

export type PropMaterial = 'wood' | 'leaf' | 'stone' | 'ice' | 'hay' | 'metal' | 'plant' | 'snow';

export interface VoxelDef {
  x: number;
  y: number;
  z: number;
  /** 色（0xRRGGBB） */
  c: number;
}

/** 壊す単位（区画） */
export interface SegmentDef {
  voxels: VoxelDef[];
  /** この区画を支えている区画の番号（空なら地面に立つ） */
  supports: number[];
  /** 残っている支えがこの数を下回ると落ちる */
  supportNeed: number;
  hp: number;
  material: PropMaterial;
  flammable: boolean;
  /** 壊れると爆発する（爆発樽） */
  explosive?: boolean;
  /** 壊すと宝箱が出る（古戦場の宝の山） */
  treasure?: boolean;
  /** 落ちるときの動き: 倒れる（木・柱）／真下に落ちる（屋根） */
  fall: 'tip' | 'drop';
}

export interface PropModel {
  kind: PropKind;
  segments: SegmentDef[];
}

/** ワールド座標に置いた区画の箱（AABB、m） */
export interface WorldBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

class Builder {
  readonly segments: SegmentDef[] = [];
  constructor(readonly rng: () => number) {}

  seg(def: Omit<SegmentDef, 'voxels' | 'supports' | 'supportNeed' | 'fall'> & Partial<Pick<SegmentDef, 'supports' | 'supportNeed' | 'fall'>>): SegmentDef {
    const s: SegmentDef = {
      voxels: [],
      supports: def.supports ?? [],
      supportNeed: def.supportNeed ?? 1,
      fall: def.fall ?? 'tip',
      hp: def.hp,
      material: def.material,
      flammable: def.flammable,
      explosive: def.explosive,
      treasure: def.treasure,
    };
    this.segments.push(s);
    return s;
  }

  /** 直方体を詰める（max は含まない） */
  box(s: SegmentDef, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: (x: number, y: number, z: number) => number): void {
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) s.voxels.push({ x, y, z, c: color(x, y, z) });
  }

  /** 楕円体の塊（rough で縁をランダムに欠く） */
  blob(s: SegmentDef, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rough: number, color: (x: number, y: number, z: number) => number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
          if (d > 1) continue;
          if (d > 0.55 && this.rng() < rough) continue;
          if (y < 0) continue;
          s.voxels.push({ x, y, z, c: color(x, y, z) });
        }
      }
    }
  }
}

/** 色をわずかに揺らす */
function jitter(rng: () => number, base: number, amount = 0.08): number {
  const k = 1 + (rng() - 0.5) * 2 * amount;
  const r = Math.min(255, Math.max(0, Math.round(((base >> 16) & 0xff) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((base >> 8) & 0xff) * k)));
  const b = Math.min(255, Math.max(0, Math.round((base & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

const WOOD = 0x7a4f2a;
const WOOD_DARK = 0x5b3a1f;
const LEAF = [0x3f8a3a, 0x4d9a3e, 0x357a35];
const PINE_LEAF = 0x2f6b43;
const STONE = 0x8a8f96;
const SAND_STONE = 0xc9a76b;
const OBSIDIAN = 0x2b2237;
const ICE = 0xa9e4f5;
const SNOW = 0xf4f8fb;
const HAY = 0xd9b54a;
const METAL = 0x5c6670;
const ROOF = [0xa8442f, 0x8a5a2b, 0x456d8a];
const WALL_WOOD = [0xc9a679, 0xb48a5a, 0xd8c39a];
const WALL_STONE = [0x9aa0a6, 0xb0a99a];
const MARBLE = 0xe8e4da;
/** 城壁の耐久力（実質壊れない） */
const CASTLE_BLOCK_HP = 1e9;

export function buildProp(kind: PropKind, seed: number): PropModel {
  const rng = fieldRng(seed);
  const b = new Builder(rng);
  const j = (c: number, a = 0.08) => () => jitter(rng, c, a);
  switch (kind) {
    case 'bush': {
      const s = b.seg({ hp: 40, material: 'plant', flammable: true });
      const col = pick(rng, LEAF);
      b.blob(s, 0, 1, 0, randRange(rng, 1.4, 2), randRange(rng, 1, 1.4), randRange(rng, 1.4, 2), 0.4, j(col, 0.12));
      break;
    }
    case 'haybale': {
      const s = b.seg({ hp: 40, material: 'hay', flammable: true });
      b.box(s, -1, 0, -1, 1, 2, 1, j(HAY, 0.1));
      break;
    }
    case 'tree_small': {
      const h = randInt(rng, 3, 6);
      const trunk = b.seg({ hp: 120, material: 'wood', flammable: true });
      b.box(trunk, 0, 0, 0, 1, h, 1, j(WOOD));
      const leaves = b.seg({ hp: 120, material: 'leaf', flammable: true, supports: [0] });
      const col = pick(rng, LEAF);
      const blobs = randInt(rng, 1, 3);
      for (let i = 0; i < blobs; i++) {
        b.blob(leaves, 0.5 + randRange(rng, -1, 1), h + 1 + randRange(rng, 0, 1.5), 0.5 + randRange(rng, -1, 1), randRange(rng, 1.6, 2.4), randRange(rng, 1.3, 2), randRange(rng, 1.6, 2.4), 0.35, j(col, 0.1));
      }
      dedupe(leaves);
      break;
    }
    case 'tree_big': {
      const low = randInt(rng, 3, 4);
      const up = randInt(rng, 3, 5);
      const t0 = b.seg({ hp: 250, material: 'wood', flammable: true });
      b.box(t0, -1, 0, -1, 1, low, 1, j(WOOD_DARK));
      const t1 = b.seg({ hp: 250, material: 'wood', flammable: true, supports: [0] });
      b.box(t1, -1, low, -1, 1, low + up, 1, j(WOOD));
      const leaves = b.seg({ hp: 250, material: 'leaf', flammable: true, supports: [1] });
      const col = pick(rng, LEAF);
      const top = low + up;
      b.blob(leaves, 0, top + 1.5, 0, randRange(rng, 3, 3.8), randRange(rng, 2.2, 3), randRange(rng, 3, 3.8), 0.3, j(col, 0.1));
      for (let i = 0; i < 2; i++) {
        b.blob(leaves, randRange(rng, -2, 2), top + randRange(rng, 0.5, 2.5), randRange(rng, -2, 2), 2, 1.6, 2, 0.4, j(col, 0.12));
      }
      dedupe(leaves);
      void t1;
      break;
    }
    case 'pine': {
      const h = randInt(rng, 2, 3);
      const trunk = b.seg({ hp: 120, material: 'wood', flammable: true });
      b.box(trunk, 0, 0, 0, 1, h + 2, 1, j(WOOD_DARK));
      const leaves = b.seg({ hp: 120, material: 'leaf', flammable: true, supports: [0] });
      const layers = randInt(rng, 3, 4);
      for (let l = 0; l < layers; l++) {
        const r = layers - l + 0.6;
        const y = h + l * 2;
        b.blob(leaves, 0.5, y + 0.6, 0.5, r, 1.1, r, 0.25, (_x, yy) => (yy >= y + 1 && rng() < 0.45 ? jitter(rng, SNOW, 0.03) : jitter(rng, PINE_LEAF, 0.1)));
      }
      dedupe(leaves);
      break;
    }
    case 'dead_tree': {
      const h = randInt(rng, 4, 7);
      const trunk = b.seg({ hp: 120, material: 'wood', flammable: true });
      b.box(trunk, 0, 0, 0, 1, Math.ceil(h / 2), 1, j(0x5a4a3a));
      const top = b.seg({ hp: 100, material: 'wood', flammable: true, supports: [0] });
      b.box(top, 0, Math.ceil(h / 2), 0, 1, h, 1, j(0x6a5a48));
      const arms = randInt(rng, 1, 3);
      for (let i = 0; i < arms; i++) {
        const y = randInt(rng, Math.ceil(h / 2), h - 1);
        const dir = pick(rng, [[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
        for (let k = 1; k <= randInt(rng, 1, 2); k++) top.voxels.push({ x: dir[0] * k, y: y + (k > 1 ? 1 : 0), z: dir[1] * k, c: jitter(rng, 0x6a5a48) });
      }
      break;
    }
    case 'log': {
      const s = b.seg({ hp: 120, material: 'wood', flammable: true });
      const len = randInt(rng, 5, 7);
      b.box(s, -Math.floor(len / 2), 0, 0, Math.ceil(len / 2), 1, 1, j(WOOD));
      break;
    }
    case 'cactus': {
      const s = b.seg({ hp: 80, material: 'plant', flammable: false });
      const h = randInt(rng, 3, 5);
      b.box(s, 0, 0, 0, 1, h, 1, j(0x4f8a3a));
      if (rng() < 0.7) {
        const y = randInt(rng, 1, h - 2);
        s.voxels.push({ x: 1, y, z: 0, c: 0x4f8a3a }, { x: 2, y, z: 0, c: 0x4f8a3a }, { x: 2, y: y + 1, z: 0, c: 0x4f8a3a });
      }
      if (rng() < 0.5) {
        const y = randInt(rng, 1, h - 2);
        s.voxels.push({ x: -1, y, z: 0, c: 0x4a8236 }, { x: -1, y: y + 1, z: 0, c: 0x4a8236 });
      }
      break;
    }
    case 'rock_small': {
      const s = b.seg({ hp: 200, material: 'stone', flammable: false });
      b.blob(s, 0, 0.8, 0, randRange(rng, 1.2, 1.8), randRange(rng, 0.9, 1.3), randRange(rng, 1.2, 1.8), 0.3, j(STONE, 0.1));
      break;
    }
    case 'rock_mid': {
      const lower = b.seg({ hp: 400, material: 'stone', flammable: false });
      const upper = b.seg({ hp: 400, material: 'stone', flammable: false, supports: [0], fall: 'drop' });
      const rx = randRange(rng, 2.2, 3);
      const ry = randRange(rng, 2, 2.8);
      const rz = randRange(rng, 2.2, 3);
      const tmp = b.seg({ hp: 1, material: 'stone', flammable: false });
      b.blob(tmp, 0, 1.4, 0, rx, ry, rz, 0.3, j(STONE, 0.1));
      b.segments.pop();
      for (const v of tmp.voxels) (v.y < 2 ? lower : upper).voxels.push(v);
      break;
    }
    case 'rock_pillar':
    case 'ruin_pillar':
    case 'obsidian':
    case 'sanctum_pillar': {
      const col = kind === 'rock_pillar' ? STONE : kind === 'ruin_pillar' ? SAND_STONE : kind === 'obsidian' ? OBSIDIAN : MARBLE;
      const h = kind === 'sanctum_pillar' ? 12 : randInt(rng, 6, 9);
      const third = Math.ceil(h / 3);
      const w = kind === 'obsidian' ? 1 : 2;
      for (let k = 0; k < 3; k++) {
        const s = b.seg({ hp: 600, material: 'stone', flammable: false, supports: k === 0 ? [] : [k - 1] });
        const y0 = k * third;
        const y1 = Math.min(h, (k + 1) * third);
        // ruin_pillar は上が崩れて欠けている
        const broken = kind === 'ruin_pillar' && k === 2;
        for (let y = y0; y < y1; y++) for (let z = -1; z < w - 1 + (w === 1 ? 1 : 0); z++) for (let x = -1; x < w - 1 + (w === 1 ? 1 : 0); x++) {
          if (broken && y > y0 && rng() < 0.4) continue;
          s.voxels.push({ x, y, z, c: jitter(rng, col, kind === 'obsidian' ? 0.15 : 0.06) });
        }
        if (kind === 'sanctum_pillar' && k === 0) b.box(s, -2, 0, -2, 2, 1, 2, j(MARBLE, 0.04));
        if (kind === 'sanctum_pillar' && k === 2) b.box(s, -2, y1, -2, 2, y1 + 1, 2, j(MARBLE, 0.04));
        if (s.voxels.length === 0) b.segments.pop();
      }
      break;
    }
    case 'ice_block': {
      const s = b.seg({ hp: 250, material: 'ice', flammable: false });
      b.blob(s, 0, 1.4, 0, randRange(rng, 1.4, 2), randRange(rng, 1.4, 2.2), randRange(rng, 1.4, 2), 0.2, j(ICE, 0.06));
      break;
    }
    case 'snowman': {
      const base = b.seg({ hp: 60, material: 'snow', flammable: false });
      b.blob(base, 0, 1, 0, 1.3, 1.1, 1.3, 0.1, j(SNOW, 0.02));
      const head = b.seg({ hp: 60, material: 'snow', flammable: false, supports: [0] });
      b.blob(head, 0, 2.8, 0, 0.9, 0.8, 0.9, 0.05, j(SNOW, 0.02));
      head.voxels.push({ x: 0, y: 3, z: 1, c: 0xf08c2a });
      break;
    }
    case 'fence':
    case 'rail': {
      const stone = kind === 'rail';
      const s = b.seg({ hp: stone ? 160 : 60, material: stone ? 'stone' : 'wood', flammable: !stone });
      const len = stone ? 2 : 6;
      for (let x = -len / 2; x < len / 2; x++) {
        const post = x === -len / 2 || x === len / 2 - 1 || x === 0;
        s.voxels.push({ x, y: 0, z: 0, c: jitter(rng, stone ? STONE : WOOD) });
        if (post || stone) s.voxels.push({ x, y: 1, z: 0, c: jitter(rng, stone ? STONE : WOOD_DARK) });
        else s.voxels.push({ x, y: 1, z: 0, c: jitter(rng, WOOD) });
      }
      break;
    }
    case 'barrel':
    case 'barrel_explosive': {
      const explosive = kind === 'barrel_explosive';
      const s = b.seg({ hp: explosive ? 30 : 60, material: 'wood', flammable: true, explosive });
      const col = explosive ? 0xc0392b : WOOD;
      b.box(s, -1, 0, -1, 1, 2, 1, (_x, y) => (y === 1 && explosive ? 0xf1c40f : jitter(rng, col, 0.06)));
      break;
    }
    case 'cart': {
      const bed = b.seg({ hp: 60, material: 'wood', flammable: true });
      b.box(bed, -2, 1, -1, 2, 2, 2, j(WOOD));
      bed.voxels.push({ x: -2, y: 0, z: -2, c: 0x333333 }, { x: 1, y: 0, z: -2, c: 0x333333 }, { x: -2, y: 0, z: 2, c: 0x333333 }, { x: 1, y: 0, z: 2, c: 0x333333 });
      const load = b.seg({ hp: 60, material: 'hay', flammable: true, supports: [0], fall: 'drop' });
      b.box(load, -1, 2, -1, 2, 3, 2, j(HAY, 0.1));
      break;
    }
    case 'lamp': {
      const s = b.seg({ hp: 60, material: 'metal', flammable: false });
      b.box(s, 0, 0, 0, 1, 6, 1, j(METAL, 0.04));
      s.voxels.push({ x: 0, y: 6, z: 0, c: 0xffe08a });
      break;
    }
    case 'house_wood':
    case 'house_stone':
    case 'shack': {
      buildHouse(b, kind, rng);
      break;
    }
    case 'wall_stone': {
      const len = 8;
      const s0 = b.seg({ hp: 500, material: 'stone', flammable: false });
      b.box(s0, -len / 2, 0, -1, len / 2, 4, 1, j(0x8d8a82, 0.06));
      const s1 = b.seg({ hp: 500, material: 'stone', flammable: false, supports: [0], fall: 'drop' });
      for (let x = -len / 2; x < len / 2; x++) {
        b.box(s1, x, 4, -1, x + 1, x % 2 === 0 ? 6 : 5, 1, j(0x9a968c, 0.06));
      }
      break;
    }
    case 'castle_block': {
      // 1m 四方・高さ 3m の石積み。seed の偶奇で胸壁（凸凹）を付け、並べると城壁になる
      const s = b.seg({ hp: CASTLE_BLOCK_HP, material: 'stone', flammable: false });
      b.box(s, -1, 0, -1, 1, 6, 1, j(0x8d8a82, 0.05));
      if (seed % 2 === 0) b.box(s, -1, 6, -1, 1, 7, 1, j(0x9a968c, 0.05));
      break;
    }
    case 'treasure': {
      const s = b.seg({ hp: 150, material: 'metal', flammable: false, treasure: true });
      b.blob(s, 0, 0.8, 0, 1.6, 1, 1.6, 0.3, () => (rng() < 0.25 ? 0xf5c542 : jitter(rng, METAL, 0.2)));
      s.voxels.push({ x: 0, y: 2, z: 0, c: 0xc0c7cf }, { x: 0, y: 3, z: 0, c: 0xc0c7cf });
      break;
    }
  }
  return { kind, segments: b.segments.filter((s) => s.voxels.length > 0) };
}

function buildHouse(b: Builder, kind: 'house_wood' | 'house_stone' | 'shack', rng: () => number): void {
  const stone = kind === 'house_stone';
  const small = kind === 'shack';
  const w = small ? 3 : randInt(rng, 3, 5); // 半幅（ボクセル）
  const d = small ? 3 : randInt(rng, 3, 4);
  const floors = small ? 1 : rng() < 0.35 ? 2 : 1;
  const fh = 5;
  const wallCol = small ? 0x6e5a40 : stone ? pick(rng, WALL_STONE) : pick(rng, WALL_WOOD);
  const roofCol = small ? 0x4e3e2c : pick(rng, ROOF);
  const hp = stone ? 500 : 200;
  const mat = stone ? 'stone' : 'wood';
  const flam = !stone;
  const doorX = randInt(rng, -w + 1, w - 2);
  const wallIdx: number[][] = [];
  for (let f = 0; f < floors; f++) {
    const y0 = f * fh;
    const y1 = y0 + fh;
    const ids: number[] = [];
    const sup = (k: number) => (f === 0 ? [] : [wallIdx[f - 1][k]]);
    // 前後の壁（全幅）と左右の壁（内側の奥行き）
    const walls: [number, number, number, number][] = [
      [-w, w, -d, -d + 1],
      [-w, w, d - 1, d],
      [-w, -w + 1, -d + 1, d - 1],
      [w - 1, w, -d + 1, d - 1],
    ];
    walls.forEach((r, k) => {
      ids.push(b.segments.length);
      const s = b.seg({ hp, material: mat, flammable: flam, supports: sup(k) });
      for (let y = y0; y < y1; y++) for (let z = r[2]; z < r[3]; z++) for (let x = r[0]; x < r[1]; x++) {
        // ドア（1階の前面）と窓
        if (f === 0 && k === 0 && (x === doorX || x === doorX + 1) && y < 3) continue;
        const window = y === y0 + 2 && ((k < 2 && Math.abs(x) % 3 === 1 && x !== doorX && x !== doorX + 1) || (k >= 2 && Math.abs(z) % 3 === 1));
        if (window) {
          s.voxels.push({ x, y, z, c: 0x2c3e50 });
          continue;
        }
        const beam = !stone && (y === y0 || x === r[0] || x === r[1] - 1) && k < 2;
        s.voxels.push({ x, y, z, c: jitter(rng, beam ? WOOD_DARK : wallCol, 0.05) });
      }
    });
    wallIdx.push(ids);
  }
  // 屋根: 最上階の壁4面に支えられ、2面壊れると落ちる
  const top = floors * fh;
  const roof = b.seg({ hp, material: stone ? 'stone' : 'wood', flammable: true, supports: wallIdx[floors - 1], supportNeed: 3, fall: 'drop' });
  const gable = rng() < 0.7;
  if (gable) {
    for (let k = 0; k <= d; k++) {
      for (let x = -w - 1; x < w + 1; x++) {
        roof.voxels.push({ x, y: top + k, z: -d - 1 + k, c: jitter(rng, roofCol, 0.06) });
        if (d - k !== -d - 1 + k) roof.voxels.push({ x, y: top + k, z: d - k, c: jitter(rng, roofCol, 0.06) });
      }
    }
  } else {
    for (let z = -d - 1; z < d + 1; z++) for (let x = -w - 1; x < w + 1; x++) roof.voxels.push({ x, y: top, z, c: jitter(rng, roofCol, 0.06) });
  }
}

function dedupe(s: SegmentDef): void {
  const seen = new Set<string>();
  s.voxels = s.voxels.filter((v) => {
    const k = `${v.x},${v.y},${v.z}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 整数ボクセル座標を 90° 単位で回す */
export function rotateVoxel(x: number, z: number, rot: number): [number, number] {
  const cx = x + 0.5;
  const cz = z + 0.5;
  let rx = cx;
  let rz = cz;
  switch (rot & 3) {
    case 1:
      rx = -cz;
      rz = cx;
      break;
    case 2:
      rx = -cx;
      rz = -cz;
      break;
    case 3:
      rx = cz;
      rz = -cx;
      break;
  }
  return [rx - 0.5, rz - 0.5];
}

/** 区画の箱（ワールド座標） */
export function segmentWorldBox(seg: SegmentDef, place: Pick<PropPlacement, 'x' | 'z' | 'rot'>): WorldBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of seg.voxels) {
    const [rx, rz] = rotateVoxel(v.x, v.z, place.rot);
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx + 1);
    minZ = Math.min(minZ, rz);
    maxZ = Math.max(maxZ, rz + 1);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y + 1);
  }
  return {
    minX: place.x + minX * VOXEL,
    maxX: place.x + maxX * VOXEL,
    minY: minY * VOXEL,
    maxY: maxY * VOXEL,
    minZ: place.z + minZ * VOXEL,
    maxZ: place.z + maxZ * VOXEL,
  };
}

/** 歩行を妨げる高さ（これより低い所から始まる区画は通行の邪魔になる） */
export const BLOCKING_HEIGHT = 1.2;

/** 地物の通行を妨げる範囲（区画の箱のうち、低い所にあるもの） */
export function propBlockingBoxes(model: PropModel, place: Pick<PropPlacement, 'x' | 'z' | 'rot'>): WorldBox[] {
  return model.segments.map((s) => segmentWorldBox(s, place)).filter((bx) => bx.minY < BLOCKING_HEIGHT);
}
