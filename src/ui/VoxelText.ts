/**
 * ドットフォントの字形を 1 ドットずつ読み取り、立体のブロックとして canvas に描く。
 * DOM の要素に文字を入れる代わりに使う。フォントが未読み込みの間は通常の文字のまま見せる。
 */
const FONT_FAMILY = 'DotGothic16';
const FONT = `16px "${FONT_FAMILY}"`;
const GLYPH_SIZE = 16;
/** 字形がドット格子にぴったり乗る基準線（フォント固有の値） */
const BASELINE = 14;

type Size = number | (() => number);

export interface VoxelTextOptions {
  /** 文字の高さの目安（CSS px）。16 の倍数に丸めてドットを揃える */
  height: Size;
  /** 収めたい幅（CSS px）。超えるときはドットを小さくする */
  maxWidth?: Size;
  /** 1 ドットの大きさの上限（CSS px） */
  maxCell?: number;
  /** 手前に伸ばす立体の厚み（ドット数） */
  depth?: number;
  /** 線を 1 ドット太らせる（画数の少ない見出し向け） */
  bold?: boolean;
  /** 列ごとに色を変える */
  rainbow?: boolean;
  /** 幅に収まらないとき、1 ドットでも足りなければ折り返す */
  wrap?: boolean;
  /** 本文の後ろに別の色で続ける文字（絵文字の除去や前後の空白の調整はしない） */
  suffix?: { text: string; color: string };
}

interface Painted {
  text: string;
  opts: VoxelTextOptions;
}

const painted = new Map<HTMLElement, Painted>();
let listening = false;
let rasterCtx: CanvasRenderingContext2D | null = null;

/** 絵文字はドットにできないので取り除く */
export function stripPictographs(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
}

/** 指定の高さに一番近く、幅に収まる 1 ドットの大きさを実ピクセルで返す */
export function pickVoxelUnit(height: number, cols: number, maxWidth: number, dpr = 1, maxCell = 8): number {
  const cell = Math.max(1, Math.min(maxCell, Math.round(height / GLYPH_SIZE)));
  const desired = Math.max(1, Math.round(cell * dpr));
  return Math.max(1, Math.min(desired, Math.floor((maxWidth * dpr) / cols)));
}

/** 1 行の文字を、指定の列数に収まるように分ける */
export function breakVoxelLines(text: string, maxCols: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (current && measure(current + ch) > maxCols) {
      lines.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 立体の分も含めた、文字の占める高さ（CSS px） */
export function voxelBoxHeight(height: number, depth: number, dpr = 1, maxCell = 8): number {
  const unit = pickVoxelUnit(height, 1, Infinity, dpr, maxCell);
  return ((GLYPH_SIZE + depth + 2) * unit) / dpr;
}

/** 演出の途中でフォント待ちが起きないよう、使う文字を先に読み込んでおく */
export function preloadVoxelText(text: string): void {
  void document.fonts?.load(FONT, text).catch(() => undefined);
}

function resolve(size: Size | undefined, fallback: number): number {
  if (size === undefined) return fallback;
  return typeof size === 'function' ? size() : size;
}

function raster(): CanvasRenderingContext2D {
  if (!rasterCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = GLYPH_SIZE;
    rasterCtx = canvas.getContext('2d', { willReadFrequently: true })!;
  }
  rasterCtx.font = FONT;
  rasterCtx.textBaseline = 'alphabetic';
  rasterCtx.fontKerning = 'none';
  rasterCtx.fillStyle = '#fff';
  return rasterCtx;
}

function measure(ctx: CanvasRenderingContext2D, text: string): number {
  return Math.ceil(ctx.measureText(text).width);
}

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/[\d.]+/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}

function mix(c: [number, number, number], to: number, amount: number): string {
  const ch = (v: number) => Math.round(v + (to - v) * amount);
  return `rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})`;
}

/** 文字を読み取って、ドットごとの塗り分け（0=なし, 1=本文, 2=suffix）を作る */
function buildGrid(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  accentFrom: number,
  cols: number,
  bold: boolean,
): { cells: Uint8Array; width: number; height: number } {
  const width = cols + (bold ? 1 : 0);
  const height = lines.length * GLYPH_SIZE;
  const cells = new Uint8Array(width * height);
  lines.forEach((line, row) => {
    ctx.clearRect(0, 0, ctx.canvas.width, GLYPH_SIZE);
    ctx.fillText(line, 0, BASELINE);
    const data = ctx.getImageData(0, 0, Math.min(cols, ctx.canvas.width), GLYPH_SIZE).data;
    const rowCols = Math.min(cols, ctx.canvas.width);
    for (let y = 0; y < GLYPH_SIZE; y++) {
      for (let x = 0; x < rowCols; x++) {
        if (data[(y * rowCols + x) * 4 + 3] < 128) continue;
        const value = x >= accentFrom ? 2 : 1;
        const top = (row * GLYPH_SIZE + y) * width;
        cells[top + x] = value;
        if (bold) cells[top + x + 1] = value;
      }
    }
  });
  return { cells, width, height };
}

function paint(el: HTMLElement, text: string, opts: VoxelTextOptions): void {
  const ctx = raster();
  const depth = opts.depth ?? 1;
  const suffix = opts.suffix?.text ?? '';
  const pad = depth + 2 + (opts.bold ? 1 : 0);
  const maxWidth = resolve(opts.maxWidth, Infinity);
  // 1 ドットを細かくしすぎると読めないので、折り返しの判断は 1 CSS px 相当で行う
  const dpr = window.devicePixelRatio || 1;
  const minCell = Math.max(1, Math.round(dpr)) / dpr;

  let lines = [text + suffix];
  let cols = measure(ctx, lines[0]);
  if (opts.wrap && (cols + pad) * minCell > maxWidth) {
    lines = breakVoxelLines(lines[0], Math.max(GLYPH_SIZE, Math.floor(maxWidth / minCell) - pad), (s) => measure(ctx, s));
    cols = Math.max(...lines.map((line) => measure(ctx, line)));
  }
  const accentFrom = suffix ? measure(ctx, text) : Infinity;
  const grid = buildGrid(ctx, lines, accentFrom, cols, opts.bold ?? false);

  const totalW = grid.width + depth + 2;
  const totalH = grid.height + depth + 2;
  // 端末の拡大率でも 1 ドットが整数ピクセルになるようにする
  const unit = pickVoxelUnit(resolve(opts.height, GLYPH_SIZE), totalW, maxWidth, dpr, opts.maxCell);

  const canvas = document.createElement('canvas');
  canvas.width = totalW * unit;
  canvas.height = totalH * unit;
  canvas.style.width = `${(totalW * unit) / dpr}px`;
  canvas.setAttribute('aria-hidden', 'true');
  drawGrid(canvas.getContext('2d')!, grid, totalW, totalH, unit, depth, el, opts);

  const label = document.createElement('span');
  label.className = 'voxel-sr';
  label.textContent = text + suffix;
  el.classList.add('voxel-text');
  el.replaceChildren(label, canvas);
}

function drawGrid(
  g: CanvasRenderingContext2D,
  grid: { cells: Uint8Array; width: number; height: number },
  totalW: number,
  totalH: number,
  unit: number,
  depth: number,
  el: HTMLElement,
  opts: VoxelTextOptions,
): void {
  const main = parseRgb(getComputedStyle(el).color);
  const accent = parseRgb(opts.suffix?.color ?? 'rgb(255,255,255)');
  const OUTLINE = 'rgb(18,10,6)';

  // 立体の厚みも含めて埋まっているドット
  const solid = new Int8Array(totalW * totalH).fill(-1);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const value = grid.cells[y * grid.width + x];
      if (!value) continue;
      for (let d = depth; d >= 0; d--) {
        const i = (y + 1 + d) * totalW + (x + 1 + d);
        if (d === 0 || solid[i] !== 0) solid[i] = d;
      }
    }
  }

  // 外周の縁取り
  g.fillStyle = OUTLINE;
  for (let y = 0; y < totalH; y++) {
    for (let x = 0; x < totalW; x++) {
      if (solid[y * totalW + x] >= 0) continue;
      let touch = false;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(totalH - 1, y + 1) && !touch; ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(totalW - 1, x + 1); nx++) {
          if (solid[ny * totalW + nx] >= 0) {
            touch = true;
            break;
          }
        }
      }
      if (touch) g.fillRect(x * unit, y * unit, unit, unit);
    }
  }

  const bevel = Math.max(1, Math.round(unit / 5));
  for (let y = 0; y < totalH; y++) {
    for (let x = 0; x < totalW; x++) {
      const d = solid[y * totalW + x];
      if (d < 0) continue;
      const px = x * unit;
      const py = y * unit;
      if (d > 0) {
        // 手前に伸びた側面。奥ほど暗い
        g.fillStyle = mix(main, 0, 0.55 + (0.3 * (d - 1)) / Math.max(1, depth));
        g.fillRect(px, py, unit, unit);
        continue;
      }
      const value = grid.cells[(y - 1) * grid.width + (x - 1)];
      let base: string;
      let light: string;
      let dark: string;
      if (opts.rainbow && value === 1) {
        // 数列ごとに色を切り替え、文字の形が色で途切れないようにする
        const hue = (Math.floor(x / 6) * 42) % 360;
        base = `hsl(${hue} 95% 62%)`;
        light = `hsl(${hue} 100% 82%)`;
        dark = `hsl(${hue} 90% 42%)`;
      } else {
        const color = value === 2 ? accent : main;
        base = mix(color, 0, 0);
        light = mix(color, 255, 0.55);
        dark = mix(color, 0, 0.32);
      }
      g.fillStyle = base;
      g.fillRect(px, py, unit, unit);
      if (unit < 3) continue;
      // 上と左を明るく、下と右を暗くして 1 ドットずつブロックに見せる
      g.fillStyle = light;
      g.fillRect(px, py, unit, bevel);
      g.fillRect(px, py, bevel, unit);
      g.fillStyle = dark;
      g.fillRect(px, py + unit - bevel, unit, bevel);
      g.fillRect(px + unit - bevel, py + bevel, bevel, unit - bevel);
    }
  }
}

function repaintAll(): void {
  for (const [el, state] of painted) {
    if (!el.isConnected) painted.delete(el);
    else if (state.text) paint(el, state.text, state.opts);
  }
}

/** 要素の中身をボクセル文字にする。text が空なら中身を消す */
export function setVoxelText(el: HTMLElement, rawText: string, opts: VoxelTextOptions): void {
  const text = stripPictographs(rawText);
  const all = text + (opts.suffix?.text ?? '');
  painted.set(el, { text, opts });
  if (!listening) {
    listening = true;
    window.addEventListener('resize', repaintAll);
  }
  if (!all) {
    el.replaceChildren();
    return;
  }
  const fonts = document.fonts;
  if (fonts?.check(FONT, all)) {
    paint(el, text, opts);
    return;
  }
  // 読み込みが済むまでは普通の文字で見せ、間に別の文字へ変わっていたら描かない
  el.classList.remove('voxel-text');
  el.textContent = all;
  void fonts
    ?.load(FONT, all)
    .then(() => {
      const state = painted.get(el);
      if (state && state.text === text && state.opts === opts && el.isConnected) paint(el, text, opts);
    })
    .catch(() => undefined);
}
