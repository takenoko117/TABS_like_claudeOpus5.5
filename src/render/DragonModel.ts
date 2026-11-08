import { TEAM_COLORS, type Team } from '../units/UnitTypes';
import { VoxelGrid } from './VoxelModel';

/**
 * 西洋ドラゴン専用のボクセル造形モジュール。
 * 直方体の積み上げではなく、楕円体・テーパー付きチューブ・多角形膜を
 * ボクセル化して「頭・胴・首・尾・翼膜・後脚」を彫刻的に生成する。
 *
 * 座標系はすべて「ピボット原点からのボクセル単位（ボクセル中心）」で記述する。
 *   +X = 右, +Y = 上, +Z = 前（頭の向き）
 */

export interface DragonPartSpec {
  grid: VoxelGrid;
  voxelSize: number;
  pivot: readonly [number, number, number];
}

/** syncDragon が胴体ローカル座標（スケール 1 基準）で各部位を組み立てるためのリグ定数 */
export const DRAGON_RIG = {
  /** 首の付け根（胴体前方上部） */
  neckBase: [0, 0.15, 0.4] as const,
  /** 首の S 字カーブ制御点 */
  neckCtrl: [0, 0.46, 0.52] as const,
  /** 翼の付け根（肩） x は左右で符号反転 */
  shoulder: [0.19, 0.15, 0.24] as const,
  /** 後脚の股関節 */
  hip: [0.17, -0.04, -0.187] as const,
  knee: [0.2, -0.2, -0.06] as const,
  foot: [0.19, -0.42, -0.16] as const,
  /** 尾の付け根 */
  tailBase: [0, 0.01, -0.4] as const,
  /** 胴体を前後 2 パーツに分ける腰の位置（z, 骨盤基準）。ボクセル境界に合わせる */
  waistZ: -1 * 0.034,
  /** 前脚の付け根 x は左右で符号反転 */
  foreleg: [4.4 * 0.034, -2.6 * 0.034, 9.5 * 0.034] as const,
  /** 首・尾の 1 節テンプレートの長さ（ローカル単位） */
  segmentLength: 5 * 0.03,
  /** 翼テンプレートの骨の長さ（ローカル単位） */
  upperWingLength: 14 * 0.022,
  foreWingLength: 17 * 0.022,
  neckSegments: 5,
  tailSegments: 7,
};

// ---------------------------------------------------------------
// 色ユーティリティ
// ---------------------------------------------------------------

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) ^ Math.imul(Math.floor(y) | 0, 668265263) ^ Math.imul(Math.floor(z) | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

interface DragonPalette {
  scale: number;
  scaleMid: number;
  scaleDark: number;
  scaleLight: number;
  spine: number;
  belly: number;
  bellyDark: number;
  membrane: number;
  membraneDark: number;
  membraneLight: number;
  horn: number;
  hornMid: number;
  hornTip: number;
  claw: number;
  eye: number;
  eyeGlow: number;
  pupil: number;
  mouth: number;
  tongue: number;
  teeth: number;
  fire: number;
  fireCore: number;
}

function dragonPalette(team: Team): DragonPalette {
  const base = TEAM_COLORS[team].shirt;
  return {
    scale: base,
    scaleMid: shade(base, 0.8),
    scaleDark: shade(base, 0.55),
    scaleLight: mix(base, 0xffffff, 0.22),
    spine: shade(base, 0.42),
    belly: 0xe9cf98,
    bellyDark: 0xc49a5e,
    membrane: mix(shade(base, 0.62), 0x301810, 0.3),
    membraneDark: mix(shade(base, 0.4), 0x1a0c08, 0.4),
    membraneLight: mix(shade(base, 0.85), 0x301810, 0.15),
    horn: 0xf1e7cf,
    hornMid: 0xbfae8a,
    hornTip: 0x3a322c,
    claw: 0x1c1817,
    eye: 0xffd43b,
    eyeGlow: 0xfff7c2,
    pupil: 0x140a00,
    mouth: 0x5c0b0b,
    tongue: 0xb4232a,
    teeth: 0xfbf7ea,
    fire: 0xff7a18,
    fireCore: 0xffd166,
  };
}

/** 角・棘の根元→先端グラデーション */
function hornColor(p: DragonPalette) {
  return (t: number): number => (t < 0.45 ? p.horn : t < 0.78 ? p.hornMid : p.hornTip);
}

// ---------------------------------------------------------------
// ボクセル彫刻ヘルパー
// ---------------------------------------------------------------

type V3 = readonly [number, number, number];
type TubeColor = number | ((t: number, px: number, py: number, pz: number) => number);
type FieldColor = (px: number, py: number, pz: number) => number;

class Sculpt {
  readonly grid: VoxelGrid;

  constructor(
    sx: number,
    sy: number,
    sz: number,
    private readonly ox: number,
    private readonly oy: number,
    private readonly oz: number,
  ) {
    this.grid = new VoxelGrid(sx, sy, sz);
  }

  set(px: number, py: number, pz: number, c: number): void {
    this.grid.set(Math.floor(px + this.ox), Math.floor(py + this.oy), Math.floor(pz + this.oz), c);
  }

  get(px: number, py: number, pz: number): number {
    return this.grid.get(Math.floor(px + this.ox), Math.floor(py + this.oy), Math.floor(pz + this.oz));
  }

  /** 指定範囲（ピボット相対）のボクセル中心を走査する */
  private scan(min: V3, max: V3, fn: (px: number, py: number, pz: number, x: number, y: number, z: number) => void): void {
    const x0 = Math.max(0, Math.floor(min[0] + this.ox));
    const y0 = Math.max(0, Math.floor(min[1] + this.oy));
    const z0 = Math.max(0, Math.floor(min[2] + this.oz));
    const x1 = Math.min(this.grid.sx - 1, Math.ceil(max[0] + this.ox));
    const y1 = Math.min(this.grid.sy - 1, Math.ceil(max[1] + this.oy));
    const z1 = Math.min(this.grid.sz - 1, Math.ceil(max[2] + this.oz));
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          fn(x + 0.5 - this.ox, y + 0.5 - this.oy, z + 0.5 - this.oz, x, y, z);
        }
      }
    }
  }

  /** グリッド全体を走査し、関数が 0 以外を返したボクセルを塗る */
  fill(fn: FieldColor): void {
    this.scan([-1e3, -1e3, -1e3], [1e3, 1e3, 1e3], (px, py, pz, x, y, z) => {
      const c = fn(px, py, pz);
      if (c !== 0) this.grid.set(x, y, z, c);
    });
  }

  /** 既存ボクセルの色を塗り替える（0 を返すと変更なし） */
  recolor(fn: (px: number, py: number, pz: number, c: number) => number): void {
    this.scan([-1e3, -1e3, -1e3], [1e3, 1e3, 1e3], (px, py, pz, x, y, z) => {
      const c = this.grid.get(x, y, z);
      if (c === 0) return;
      const n = fn(px, py, pz, c);
      if (n !== 0) this.grid.set(x, y, z, n);
    });
  }

  ellipsoid(c: V3, r: V3, color: number | ((nx: number, ny: number, nz: number, px: number, py: number, pz: number) => number)): void {
    this.scan([c[0] - r[0], c[1] - r[1], c[2] - r[2]], [c[0] + r[0], c[1] + r[1], c[2] + r[2]], (px, py, pz, x, y, z) => {
      const nx = (px - c[0]) / r[0];
      const ny = (py - c[1]) / r[1];
      const nz = (pz - c[2]) / r[2];
      if (nx * nx + ny * ny + nz * nz > 1) return;
      this.grid.set(x, y, z, typeof color === 'number' ? color : color(nx, ny, nz, px, py, pz));
    });
  }

  /** a→b のテーパー付きチューブ（角・棘・爪・骨） */
  tube(a: V3, b: V3, r0: number, r1: number, color: TubeColor): void {
    const rm = Math.max(r0, r1) + 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dy * dy + dz * dz || 1e-6;
    this.scan(
      [Math.min(a[0], b[0]) - rm, Math.min(a[1], b[1]) - rm, Math.min(a[2], b[2]) - rm],
      [Math.max(a[0], b[0]) + rm, Math.max(a[1], b[1]) + rm, Math.max(a[2], b[2]) + rm],
      (px, py, pz, x, y, z) => {
        let t = ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const qx = px - (a[0] + dx * t);
        const qy = py - (a[1] + dy * t);
        const qz = pz - (a[2] + dz * t);
        const r = Math.max(0.5, r0 + (r1 - r0) * t);
        if (qx * qx + qy * qy + qz * qz > r * r) return;
        this.grid.set(x, y, z, typeof color === 'number' ? color : color(t, px, py, pz));
      },
    );
  }

  /** 折れ線に沿ったチューブ。color の t は全長に対する 0..1 */
  chain(points: readonly V3[], radii: readonly number[], color: TubeColor): void {
    const n = points.length - 1;
    for (let i = 0; i < n; i++) {
      this.tube(points[i], points[i + 1], radii[i], radii[i + 1], (t, px, py, pz) =>
        typeof color === 'number' ? color : color((i + t) / n, px, py, pz),
      );
    }
  }

  spec(voxelSize: number): DragonPartSpec {
    return { grid: this.grid, voxelSize, pivot: [this.ox, this.oy, this.oz] };
  }
}

/** 2D 多角形の内外判定（XZ 平面） */
function insidePolygon(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const mirror = (v: V3, sx: number): V3 => [v[0] * sx, v[1], v[2]];

// ---------------------------------------------------------------
// 頭部: 長い鼻面・開いた顎と牙・灼熱の喉・後方へ反り返る大角・頬角・顎のフリル
// ---------------------------------------------------------------

export function buildDragonHead(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(26, 28, 37, 13, 7, 10.5);
  const horn = hornColor(p);

  // 首との接合部
  S.ellipsoid([0, 2.4, -0.6], [4.5, 4.2, 4.0], (_nx, ny) => (ny < -0.3 ? p.belly : p.scale));

  // 頭蓋（後頭部）
  S.ellipsoid([0, 5, 4], [5.2, 4.6, 5.6], (_nx, ny, _nz, px, py, pz) => {
    if (ny > 0.55) return p.scaleDark;
    const h = hash3(px, py, pz);
    return h < 0.2 ? p.scaleMid : h > 0.88 ? p.scaleLight : p.scale;
  });

  // 上顎・鼻面（前方へテーパー）
  const snoutW = (pz: number) => 4.4 - 1.8 * ((pz - 5) / 15.5);
  const snoutTop = (pz: number) => 8.4 - 2.6 * ((pz - 5) / 15.5);
  const snoutBot = (pz: number) => 3.0 + 0.4 * Math.max(0, (pz - 5) / 15.5);
  S.fill((px, py, pz) => {
    if (pz < 5 || pz > 20.5) return 0;
    const w = snoutW(pz);
    const top = snoutTop(pz);
    if (Math.abs(px) > w || py < snoutBot(pz) || py > top) return 0;
    if (Math.abs(px) > w - 0.9 && py > top - 0.9) return 0; // 角を落として丸みを出す
    if (py > top - 1.2) return p.scaleDark;
    return hash3(px, py, pz) < 0.15 ? p.scaleMid : p.scale;
  });

  // 下顎（大きく開いた状態）
  const jawW = (pz: number) => 4.0 - 1.5 * ((pz - 2) / 16.5);
  const jawTop = (pz: number) => 2.4 - 3.0 * ((pz - 2) / 16.5);
  S.fill((px, py, pz) => {
    if (pz < 2 || pz > 18.5) return 0;
    const t = (pz - 2) / 16.5;
    const w = jawW(pz);
    const top = jawTop(pz);
    const bot = top - 2.4 + 0.4 * t;
    if (Math.abs(px) > w || py > top || py < bot) return 0;
    return py < bot + 1 && Math.abs(px) < w - 0.8 ? p.belly : p.scale;
  });

  // 口内: 上顎の天井と下顎の内側を暗赤色に、舌と喉奥の灼熱の炎
  S.recolor((px, py, pz) => {
    if (pz < 5 || pz > 20) return 0;
    if (py < snoutBot(pz) + 1 && py > 2.6 && Math.abs(px) < snoutW(pz) - 1) return p.mouth;
    return 0;
  });
  S.recolor((px, py, pz) => {
    if (pz < 3 || pz > 18) return 0;
    if (py > jawTop(pz) - 1 && py < 2.6 && Math.abs(px) < jawW(pz) - 1) return Math.abs(px) < 1.4 && pz < 15 ? p.tongue : p.mouth;
    return 0;
  });
  S.fill((px, py, pz) => {
    if (pz < 2.5 || pz > 6) return 0;
    const top = snoutBot(5) + 0.5;
    if (py < jawTop(pz) || py > top || Math.abs(px) > jawW(pz) - 1) return 0;
    return pz < 4.5 ? p.fireCore : p.fire;
  });

  // 牙（上顎の縁から下向き・下顎の縁から上向き、先端に大きな犬歯）
  for (let z = 7.5; z <= 19.5; z += 2) {
    for (const sx of [-1, 1]) {
      const x = sx * (snoutW(z) - 0.6);
      const bot = snoutBot(z);
      S.set(x, bot - 0.5, z, p.teeth);
      if (z > 16) S.set(x, bot - 1.5, z, p.teeth);
    }
  }
  for (let z = 6.5; z <= 17.5; z += 2) {
    for (const sx of [-1, 1]) {
      const x = sx * (jawW(z) - 0.6);
      const top = jawTop(z);
      S.set(x, top + 0.5, z, p.teeth);
      if (z > 15) S.set(x, top + 1.5, z, p.teeth);
    }
  }

  // 鼻孔と鼻先の小角
  const nz = 19.5;
  S.set(-1.4, snoutTop(nz) - 0.4, nz, 0x220808);
  S.set(1.4, snoutTop(nz) - 0.4, nz, 0x220808);
  S.tube([0, 6.8, 15.5], [0, 9.4, 18.2], 1.0, 0.25, horn);
  S.tube([0, 7.6, 11.5], [0, 9.0, 13.0], 0.8, 0.25, horn);

  // 眉骨（目の上に張り出して険しい表情を作る）
  for (const sx of [-1, 1]) {
    S.tube(mirror([2.6, 8.6, 11.5], sx), mirror([4.9, 8.9, 6.4], sx), 1.1, 1.4, p.scaleDark);
  }

  // 目: 側面の最外殻ボクセルを黄金の瞳＋縦長の瞳孔に塗り替える
  for (const sx of [-1, 1]) {
    for (let z = 7.5; z <= 10.5; z += 1) {
      for (let y = 5.5; y <= 7.5; y += 1) {
        for (let x = 12.5; x >= 0; x -= 1) {
          if (S.get(sx * x, y, z) !== 0) {
            const isPupil = z === 9.5 && y <= 6.5;
            const isGlow = z === 8.5 && y === 7.5;
            S.set(sx * x, y, z, isPupil ? p.pupil : isGlow ? p.eyeGlow : p.eye);
            break;
          }
        }
      }
    }
  }

  // 後方へ反り返り天を衝く 2 本の大角
  for (const sx of [-1, 1]) {
    S.chain(
      [
        mirror([3.0, 8.6, 3.5], sx),
        mirror([5.2, 11.0, -1.0], sx),
        mirror([7.0, 13.4, -5.0], sx),
        mirror([7.8, 16.2, -7.8], sx),
        mirror([7.3, 18.8, -8.8], sx),
      ],
      [2.0, 1.65, 1.25, 0.85, 0.35],
      horn,
    );
    // 頬から後方へ伸びる副角
    S.chain(
      [mirror([4.6, 5.6, 1.8], sx), mirror([6.8, 6.2, -3.2], sx), mirror([7.9, 7.4, -6.6], sx)],
      [1.3, 0.9, 0.35],
      horn,
    );
    // 顎のフリル棘
    S.tube(mirror([4.0, 1.2, 3.5], sx), mirror([6.6, -0.4, -1.0], sx), 1.0, 0.3, horn);
    S.tube(mirror([3.6, 0.0, 7.0], sx), mirror([5.8, -2.0, 4.0], sx), 0.85, 0.25, horn);
  }

  // 頭頂から後頭部へ続くトサカ状の棘列
  S.tube([0, 9.4, 3.0], [0, 12.2, -1.5], 1.1, 0.3, horn);
  S.tube([0, 8.6, -0.5], [0, 10.4, -5.0], 0.9, 0.25, horn);
  S.tube([0, 7.0, -2.5], [0, 8.0, -6.5], 0.8, 0.2, horn);

  return S.spec(0.019);
}

// ---------------------------------------------------------------
// 胴体: 厚い胸郭・蛇腹の腹鱗・背骨の棘列・翼の付け根の肩甲隆起・前脚と鉤爪
// ---------------------------------------------------------------

export function buildDragonBody(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(25, 24, 36, 12.5, 10, 15.5);
  const horn = hornColor(p);
  const zc = 0.6;
  const rz = 14.5;
  const profile = (t: number) => (t < 0 ? 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - t * t)) : Math.sqrt(Math.max(0, 1 - t * t * 0.85)));
  const centerY = (t: number) => Math.max(0, t) * 1.6 - 0.3 * (1 - Math.abs(t));

  S.fill((px, py, pz) => {
    const t = (pz - zc) / rz;
    if (t < -1 || t > 1) return 0;
    const pr = profile(t);
    const rx = 7.0 * pr;
    const dy = py - centerY(t);
    const ry = dy > 0 ? 5.9 * pr : 6.6 * pr;
    if ((px / rx) ** 2 + (dy / ry) ** 2 > 1) return 0;
    const ny = dy / ry;
    const h = hash3(px, py, pz);
    if (ny < -0.45 && Math.abs(px) < rx * 0.75) return Math.floor(pz + 100) % 3 === 0 ? p.bellyDark : p.belly;
    if (ny > 0.62) return Math.abs(px) < 1.1 ? p.spine : h < 0.3 ? p.scaleDark : p.scaleMid;
    return h < 0.16 ? p.scaleDark : h > 0.86 ? p.scaleLight : p.scale;
  });

  // 首の付け根を滑らかに盛り上げる
  S.ellipsoid([0, 3.0, 12.5], [3.8, 3.8, 3.4], (_nx, ny) => (ny < -0.4 ? p.belly : p.scale));

  // 翼の付け根の肩甲隆起と、後脚の太い腿の付け根
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([5.6, 3.9, 7.0], sx), [2.6, 2.4, 3.0], p.scaleDark);
    S.ellipsoid(mirror([5.0, -1.2, -5.5], sx), [2.8, 3.4, 3.8], p.scale);
  }

  // 背骨に沿って並ぶ棘（中央が最も高い）
  for (let z = -12; z <= 13; z += 2.5) {
    const t = (z - zc) / rz;
    const pr = profile(t);
    const top = centerY(t) + 5.9 * pr;
    const h = 1.6 + 3.4 * pr;
    S.tube([0, top - 1, z], [0, top + h, z - 2.2], 1.3 * pr + 0.4, 0.25, horn);
  }

  // 前脚の付け根（前脚本体は別メッシュでばたつかせる）
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([4.4, -2.6, 9.5], sx), [2.2, 2.2, 2.4], p.scale);
  }

  return S.spec(0.034);
}

/**
 * 胴体を腰（ピボット）で前半身（胸）と後半身（腰・尻）の 2 パーツに分割する。
 * 後半身には前半身の内部に隠れる「差し込み」部分を持たせ、腰を曲げても継ぎ目に隙間が出ないようにする。
 */
export function buildDragonBodyHalves(team: Team): { front: DragonPartSpec; rear: DragonPartSpec } {
  const full = buildDragonBody(team);
  const g = full.grid;
  const [ox, oy, oz] = full.pivot;
  const waistZ = DRAGON_RIG.waistZ / full.voxelSize; // 腰のボクセル境界（ピボット相対）
  const front = new VoxelGrid(g.sx, g.sy, g.sz);
  const rear = new VoxelGrid(g.sx, g.sy, g.sz);
  for (let z = 0; z < g.sz; z++) {
    const pz = z + 0.5 - oz;
    for (let y = 0; y < g.sy; y++) {
      for (let x = 0; x < g.sx; x++) {
        const c = g.get(x, y, z);
        if (c === 0) continue;
        if (pz > waistZ) {
          front.set(x, y, z, c);
          // 内部ボクセル（6 近傍がすべて埋まっている）だけを後半身の差し込みとして複製
          const interior =
            g.get(x + 1, y, z) && g.get(x - 1, y, z) && g.get(x, y + 1, z) && g.get(x, y - 1, z) && g.get(x, y, z + 1) && g.get(x, y, z - 1);
          if (pz < waistZ + 3 && interior) rear.set(x, y, z, c);
        } else {
          rear.set(x, y, z, c);
          if (pz > waistZ - 3) {
            const interior =
              g.get(x + 1, y, z) && g.get(x - 1, y, z) && g.get(x, y + 1, z) && g.get(x, y - 1, z) && g.get(x, y, z + 1) && g.get(x, y, z - 1);
            if (interior) front.set(x, y, z, c);
          }
        }
      }
    }
  }
  const pivot = [ox, oy, oz + waistZ] as const;
  return {
    front: { grid: front, voxelSize: full.voxelSize, pivot },
    rear: { grid: rear, voxelSize: full.voxelSize, pivot },
  };
}

/** 胸の下からばたつかせる前脚（付け根がピボット、+Y 上・+Z 前）。sx で左右を反転する */
export function buildDragonForeleg(team: Team, sx: number): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(9, 11, 10, 4.5, 9.5, 3.5);
  S.chain([[0, 0, 0], mirror([1.2, -3.6, 1.5], sx), mirror([0.6, -6.0, 3.1], sx)], [2.0, 1.5, 1.2], p.scale);
  S.ellipsoid(mirror([0.6, -6.1, 3.5], sx), [1.6, 0.9, 1.4], p.scaleDark);
  for (const dx of [-1.1, 0, 1.1]) {
    S.tube([sx * 0.6 + dx, -6.2, 3.3], [sx * 0.6 + dx * 1.4, -6.8, 5.9], 0.75, 0.3, p.claw);
  }
  return S.spec(0.034);
}

// ---------------------------------------------------------------
// 首・尾の 1 節（+Y 方向に伸び、-Z 側に棘・+Z 側に腹鱗）
// ---------------------------------------------------------------

export function buildDragonSegment(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(10, 9, 13, 5, 1, 6.5);
  S.tube([0, -0.5, 0], [0, 5.5, 0], 3.5, 3.2, (_t, px, py, pz) => {
    if (pz > 1.6 && Math.abs(px) < 2.6) return Math.floor(py + 10) % 2 === 0 ? p.belly : p.bellyDark;
    if (pz < -2.2) return p.scaleDark;
    return hash3(px, py, pz) < 0.18 ? p.scaleMid : p.scale;
  });
  // 根元側（-Y）へ寝かせた背棘
  S.tube([0, 4.0, -2.6], [0, 1.2, -6.0], 1.1, 0.25, hornColor(p));
  return S.spec(0.03);
}

/** 尾の先端: 西洋竜らしい矢じり形（スペード）の尾ビレ */
export function buildDragonTailTip(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(14, 14, 5, 7, 10, 2.5);
  S.tube([0, 3.5, 0], [0, -2.0, 0], 2.6, 1.6, p.scale);
  const spade: ReadonlyArray<readonly [number, number]> = [
    [0, 0.5],
    [5.2, -2.2],
    [1.4, -4.6],
    [0, -9.2],
    [-1.4, -4.6],
    [-5.2, -2.2],
  ];
  S.fill((px, py, pz) => {
    if (Math.abs(pz) > 1.1) return 0;
    if (!insidePolygon(px, py, spade)) return 0;
    if (Math.abs(px) < 0.6) return p.scaleDark;
    if (Math.abs(pz) > 0.6) return 0;
    return Math.abs(px) > 3.2 || py < -6.5 ? p.membraneDark : p.membrane;
  });
  return S.spec(0.03);
}

// ---------------------------------------------------------------
// 翼: 骨は +X 方向、翼膜は -Z（後方）へ広がる単層膜。上下対称に作って左右で共用する
// ---------------------------------------------------------------

export function buildDragonUpperWing(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(21, 5, 29, 2.5, 2.5, 23.5);
  const L = 14;
  const trail = (x: number) => 20 + 2 * (x / L) - 3.2 * Math.sin((Math.PI * x) / L);

  S.fill((px, py, pz) => {
    if (Math.abs(py) > 0.6 || px < 0.2 || px > L || pz > -0.5) return 0;
    const tr = trail(px);
    if (pz < -tr) return 0;
    if (pz < -tr + 1.5) return p.membraneDark; // 縁取り
    if (Math.floor(px + 100) % 4 === 0) return p.membraneDark; // 翼脈
    if (pz > -3.5) return p.membraneLight;
    return hash3(px, py, pz) < 0.1 ? p.membraneLight : p.membrane;
  });
  S.ellipsoid([0, 0, 0], [2.2, 2.0, 2.2], p.scale);
  S.tube([0, 0, 0], [L, 0, 0], 1.6, 1.25, p.scaleDark);
  S.ellipsoid([L, 0, 0], [2.0, 1.8, 2.0], p.scaleDark);
  // 肘の前方へ突き出す鉤棘
  S.tube([L + 0.5, 0, 1.0], [L + 2.8, 0, 4.2], 1.0, 0.25, p.claw);
  return S.spec(0.022);
}

export function buildDragonForeWing(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(37, 5, 30, 2.5, 2.5, 24.5);
  const W: V3 = [17, 0, 0];
  const tips: V3[] = [
    [31, 0, -3],
    [27, 0, -14],
    [19, 0, -22],
  ];
  // 指骨の間で内側へえぐれた（スカラップ状の）翼膜の輪郭
  const membrane: ReadonlyArray<readonly [number, number]> = [
    [0, 0.5],
    [17, 0.5],
    [31, -3],
    [25.4, -6],
    [27, -14],
    [21.2, -12.6],
    [19, -22],
    [9.5, -18],
    [0, -22],
  ];

  S.fill((px, py, pz) => {
    if (Math.abs(py) > 0.6) return 0;
    if (!insidePolygon(px, pz, membrane)) return 0;
    const d = Math.hypot(px - W[0], pz - W[2]);
    if (d > 17) return p.membraneDark;
    if (pz > -3) return p.membraneLight;
    return hash3(px, py, pz) < 0.1 ? p.membraneLight : p.membrane;
  });

  S.tube([0, 0, 0], W, 1.3, 1.05, p.scaleDark);
  S.ellipsoid(W, [1.7, 1.6, 1.7], p.scaleDark);
  // 手首の親指鉤爪
  S.tube([17.3, 0, 0.8], [18.8, 0, 4.2], 0.95, 0.25, p.claw);
  // 翼膜を張る長い指骨
  for (const tip of tips) {
    S.tube(W, tip, 1.0, 0.45, p.scaleDark);
  }
  S.tube(tips[0], [33, 0, -3.3], 0.6, 0.2, p.claw);
  return S.spec(0.022);
}

// ---------------------------------------------------------------
// 後脚: 筋肉質な腿と、蹴爪・3 本の鉤爪を備えた脛
// ---------------------------------------------------------------

export function buildDragonThigh(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(9, 10, 10, 4.5, 1.5, 5);
  S.ellipsoid([0, 3.2, 0.4], [2.6, 4.4, 3.3], (_nx, _ny, nz, px, py, pz) => {
    if (nz > 0.55) return p.scaleMid;
    return hash3(px, py, pz) < 0.18 ? p.scaleDark : p.scale;
  });
  S.ellipsoid([0, 7.0, 0.6], [1.9, 1.8, 2.0], p.scaleDark);
  return S.spec(0.03);
}

export function buildDragonShin(team: Team): DragonPartSpec {
  const p = dragonPalette(team);
  const S = new Sculpt(9, 13, 13, 4.5, 1.5, 5.5);
  S.tube([0, 0, 0], [0, 8, -0.4], 1.8, 1.2, p.scale);
  S.tube([0, 2.5, -1.4], [0, 0.5, -3.8], 0.8, 0.2, p.hornMid);
  S.ellipsoid([0, 8.4, 1.0], [2.3, 1.2, 2.4], p.scaleDark);
  for (const dx of [-1.5, 0, 1.5]) {
    S.tube([dx, 8.6, 2.2], [dx * 1.25, 9.6, 5.6], 0.85, 0.25, (t) => (t > 0.35 ? p.claw : p.scaleDark));
  }
  S.tube([0, 8.6, -1.0], [0, 9.6, -3.4], 0.7, 0.2, p.claw);
  return S.spec(0.03);
}
