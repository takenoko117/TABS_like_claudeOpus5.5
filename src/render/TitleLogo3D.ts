import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// ─────────────────────────────────────────────────────────────
// 形の定数
// ─────────────────────────────────────────────────────────────

/** カナどうしの間隔（ブロック数） */
const KANA_GAP = 2;
/** 英字どうしの間隔 */
const LATIN_GAP = 1;
/** 帯の左右の余白 */
const BANNER_PAD_X = 3;
/** リボンの垂れ（帯の左右に出る部分）の長さ */
const TAIL_LEN = 5;
/** 奥行きの層数（0 が最前面） */
const LAYER_COUNT = 7;
/** 左右の揺れ幅（ラジアン） */
const SWAY_YAW = 0.22;
const FOV = 20;

// ─────────────────────────────────────────────────────────────
// 演出の定数（秒）
// ─────────────────────────────────────────────────────────────

/** 文字が上から落ちてくる時間 */
const DROP_DUR = 0.55;
/** 縁や帯がふくらんで現れる時間 */
const POP_DUR = 0.32;
/** 光の筋が走る間隔 */
const GLINT_PERIOD = 4.6;
/** 光の筋が端から端まで走る時間 */
const GLINT_SWEEP = 0.95;
/** 光の筋の幅（ロゴ幅に対する割合） */
const GLINT_WIDTH = 0.07;

// ─────────────────────────────────────────────────────────────
// 文字の形（# がブロック）
// ─────────────────────────────────────────────────────────────

/** 12×12 の太いカナ。小書きの ッ・ォ は小さく作り、下寄せで置く */
const KANA: Record<string, readonly string[]> = {
  エ: [
    '............',
    '.##########.',
    '.##########.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '############',
    '############',
    '............',
  ],
  ク: [
    '....##......',
    '...#########',
    '..##########',
    '.##......##.',
    '##.......##.',
    '#.......##..',
    '........##..',
    '.......###..',
    '......###...',
    '....####....',
    '..####......',
    '..##........',
  ],
  ス: [
    '............',
    '.##########.',
    '.##########.',
    '.........##.',
    '........###.',
    '.......###..',
    '......###...',
    '.....#####..',
    '....###.###.',
    '..###....###',
    '.###......##',
    '##..........',
  ],
  ブ: [
    '..........#.#',
    '..........#.#',
    '##########...',
    '##########...',
    '........##...',
    '........##...',
    '.......##....',
    '......###....',
    '.....###.....',
    '...####......',
    '.####........',
    '##...........',
  ],
  ロ: [
    '............',
    '.##########.',
    '.##########.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##########.',
    '.##########.',
    '............',
  ],
  ッ: [
    '##..##..##',
    '##..##..##',
    '.##..##.##',
    '.......##.',
    '......###.',
    '.....###..',
    '..#####...',
    '.###......',
  ],
  ウ: [
    '.....##.....',
    '.....##.....',
    '.##########.',
    '.##########.',
    '.##......##.',
    '.##......##.',
    '.........##.',
    '........##..',
    '.......###..',
    '.....####...',
    '..#####.....',
    '.###........',
  ],
  ォ: [
    '......##.',
    '#########',
    '#########',
    '.....###.',
    '....####.',
    '...##.##.',
    '.##...##.',
    '##..####.',
    '....###..',
  ],
  ー: [
    '............',
    '............',
    '............',
    '............',
    '............',
    '############',
    '############',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
};
const KANA_HEIGHT = 12;

/** 5×5 の太い英字 */
const LATIN: Record<string, readonly string[]> = {
  E: ['#####', '##...', '####.', '##...', '#####'],
  X: ['##.##', '.###.', '..#..', '.###.', '##.##'],
  B: ['####.', '##.##', '####.', '##.##', '####.'],
  L: ['##...', '##...', '##...', '##...', '#####'],
  O: ['.###.', '##.##', '##.##', '##.##', '.###.'],
  C: ['.####', '##...', '##...', '##...', '.####'],
  K: ['##.##', '####.', '###..', '####.', '##.##'],
  S: ['.####', '##...', '.###.', '...##', '####.'],
  W: ['##.##', '##.##', '##.##', '#####', '##.##'],
  A: ['.###.', '##.##', '#####', '##.##', '##.##'],
  R: ['####.', '##.##', '####.', '##.##', '##.##'],
  ' ': ['..', '..', '..', '..', '..'],
};
const LATIN_HEIGHT = 5;

// ─────────────────────────────────────────────────────────────
// 色（sRGB の 16 進）
// ─────────────────────────────────────────────────────────────

type Tone = 'gold' | 'red' | 'white' | 'sun';

/** 面の色は上→中→下の 3 段グラデーション。側面と奥は暗い色 */
const TONES: Record<Tone, { grad: readonly [number, number, number]; side: readonly [number, number]; back: number }> = {
  gold: { grad: [0xfff6b0, 0xffcc1a, 0xff8a00], side: [0xe07a00, 0xa63a00], back: 0x5e1e00 },
  red: { grad: [0xffb8a3, 0xff4a2b, 0xc8101e], side: [0xc0261a, 0x7a0b12], back: 0x420610 },
  white: { grad: [0xffffff, 0xf1f4ff, 0xc7d3ff], side: [0x8d9cc9, 0x5d6a9a], back: 0x2c3360 },
  sun: { grad: [0xfff3a8, 0xffd23a, 0xffa600], side: [0xb86e00, 0x7a4100], back: 0x3d2100 },
};
const OUTLINE_FRONT = 0x2b1f57;
const OUTLINE_LIT = 0x5a46a8;
const OUTLINE_BACK = 0x150d2e;
const BANNER_GRAD: readonly [number, number, number] = [0x6aa8ff, 0x2f6ae6, 0x1c3fae];
const BANNER_TOP = 0xb8d8ff;
const BANNER_BOTTOM = 0x14286e;
const BANNER_SIDE = 0x17307f;
const BANNER_BACK = 0x0b1640;
const TAIL_FRONT: readonly [number, number] = [0x2550c4, 0x183488];
const TAIL_BACK = 0x0b1640;
const GEM_COLOR = 0xffc21a;

function channel(hex: number, shift: number): number {
  return (hex >> shift) & 0xff;
}

/** 2 色を t（0〜1）で混ぜる */
function mix(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round(channel(a, s) + (channel(b, s) - channel(a, s)) * k) << s;
  return out;
}

/** 明るさを f 倍する */
function scale(hex: number, f: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.min(255, Math.round(channel(hex, s) * f)) << s;
  return out;
}

function grad3(stops: readonly [number, number, number], t: number): number {
  return t < 0.45 ? mix(stops[0], stops[1], t / 0.45) : mix(stops[1], stops[2], (t - 0.45) / 0.55);
}

/** 位置から決まる 0〜1 の疑似乱数（毎回同じ形にするため） */
function hash01(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// ─────────────────────────────────────────────────────────────
// ロゴのボクセルを組み立てる（Three.js の描画とは独立）
// ─────────────────────────────────────────────────────────────

/** 部位。演出と色の塗り分けに使う */
export type LogoPart = 'title' | 'sub' | 'outline' | 'banner' | 'tail';

export interface LogoVoxel {
  x: number;
  y: number;
  z: number;
  color: number;
  part: LogoPart;
  /** 組み上げ演出で動き出すまでの秒数 */
  delay: number;
  /** 光の筋が走る最前面か */
  glint: boolean;
}

export interface LogoBuild {
  voxels: LogoVoxel[];
  width: number;
  height: number;
  /** 層の数（奥行き） */
  depth: number;
  /** 帯の中心の y と、帯の端の x（左右の飾りの位置に使う） */
  bannerY: number;
  bannerHalfWidth: number;
  /** 組み上げ演出が終わる秒数 */
  introEnd: number;
}

interface GlyphCell {
  col: number;
  row: number;
  index: number;
}

/** 文字列を 1 行分のマスにする。背の低い字は下寄せ（1 段浮かせる） */
function layoutLine(
  text: string,
  glyphs: Record<string, readonly string[]>,
  lineHeight: number,
  gap: number,
): { cells: GlyphCell[]; width: number } {
  const cells: GlyphCell[] = [];
  let cursor = 0;
  Array.from(text).forEach((ch, index) => {
    const glyph = glyphs[ch];
    const offset = glyph.length < lineHeight ? lineHeight - glyph.length - 1 : 0;
    glyph.forEach((line, row) => {
      Array.from(line).forEach((mark, col) => {
        if (mark === '#') cells.push({ col: cursor + col, row: row + offset, index });
      });
    });
    cursor += glyph[0].length + gap;
  });
  return { cells, width: cursor - gap };
}

const key2 = (c: number, r: number): string => `${c},${r}`;

/**
 * ロゴ全体のボクセルを、中心が原点に来るように並べて返す。
 * 構成: 太いカナ（金→ウォーだけ赤）＋濃い紫の縁取り、その下に青いリボン帯と白い英字。
 */
export function buildLogoVoxels(): LogoBuild {
  const title = layoutLine('エクスブロックスウォー', KANA, KANA_HEIGHT, KANA_GAP);
  const sub = layoutLine('EXBLOCKS WAR', LATIN, LATIN_HEIGHT, LATIN_GAP);
  const subChars = Array.from('EXBLOCKS WAR');
  const warStart = subChars.indexOf('W');

  // 帯は題字の縁取りのすぐ下（縁取り 2 段ぶん空ける）
  const bannerTop = KANA_HEIGHT + 2;
  const bannerBottom = bannerTop + LATIN_HEIGHT + 1;
  const subTop = bannerTop + 1;
  const subLeft = Math.floor((title.width - sub.width) / 2);
  const bannerLeft = subLeft - BANNER_PAD_X;
  const bannerRight = subLeft + sub.width - 1 + BANNER_PAD_X;
  const bannerMid = (bannerLeft + bannerRight) / 2;
  const bannerHalf = (bannerRight - bannerLeft) / 2;

  // マスごとの持ち主
  const titleCells = new Map<string, GlyphCell>();
  for (const c of title.cells) titleCells.set(key2(c.col, c.row), c);
  const subCells = new Map<string, GlyphCell>();
  for (const c of sub.cells) subCells.set(key2(c.col + subLeft, c.row + subTop), c);
  const bannerCells = new Set<string>();
  for (let r = bannerTop; r <= bannerBottom; r++) for (let c = bannerLeft; c <= bannerRight; c++) bannerCells.add(key2(c, r));
  // リボンの垂れ: 帯より 1 段下・奥にずらし、外側の端を V 字に切り欠く
  const tailCells = new Set<string>();
  const tailTop = bannerTop + 1;
  const tailBottom = bannerBottom + 1;
  const tailMid = (tailTop + tailBottom) / 2;
  for (const dir of [-1, 1]) {
    const edge = dir < 0 ? bannerLeft : bannerRight;
    for (let i = -1; i <= TAIL_LEN; i++) {
      const c = edge + dir * i;
      // 外から数えて何列目か（0 が最外）。外ほど深く切り欠く
      const fromOuter = TAIL_LEN - i;
      const notch = fromOuter <= 1 ? 2 - fromOuter : -1;
      for (let r = tailTop; r <= tailBottom; r++) {
        if (Math.abs(r - tailMid) <= notch) continue;
        if (i >= 1 || !bannerCells.has(key2(c, r))) tailCells.add(key2(c, r));
      }
    }
  }

  // 縁取り: 題字・帯・垂れを 1 マス太らせた外周
  const solid = new Set<string>([...titleCells.keys(), ...bannerCells, ...tailCells]);
  const outline = new Map<string, LogoPart>();
  const neighbors8 = [-1, 0, 1].flatMap((dc) => [-1, 0, 1].map((dr) => [dc, dr] as const)).filter(([dc, dr]) => dc || dr);
  for (const k of solid) {
    const [c, r] = k.split(',').map(Number);
    for (const [dc, dr] of neighbors8) {
      const nk = key2(c + dc, r + dr);
      if (solid.has(nk)) continue;
      // 隣に題字があれば題字の縁（最も手前まで）、なければ帯、垂れの順
      const owner: LogoPart = titleCells.has(k) ? 'title' : bannerCells.has(k) ? 'banner' : 'tail';
      const prev = outline.get(nk);
      const rank = (p: LogoPart | undefined): number => (p === 'title' ? 3 : p === 'banner' ? 2 : p === 'tail' ? 1 : 0);
      if (rank(owner) > rank(prev)) outline.set(nk, owner);
    }
  }

  // 範囲（中心合わせ用）
  const allKeys = [...solid, ...outline.keys()];
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const k of allKeys) {
    const [c, r] = k.split(',').map(Number);
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }
  const spanC = maxC - minC;
  const cx = (minC + maxC) / 2;
  const cy = (minR + maxR) / 2;
  const zMid = (LAYER_COUNT - 1) / 2;

  const raw: LogoVoxel[] = [];
  const push = (c: number, r: number, layer: number, color: number, part: LogoPart, delay: number, glint = false): void => {
    raw.push({ x: c - cx, y: cy - r, z: zMid - layer, color, part, delay, glint });
  };

  // 題字: 層 0〜3。面はグラデーション＋上の縁を明るく、下の縁を暗く（面取りの見え方）
  for (const cell of titleCells.values()) {
    const { col: c, row: r } = cell;
    const tone = TONES[cell.index >= 8 ? 'red' : 'gold'];
    const t = r / (KANA_HEIGHT - 1);
    let front = grad3(tone.grad, t);
    if (!titleCells.has(key2(c, r - 1))) front = mix(front, 0xffffff, 0.42);
    else if (!titleCells.has(key2(c, r + 1))) front = scale(front, 0.84);
    if (!titleCells.has(key2(c - 1, r)) && titleCells.has(key2(c, r - 1))) front = mix(front, 0xffffff, 0.1);
    const side = mix(tone.side[0], tone.side[1], t);
    const delay = 0.05 + cell.index * 0.075 + hash01(c, r) * 0.06;
    push(c, r, 0, front, 'title', delay, true);
    push(c, r, 1, side, 'title', delay);
    push(c, r, 2, scale(side, 0.82), 'title', delay);
    push(c, r, 3, tone.back, 'title', delay);
  }

  // 縁取り: 持ち主に合わせて奥行きを変える。上が空いた縁は明るい紫で光を受ける
  const titleWidth = Math.max(1, title.width - 1);
  for (const [k, owner] of outline) {
    const [c, r] = k.split(',').map(Number);
    const [from, to] = owner === 'title' ? [1, 5] : owner === 'banner' ? [2, 5] : [4, 6];
    const lit = !outline.has(key2(c, r - 1)) && !solid.has(key2(c, r - 1));
    const delay = owner === 'title' ? 0.3 + Math.min(1, Math.max(0, c / titleWidth)) * 0.7 : 0.9 + (Math.abs(c - bannerMid) / (bannerHalf + TAIL_LEN)) * 0.3;
    for (let layer = from; layer <= to; layer++) {
      const color = layer === from ? (lit ? OUTLINE_LIT : OUTLINE_FRONT) : layer === to ? OUTLINE_BACK : scale(OUTLINE_FRONT, 0.75);
      push(c, r, layer, color, 'outline', delay);
    }
  }

  // 帯と英字: 帯の面は層 1、英字は層 0 まで浮き出す
  for (const k of bannerCells) {
    const [c, r] = k.split(',').map(Number);
    const t = (r - bannerTop) / (bannerBottom - bannerTop);
    const delay = 0.85 + (Math.abs(c - bannerMid) / bannerHalf) * 0.3;
    const letter = subCells.get(k);
    if (letter) {
      const tone = TONES[letter.index >= warStart ? 'sun' : 'white'];
      const lt = (r - subTop) / (LATIN_HEIGHT - 1);
      let front = grad3(tone.grad, lt);
      if (!subCells.has(key2(c, r - 1))) front = mix(front, 0xffffff, 0.35);
      const ld = 1.15 + letter.index * 0.045;
      push(c, r, 0, front, 'sub', ld, true);
      push(c, r, 1, mix(tone.side[0], tone.side[1], lt), 'sub', ld);
    } else {
      const face = r === bannerTop ? BANNER_TOP : r === bannerBottom ? BANNER_BOTTOM : grad3(BANNER_GRAD, t);
      push(c, r, 1, face, 'banner', delay);
    }
    push(c, r, 2, BANNER_SIDE, 'banner', delay);
    push(c, r, 3, BANNER_SIDE, 'banner', delay);
    push(c, r, 4, BANNER_BACK, 'banner', delay);
  }
  for (const k of tailCells) {
    const [c, r] = k.split(',').map(Number);
    const t = (r - tailTop) / (tailBottom - tailTop);
    const delay = 1.1 + hash01(c, r) * 0.08;
    push(c, r, 4, mix(TAIL_FRONT[0], TAIL_FRONT[1], t), 'tail', delay);
    push(c, r, 5, TAIL_BACK, 'tail', delay);
  }

  // 前後左右上下をすべて埋められて見えないブロックは描かない
  const occupied = new Set(raw.map((v) => `${v.x},${v.y},${v.z}`));
  const hidden = (v: LogoVoxel): boolean =>
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].every(([dx, dy, dz]) => occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`));
  const voxels = raw.filter((v) => !hidden(v));

  const introEnd = Math.max(...voxels.map((v) => v.delay + (v.part === 'title' || v.part === 'sub' ? DROP_DUR : POP_DUR)));
  return {
    voxels,
    width: spanC + 1,
    height: maxR - minR + 1,
    depth: LAYER_COUNT,
    bannerY: cy - (bannerTop + bannerBottom) / 2,
    bannerHalfWidth: bannerHalf + TAIL_LEN + 1,
    introEnd,
  };
}

// ─────────────────────────────────────────────────────────────
// 描画
// ─────────────────────────────────────────────────────────────

/**
 * 角を面取りした立方体（1 辺 1）。平らな 6 面＋縁 12 面＋角 8 面で、
 * 縁に光が乗って「1 個ずつのブロック」に見える。頂点は面ごとに分けて平らな陰影にする
 */
function createBevelCube(bevel = 0.09): BufferGeometry {
  const a = 0.5;
  const c = 0.5 - bevel;
  const points: Vector3[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      for (const u of [-1, 1]) {
        for (const v of [-1, 1]) {
          const p = [0, 0, 0];
          p[axis] = s * a;
          p[(axis + 1) % 3] = u * c;
          p[(axis + 2) % 3] = v * c;
          points.push(new Vector3(p[0], p[1], p[2]));
        }
      }
    }
  }
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-6;
  const faces: Vector3[][] = [];
  // 平らな面
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) faces.push(points.filter((p) => near(p.getComponent(axis), s * a)));
  }
  // 縁
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          faces.push(
            points.filter(
              (p) =>
                (near(p.getComponent(i), si * a) && near(p.getComponent(j), sj * c)) ||
                (near(p.getComponent(i), si * c) && near(p.getComponent(j), sj * a)),
            ),
          );
        }
      }
    }
  }
  // 角
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        faces.push(points.filter((p) => Math.sign(p.x) === sx && Math.sign(p.y) === sy && Math.sign(p.z) === sz && near(p.lengthSq(), a * a + 2 * c * c)));
      }
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  for (const face of faces) {
    const center = face.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(face.length);
    const normal = center.clone().normalize();
    // 面の中心まわりの角度で並べ、法線に対して反時計回りの扇に分ける
    const u = face[0].clone().sub(center).normalize();
    const w = new Vector3().crossVectors(normal, u);
    const sorted = [...face].sort((p, q) => {
      const dp = p.clone().sub(center);
      const dq = q.clone().sub(center);
      return Math.atan2(dp.dot(w), dp.dot(u)) - Math.atan2(dq.dot(w), dq.dot(u));
    });
    for (let k = 1; k < sorted.length - 1; k++) {
      for (const p of [sorted[0], sorted[k], sorted[k + 1]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(normal.x, normal.y, normal.z);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return geometry;
}

/** ロゴの後ろに敷く、ふちがぼけた暗い楕円（背景の戦場から文字を浮かせる） */
function createBackdropTexture(): CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(128, 64);
  ctx.scale(2, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 62);
  g.addColorStop(0, 'rgba(10,6,24,0.62)');
  g.addColorStop(0.55, 'rgba(10,6,24,0.38)');
  g.addColorStop(1, 'rgba(10,6,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-64, -64, 128, 128);
  return new CanvasTexture(canvas);
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutBack = (t: number): number => {
  const k = 1.9;
  return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
};
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** タイトル画面のロゴ。背景の戦場とは別の canvas に描き、タイトルの間だけ動かす */
export class TitleLogo3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 1000);
  private readonly root = new Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly mesh: InstancedMesh;
  private readonly voxels: LogoVoxel[];
  private readonly baseColors: Float32Array;
  /** 光の筋が走るブロックの番号と、その横位置（0〜1） */
  private readonly glintIndex: number[] = [];
  private readonly glintPos: number[] = [];
  private readonly gems: Mesh[] = [];
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private readonly halfDepth: number;
  private readonly introEnd: number;
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private t = 0;
  private introT = 0;
  private introDone = false;
  private glintDirty = false;
  private cssW = 0;
  private cssH = 0;
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpPos = new Vector3();
  private readonly tmpScale = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);

    const build = buildLogoVoxels();
    this.voxels = build.voxels;
    this.introEnd = build.introEnd;
    this.halfWidth = build.width / 2;
    this.halfHeight = build.height / 2;
    this.halfDepth = build.depth / 2;

    // 光: 部屋の映り込み＋上からの暖かい主光（影を落とす）＋後ろからの青い縁取り光
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    this.scene.add(new HemisphereLight(0xfff2dc, 0x2a2350, 0.85));
    const key = new DirectionalLight(0xfff0d4, 2.3);
    key.position.set(-35, 75, 55);
    key.castShadow = true;
    const big = this.renderer.capabilities.maxTextureSize >= 4096;
    key.shadow.mapSize.set(big ? 4096 : 2048, big ? 1024 : 512);
    const cam = key.shadow.camera;
    cam.left = -this.halfWidth - 12;
    cam.right = this.halfWidth + 12;
    cam.top = this.halfHeight + 14;
    cam.bottom = -this.halfHeight - 14;
    cam.near = 1;
    cam.far = 260;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    this.scene.add(key);
    const rim = new DirectionalLight(0x8fb0ff, 1.3);
    rim.position.set(60, 25, -70);
    this.scene.add(rim);

    // 背景の暗いぼかし
    const backdropTex = createBackdropTexture();
    if (backdropTex) {
      const backdrop = new Mesh(
        new PlaneGeometry(build.width * 1.05, build.height * 2.1),
        new MeshBasicMaterial({ map: backdropTex, transparent: true, depthWrite: false }),
      );
      backdrop.position.z = -this.halfDepth - 8;
      backdrop.renderOrder = -1;
      this.scene.add(backdrop);
    }

    // ブロック本体
    const geometry = createBevelCube();
    const material = new MeshStandardMaterial({ roughness: 0.42, metalness: 0 });
    this.mesh = new InstancedMesh(geometry, material, this.voxels.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.baseColors = new Float32Array(this.voxels.length * 3);
    const color = new Color();
    const span = Math.max(1, build.width - 1);
    this.voxels.forEach((v, i) => {
      // ブロックごとにわずかに明るさを変えて、1 個ずつ積んだ感じを出す
      const shade = 0.93 + hash01(v.x, v.y * 3 + v.z) * 0.1;
      color.setHex(v.color).multiplyScalar(shade);
      this.mesh.setColorAt(i, color);
      color.toArray(this.baseColors, i * 3);
      if (v.glint) {
        this.glintIndex.push(i);
        // 少し斜めに傾けた帯にする
        this.glintPos.push((v.x + this.halfWidth) / span + v.y * 0.012);
      }
    });
    this.root.add(this.mesh);

    // 帯の左右に浮かぶ金のブロック
    const gemMaterial = new MeshStandardMaterial({ color: GEM_COLOR, roughness: 0.28, metalness: 0.35, emissive: 0x3a1c00 });
    for (const dir of [-1, 1]) {
      const gem = new Mesh(geometry, gemMaterial);
      gem.castShadow = true;
      gem.position.set(dir * (build.bannerHalfWidth + 3.5), build.bannerY, 0);
      gem.userData.dir = dir;
      this.gems.push(gem);
      this.root.add(gem);
    }
    this.scene.add(this.root);

    this.playIntro();
  }

  /** ブロックが降ってきて組み上がる演出を最初から流す（動きを減らす設定なら完成形を出す） */
  playIntro(): void {
    this.introT = this.still ? this.introEnd + 1 : 0;
    this.introDone = false;
    this.applyIntro();
  }

  /** 組み上げ演出の 1 コマ。全ブロックの位置と大きさを決め直す */
  private applyIntro(): void {
    const t = this.introT;
    const m = this.tmpMatrix;
    this.voxels.forEach((v, i) => {
      const drop = v.part === 'title' || v.part === 'sub';
      const p = Math.min(1, Math.max(0, (t - v.delay) / (drop ? DROP_DUR : POP_DUR)));
      let s: number;
      let lift = 0;
      if (drop) {
        // 上から落ちて、最後に少しだけ沈んで戻る
        s = p > 0 ? 1 : 0;
        const fall = 1 - easeOutBack(p);
        lift = fall * 9;
      } else {
        s = p <= 0 ? 0 : p >= 1 ? 1 : easeOutBack(p);
      }
      this.tmpPos.set(v.x, v.y + lift, v.z + (drop ? (1 - easeOutCubic(p)) * 6 : 0));
      this.tmpScale.setScalar(Math.max(0, s) * 0.985);
      m.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    const gemP = Math.min(1, Math.max(0, (t - (this.introEnd - 0.45)) / 0.45));
    for (const gem of this.gems) gem.scale.setScalar(2.4 * (gemP <= 0 ? 0 : easeOutBack(gemP)));
    if (t >= this.introEnd) this.introDone = true;
  }

  /** 金色の面を斜めの光の筋がなでる */
  private applyGlint(): void {
    const colors = this.mesh.instanceColor;
    if (!colors) return;
    const cycle = this.introDone ? (this.introT - this.introEnd) % GLINT_PERIOD : -1;
    const arr = colors.array as Float32Array;
    if (cycle < 0 || cycle > GLINT_SWEEP) {
      if (this.glintDirty) {
        for (const i of this.glintIndex) for (let k = 0; k < 3; k++) arr[i * 3 + k] = this.baseColors[i * 3 + k];
        colors.needsUpdate = true;
        this.glintDirty = false;
      }
      return;
    }
    const u = -0.15 + (cycle / GLINT_SWEEP) * 1.3;
    this.glintIndex.forEach((i, n) => {
      const d = Math.abs(this.glintPos[n] - u);
      const f = d < GLINT_WIDTH ? (1 - d / GLINT_WIDTH) ** 2 * 0.75 : 0;
      for (let k = 0; k < 3; k++) {
        const base = this.baseColors[i * 3 + k];
        arr[i * 3 + k] = base + (1 - base) * f;
      }
    });
    colors.needsUpdate = true;
    this.glintDirty = true;
  }

  private fitToCanvas(): void {
    const w = this.canvas.parentElement?.clientWidth ?? 0;
    const h = this.canvas.parentElement?.clientHeight ?? 0;
    if (w === this.cssW && h === this.cssH) return;
    this.cssW = w;
    this.cssH = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    const tan = Math.tan((FOV / 2) * (Math.PI / 180));
    // 揺れて手前に来た端が画面からはみ出さない距離まで引く
    const nearX = this.halfWidth * Math.cos(SWAY_YAW);
    const nearZ = this.halfWidth * Math.sin(SWAY_YAW) + this.halfDepth;
    const forWidth = (nearX / (tan * aspect) + nearZ) * 1.04;
    const forHeight = (this.halfHeight * 1.3) / tan + nearZ;
    this.camera.position.set(0, 0, Math.max(forWidth, forHeight));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  update(realDt: number): void {
    this.fitToCanvas();
    if (this.cssW === 0 || this.cssH === 0) return;
    const dt = Math.min(realDt, 0.1);
    this.t = this.still ? 0.9 : this.t + dt;
    if (!this.still) this.introT += dt;
    if (!this.introDone) this.applyIntro();
    if (!this.still) this.applyGlint();

    // 組み上がったら揺れ始める。中心を通る縦の軸で左右に振り、少し上を手前へ傾けて厚みを見せる
    const amp = this.still ? 1 : smoothstep(this.introEnd - 0.4, this.introEnd + 1.2, this.introT);
    const ry = SWAY_YAW * Math.sin(this.t * 0.7);
    this.root.rotation.y = ry * amp;
    this.root.rotation.x = 0.17 + 0.035 * Math.sin(this.t * 0.55 + 1) * amp;
    this.root.rotation.z = 0.02 * Math.cos(this.t * 0.7) * amp;
    this.root.position.y = 0.35 * Math.sin(this.t * 1.1) * amp;

    for (const gem of this.gems) {
      const dir = gem.userData.dir as number;
      gem.rotation.set(0.62, this.t * 1.4 * dir, Math.PI / 4);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
