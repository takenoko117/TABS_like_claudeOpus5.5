import { TEAM_COLORS, type Team } from '../units/UnitTypes';
import { Sculpt, hash3, insidePolygon, mirror, mix, shade, type DragonPartSpec, type V3 } from './DragonModel';

/**
 * 動物系ユニット（鎧戦象・大鷲・巨大アナコンダ）の彫刻的なボクセル造形。
 * DragonModel の Sculpt（楕円体・テーパー付きチューブ・多角形のボクセル化）で、
 * 直方体の積み上げより丸みのある、表情のあるシルエットを作る。
 *
 * 座標はすべて「ピボット原点からのボクセル単位」。+X = 右, +Y = 上, +Z = 前。
 * 四肢のテンプレートは +Y が付け根→先端（下向きに置かれる）、+Z が正面。
 */

/** 外側から dir 方向へ進み、最初に当たったボクセルを塗る（目・鼻孔など表面の描き込み用） */
export function castPaint(S: Sculpt, from: V3, dir: V3, color: number, maxSteps = 40): boolean {
  let x = from[0];
  let y = from[1];
  let z = from[2];
  for (let i = 0; i < maxSteps; i++) {
    if (S.get(x, y, z) !== 0) {
      S.set(x, y, z, color);
      return true;
    }
    x += dir[0];
    y += dir[1];
    z += dir[2];
  }
  return false;
}

/** XZ 平面上の平たいカプセル（羽根 1 枚分）。|py| <= halfY の層だけ塗る */
function flatCapsule(
  S: Sculpt,
  a: readonly [number, number],
  b: readonly [number, number],
  r0: number,
  r1: number,
  halfY: number,
  color: (t: number, px: number, py: number, pz: number) => number,
): void {
  const rm = Math.max(r0, r1) + 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-6;
  S.region(
    [Math.min(a[0], b[0]) - rm, -halfY, Math.min(a[1], b[1]) - rm],
    [Math.max(a[0], b[0]) + rm, halfY, Math.max(a[1], b[1]) + rm],
    (px, py, pz) => {
      let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const qx = px - (a[0] + dx * t);
      const qz = pz - (a[1] + dz * t);
      const r = r0 + (r1 - r0) * t;
      if (qx * qx + qz * qz > r * r) return 0;
      return color(t, px, py, pz);
    },
  );
}

// ---------------------------------------------------------------
// 鎧戦象: 大きな耳・丸い額・長い鼻と牙・黄金の面当て・陣営色の豪華な鞍と天蓋
// ---------------------------------------------------------------

interface ElephantPalette {
  skin: number;
  skinDark: number;
  skinLight: number;
  wrinkle: number;
  earInner: number;
  ivory: number;
  nail: number;
  sole: number;
  gold: number;
  goldDark: number;
  cloth: number;
  clothDark: number;
  clothLight: number;
  accent: number;
  wood: number;
  woodDark: number;
  pupil: number;
  sparkle: number;
  tuft: number;
}

function elephantPalette(team: Team): ElephantPalette {
  const tc = TEAM_COLORS[team];
  return {
    skin: 0xa3a9b3,
    skinDark: 0x878d97,
    skinLight: 0xbcc1c9,
    wrinkle: 0x7a808a,
    earInner: 0xc9a2a6,
    ivory: 0xf7f1df,
    nail: 0xe6dcc3,
    sole: 0x54565e,
    gold: 0xe3b341,
    goldDark: 0xa97c1f,
    cloth: tc.shirt,
    clothDark: shade(tc.shirt, 0.68),
    clothLight: mix(tc.shirt, 0xffffff, 0.3),
    accent: tc.accent,
    wood: 0x8b5a2b,
    woodDark: 0x5c3a1a,
    pupil: 0x1c1416,
    sparkle: 0xffffff,
    tuft: 0x3b3b42,
  };
}

/** 象の肌: 低い位置ほどしわが多く、ところどころ明暗のムラがある */
function elephantSkin(p: ElephantPalette, px: number, py: number, pz: number, wrinkleBelow = 6): number {
  const h = hash3(px, py, pz);
  if (py < wrinkleBelow && Math.floor(py + 100) % 4 === 0 && h < 0.45) return p.wrinkle;
  if (h < 0.1) return p.skinDark;
  if (h > 0.9) return p.skinLight;
  return p.skin;
}

export function buildElephantTorso(team: Team): DragonPartSpec {
  const p = elephantPalette(team);
  const S = new Sculpt(32, 43, 47, 16, 7, 23.5);
  const L = 17.5;
  const CY = 5.5;
  const RX = 13.5;
  const RY = 12;
  /** 樽型の胴体（g だけ外側へ膨らませた殻を判定できる） */
  const inBody = (px: number, py: number, pz: number, g: number): boolean => {
    const t = pz / (L + g);
    if (t <= -1 || t >= 1) return false;
    const prof = Math.sqrt(1 - t ** 4);
    const cy = CY + t * 1.2;
    const rx = RX * prof + g;
    const ry = RY * prof + g;
    return (px / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
  };
  const skin = (px: number, py: number, pz: number) => elephantSkin(p, px, py, pz);

  S.fill((px, py, pz) => (inBody(px, py, pz, 0) ? skin(px, py, pz) : 0));
  // 肩と腰の盛り上がり（脚の付け根）
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([8, 4, 11], sx), [5.5, 7, 6], (_nx, _ny, _nz, px, py, pz) => skin(px, py, pz));
    S.ellipsoid(mirror([8, 4, -11], sx), [5.5, 7, 6.5], (_nx, _ny, _nz, px, py, pz) => skin(px, py, pz));
  }

  // 背中を覆う陣営色の掛け布（菱形の織り模様・裾は波打つ金縁）
  const hemY = (pz: number) => 3.4 + Math.abs(Math.sin(pz * 0.55)) * 1.6;
  S.fill((px, py, pz) => {
    if (Math.abs(pz) > 13.5 || py < hemY(pz)) return 0;
    if (!inBody(px, py, pz, 1.2) || inBody(px, py, pz, 0)) return 0;
    if (py < hemY(pz) + 1.4 || Math.abs(pz) > 12.4) return p.gold;
    const a = Math.floor(pz + 100);
    const b = Math.floor(py + 100);
    if ((a + b) % 6 === 0 || (a - b + 600) % 6 === 0) return p.clothDark;
    return p.cloth;
  });
  // 裾から下がる房飾り
  for (const pz of [-11, -7, -3, 1, 5, 9]) {
    const t = pz / (L + 1.2);
    const prof = Math.sqrt(1 - t ** 4);
    const rx = RX * prof + 1.2;
    const ry = RY * prof + 1.2;
    const y0 = hemY(pz) + 0.2;
    const x = rx * Math.sqrt(Math.max(0, 1 - ((y0 - (CY + t * 1.2)) / ry) ** 2));
    for (const sx of [-1, 1]) {
      S.tube([sx * x, y0, pz], [sx * (x + 0.3), y0 - 2.6, pz], 0.6, 0.6, p.gold);
      S.ellipsoid([sx * (x + 0.3), y0 - 3.2, pz], [0.9, 1.1, 0.9], p.accent);
    }
  }

  // 背の天蓋付き鞍（ハウダー）: 木の台座・低い壁・柱・縞の屋根・金の宝珠
  S.box([-8, 18, -9], [8, 20, 5], (px, _py, pz) => (Math.abs(px) > 7 || pz > 4 || pz < -8 ? p.gold : p.wood));
  S.box([-8, 20, -9], [8, 22.6, 5], (px, py, pz) => {
    if (Math.abs(px) < 7 && pz < 4 && pz > -8) return 0;
    return py > 21.8 ? p.gold : p.cloth;
  });
  for (const x of [-7.5, 7.5]) {
    for (const z of [-8.5, 4.5]) S.tube([x, 20, z], [x, 27, z], 0.7, 0.7, p.woodDark);
  }
  S.region([-10, 27, -12], [10, 32.6, 8], (px, py, pz) => {
    const k = 1 - (py - 27) / 5.6;
    if (Math.abs(px) > 9.6 * k || Math.abs(pz + 2) > 8.6 * k) return 0;
    if (py < 27.9) return p.gold;
    return Math.floor((px + 100) / 2) % 2 === 0 ? p.cloth : p.clothLight;
  });
  S.ellipsoid([0, 33.2, -2], [1.1, 1.1, 1.1], p.gold);

  // 短い尾と房毛
  S.chain([[0, 8, -17], [0, 4, -20.5], [0, 0, -21.5]], [1.2, 1.0, 0.8], p.skinDark);
  S.ellipsoid([0, -1.5, -21.6], [1.3, 1.8, 1.3], p.tuft);

  return S.spec(0.021);
}

export function buildElephantHead(team: Team): DragonPartSpec {
  const p = elephantPalette(team);
  const S = new Sculpt(40, 37, 32, 20, 16.5, 11);
  const skin = (_nx: number, _ny: number, _nz: number, px: number, py: number, pz: number) => elephantSkin(p, px, py, pz, -2);

  // 大きく広がった耳（前面は桃色の内耳、縁は濃い肌）
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([11, 3, -3.2], sx), [7.5, 8, 1.5], (nx, ny, nz) => {
      if (Math.hypot(nx, ny) > 0.86) return p.skinDark;
      return nz > 0 ? p.earInner : p.skin;
    });
    S.ellipsoid(mirror([6.5, 3, -3], sx), [2.6, 5, 2.2], skin);
  }

  // 頭蓋・二つの丸い額・顔・頬
  S.ellipsoid([0, 3, -1], [8, 8.5, 8], skin);
  for (const sx of [-1, 1]) S.ellipsoid(mirror([3, 8.5, 1], sx), [4.5, 4, 5], skin);
  S.ellipsoid([0, 0, 5], [6, 6.5, 4.5], skin);
  for (const sx of [-1, 1]) S.ellipsoid(mirror([5, 0, 3], sx), [3.5, 4, 4], skin);

  // 長い鼻（しわの縞・先端が前へ巻き上がる）
  S.chain(
    [
      [0, 1, 7],
      [0, -3, 9.8],
      [0, -7.5, 10.8],
      [0, -11, 10.2],
      [0, -13.5, 11.5],
      [0, -14, 14],
    ],
    [3.4, 3.0, 2.5, 2.1, 1.8, 1.6],
    (t, px, py, pz) => (Math.floor(t * 22) % 2 === 0 ? p.skinDark : elephantSkin(p, px, py, pz, -99)),
  );
  S.set(-0.5, -14, 15.2, p.tuft);
  S.set(0.5, -14, 15.2, p.tuft);

  // 金の口金をはめた反り返る牙
  for (const sx of [-1, 1]) {
    S.chain(
      [mirror([3.2, -2, 7], sx), mirror([4.2, -6, 9.5], sx), mirror([4, -8.5, 13], sx), mirror([3, -7.8, 16], sx)],
      [1.5, 1.25, 0.95, 0.5],
      p.ivory,
    );
    S.ellipsoid(mirror([3.5, -3, 8], sx), [1.9, 1.4, 1.9], p.gold);
  }

  // 額から鼻筋を覆う黄金の面当て
  S.recolor((px, py, pz) => {
    if (Math.abs(px) > 3.3 || py < -2.5 || py > 10.5 || pz < 2) return 0;
    if (S.get(px, py, pz + 1) !== 0) return 0;
    return Math.abs(px) > 2.4 || py > 9.6 ? p.goldDark : p.gold;
  });
  S.ellipsoid([0, 6, 7], [1.4, 1.4, 1.0], p.accent);

  // つぶらな瞳（黒目にきらりと光る白点）と、まぶたの影
  for (const sx of [-1, 1]) {
    for (const z of [3.5, 4.5, 5.5, 6.5]) castPaint(S, [sx * 19.5, 4.5, z], [-sx, 0, 0], p.skinDark);
    for (const y of [2.5, 3.5]) {
      for (const z of [4.5, 5.5]) {
        castPaint(S, [sx * 19.5, y, z], [-sx, 0, 0], y === 3.5 && z === 5.5 ? p.sparkle : p.pupil);
      }
    }
  }

  // 頭頂の陣営色の羽飾り
  S.tube([0, 10.5, 0], [0, 12, -0.5], 1.6, 1.6, p.gold);
  S.chain(
    [
      [0, 11.5, -0.5],
      [0, 15, -1.5],
      [0, 17.5, -4],
      [0, 18, -7],
    ],
    [1.6, 1.8, 1.4, 0.6],
    (t) => (t > 0.7 ? p.clothLight : p.cloth),
  );

  // 耳飾り
  for (const sx of [-1, 1]) {
    S.tube(mirror([12, -4.5, -3.2], sx), mirror([12, -6.5, -3.2], sx), 0.7, 0.7, p.gold);
    S.ellipsoid(mirror([12, -7.3, -3.2], sx), [1.1, 1.1, 1.1], p.accent);
  }

  return S.spec(0.023);
}

/** 象の脚の上半分（肩・腿）。胴体の中へ差し込まれる太い柱 */
export function buildElephantUpperLeg(team: Team): DragonPartSpec {
  const p = elephantPalette(team);
  const S = new Sculpt(15, 18, 15, 7.5, 2, 7.5);
  S.tube([0, -1, 0], [0, 13.5, 0], 6.3, 5.7, (_t, px, py, pz) => elephantSkin(p, px, py, pz, 99));
  return S.spec(0.021);
}

/** 象の脚の下半分（膝当て・金の足輪・丸い足と爪） */
export function buildElephantLowerLeg(team: Team): DragonPartSpec {
  const p = elephantPalette(team);
  const S = new Sculpt(17, 20, 17, 8.5, 1, 8.5);
  S.tube([0, 0, 0], [0, 13, 0], 5.6, 6.0, (_t, px, py, pz) => elephantSkin(p, px, py, pz, 99));
  S.region([-7.5, 12.5, -7.5], [7.5, 17.5, 7.5], (px, py, pz) => {
    if (Math.hypot(px, pz) > 6.5) return 0;
    return py > 16.6 ? p.sole : elephantSkin(p, px, py, pz, 99);
  });
  for (const a of [-0.75, 0, 0.75]) {
    S.ellipsoid([Math.sin(a) * 6.2, 15.6, Math.cos(a) * 6.2], [1.3, 1.0, 0.8], p.nail);
  }
  // 金の足輪（正面に宝石）
  S.region([-7.5, 9, -7.5], [7.5, 10.8, 7.5], (px, _py, pz) => {
    const r = Math.hypot(px, pz);
    if (r < 5.2 || r > 6.7) return 0;
    return Math.abs(px) < 1 && pz > 0 ? p.accent : p.gold;
  });
  // 膝当て
  S.ellipsoid([0, 1.5, 5.2], [3.6, 2.8, 1.4], (nx, ny) => (Math.hypot(nx, ny) < 0.45 ? p.cloth : p.gold));
  return S.spec(0.021);
}

// ---------------------------------------------------------------
// 大鷲: 水平に構えた胴体・白い頭と鋭い眉・黄色い鉤クチバシ・陣営色のスカーフ・指のように分かれた初列風切
// ---------------------------------------------------------------

/** syncEagle が翼の骨の長さとして使う値（ローカル単位） */
export const EAGLE_RIG = {
  upperWingLength: 15 * 0.02,
  foreWingLength: 19 * 0.02,
};

interface EaglePalette {
  brown: number;
  brownMid: number;
  brownLight: number;
  brownDark: number;
  feather: number;
  featherTip: number;
  white: number;
  whiteShade: number;
  brow: number;
  beak: number;
  beakDark: number;
  eye: number;
  pupil: number;
  sparkle: number;
  talon: number;
  cloth: number;
  clothDark: number;
}

function eaglePalette(team: Team): EaglePalette {
  const tc = TEAM_COLORS[team];
  return {
    brown: 0x5c3d24,
    brownMid: 0x7d5532,
    brownLight: 0xa57446,
    brownDark: 0x3f2916,
    feather: 0x35210f,
    featherTip: 0x22160b,
    white: 0xf6f6f8,
    whiteShade: 0xd8d8de,
    brow: 0xc4c4cc,
    beak: 0xf7b928,
    beakDark: 0xd38b10,
    eye: 0xffb000,
    pupil: 0x170d04,
    sparkle: 0xffffff,
    talon: 0x1e1916,
    cloth: tc.shirt,
    clothDark: shade(tc.shirt, 0.7),
  };
}

function eagleBodyFeather(p: EaglePalette, ny: number, px: number, py: number, pz: number): number {
  const h = hash3(px, py, pz);
  if (ny < -0.5) return h < 0.3 ? p.brownMid : p.brownLight;
  if (Math.floor(pz + 100) % 3 === 0 && h < 0.6) return p.brownDark;
  if (ny > 0.6) return h < 0.25 ? p.brown : p.brownMid;
  return h < 0.15 ? p.brownDark : p.brown;
}

/** 胴体（水平・+Z が頭側）。ピボットは胴体の中心 */
export function buildEagleTorso(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const S = new Sculpt(26, 21, 50, 13, 9.5, 32);
  const body = (_nx: number, ny: number, _nz: number, px: number, py: number, pz: number) => eagleBodyFeather(p, ny, px, py, pz);
  S.ellipsoid([0, 0, -1], [7.5, 7, 16], body);
  // ふっくらした胸
  S.ellipsoid([0, -0.5, 7], [7, 6.8, 7.5], body);
  // 翼の付け根と、足の付け根の羽毛
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([6, 3, 6], sx), [3, 3, 4], p.brownMid);
    S.ellipsoid(mirror([3.5, -5, -3], sx), [3, 3.5, 4], body);
  }
  // 首元は白い羽毛（頭へ続く）
  S.recolor((px, py, pz) => (pz > 10 + hash3(px, py, pz) * 1.5 ? (hash3(px, pz, py) < 0.15 ? p.whiteShade : p.white) : 0));

  // 扇形に広がる白い尾羽（羽根の境目に影）
  const tail: ReadonlyArray<readonly [number, number]> = [
    [0, -14],
    [5, -15.5],
    [10, -23.5],
    [6.5, -26.5],
    [2.5, -25.5],
    [0, -26.5],
    [-2.5, -25.5],
    [-6.5, -26.5],
    [-10, -23.5],
    [-5, -15.5],
  ];
  S.region([-10, -0.6, -31], [10, 1.6, -13], (px, py, pz) => {
    if (!insidePolygon(px, pz, tail)) return 0;
    if (pz > -17.5) return Math.floor(pz + 100) % 2 === 0 ? p.brownMid : p.brown; // 尾の付け根の雨覆
    const ang = Math.atan2(px, -pz - 12);
    if (Math.abs((ang * 9) % 1) < 0.2) return p.whiteShade;
    return py > 1 ? p.white : p.whiteShade;
  });

  // 首に巻いた陣営色のスカーフ（後ろへなびく 2 本の端）
  S.recolor((px, py, pz) => {
    if (pz < 8.6 || pz > 10.6) return 0;
    const out = S.get(px * 1.25, py * 1.25 - 0.1, pz) === 0 || S.get(px, py + 1, pz) === 0 || S.get(px, py - 1, pz) === 0;
    return out ? p.cloth : 0;
  });
  S.ellipsoid([3, 4.8, 9.6], [1.4, 1.3, 1.2], p.clothDark);
  S.chain([[3, 5.2, 9], [5, 6.4, 5.5], [6.4, 6.0, 2]], [1.3, 1.0, 0.7], p.cloth);
  S.chain([[3.4, 4.6, 8.8], [6, 4.8, 6], [7.6, 4.0, 3]], [1.1, 0.9, 0.6], p.clothDark);

  return S.spec(0.02);
}

export function buildEagleHead(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const S = new Sculpt(24, 22, 31, 12, 10, 11.5);
  const white = (_nx: number, _ny: number, _nz: number, px: number, py: number, pz: number) =>
    hash3(px, py, pz) < 0.15 ? p.whiteShade : p.white;

  S.ellipsoid([0, -1, -5], [5, 5, 4], white); // 首
  S.ellipsoid([0, 1, 0], [6, 6, 6.5], white); // 頭
  for (const sx of [-1, 1]) S.ellipsoid(mirror([3.5, -1, 1], sx), [3.5, 3.5, 4.5], white); // 頬の羽毛
  // 後頭部の跳ねた冠羽
  const tuft = (_t: number, px: number, py: number, pz: number) => white(0, 0, 0, px, py, pz);
  S.tube([0, 4.5, -4], [0, 5.2, -9.5], 1.4, 0.4, tuft);
  for (const sx of [-1, 1]) {
    S.tube(mirror([2, 3, -4], sx), mirror([3, 4, -9], sx), 1.4, 0.4, tuft);
    S.tube(mirror([3.5, 0, -4], sx), mirror([4.5, 0.5, -8.5], sx), 1.2, 0.4, tuft);
  }

  // 黄色い鉤クチバシ（ろう膜・上嘴の鉤・下嘴・口角の線・鼻孔）
  S.ellipsoid([0, 1.5, 5.5], [2.8, 2.4, 2], p.beak);
  S.chain(
    [
      [0, 1.5, 6],
      [0, 1.0, 9.5],
      [0, -0.8, 12],
      [0, -3, 12],
    ],
    [2.5, 2.0, 1.3, 0.6],
    (t) => (t > 0.75 ? p.beakDark : p.beak),
  );
  S.tube([0, -1.0, 5.5], [0, -2.0, 9.5], 1.8, 0.8, p.beakDark);
  for (const sx of [-1, 1]) {
    S.tube(mirror([2.2, -0.4, 6], sx), mirror([1.4, -0.8, 9], sx), 0.5, 0.5, 0x6b4410);
    S.set(sx * 1.2, 2.2, 7.5, 0x5a3a12);
  }

  // 張り出した眉（凛々しい目つき）
  for (const sx of [-1, 1]) S.tube(mirror([2.6, 3.6, 6], sx), mirror([5.2, 3.4, 2], sx), 1.3, 1.1, p.brow);

  // 金色の大きな目（黒目と光の点）
  for (const sx of [-1, 1]) {
    for (const y of [0.5, 1.5, 2.5]) {
      for (const z of [2.5, 3.5, 4.5]) {
        const isPupil = (y === 0.5 || y === 1.5) && (z === 3.5 || z === 4.5);
        const isSparkle = y === 1.5 && z === 4.5;
        castPaint(S, [sx * 12, y, z], [-sx, 0, 0], isSparkle ? p.sparkle : isPupil ? p.pupil : p.eye);
      }
    }
  }

  return S.spec(0.018);
}

/** 上腕の翼（骨は +X、雨覆と次列風切が -Z の後方へ広がる。上下対称で左右共用） */
export function buildEagleUpperWing(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const L = 15;
  const S = new Sculpt(21, 5, 26, 3, 2.5, 22);
  const te = (px: number) => -18 + 1.3 * Math.abs(Math.sin((px * Math.PI) / 2.5));
  // 次列風切（1 層の平たい羽根。境目と先端に濃い影）
  S.region([0, -0.6, -19], [L + 0.5, 0.6, -5.5], (px, _py, pz) => {
    if (pz < te(px)) return 0;
    if (pz < te(px) + 1.6) return p.featherTip;
    return (px + 100) % 2.5 < 0.6 ? p.featherTip : p.feather;
  });
  // 雨覆（厚みのある小羽の段々。陣営色の帯で敵味方を見分ける）
  S.region([0, -1, -7], [L + 0.5, 1, 1.6], (px, _py, pz) => {
    if (pz > 1.5 - px * 0.03) return 0;
    if (pz > -5.5 && pz < -4.5 && px > 1.5 && px < L - 1) return p.cloth;
    if (pz > 0.4) return p.brownLight;
    return Math.floor((pz + 100) / 2) % 2 === 0 ? p.brownMid : p.brown;
  });
  S.tube([0, 0, 0], [L, 0, 0], 2.2, 1.6, p.brown);
  S.ellipsoid([0, 0, 0], [2.6, 2.4, 2.8], p.brownMid);
  return S.spec(0.02);
}

/** 前腕の翼（手首から先の初列風切が指のように分かれて広がる） */
export function buildEagleForeWing(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const S = new Sculpt(34, 5, 27, 3, 2.5, 22.5);
  // 内側の風切（後縁）
  const inner: ReadonlyArray<readonly [number, number]> = [
    [0, -5],
    [10, -4],
    [12.5, -16],
    [6, -17.6],
    [0, -18],
  ];
  S.region([0, -0.6, -19], [13, 0.6, -3.5], (px, _py, pz) => {
    if (!insidePolygon(px, pz, inner)) return 0;
    if (pz < -16.3) return p.featherTip;
    return (px + 100) % 2.5 < 0.6 ? p.featherTip : p.feather;
  });
  // 初列風切 6 枚（外側ほど前へ開く）
  for (let i = 0; i < 6; i++) {
    flatCapsule(S, [9 + i * 1.6, -3 + i * 0.3], [15 + i * 2.5, -17 + i * 2.6], 1.6, 0.7, 0.6, (t) =>
      t > 0.72 ? p.featherTip : p.feather,
    );
  }
  // 雨覆（前縁の厚い羽毛と陣営色の帯）
  S.region([0, -1, -6.5], [18, 1, 1.5], (px, _py, pz) => {
    if (pz > 1.4 - px * 0.03 || pz < -6 + (px / 18) * 2.5) return 0;
    if (pz > -4.5 && pz < -3.5 && px < 14) return p.cloth;
    if (pz > 0.3) return p.brownLight;
    return Math.floor((pz + 100) / 2) % 2 === 0 ? p.brownMid : p.brown;
  });
  S.tube([0, 0, 0], [18, 0, 0], 1.7, 1.1, p.brown);
  S.ellipsoid([0, 0, 0], [2.0, 1.8, 2.2], p.brownMid);
  return S.spec(0.02);
}

/** 羽毛に覆われた腿（ふわふわの「ズボン」） */
export function buildEagleThigh(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const S = new Sculpt(10, 12, 10, 5, 1.5, 5);
  S.ellipsoid([0, 4, 0], [3.6, 5, 3.8], (_nx, ny, _nz, px, py, pz) => {
    const h = hash3(px, py, pz);
    if (ny > 0.75 && h < 0.5) return 0; // 裾のギザギザ
    return h < 0.3 ? p.brownMid : p.brown;
  });
  return S.spec(0.02);
}

/** 黄色い鱗の脛と、黒く鋭い鉤爪（前 3 本・後ろ 1 本） */
export function buildEagleShin(team: Team): DragonPartSpec {
  const p = eaglePalette(team);
  const S = new Sculpt(14, 14, 15, 7, 1.5, 6);
  S.ellipsoid([0, 0.5, 0], [2.4, 1.8, 2.4], p.brown);
  S.tube([0, 0, 0], [0, 7, 0.5], 1.6, 1.3, (_t, _px, py) => (Math.floor(py + 100) % 2 === 0 ? p.beakDark : p.beak));
  for (const dx of [-2, 0, 2]) {
    S.tube([0, 8, 0.5], [dx, 9.5, 5], 1.0, 0.7, p.beak);
    S.tube([dx, 9.5, 5], [dx * 1.1, 11.5, 6.5], 0.7, 0.25, p.talon);
  }
  S.tube([0, 8, 0], [0, 9.5, -3.5], 0.9, 0.7, p.beak);
  S.tube([0, 9.5, -3.5], [0, 11.5, -4.2], 0.7, 0.25, p.talon);
  return S.spec(0.02);
}

// ---------------------------------------------------------------
// 巨大アナコンダ: オリーブ色の地に黒い楕円斑と橙の眼状紋、黄色い腹板。
// 平たく大きな頭・ニッと笑った口・頭頂寄りの大きな目・ちょろりと出した二又の舌
// ---------------------------------------------------------------

interface SnakePalette {
  base: number;
  baseDark: number;
  baseLight: number;
  blotch: number;
  ocellus: number;
  belly: number;
  bellyDark: number;
  mouth: number;
  eye: number;
  pupil: number;
  sparkle: number;
  tongue: number;
  cloth: number;
  accent: number;
}

function snakePalette(team: Team): SnakePalette {
  const tc = TEAM_COLORS[team];
  return {
    base: 0x6f9440,
    baseDark: 0x5a7c33,
    baseLight: 0x88ab52,
    blotch: 0x2a3a1c,
    ocellus: 0xf0b445,
    belly: 0xead98d,
    bellyDark: 0xcfbd6c,
    mouth: 0x1a1f12,
    eye: 0xf2d24c,
    pupil: 0x141008,
    sparkle: 0xffffff,
    tongue: 0xe03131,
    cloth: tc.shirt,
    accent: tc.accent,
  };
}

/**
 * 蛇の鱗模様。lat = 横方向, dors = 背側方向, along = 体軸方向の座標。
 * 背の楕円斑は左右で互い違い、体側には橙の眼状紋、腹は横縞の腹板。
 */
function snakeSkin(p: SnakePalette, lat: number, dors: number, along: number, offset: number): number {
  const a = Math.abs(Math.atan2(lat, dors));
  if (a > 2.25) return Math.floor(along + 100) % 2 === 0 ? p.belly : p.bellyDark;
  const side = lat >= 0 ? 1 : 0;
  const yy = along + offset + side * 3.5;
  const local = (((yy % 7) + 7) % 7) - 3.5;
  if ((local / 2.1) ** 2 + ((a - 0.62) / 0.36) ** 2 < 1) return p.blotch;
  const y2 = along + offset * 1.7 + side * 2.5;
  const l2 = (((y2 % 5) + 5) % 5) - 2.5;
  const d = (l2 / 1.5) ** 2 + ((a - 1.72) / 0.3) ** 2;
  if (d < 1) return d < 0.32 ? p.ocellus : p.blotch;
  const h = hash3(lat, dors, along);
  if (a < 0.2 || h < 0.18) return p.baseDark;
  return h > 0.9 ? p.baseLight : p.base;
}

/**
 * 胴の 1 節（+Y が尾の方向、+Z が背）。両端は丸く、隣の節と重なって継ぎ目が見えない。
 * r1 を小さくすると尾先のように細く尖る。
 */
export function buildSnakeSegment(team: Team, r0: number, r1: number, len: number, offset: number): DragonPartSpec {
  const p = snakePalette(team);
  const rm = Math.max(r0, r1);
  const n = Math.ceil(rm) + 2;
  const S = new Sculpt(2 * n, Math.ceil(len + 2 * rm) + 3, 2 * n, n, Math.ceil(rm) + 1, n);
  S.tube([0, 0, 0], [0, len, 0], r0, r1, (_t, px, py, pz) => snakeSkin(p, px, pz, py, offset));
  return S.spec(0.022);
}

/** 前胴（骨盤→胸の向きが +Z、+Y が背）。背中に陣営色の菱紋 */
export function buildSnakeTorso(team: Team): DragonPartSpec {
  const p = snakePalette(team);
  const S = new Sculpt(16, 16, 31, 8, 7, 9);
  S.tube([0, 0, -2], [0, 0.8, 15], 5.6, 5.3, (_t, px, py, pz) => snakeSkin(p, px, py, -pz, 2));
  S.recolor((px, py, pz) => {
    if (S.get(px, py + 1, pz) !== 0) return 0;
    const dz = (((pz + 1) % 7) + 7) % 7 - 3.5;
    const d = Math.abs(px) + Math.abs(dz) * 0.8;
    if (d < 1.1) return p.accent;
    return d < 2.4 ? p.cloth : 0;
  });
  return S.spec(0.022);
}

export function buildSnakeHead(team: Team): DragonPartSpec {
  const p = snakePalette(team);
  const S = new Sculpt(26, 20, 38, 13, 8, 7);
  const top = (_nx: number, ny: number, _nz: number, px: number, py: number, pz: number) => {
    const h = hash3(px, py, pz);
    if (ny > 0.55) return h < 0.4 ? p.baseDark : p.base;
    return h < 0.15 ? p.baseDark : h > 0.9 ? p.baseLight : p.base;
  };

  S.ellipsoid([0, 1, 0], [6, 5, 5], top); // 首
  // 下顎（黄色い腹側）
  S.ellipsoid([0, -1.2, 12], [7.6, 2.6, 11], (_nx, _ny, _nz, _px, py) => (py < -0.5 ? p.belly : p.base));
  // 頭蓋と、平たく幅のある鼻先
  S.ellipsoid([0, 2, 7], [9, 5, 9], top);
  S.ellipsoid([0, 1.8, 16], [6.8, 4.2, 9], top);

  // ニッと口角の上がった口の線
  const mouthY = (pz: number) => 0.2 + Math.max(0, 8 - pz) * 0.18;
  S.recolor((_px, py, pz) => (pz > 4 && pz < 25.5 && Math.abs(py - mouthY(pz)) < 0.5 ? p.mouth : 0));

  // 頭頂の黒い縦縞と、目の後ろの黒と橙の帯
  S.recolor((px, py, pz) => (Math.abs(px) < 1.8 && pz > 1 && pz < 14 && S.get(px, py + 1, pz) === 0 ? p.blotch : 0));
  for (const sx of [-1, 1]) {
    S.tube(mirror([7.5, 3, 6.5], sx), mirror([8.6, 0.5, 0], sx), 0.9, 0.9, p.blotch);
    S.tube(mirror([7.8, 1.6, 6], sx), mirror([8.8, -0.6, 0.5], sx), 0.6, 0.6, p.ocellus);
  }

  // 大きな丸い目（頭頂寄り）と、眉のような眼上鱗
  for (const sx of [-1, 1]) {
    S.ellipsoid(mirror([6.2, 4.2, 9], sx), [2.4, 2.4, 2.4], p.eye);
    S.tube(mirror([4.5, 6.5, 11.5], sx), mirror([6.5, 6.4, 6.5], sx), 1.2, 1.2, p.baseDark);
    for (const y of [3.5, 4.5]) {
      for (const z of [8.5, 9.5]) {
        castPaint(S, [sx * 13, y, z], [-sx, 0, 0], y === 4.5 && z === 9.5 ? p.sparkle : p.pupil);
      }
    }
    castPaint(S, [sx * 2.2, 12, 23.5], [0, -1, 0], p.mouth); // 鼻孔
  }

  // ちょろりと出した二又の舌
  S.tube([0, -0.2, 24], [0, -0.6, 28], 0.7, 0.6, p.tongue);
  for (const sx of [-1, 1]) S.tube([0, -0.6, 28], [sx * 1.4, -0.6, 30], 0.55, 0.5, p.tongue);

  return S.spec(0.023);
}
