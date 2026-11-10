import { Mesh, MeshLambertMaterial } from 'three';
import { isGateTypeId, type FacilityTypeId } from '../facilities/FacilityTypes';
import { GATE_TINTS, VoxelGrid, buildFacilityVoxelGrid } from './VoxelModel';

/** 門の網の中央に出す、効果を表す絵柄（幅 9 マス以内。# が塗り） */
const GATE_GLYPHS: Partial<Record<FacilityTypeId, readonly string[]>> = {
  multiplier_gate: ['#...#.###', '.#.#....#', '..#...###', '.#.#..#..', '#...#.###'],
  giant_gate: ['....#....', '...###...', '..#####..', '.#######.', '#########', '...###...', '...###...', '...###...'],
  shrink_gate: ['...###...', '...###...', '...###...', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  fire_gate: ['....#....', '...##....', '...###.#.', '.#.#####.', '.#######.', '#########', '####.####', '.##...##.'],
  thunder_gate: ['.....###.', '....###..', '...###...', '..######.', '.....##..', '....##...', '...##....', '..##.....', '.#.......'],
  venom_gate: ['....#....', '....#....', '...###...', '..#####..', '.#######.', '.#######.', '.#.#####.', '..#####..', '...###...'],
  power_gate: ['.......##', '......###', '.....###.', '#...###..', '##.###...', '.####....', '..##.....', '.#.##....', '#...#....'],
  reach_gate: ['...###...', '..#...#..', '.#..#..#.', '#...#...#', '#.#####.#', '#...#...#', '.#..#..#.', '..#...#..', '...###...'],
  haste_gate: ['#...#....', '##..##...', '.##..##..', '..##..##.', '...##..##', '..##..##.', '.##..##..', '##..##...', '#...#....'],
  vitality_gate: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  swift_gate: ['.....#...', '.....##..', '###..###.', '.########', '###..###.', '.....##..', '.....#...'],
  guard_gate: ['#########', '#...#...#', '#...#...#', '#########', '#...#...#', '.#..#..#.', '..#.#.#..', '...###...', '....#....'],
  impact_gate: ['#...#...#', '.#..#..#.', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '.#..#..#.', '#...#...#'],
  // 転生: しずく形のスライム
  rebirth_gate: ['....#....', '...###...', '..#####..', '.##.#.##.', '.#######.', '#########', '#########', '.#######.'],
  // 輪廻転生: 円環と中心
  samsara_gate: ['..#####..', '.#.....#.', '#.......#', '#...#...#', '#..###..#', '#...#...#', '#.......#', '.#.....#.', '..#####..'],
  // 爆裂: 破裂する星
  blast_gate: ['#...#...#', '.#.###.#.', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '.#.###.#.', '#...#...#'],
  // 磁力: U字の磁石
  magnet_gate: ['##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '.##...##.', '..#####..', '...###...'],
};

/** 絵柄の土台の色 */
const GLYPH_PLATE_COLOR = 0x14181f;
/** 絵柄の中心の位置（門のモデルのマス目） */
const GLYPH_CENTER_X = 20;
const GLYPH_CENTER_Y = 16;
const GLYPH_PLATE_HALF = 6;

/** 門の種類が形でも分かるよう、網の中央に絵柄を入れる */
function stampGateGlyph(grid: VoxelGrid, glyph: readonly string[], color: number): void {
  const z = Math.floor(grid.sz / 2);
  const cx = GLYPH_CENTER_X;
  const cy = GLYPH_CENTER_Y;
  const half = GLYPH_PLATE_HALF;
  grid.fillBox(cx - half, cy - half, z, cx + half, cy + half, z, GLYPH_PLATE_COLOR);
  const top = cy + Math.floor((glyph.length - 1) / 2);
  glyph.forEach((row, r) => {
    const left = cx - Math.floor((row.length - 1) / 2);
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      grid.set(left + c, top - r, z + 1, color);
      grid.set(left + c, top - r, z - 1, color);
    }
  });
}

/** レリックのモデルのボクセルグリッド */
export function buildRelicVoxelGrid(id: FacilityTypeId): { grid: VoxelGrid; voxelSize: number } {
  const model = buildFacilityVoxelGrid(id, 0);
  const glyph = isGateTypeId(id) ? GATE_GLYPHS[id] : undefined;
  if (glyph) stampGateGlyph(model.grid, glyph, GATE_TINTS[id] ?? 0xffffff);
  return model;
}

const GOLD_LIGHT = 0xffe066;
const GOLD_MID = 0xffc61a;
const GOLD_DARK = 0xe89a00;
const GOLD_SHADE = 0xb87400;
const GOLD_SHINE = 0xfff4c2;

/** 金貨の表面の「G」 */
const COIN_MARK: readonly string[] = ['.#####.', '##...##', '##.....', '##.....', '##.####', '##...##', '##...##', '.#####.'];

/** ゴールドのモデル（金貨の山・立てた大金貨・金の延べ棒）のボクセルグリッド */
export function buildGoldVoxelGrid(): { grid: VoxelGrid; voxelSize: number } {
  const sx = 33;
  const sy = 28;
  const sz = 33;
  const grid = new VoxelGrid(sx, sy, sz);
  const c = (sx - 1) / 2;
  const coinColors = [GOLD_MID, GOLD_LIGHT, GOLD_DARK, GOLD_MID, GOLD_SHADE, GOLD_LIGHT];

  // 金貨の山。小さな金貨が積もったように 2 マス単位で色を変える
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const r = Math.hypot(x - c, z - c) / (c + 0.5);
      if (r > 1) continue;
      const height = Math.round(8 * (1 - r * r));
      for (let y = 0; y <= height; y++) {
        const hash = (Math.floor(x / 2) * 7 + Math.floor(z / 2) * 13 + Math.floor(y / 2) * 29) % coinColors.length;
        grid.set(x, y, z, coinColors[hash]);
      }
    }
  }

  // 山に立てた大金貨
  const radius = 10;
  const coinY = 16;
  for (let y = coinY - radius; y <= coinY + radius; y++) {
    for (let x = c - radius; x <= c + radius; x++) {
      const r = Math.hypot(x - c, y - coinY);
      if (r > radius + 0.3) continue;
      const rim = r > radius - 1.6;
      for (let z = c - 1; z <= c + 1; z++) grid.set(x, y, z, rim ? GOLD_DARK : GOLD_MID);
      if (rim) {
        grid.set(x, y, c + 2, GOLD_LIGHT);
        grid.set(x, y, c - 2, GOLD_LIGHT);
      }
    }
  }
  const markTop = coinY + 3;
  COIN_MARK.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== '#') continue;
      grid.set(c - 3 + i, markTop - r, c + 2, GOLD_SHINE);
      grid.set(c - 3 + i, markTop - r, c - 2, GOLD_SHINE);
    }
  });

  // 手前に置いた金の延べ棒
  const bar = (x0: number, y0: number, z0: number) => {
    grid.fillBox(x0, y0, z0, x0 + 7, y0 + 2, z0 + 3, GOLD_MID);
    grid.fillBox(x0 + 1, y0 + 3, z0 + 1, x0 + 6, y0 + 3, z0 + 2, GOLD_LIGHT);
  };
  bar(3, 4, 21);
  bar(21, 4, 22);
  bar(12, 6, 25);
  return { grid, voxelSize: 0.1 };
}

/** ゴールド（'gold'）やレリック（'relic:施設ID'）の表示用メッシュを作る */
export function createRewardPropMesh(key: string): Mesh {
  const { grid, voxelSize } = key === 'gold' ? buildGoldVoxelGrid() : buildRelicVoxelGrid(key.slice('relic:'.length) as FacilityTypeId);
  return new Mesh(grid.toGeometry(voxelSize, [grid.sx / 2, 0, grid.sz / 2]), new MeshLambertMaterial({ vertexColors: true }));
}
