// ボクセル調のピクセルアート（小さな SVG）。文字の並びで描いた絵を、1 マスずつ「面」と「奥行きの影」の
// 2 枚の四角にして、積み木のように少し浮き出て見せる。オンライン対戦のロビーなどで使う。

/** 絵の名前 */
export type PixelSpriteName =
  | 'castleBlue'
  | 'castleRed'
  | 'swords'
  | 'chest'
  | 'crown'
  | 'hourglass'
  | 'eye'
  | 'soldierBlue'
  | 'soldierRed'
  | 'house'
  | 'levelup';

interface PixelSprite {
  rows: readonly string[];
  /** 文字 → 色（'.' は透明） */
  palette: Readonly<Record<string, string>>;
}

const BLUE = '#4f8dff';
const RED = '#ff5a4f';

const CASTLE_ROWS = [
  '.....FF....',
  '.....FFF...',
  '.....f.....',
  'S.S.SSS.S.S',
  'SSS.SSS.SSS',
  'SwS.SwS.SwS',
  'SSSSSSSSSSS',
  'SsSSSSSSSsS',
  'SSSSSDDSSSS',
  'SSSSDDDDSSS',
  'SsSSDDDDSsS',
  'SSSSDDDDSSS',
];
const castlePalette = (flag: string) => ({ F: flag, f: '#6b4a2b', S: '#c3c9d6', s: '#8a92a6', w: '#2b3247', D: '#4a321f' });

const SOLDIER_ROWS = [
  '..HHH..',
  '.HHHHH.',
  '..PPP..',
  '..PKP..',
  '.TTTTT.',
  'TTTTTTT',
  'P.TTT.P',
  '..TTT..',
  '..T.T..',
  '.KK.KK.',
];
const soldierPalette = (team: string) => ({ H: '#9aa3b5', P: '#f2c9a0', K: '#3a2a1e', T: team });

const SPRITES: Record<PixelSpriteName, PixelSprite> = {
  castleBlue: { rows: CASTLE_ROWS, palette: castlePalette(BLUE) },
  castleRed: { rows: CASTLE_ROWS, palette: castlePalette(RED) },
  soldierBlue: { rows: SOLDIER_ROWS, palette: soldierPalette(BLUE) },
  soldierRed: { rows: SOLDIER_ROWS, palette: soldierPalette(RED) },
  swords: {
    rows: [
      'B.........B',
      'BB.......BB',
      '.BB.....BB.',
      '..BB...BB..',
      '...BB.BB...',
      '....BBB....',
      '...BB.BB...',
      '.HHB...BHH.',
      '..HG...GH..',
      '.G.......G.',
      'G.........G',
    ],
    palette: { B: '#e6edf5', H: '#f2c84b', G: '#7a4b25' },
  },
  chest: {
    rows: [
      '.OOOOOOOOOO.',
      'OLLLLLLLLLLO',
      'OLLLLLLLLLLO',
      'OOOOOKKOOOOO',
      'OWWWWKKWWWWO',
      'OWWWWWWWWWWO',
      'OWWWWWWWWWWO',
      'OOOOOOOOOOOO',
    ],
    palette: { O: '#f2c84b', L: '#d08d4c', W: '#9c5f2e', K: '#3a2a1e' },
  },
  crown: {
    rows: [
      'Y....Y....Y',
      'YY..YYY..YY',
      'YYY.YRY.YYY',
      'YYYYYYYYYYY',
      'YRYYYBYYYRY',
      'YYYYYYYYYYY',
    ],
    palette: { Y: '#f5c451', R: '#ff5a6e', B: '#5ab4ff' },
  },
  hourglass: {
    rows: [
      'WWWWWWWWW',
      '.G.....G.',
      '.GSSSSSG.',
      '..GSSSG..',
      '...GSG...',
      '...G.G...',
      '..G.S.G..',
      '.G.SSS.G.',
      '.GSSSSSG.',
      'WWWWWWWWW',
    ],
    palette: { W: '#9c5f2e', G: '#bfe6ff', S: '#f5c451' },
  },
  eye: {
    rows: [
      '....KKKKK....',
      '..KKWWWWWKK..',
      '.KWWWBBBWWWK.',
      'KWWWBBPBBWWWK',
      '.KWWWBBBWWWK.',
      '..KKWWWWWKK..',
      '....KKKKK....',
    ],
    palette: { K: '#2b3247', W: '#f4f6fb', B: '#5ab4ff', P: '#14182a' },
  },
  house: {
    rows: [
      '.....R.....',
      '....RRR....',
      '...RRRRR...',
      '..RRRRRRR..',
      '.RRRRRRRRR.',
      '..WWWWWWW..',
      '..WGWWWGW..',
      '..WWWDWWW..',
      '..WWWDWWW..',
      '..WWWDWWW..',
    ],
    palette: { R: '#ff7a59', W: '#f1e3c6', G: '#5ab4ff', D: '#7a4b25' },
  },
  levelup: {
    rows: [
      '....Y....',
      '...YYY...',
      '..YYYYY..',
      '.YYYYYYY.',
      'YYYYYYYYY',
      '...YYY...',
      '...YYY...',
      '...YYY...',
      '...YYY...',
    ],
    palette: { Y: '#9dff6a' },
  },
};

/** 奥行きの影のずれ（マスの何割か） */
const DEPTH = 0.32;

/** 色を明るさ factor 倍にする（#rrggbb） */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** 絵のマス目（幅・高さ・塗るマス）。テスト用にも使う */
export function pixelCells(name: PixelSpriteName): { width: number; height: number; cells: Array<{ x: number; y: number; color: string }> } {
  const sprite = SPRITES[name];
  const cells: Array<{ x: number; y: number; color: string }> = [];
  let width = 0;
  sprite.rows.forEach((row, y) => {
    width = Math.max(width, row.length);
    [...row].forEach((ch, x) => {
      const color = sprite.palette[ch];
      if (color) cells.push({ x, y, color });
    });
  });
  return { width, height: sprite.rows.length, cells };
}

/** 色の決まっていない文字（描き間違い）。テスト用 */
export function unknownPixelChars(name: PixelSpriteName): string[] {
  const sprite = SPRITES[name];
  const chars = new Set(sprite.rows.join('').replace(/\./g, ''));
  return [...chars].filter((ch) => !sprite.palette[ch]);
}

const cache = new Map<string, string>();

/** ボクセル調のピクセルアートの SVG（大きさは CSS で決める。cls は svg に付けるクラス） */
export function pixelArt(name: PixelSpriteName, cls = ''): string {
  const key = `${name}|${cls}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { width, height, cells } = pixelCells(name);
  const depth = cells.map((c) => `<rect x="${c.x + DEPTH}" y="${c.y + DEPTH}" width="1" height="1" fill="${shade(c.color, 0.5)}"/>`).join('');
  const faces = cells.map((c) => `<rect x="${c.x}" y="${c.y}" width="1.02" height="1.02" fill="${c.color}"/>`).join('');
  // 面の上側に細い光を入れて、ブロックの角を立たせる
  const shine = cells.map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="0.2" fill="${shade(c.color, 1.3)}"/>`).join('');
  const svg = `<svg class="px-art ${cls}" viewBox="0 0 ${width + DEPTH} ${height + DEPTH}" aria-hidden="true" shape-rendering="crispEdges">${depth}${faces}${shine}</svg>`;
  cache.set(key, svg);
  return svg;
}
