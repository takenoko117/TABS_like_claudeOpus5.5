import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Euler,
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
/** 落下が初めて着地する進み具合（easeOutBack が初めて 1 に届く点 = 1 / (k + 1)） */
const DROP_FIRST_HIT = 1 / 2.9;
/** 文字が順に跳ねる波の間隔と、1 文字が跳ねている時間・高さ・ずれ */
const HOP_PERIOD = 7.5;
const HOP_OFFSET = 2.6;
const HOP_DUR = 0.46;
const HOP_HEIGHT = 1.7;
const HOP_STAGGER = 0.065;
/** 接地影（隣のブロックが手前に出ているほど暗くする）の強さと下限 */
const AO_STEP = 0.075;
const AO_MIN = 0.58;

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
  /** 題字・英字の何文字目か（それ以外は -1） */
  group: number;
}

/** 1 文字ぶんの位置。着地の粒子や跳ねる動きに使う */
export interface LogoChar {
  x: number;
  width: number;
  top: number;
  bottom: number;
  /** 組み上げ演出で着地する秒数 */
  landT: number;
  tone: number;
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
  titleChars: LogoChar[];
  subChars: LogoChar[];
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
  const push = (c: number, r: number, layer: number, color: number, part: LogoPart, delay: number, glint = false, group = -1): void => {
    raw.push({ x: c - cx, y: cy - r, z: zMid - layer, color, part, delay, glint, group });
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
    const g = cell.index;
    push(c, r, 0, front, 'title', delay, true, g);
    push(c, r, 1, side, 'title', delay, false, g);
    push(c, r, 2, scale(side, 0.82), 'title', delay, false, g);
    push(c, r, 3, tone.back, 'title', delay, false, g);
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
      push(c, r, 0, front, 'sub', ld, true, letter.index);
      push(c, r, 1, mix(tone.side[0], tone.side[1], lt), 'sub', ld, false, letter.index);
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

  // 接地影: 列のいちばん手前のブロックは、まわり 8 マスで 1 段手前に出ているブロックの数だけ暗くする
  // （文字の根元・帯の英字のまわりに影がたまり、くぼみが締まって見える）
  for (const v of voxels) {
    if (occupied.has(`${v.x},${v.y},${v.z + 1}`)) continue;
    let count = 0;
    for (const [dx, dy] of neighbors8) if (occupied.has(`${v.x + dx},${v.y + dy},${v.z + 1}`)) count++;
    if (count > 0) v.color = scale(v.color, Math.max(AO_MIN, 1 - count * AO_STEP));
  }

  // 文字ごとの位置と着地の秒数
  const charsOf = (part: LogoPart): LogoChar[] => {
    const byGroup = new Map<number, LogoVoxel[]>();
    for (const v of voxels) {
      if (v.part !== part || v.group < 0) continue;
      const list = byGroup.get(v.group) ?? [];
      list.push(v);
      byGroup.set(v.group, list);
    }
    return [...byGroup.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, list]) => {
        const xs = list.map((v) => v.x);
        const ys = list.map((v) => v.y);
        const front = list.filter((v) => v.glint);
        const meanDelay = list.reduce((acc, v) => acc + v.delay, 0) / list.length;
        return {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          width: Math.max(...xs) - Math.min(...xs) + 1,
          top: Math.max(...ys),
          bottom: Math.min(...ys),
          landT: meanDelay + DROP_FIRST_HIT * DROP_DUR,
          tone: (front[Math.floor(front.length / 2)] ?? list[0]).color,
        };
      });
  };

  const introEnd = Math.max(...voxels.map((v) => v.delay + (v.part === 'title' || v.part === 'sub' ? DROP_DUR : POP_DUR)));
  return {
    voxels,
    width: spanC + 1,
    height: maxR - minR + 1,
    depth: LAYER_COUNT,
    bannerY: cy - (bannerTop + bannerBottom) / 2,
    bannerHalfWidth: bannerHalf + TAIL_LEN + 1,
    introEnd,
    titleChars: charsOf('title'),
    subChars: charsOf('sub'),
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

/** ふちがぼけた楕円の絵（背景の暗いぼかしと、暖かい光の輪に使う） */
function createRadialTexture(stops: readonly [number, string][]): CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(128, 64);
  ctx.scale(2, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 62);
  for (const [at, color] of stops) g.addColorStop(at, color);
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
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

// ─────────────────────────────────────────────────────────────
// 粒子（小さなブロック）
// ─────────────────────────────────────────────────────────────

/** 粒子の数の上限 */
const DEBRIS_CAPACITY = 260;
const SPARK_CAPACITY = 560;
/** 下から舞い上がる火の粉の数（毎秒） */
const EMBER_RATE = 18;
/** 光の筋に沿って出るきらめきの数（毎秒） */
const GLINT_SPARK_RATE = 70;

const EMBER_COLORS = [0xffb23a, 0xff7a1a, 0xffe08a, 0xff9a2e] as const;
const EMBER_COOL = 0x7fd4ff;
const SPARK_WARM = [0xffe9a0, 0xffc93a, 0xffffff, 0xff9a3a] as const;
const CONFETTI = [0xffcc1a, 0xff4a2b, 0x5b9bff, 0xffffff, 0xffe08a] as const;
const DUST = 0xd9ccb2;

interface SpawnOptions {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  color: number;
  /** 上向きが正。火の粉は少し浮く（正の値） */
  gravity?: number;
  /** 空気抵抗（毎秒の減衰率） */
  drag?: number;
  spin?: number;
  /** この高さより下に落ちたら弾む */
  floor?: number;
}

interface Particle extends Required<Omit<SpawnOptions, 'color' | 'floor'>> {
  active: boolean;
  age: number;
  floor: number;
  rx: number;
  ry: number;
  color: Color;
}

/**
 * 小さなブロックの粒子をまとめて 1 回で描く入れ物。
 * glow（加算合成）は色を暗くして消し、そうでない破片は縮んで消える
 */
class ParticlePool {
  readonly mesh: InstancedMesh;
  private readonly items: Particle[];
  private cursor = 0;
  private alive = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();

  constructor(
    geometry: BufferGeometry,
    material: MeshStandardMaterial | MeshBasicMaterial,
    private readonly capacity: number,
    private readonly glow: boolean,
  ) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      age: 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 1,
      size: 1,
      gravity: 0,
      drag: 0,
      spin: 0,
      floor: -Infinity,
      rx: 0,
      ry: 0,
      color: new Color(),
    }));
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(0x000000));
    }
    this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
  }

  spawn(o: SpawnOptions): void {
    // 空きがなければ古いものから上書きする
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!p.active) this.alive++;
    p.active = true;
    p.age = 0;
    p.x = o.x;
    p.y = o.y;
    p.z = o.z;
    p.vx = o.vx;
    p.vy = o.vy;
    p.vz = o.vz;
    p.life = o.life;
    p.size = o.size;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.spin = o.spin ?? 0;
    p.floor = o.floor ?? -Infinity;
    p.rx = Math.random() * Math.PI;
    p.ry = Math.random() * Math.PI;
    p.color.setHex(o.color);
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    const colors = this.mesh.instanceColor;
    this.items.forEach((p, i) => {
      if (!p.active) return;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.alive--;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        return;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.vz *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor && p.vy < 0) {
        // 床で弾んで勢いを失う
        p.y = p.floor;
        p.vy *= -0.38;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.spin *= 0.5;
      }
      const k = 1 - p.age / p.life;
      const grow = Math.min(1, p.age / 0.05);
      const size = p.size * grow * (this.glow ? 0.45 + 0.55 * k : Math.min(1, k * 3));
      this.e.set(p.rx + p.age * p.spin, p.ry + p.age * p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.p.set(p.x, p.y, p.z);
      this.s.setScalar(size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      // 加算合成は色を暗くすると透けて消える。出始めは白く飛ばす
      if (this.glow) this.c.copy(p.color).multiplyScalar(k * (1 + Math.max(0, 0.15 - p.age) * 6));
      else this.c.copy(p.color);
      this.mesh.setColorAt(i, this.c);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors) colors.needsUpdate = true;
  }
}

// ─────────────────────────────────────────────────────────────
// ロゴ本体
// ─────────────────────────────────────────────────────────────

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
  /** 題字の文字ごとのブロック番号（跳ねる動きで使う） */
  private readonly charVoxels: number[][];
  private readonly titleChars: LogoChar[];
  private readonly subChars: LogoChar[];
  private readonly charLift: number[];
  private readonly charLanded: boolean[];
  private readonly subLanded: boolean[];
  private readonly gems: Mesh[] = [];
  private readonly gemMaterial: MeshStandardMaterial;
  private readonly key: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly glowMaterial: MeshBasicMaterial | null = null;
  private readonly debris: ParticlePool;
  private readonly sparks: ParticlePool;
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private readonly halfDepth: number;
  private readonly bannerY: number;
  private readonly introEnd: number;
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private t = 0;
  private introT = 0;
  private introDone = false;
  private bannerFired = false;
  private finaleFired = false;
  /** 完成の瞬間からの秒数（弾む拡大と閃光に使う。負なら未発生） */
  private finaleT = -1;
  private flash = 0;
  private glintDirty = false;
  private emberAcc = 0;
  private glintSparkAcc = 0;
  private cssW = 0;
  private cssH = 0;
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpPos = new Vector3();
  private readonly tmpScale = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly hopQuat = new Quaternion();
  private readonly zAxis = new Vector3(0, 0, 1);

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
    this.bannerY = build.bannerY;
    this.titleChars = build.titleChars;
    this.subChars = build.subChars;
    this.charVoxels = this.titleChars.map(() => []);
    this.charLift = this.titleChars.map(() => 0);
    this.charLanded = this.titleChars.map(() => false);
    this.subLanded = this.subChars.map(() => false);

    // 光: 部屋の映り込み＋上からの暖かい主光（ゆっくり動いて影と照り返しが流れる）＋後ろからの青い縁取り光
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    this.scene.add(new HemisphereLight(0xfff2dc, 0x2a2350, 0.85));
    this.key = new DirectionalLight(0xfff0d4, 2.3);
    this.key.position.set(-35, 75, 55);
    this.key.castShadow = true;
    const big = this.renderer.capabilities.maxTextureSize >= 4096;
    this.key.shadow.mapSize.set(big ? 4096 : 2048, big ? 1024 : 512);
    const cam = this.key.shadow.camera;
    cam.left = -this.halfWidth - 16;
    cam.right = this.halfWidth + 16;
    cam.top = this.halfHeight + 18;
    cam.bottom = -this.halfHeight - 18;
    cam.near = 1;
    cam.far = 280;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 3;
    this.scene.add(this.key);
    this.rim = new DirectionalLight(0x8fb0ff, 1.3);
    this.rim.position.set(60, 25, -70);
    this.scene.add(this.rim);

    // 背景: 暗いぼかしの上に、脈打つ暖かい光の輪
    const backdropTex = createRadialTexture([
      [0, 'rgba(10,6,24,0.62)'],
      [0.55, 'rgba(10,6,24,0.38)'],
      [1, 'rgba(10,6,24,0)'],
    ]);
    if (backdropTex) {
      const backdrop = new Mesh(
        new PlaneGeometry(build.width * 1.05, build.height * 2.1),
        new MeshBasicMaterial({ map: backdropTex, transparent: true, depthWrite: false }),
      );
      backdrop.position.z = -this.halfDepth - 8;
      backdrop.renderOrder = -2;
      this.scene.add(backdrop);
    }
    const glowTex = createRadialTexture([
      [0, 'rgba(255,176,70,0.9)'],
      [0.4, 'rgba(255,120,40,0.35)'],
      [1, 'rgba(255,90,30,0)'],
    ]);
    if (glowTex) {
      this.glowMaterial = new MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0.2,
        toneMapped: false,
      });
      const glow = new Mesh(new PlaneGeometry(build.width * 0.8, build.height * 1.7), this.glowMaterial);
      glow.position.z = -this.halfDepth - 7;
      glow.renderOrder = -1;
      this.scene.add(glow);
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
      if (v.part === 'title' && v.group >= 0) this.charVoxels[v.group]?.push(i);
    });
    this.root.add(this.mesh);

    // 帯の左右に浮かぶ金のブロック（光が脈打つ）
    this.gemMaterial = new MeshStandardMaterial({ color: GEM_COLOR, roughness: 0.28, metalness: 0.35, emissive: 0x5a2c00 });
    for (const dir of [-1, 1]) {
      const gem = new Mesh(geometry, this.gemMaterial);
      gem.castShadow = true;
      gem.position.set(dir * (build.bannerHalfWidth + 3.5), build.bannerY, 0);
      gem.userData.dir = dir;
      this.gems.push(gem);
      this.root.add(gem);
    }

    // 粒子: 照らされる破片と、光る火花
    this.debris = new ParticlePool(geometry, new MeshStandardMaterial({ roughness: 0.5, metalness: 0 }), DEBRIS_CAPACITY, false);
    this.debris.mesh.castShadow = true;
    this.sparks = new ParticlePool(
      geometry,
      new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
      SPARK_CAPACITY,
      true,
    );
    this.root.add(this.debris.mesh, this.sparks.mesh);
    this.scene.add(this.root);

    this.playIntro();
  }

  /** ブロックが降ってきて組み上がる演出を最初から流す（動きを減らす設定なら完成形を出す） */
  playIntro(): void {
    this.introT = this.still ? this.introEnd + 1 : 0;
    this.introDone = false;
    this.bannerFired = this.still;
    this.finaleFired = this.still;
    this.finaleT = -1;
    this.flash = 0;
    this.charLanded.fill(this.still);
    this.subLanded.fill(this.still);
    this.charLift.fill(0);
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
        lift = (1 - easeOutBack(p)) * 9;
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

  /** 組み上げ中の出来事（着地・帯が開く・完成）に合わせて粒子を出す */
  private fireIntroEvents(): void {
    const t = this.introT;
    this.titleChars.forEach((c, k) => {
      if (this.charLanded[k] || t < c.landT) return;
      this.charLanded[k] = true;
      this.burstLanding(c, 1);
    });
    this.subChars.forEach((c, k) => {
      if (this.subLanded[k] || t < c.landT) return;
      this.subLanded[k] = true;
      for (let n = 0; n < 4; n++) {
        this.sparks.spawn({
          x: c.x + rand(-1.5, 1.5),
          y: c.bottom,
          z: this.halfDepth + 0.5,
          vx: rand(-3, 3),
          vy: rand(2, 6),
          vz: rand(0, 3),
          life: rand(0.3, 0.5),
          size: rand(0.18, 0.3),
          color: pick(SPARK_WARM),
          gravity: -14,
        });
      }
    });
    if (!this.bannerFired && t >= 0.85) {
      this.bannerFired = true;
      // 帯が中央から左右へ開くのに合わせて、縁を光が走る
      for (let n = 0; n < 44; n++) {
        const dir = n % 2 ? 1 : -1;
        this.sparks.spawn({
          x: dir * rand(0, 3),
          y: this.bannerY + (n % 4 < 2 ? 3.6 : -3.6),
          z: this.halfDepth - 0.5,
          vx: dir * rand(20, 52),
          vy: rand(-0.6, 0.6),
          vz: rand(0, 1.5),
          life: rand(0.35, 0.6),
          size: rand(0.2, 0.34),
          color: n % 3 ? 0xbfe0ff : 0xffffff,
          drag: 3.2,
        });
      }
    }
    if (!this.finaleFired && t >= this.introEnd) {
      this.finaleFired = true;
      this.finale();
    }
  }

  /** 文字が着地したときの破片・土ぼこり・火花。power は勢い（跳ねの着地は小さめ） */
  private burstLanding(c: LogoChar, power: number): void {
    const front = this.halfDepth;
    const debrisCount = Math.round(10 * power);
    for (let n = 0; n < debrisCount; n++) {
      this.debris.spawn({
        x: c.x + rand(-0.5, 0.5) * c.width,
        y: c.bottom + 0.2,
        z: rand(-1, front),
        vx: rand(-6, 6) * power,
        vy: rand(4, 10) * power,
        vz: rand(0, 6) * power,
        life: rand(0.8, 1.25),
        size: rand(0.26, 0.5),
        color: n % 3 === 0 ? DUST : c.tone,
        gravity: -34,
        spin: rand(6, 14),
        floor: c.bottom - 2.2,
      });
    }
    for (let n = 0; n < Math.round(6 * power); n++) {
      // 横に広がってすぐ止まる土ぼこり
      this.debris.spawn({
        x: c.x + rand(-0.5, 0.5) * c.width,
        y: c.bottom - 0.4,
        z: rand(0, front + 1),
        vx: rand(-9, 9),
        vy: rand(0.5, 2.2),
        vz: rand(-1, 3),
        life: rand(0.45, 0.7),
        size: rand(0.45, 0.8),
        color: DUST,
        drag: 4,
        gravity: -1.5,
        spin: rand(1, 3),
      });
    }
    for (let n = 0; n < Math.round(7 * power); n++) {
      this.sparks.spawn({
        x: c.x + rand(-0.5, 0.5) * c.width,
        y: c.bottom,
        z: front + 0.4,
        vx: rand(-7, 7),
        vy: rand(5, 12) * power,
        vz: rand(0, 4),
        life: rand(0.35, 0.6),
        size: rand(0.18, 0.3),
        color: pick(SPARK_WARM),
        gravity: -20,
      });
    }
  }

  /** 組み上がった瞬間: 閃光・ロゴが弾む・火花と紙吹雪が広がる */
  private finale(): void {
    this.flash = 1;
    this.finaleT = 0;
    for (let n = 0; n < 110; n++) {
      const x = rand(-1, 1) * this.halfWidth * 0.95;
      const y = rand(-0.3, 1) * this.halfHeight;
      const len = Math.hypot(x / this.halfWidth, y / this.halfHeight) || 1;
      const speed = rand(10, 24);
      this.sparks.spawn({
        x,
        y,
        z: this.halfDepth + 0.5,
        vx: (x / this.halfWidth / len) * speed,
        vy: (y / this.halfHeight / len) * speed * 0.6 + rand(2, 7),
        vz: rand(1, 8),
        life: rand(0.7, 1.4),
        size: rand(0.2, 0.42),
        color: pick(SPARK_WARM),
        gravity: -9,
        drag: 1.6,
      });
    }
    for (let n = 0; n < 46; n++) {
      this.debris.spawn({
        x: rand(-1, 1) * this.halfWidth * 0.9,
        y: rand(0, 1) * this.halfHeight,
        z: rand(0, this.halfDepth + 3),
        vx: rand(-8, 8),
        vy: rand(10, 20),
        vz: rand(0, 7),
        life: rand(1.3, 1.9),
        size: rand(0.3, 0.55),
        color: pick(CONFETTI),
        gravity: -22,
        drag: 0.8,
        spin: rand(8, 16),
      });
    }
  }

  /** 組み上がったあと、ときどき文字が左から順に跳ねる（少し傾いて着地する） */
  private applyHop(): void {
    const since = this.introT - this.introEnd - HOP_OFFSET;
    const cycle = since >= 0 ? since % HOP_PERIOD : -1;
    let changed = false;
    this.titleChars.forEach((c, k) => {
      const p = cycle < 0 ? -1 : (cycle - k * HOP_STAGGER) / HOP_DUR;
      const active = p > 0 && p < 1;
      const lift = active ? Math.sin(Math.PI * p) * HOP_HEIGHT : 0;
      const tilt = active ? Math.sin(Math.PI * 2 * p) * 0.09 * (k % 2 ? 1 : -1) : 0;
      if (lift === 0 && this.charLift[k] === 0) return;
      if (lift === 0 && this.charLift[k] > 0) this.burstLanding(c, 0.45);
      this.charLift[k] = lift;
      changed = true;
      // 文字の下端中央を軸に傾けて持ち上げる
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      this.hopQuat.setFromAxisAngle(this.zAxis, tilt);
      this.tmpScale.setScalar(0.985);
      for (const i of this.charVoxels[k]) {
        const v = this.voxels[i];
        const dx = v.x - c.x;
        const dy = v.y - c.bottom;
        this.tmpPos.set(c.x + dx * cos - dy * sin, c.bottom + dx * sin + dy * cos + lift, v.z);
        this.tmpMatrix.compose(this.tmpPos, this.hopQuat, this.tmpScale);
        this.mesh.setMatrixAt(i, this.tmpMatrix);
      }
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 金色の面を斜めの光の筋がなで、筋に沿ってきらめきが散る */
  private applyGlint(dt: number): void {
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

    this.glintSparkAcc += dt * GLINT_SPARK_RATE;
    while (this.glintSparkAcc >= 1) {
      this.glintSparkAcc -= 1;
      // 筋の近くのブロックを何回か試して選ぶ
      for (let tries = 0; tries < 10; tries++) {
        const n = Math.floor(Math.random() * this.glintIndex.length);
        if (Math.abs(this.glintPos[n] - u) > GLINT_WIDTH * 0.5) continue;
        const v = this.voxels[this.glintIndex[n]];
        this.sparks.spawn({
          x: v.x + rand(-0.4, 0.4),
          y: v.y + rand(-0.4, 0.4),
          z: v.z + 0.7,
          vx: rand(-0.6, 1.2),
          vy: rand(0.8, 2.2),
          vz: rand(0, 1),
          life: rand(0.3, 0.55),
          size: rand(0.22, 0.42),
          color: 0xfff4d0,
          drag: 2,
          spin: rand(2, 6),
        });
        break;
      }
    }
  }

  /** 下から舞い上がり、ゆらめきながら消える火の粉 */
  private emitEmbers(dt: number): void {
    this.emberAcc += dt * EMBER_RATE;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      this.sparks.spawn({
        x: rand(-1.05, 1.05) * this.halfWidth,
        y: -this.halfHeight + rand(-2, 3),
        z: rand(-this.halfDepth - 4, this.halfDepth + 6),
        vx: rand(-0.8, 0.8),
        vy: rand(1.6, 3.6),
        vz: rand(-0.3, 0.3),
        life: rand(2.4, 4.4),
        size: rand(0.16, 0.36),
        color: Math.random() < 0.14 ? EMBER_COOL : pick(EMBER_COLORS),
        gravity: 0.5,
        spin: rand(0.5, 2.5),
      });
    }
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
    if (!this.still) {
      this.introT += dt;
      if (!this.introDone) this.applyIntro();
      else this.applyHop();
      this.fireIntroEvents();
      this.applyGlint(dt);
      if (this.introT > 0.4) this.emitEmbers(dt);
    }

    // 組み上がったら揺れ始める。中心を通る縦の軸で左右に振り、少し上を手前へ傾けて厚みを見せる
    const amp = this.still ? 1 : smoothstep(this.introEnd - 0.4, this.introEnd + 1.2, this.introT);
    this.root.rotation.y = SWAY_YAW * Math.sin(this.t * 0.7) * amp;
    this.root.rotation.x = 0.17 + 0.035 * Math.sin(this.t * 0.55 + 1) * amp;
    this.root.rotation.z = 0.02 * Math.cos(this.t * 0.7) * amp;
    this.root.position.y = 0.35 * Math.sin(this.t * 1.1) * amp;

    // 完成の瞬間に、ばねのように一度ふくらんで戻る
    let punch = 0;
    if (this.finaleT >= 0) {
      this.finaleT += dt;
      punch = 0.06 * Math.exp(-this.finaleT * 6) * Math.cos(this.finaleT * 22);
      if (this.finaleT > 1.5) this.finaleT = -1;
    }
    this.root.scale.setScalar(1 + punch);

    // 光: 主光がゆっくり回って影と照り返しが流れる。完成の閃光で一瞬強く光る
    this.flash *= Math.exp(-dt * 4.5);
    this.key.position.set(-35 + 30 * Math.sin(this.t * 0.31), 75, 55 + 12 * Math.cos(this.t * 0.31));
    this.key.intensity = 2.3 + this.flash * 3.5;
    this.rim.intensity = 1.3 + 0.35 * Math.sin(this.t * 0.9) + this.flash * 2;
    if (this.glowMaterial) this.glowMaterial.opacity = 0.18 * amp + 0.06 * Math.sin(this.t * 1.7) * amp + this.flash * 0.55;

    for (const gem of this.gems) {
      const dir = gem.userData.dir as number;
      gem.rotation.set(0.62, this.t * 1.4 * dir, Math.PI / 4);
    }
    this.gemMaterial.emissiveIntensity = 1 + 0.8 * (0.5 + 0.5 * Math.sin(this.t * 3.2)) + this.flash * 5;

    this.debris.update(dt);
    this.sparks.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
