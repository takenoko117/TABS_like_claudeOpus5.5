import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

/** 手前から奥へ積むボクセルの層数 */
const LOGO_DEPTH = 4;
const CHAR_GAP = 1;
const LINE_GAP = 2;
/** 左右の揺れ幅（ラジアン） */
const SWAY_YAW = 0.27;
const FOV = 20;

type Tone = 'main' | 'accent' | 'sub';

const PALETTE: Record<Tone, readonly [front: number, side: number, back: number]> = {
  main: [0xffd43b, 0xc26a00, 0x6b3300],
  accent: [0xff5a3c, 0xa8230f, 0x5a1208],
  sub: [0xfff3bf, 0xc26a00, 0x6b3300],
};

const KANA: Record<string, readonly string[]> = {
  エ: ['..........', '.########.', '.########.', '....##....', '....##....', '....##....', '....##....', '##########', '##########', '..........'],
  ク: ['...##.....', '..########', '..########', '.##....##.', '##.....##.', '......##..', '.....###..', '....###...', '..####....', '..##......'],
  ス: ['.########.', '.########.', '.......##.', '......###.', '.....###..', '....####..', '...##.###.', '.###...###', '###.....##', '##........'],
  ブ: ['.......#.#', '.......#.#', '#######...', '#######...', '.....##...', '.....##...', '....##....', '...###....', '.####.....', '###.......'],
  ロ: ['..........', '.########.', '.########.', '.##....##.', '.##....##.', '.##....##.', '.##....##.', '.########.', '.########.', '..........'],
  ッ: ['..........', '..........', '.#..#..##.', '.##.##.##.', '..#..#.##.', '.......##.', '......##..', '.....###..', '...####...', '..##......'],
  ウ: ['....##....', '....##....', '.########.', '.########.', '.##....##.', '.##....##.', '......##..', '.....###..', '...####...', '.###......'],
  ォ: ['..........', '......##..', '......##..', '.########.', '.########.', '....####..', '...##.##..', '.##...##..', '##..####..', '....###...'],
  ー: ['..........', '..........', '..........', '..........', '##########', '##########', '..........', '..........', '..........', '..........'],
};

const LATIN: Record<string, readonly string[]> = {
  E: ['#####', '#....', '####.', '#....', '#####'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  ' ': ['...', '...', '...', '...', '...'],
};

export interface LogoVoxel {
  x: number;
  y: number;
  z: number;
  color: number;
}

interface LogoPlacement {
  x: number;
  y: number;
  tone: Tone;
}

/** 文字列を 1 行分のブロック座標にする。x は 0 から、y は下向きに増える */
function layoutLine(
  text: string,
  glyphs: Record<string, readonly string[]>,
  tone: (index: number) => Tone,
): { cells: LogoPlacement[]; width: number; height: number } {
  const cells: LogoPlacement[] = [];
  let cursor = 0;
  let height = 0;
  Array.from(text).forEach((ch, index) => {
    const glyph = glyphs[ch];
    height = Math.max(height, glyph.length);
    glyph.forEach((row, y) => {
      Array.from(row).forEach((mark, x) => {
        if (mark === '#') cells.push({ x: cursor + x, y, tone: tone(index) });
      });
    });
    cursor += glyph[0].length + CHAR_GAP;
  });
  return { cells, width: cursor - CHAR_GAP, height };
}

/** ロゴ全体のボクセルを、中心が原点に来るように並べて返す */
export function buildLogoVoxels(): { voxels: LogoVoxel[]; width: number; height: number } {
  const title = layoutLine('エクスブロックスウォー', KANA, (i) => (i >= 8 ? 'accent' : 'main'));
  const sub = layoutLine('EXBLOCKS WAR', LATIN, () => 'sub');
  const width = Math.max(title.width, sub.width);
  const height = title.height + LINE_GAP + sub.height;
  const placed = [
    ...title.cells.map((c) => ({ ...c, x: c.x + (width - title.width) / 2 })),
    ...sub.cells.map((c) => ({ ...c, x: c.x + Math.floor((width - sub.width) / 2), y: c.y + title.height + LINE_GAP })),
  ];
  const voxels: LogoVoxel[] = [];
  for (const cell of placed) {
    const [front, side, back] = PALETTE[cell.tone];
    for (let layer = 0; layer < LOGO_DEPTH; layer++) {
      voxels.push({
        x: cell.x - (width - 1) / 2,
        y: (height - 1) / 2 - cell.y,
        z: (LOGO_DEPTH - 1) / 2 - layer,
        color: layer === 0 ? front : layer === LOGO_DEPTH - 1 ? back : side,
      });
    }
  }
  return { voxels, width, height };
}

/** タイトル画面のロゴ。背景の戦場とは別の canvas に描き、タイトルの間だけ動かす */
export class TitleLogo3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 800);
  private readonly root = new Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private t = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);

    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xfff2d8, 2.6);
    sun.position.set(-3, 7, 8);
    this.scene.add(sun);

    const { voxels, width, height } = buildLogoVoxels();
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    const mesh = new InstancedMesh(new BoxGeometry(0.96, 0.96, 0.96), new MeshLambertMaterial(), voxels.length);
    const matrix = new Matrix4();
    const color = new Color();
    voxels.forEach((v, i) => {
      mesh.setMatrixAt(i, matrix.makeTranslation(v.x, v.y, v.z));
      // ブロックごとにわずかに明るさを変えて、1 個ずつ積んだ感じを出す
      const shade = 0.9 + (Math.abs(Math.round(v.x * 7 + v.y * 13)) % 5) * 0.04;
      mesh.setColorAt(i, color.setHex(v.color).multiplyScalar(shade));
    });
    this.root.add(mesh);
    this.scene.add(this.root);
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
    const nearZ = this.halfWidth * Math.sin(SWAY_YAW) + LOGO_DEPTH / 2;
    const forWidth = (nearX / (tan * aspect) + nearZ) * 1.03;
    const forHeight = (this.halfHeight * 1.25) / tan + nearZ;
    this.camera.position.set(0, 0, Math.max(forWidth, forHeight));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  update(realDt: number): void {
    this.fitToCanvas();
    if (this.cssW === 0 || this.cssH === 0) return;
    this.t = this.still ? 0.9 : this.t + realDt;
    // 中心を通る縦の軸で左右に振り、少し上を手前へ傾けて厚みを見せる
    this.root.rotation.y = SWAY_YAW * Math.sin(this.t * 0.85);
    this.root.rotation.x = 0.16 + 0.04 * Math.sin(this.t * 0.6 + 1);
    this.root.rotation.z = 0.025 * Math.cos(this.t * 0.85);
    this.renderer.render(this.scene, this.camera);
  }
}
