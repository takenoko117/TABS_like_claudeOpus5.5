import { TEAM_COLORS, type Team } from '../units/UnitTypes';
import { Sculpt, hash3, insidePolygon, mirror, mix, shade, type DragonPartSpec, type V3 } from './DragonModel';
import { castPaint } from './BeastModels';

/**
 * 乗り物・機械系ユニット（超重戦車・暴走バギー・巨大ロボット）の彫刻的なボクセル造形。
 * 面取りした装甲・丸い車輪・パイプフレーム・灯火などを細かいボクセルで作り込み、
 * ライトや目で「顔」を感じさせて、愛着の持てる機械に仕上げる。
 *
 * 座標はすべて「ピボット原点からのボクセル単位」。+X = 右, +Y = 上, +Z = 前。
 */

/** 中心と半径（半分の大きさ）で直方体を塗る */
function boxC(S: Sculpt, c: V3, h: V3, color: number | ((px: number, py: number, pz: number) => number)): void {
  S.box([c[0] - h[0], c[1] - h[1], c[2] - h[2]], [c[0] + h[0], c[1] + h[1], c[2] + h[2]], color);
}

/** 軸がそれぞれ X / Y / Z 方向の円柱。fn には中心軸からの距離 r を渡す */
function cylinder(
  S: Sculpt,
  axis: 'x' | 'y' | 'z',
  c: V3,
  radius: number,
  from: number,
  to: number,
  fn: (r: number, px: number, py: number, pz: number) => number,
): void {
  const lo: [number, number, number] = [c[0] - radius, c[1] - radius, c[2] - radius];
  const hi: [number, number, number] = [c[0] + radius, c[1] + radius, c[2] + radius];
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  lo[i] = Math.min(from, to);
  hi[i] = Math.max(from, to);
  S.region(lo, hi, (px, py, pz) => {
    const r =
      axis === 'x' ? Math.hypot(py - c[1], pz - c[2]) : axis === 'y' ? Math.hypot(px - c[0], pz - c[2]) : Math.hypot(px - c[0], py - c[1]);
    return r > radius ? 0 : fn(r, px, py, pz);
  });
}

/** 前方（+Z）か上方（+Y）が空いている表面のボクセルか */
const isTopOrFront = (S: Sculpt, px: number, py: number, pz: number) => S.get(px, py + 1, pz) === 0 || S.get(px, py, pz + 1) === 0;

// ---------------------------------------------------------------
// 超重戦車: 傾斜装甲の車体・ライトの「目」・丸い鋳造砲塔・長砲身・陣営旗のアンテナ
// ---------------------------------------------------------------

interface TankPalette {
  armor: number;
  armorLight: number;
  armorDark: number;
  steel: number;
  gun: number;
  metal: number;
  rubber: number;
  track: number;
  trackLight: number;
  trackDark: number;
  light: number;
  chrome: number;
  wood: number;
  black: number;
  white: number;
  periscope: number;
  cloth: number;
  clothDark: number;
  accent: number;
}

function tankPalette(team: Team): TankPalette {
  const tc = TEAM_COLORS[team];
  return {
    armor: 0x677a4c,
    armorLight: 0x7f935e,
    armorDark: 0x4b5838,
    steel: 0x34382f,
    gun: 0x3e4535,
    metal: 0x8b9097,
    rubber: 0x1d1f1c,
    track: 0x3a3c35,
    trackLight: 0x52554b,
    trackDark: 0x26281f,
    light: 0xfff3b0,
    chrome: 0xc5ccd3,
    wood: 0x8b5a2b,
    black: 0x0f100e,
    white: 0xf1f3f5,
    periscope: 0x1f2a2e,
    cloth: tc.shirt,
    clothDark: shade(tc.shirt, 0.7),
    accent: tc.accent,
  };
}

/** 車体（ピボット = 骨盤。履帯の間の下部車体・上部車体・フェンダー） */
export function buildTankHull(team: Team): DragonPartSpec {
  const p = tankPalette(team);
  const S = new Sculpt(54, 25, 62, 27, 7, 31);
  const weather = (base: number, dark: number, px: number, py: number, pz: number) => (hash3(px, py, pz) < 0.14 ? dark : base);

  // 下部車体（履帯の間。前後の下端は斜めに切り上げる）
  S.region([-10.5, -6.5, -22], [10.5, 1.5, 24], (px, py, pz) => {
    if (pz > 19 && py < -6.5 + (pz - 19) * 1.5) return 0;
    if (pz < -19 && py < -6.5 + (-19 - pz) * 1.5) return 0;
    return p.armorDark;
  });

  // 上部車体（前面は傾斜装甲、後端も少し絞る）
  const topY = (pz: number) => (pz > 10 ? 9 - (pz - 10) * 0.62 : pz < -19 ? 9 - (-19 - pz) * 1.1 : 9);
  S.region([-13.5, 1, -23], [13.5, 9.5, 24], (px, py, pz) => {
    const top = topY(pz);
    if (py > top) return 0;
    if (Math.abs(px) > 12.5 && py > top - 1) return 0; // 角の面取り
    if (py > top - 1) return weather(p.armorLight, p.armor, px, py, pz);
    return weather(p.armor, p.armorDark, px, py, pz);
  });

  // 履帯を覆うフェンダー（外縁の折り返しと、陣営色のライン）
  for (const sx of [-1, 1]) {
    S.region(sx < 0 ? [-25.5, 0, -29] : [13, 0, -29], sx < 0 ? [-13, 2.6, 29.5] : [25.5, 2.6, 29.5], (px, py, pz) => {
      const ax = Math.abs(px);
      if (ax > 24.4) return p.armorDark;
      if (py < 1) return 0;
      if (ax > 21.5 && ax < 23.5 && py > 1.8) return p.cloth;
      return weather(p.armor, p.armorDark, px, py, pz);
    });
  }

  // 前照灯（車体の「目」）と、ひさしの眉
  for (const sx of [-1, 1]) {
    boxC(S, [sx * 16.5, 4.3, 26], [2.1, 1.8, 1.6], p.armorDark);
    cylinder(S, 'z', [sx * 16.5, 4.3, 0], 1.9, 27.4, 28.5, (r) => (r > 1.25 ? p.chrome : p.light));
    S.tube([sx * 14.4, 6.5, 27.4], [sx * 18.6, 7.1, 26.6], 0.6, 0.6, p.armorDark);
  }

  // 前面の予備履帯と牽引フック
  S.recolor((px, py, pz) => {
    if (Math.abs(px) > 9 || pz < 14.5 || pz > 20.5 || !isTopOrFront(S, px, py, pz) || py < 1) return 0;
    return Math.floor((pz + 100) / 1.5) % 2 === 0 ? p.track : p.trackLight;
  });
  for (const sx of [-1, 1]) boxC(S, [sx * 7, 0, 23], [1, 1.2, 1], p.steel);

  // 操縦手ハッチと潜望鏡
  S.recolor((px, py, pz) => (px > -9.5 && px < -3.5 && pz > 10 && pz < 14 && S.get(px, py + 1, pz) === 0 ? p.armorDark : 0));
  boxC(S, [-6.5, topY(12) + 0.6, 12.5], [1.5, 0.8, 0.8], p.steel);
  S.set(-6.5, topY(12) + 0.6, 13.4, p.periscope);
  S.set(-5.5, topY(12) + 0.6, 13.4, p.periscope);

  // 砲塔リング
  cylinder(S, 'y', [0, 0, -1], 10.5, 9, 10.2, () => p.steel);

  // 機関室のルーバーと排気管
  S.recolor((px, py, pz) => {
    if (Math.abs(px) > 10 || pz > -9 || pz < -21 || S.get(px, py + 1, pz) !== 0) return 0;
    return Math.floor(pz + 100) % 2 === 0 ? p.steel : p.armorDark;
  });
  for (const sx of [-1, 1]) {
    S.tube([sx * 9, 5, -22.5], [sx * 9, 5, -25.5], 1.5, 1.5, p.steel);
    S.set(sx * 9 - 0.5 * sx, 5, -26.5, p.black);
  }

  // 側面の陣営章（菱形）
  S.recolor((px, py, pz) => {
    if (Math.abs(px) < 12.2 || py < 3 || py > 8) return 0;
    const d = Math.abs(py - 5.5) + Math.abs(pz) * 0.8;
    if (d < 1.2) return p.white;
    return d < 2.6 ? p.cloth : 0;
  });

  // フェンダー上の装備（左: スコップ / 右: 燃料缶）
  boxC(S, [-19, 3.2, -6], [0.6, 0.6, 7], p.wood);
  boxC(S, [-19, 3.2, 2.5], [1.6, 0.5, 1.8], p.metal);
  for (const z of [-20, -16.8]) {
    boxC(S, [19, 4.4, z], [2.3, 1.8, 1.4], (_px, py) => (py > 5.8 ? p.armorDark : p.armor));
  }

  return S.spec(0.024);
}

/** 旋回砲塔（ピボット = 砲塔の底。+Z が砲口） */
export function buildTankTurret(team: Team): DragonPartSpec {
  const p = tankPalette(team);
  const S = new Sculpt(32, 32, 60, 16, 2, 18);
  const turretN = (px: number, py: number, pz: number) => {
    const k = 1 - Math.pow(Math.max(0, py - 1) / 9.5, 2.2) * 0.38;
    const rz = pz > 0 ? 11.5 : 13.5;
    return Math.pow(Math.abs(px) / (12 * k), 2.6) + Math.pow(Math.abs(pz) / (rz * k), 2.6);
  };

  // 丸みを帯びた鋳造砲塔（陣営色の帯を一周させる）
  S.region([-13, 0, -14], [13, 10, 12], (px, py, pz) => {
    const n = turretN(px, py, pz);
    if (n > 1) return 0;
    if (py < 1) return p.steel;
    if (py > 5 && py < 6.4 && n > 0.62) return p.cloth;
    const h = hash3(px, py, pz);
    if (py > 8.5) return h < 0.12 ? p.armor : p.armorLight;
    return h < 0.14 ? p.armorDark : p.armor;
  });

  // 防盾・長砲身・排煙器・マズルブレーキ
  boxC(S, [0, 4.5, 12], [5, 3, 2.2], (px, py) => (Math.abs(px) > 4.2 && Math.abs(py - 4.5) > 2.2 ? 0 : p.armorDark));
  S.tube([0, 4.5, 13], [0, 4.5, 33.5], 1.6, 1.6, p.gun);
  S.ellipsoid([0, 4.5, 22], [2.4, 2.4, 3.2], p.gun);
  boxC(S, [0, 4.5, 34.8], [2.4, 2.0, 1.8], (px, _py, pz) => (Math.abs(px) > 1.9 && pz < 35.5 && pz > 34 ? p.black : p.steel));
  S.set(-0.5, 4.5, 36.5, p.black);
  S.set(0.5, 4.5, 36.5, p.black);

  // 車長キューポラ（陣営色のハッチ）と装填手ハッチ
  cylinder(S, 'y', [5, 0, -4], 3.2, 9, 12, (r, px, _py, pz) => {
    if (r > 2.5 && Math.abs(Math.sin(Math.atan2(px - 5, pz + 4) * 3)) < 0.35) return p.periscope;
    return p.armorDark;
  });
  cylinder(S, 'y', [5, 0, -4], 2.6, 12, 12.9, () => p.cloth);
  cylinder(S, 'y', [-5, 0, -1], 2.4, 9.2, 10.3, () => p.armorDark);

  // 発煙弾発射機
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) S.tube([sx * 10.5, 5.5 + k * 1.2, 5.5], [sx * 12.5, 6 + k * 1.2, 7.5], 0.8, 0.8, p.gun);
  }

  // 後部の雑具箱と、陣営色の丸めた布
  S.tube([-8, 5.5, -15.5], [8, 5.5, -15.5], 2.0, 2.0, (_t, px) => (Math.abs(Math.abs(px) - 4) < 0.6 ? p.steel : p.cloth));
  for (const sx of [-1, 1]) S.tube([sx * 10.5, 8, -13], [sx * 10.5, 8, -17.5], 0.5, 0.5, p.steel);
  S.tube([-10.5, 8, -17.5], [10.5, 8, -17.5], 0.5, 0.5, p.steel);

  // アンテナと陣営旗
  boxC(S, [-9.5, 8.8, -10.5], [1, 0.8, 1], p.steel);
  S.box([-10, 8, -11], [-9, 27.5, -10], p.steel);
  const flag: ReadonlyArray<readonly [number, number]> = [
    [-11, 27.5],
    [-11, 23.5],
    [-16.5, 25.5],
  ];
  S.region([-10, 23, -17], [-9, 28, -10.5], (_px, py, pz) => {
    if (!insidePolygon(pz, py, flag)) return 0;
    return pz > -12.5 ? p.accent : p.cloth;
  });

  return S.spec(0.027);
}

/** 無限軌道（誘導輪・起動輪・6 つの転輪・サイドスカート）。左右で共用するのでスカートは両側に付ける */
export function buildTankTrack(team: Team): DragonPartSpec {
  const p = tankPalette(team);
  const S = new Sculpt(13, 18, 68, 6.5, 0, 34);
  const RO = 7.6;
  const RI = 5.9;
  const CY = 8;
  const CZ = 25.5;
  const stadium = (py: number, pz: number) => Math.hypot(py - CY, pz - Math.max(-CZ, Math.min(CZ, pz)));

  // 転輪（ゴムの縁・円盤・ハブ）
  for (const cz of [-18.5, -11, -3.7, 3.7, 11, 18.5]) {
    cylinder(S, 'x', [0, 6.4, cz], 4.3, -4.6, 4.6, (r) => (r > 3.4 ? p.rubber : r > 1.5 ? p.armorDark : p.metal));
  }
  // 起動輪（歯付き）と誘導輪
  cylinder(S, 'x', [0, CY, -CZ], 5.6, -4.2, 4.2, (r, _px, py, pz) => {
    if (r > 4.9) return Math.abs(Math.sin(Math.atan2(py - CY, pz + CZ) * 6)) < 0.5 ? p.steel : 0;
    return r > 1.6 ? p.armorDark : p.metal;
  });
  cylinder(S, 'x', [0, CY, CZ], 5.2, -4.2, 4.2, (r) => (r > 4.2 ? p.steel : r > 1.5 ? p.armorDark : p.metal));
  // 上部転輪
  for (const cz of [-9, 9]) cylinder(S, 'x', [0, 12.6, cz], 1.6, -3, 3, () => p.steel);

  // 履帯（一続きのベルト。リンクごとに明暗、接地面にグローサー）
  S.region([-6.5, 0, -34], [6.5, 16, 34], (px, py, pz) => {
    const d = stadium(py, pz);
    if (d < RI || d > RO) return 0;
    const s = Math.abs(pz) <= CZ ? pz : Math.sign(pz) * (CZ + Math.atan2(py - CY, Math.abs(pz) - CZ) * RO);
    const link = Math.floor((s + 100) / 1.6) % 2;
    if (d > RO - 0.8 && link === 0) return p.trackDark;
    if (Math.abs(px) > 4.8) return p.trackLight;
    return link === 0 ? p.track : p.trackLight;
  });

  // サイドスカート（パネルの継ぎ目・陣営色の帯・ボルト）
  const outer = (px: number) => Math.abs(px) > 5.4;
  S.region([-6.5, 9, -30.5], [6.5, 17.4, 30.5], (px, py, pz) => {
    if (!outer(px)) return 0;
    if (pz > 28 && py < 9.5 + (pz - 28) * 2) return 0;
    if (pz < -28 && py < 9.5 + (-28 - pz) * 2) return 0;
    if (py > 16.6) return p.armorLight;
    if (py > 13.5 && py < 14.6) return p.cloth;
    if (py > 15.6 && Math.floor(pz + 100) % 4 === 0) return p.metal;
    if (Math.floor(pz + 100) % 10 === 0) return p.armorDark;
    return hash3(px, py, pz) < 0.12 ? p.armorDark : p.armor;
  });

  return S.spec(0.023);
}

// ---------------------------------------------------------------
// 暴走バギー: ライトの目と牙のようなグリル・むき出しのエンジンと 4 本の排気管・
// パイプのロールケージに乗ったゴーグルのドライバー・大きな風船タイヤ
// ---------------------------------------------------------------

interface BuggyPalette {
  body: number;
  bodyDark: number;
  bodyLight: number;
  accent: number;
  frame: number;
  chrome: number;
  chromeDark: number;
  rubber: number;
  tread: number;
  sidewall: number;
  seat: number;
  light: number;
  lightBar: number;
  black: number;
  engine: number;
  enginePart: number;
  red: number;
  jacket: number;
  skin: number;
  lens: number;
  scarf: number;
  rim: number;
  rimHole: number;
}

function buggyPalette(team: Team): BuggyPalette {
  const tc = TEAM_COLORS[team];
  return {
    body: tc.shirt,
    bodyDark: shade(tc.shirt, 0.66),
    bodyLight: mix(tc.shirt, 0xffffff, 0.32),
    accent: tc.accent,
    frame: 0x2b2f36,
    chrome: 0xdfe4ea,
    chromeDark: 0x8d96a0,
    rubber: 0x1b1b1e,
    tread: 0x2a2a2f,
    sidewall: 0x313137,
    seat: 0x6b3f22,
    light: 0xfff1a8,
    lightBar: 0xffe066,
    black: 0x111214,
    engine: 0x4b5058,
    enginePart: 0x6c737c,
    red: 0xe03131,
    jacket: 0x343a40,
    skin: 0xf1c27d,
    lens: 0x7ad7ff,
    scarf: 0xe8590c,
    rim: 0xd5dbe1,
    rimHole: 0x3a3f47,
  };
}

/** 車体（ピボット = 骨盤）。前輪は (±17.1, -9.5, 14.3)、後輪は (±18.1, -7.6, -13.3) 付近 */
export function buildBuggyChassis(team: Team): DragonPartSpec {
  const p = buggyPalette(team);
  const S = new Sculpt(48, 22, 46, 24, 8, 23);

  // フレームと床
  for (const sx of [-1, 1]) S.tube([sx * 8, -2, -16], [sx * 8, -2, 18], 1.0, 1.0, p.frame);
  S.box([-8, -3, -15], [8, -1, 15], p.frame);

  // 運転席のバスタブ（中は空洞）
  S.box([-10, -1, -7], [10, 6.5, 9], (px, py, pz) => {
    if (Math.abs(px) < 8 && py > 1 && pz > -6 && pz < 7.5) return 0;
    if (py > 5.5) return p.bodyLight;
    return py < 1 ? p.bodyDark : p.body;
  });

  // ボンネット（前へなだらかに下がり、上面に 2 本のストライプ）
  S.region([-10, -2, 8], [10, 7, 20.5], (px, py, pz) => {
    const halfW = 10 - (pz - 8) * 0.15;
    const top = 7 - (pz - 8) * 0.25;
    const bottom = -1.5 + (pz - 8) * 0.08;
    if (Math.abs(px) > halfW || py > top || py < bottom) return 0;
    if (Math.abs(px) > halfW - 1 && py > top - 1) return 0;
    if (py > top - 1) return Math.abs(px) > 1.2 && Math.abs(px) < 3.2 ? p.accent : p.body;
    return py < bottom + 1 ? p.bodyDark : p.body;
  });

  // 側面パネルと、タイヤを覆う大きなフェンダー
  for (const sx of [-1, 1]) {
    S.box(sx < 0 ? [-13.5, -1, 7] : [9.5, -1, 7], sx < 0 ? [-9.5, 2, 19] : [13.5, 2, 19], p.body);
    S.box(sx < 0 ? [-13.5, -1, -18] : [10, -1, -18], sx < 0 ? [-10, 5, -7] : [13.5, 5, -7], p.body);
  }
  const fender = (cy: number, cz: number, rIn: number, rOut: number, xIn: number, xOut: number) => {
    S.region([-xOut, cy + 2, cz - rOut], [xOut, cy + rOut, cz + rOut], (px, py, pz) => {
      const ax = Math.abs(px);
      if (ax < xIn || ax > xOut) return 0;
      const d = Math.hypot(py - cy, pz - cz);
      if (d < rIn || d > rOut) return 0;
      if (d > rOut - 0.6 || ax > xOut - 0.8) return p.bodyDark;
      return p.body;
    });
  };
  fender(-9.5, 14.3, 8.8, 10.4, 13, 21.5);
  fender(-7.6, -13.3, 10.6, 12.2, 13.5, 23);

  // ライトの「目」・やんちゃな眉・牙のようなグリル・ブルバー
  for (const sx of [-1, 1]) {
    cylinder(S, 'z', [sx * 5.5, 1.9, 0], 2.3, 19.4, 21, (r) => (r > 1.5 ? p.chrome : p.light));
    S.tube([sx * 3, 4.5, 20.4], [sx * 8, 5.4, 19.8], 0.6, 0.6, p.bodyDark);
    S.tube([sx * 9.5, -3, 21], [sx * 9.5, 3, 21.3], 0.8, 0.8, p.chrome);
  }
  boxC(S, [0, 1.6, 20.3], [2.1, 1.6, 0.7], (px) => (Math.floor(px + 100) % 2 === 0 ? p.chrome : p.black));
  S.tube([-10.5, -2.6, 21.8], [10.5, -2.6, 21.8], 1.0, 1.0, p.chrome);
  boxC(S, [0, -3, 19], [7, 0.6, 2.5], p.chromeDark);

  // 運転席（シート・ダッシュボード・ハンドル）
  S.box([-4, 1, -6], [4, 3, 1], p.seat);
  S.box([-4, 3, -7], [4, 9, -5], p.seat);
  S.box([-7, 4, 6], [7, 6.5, 8], p.frame);
  S.tube([0, 5, 6.5], [0, 7, 3.6], 0.6, 0.6, p.frame);
  S.region([-3, 4.5, 2.4], [3, 10.5, 4], (px, py, pz) => {
    const r = Math.hypot(px, py - 7.6);
    return r > 1.5 && r < 2.7 && Math.abs(pz - 3.2) < 0.7 ? p.black : 0;
  });

  // むき出しの V 型エンジンとエアスクープ
  S.box([-6, 0, -16], [6, 7, -7], p.engine);
  for (const sx of [-1, 1]) {
    S.box(sx < 0 ? [-6.5, 7, -15] : [1.5, 7, -15], sx < 0 ? [-1.5, 9, -8] : [6.5, 9, -8], (_px, _py, pz) =>
      Math.floor(pz + 100) % 2 === 0 ? p.enginePart : p.chromeDark,
    );
  }
  S.box([-2.5, 7, -13], [2.5, 12, -9], (px, py, pz) => (pz > -9.6 && Math.abs(px) < 1.6 && py > 8.5 && py < 11 ? p.black : p.chrome));

  // 跳ね上がる 4 本の排気管
  for (const sx of [-1, 1]) {
    for (const dx of [2.5, 5]) {
      const tip: V3 = [sx * (dx + 0.8), 8, -21.5];
      S.chain([[sx * dx, 4, -16], [sx * dx, 4.5, -19], tip], [0.9, 0.9, 1.0], (t) => (t < 0.4 ? p.chromeDark : p.chrome));
      S.set(tip[0], 8.5, tip[2], p.black);
    }
    boxC(S, [sx * 11.8, 3, -18.3], [1.2, 1, 0.6], p.red);
  }
  S.tube([-11, -1.5, -19], [11, -1.5, -19], 0.9, 0.9, p.chrome);

  return S.spec(0.021);
}

/** ロールケージとドライバー（ピボットは車体上面。座面は y = -5 付近） */
export function buildBuggyCage(team: Team): DragonPartSpec {
  const p = buggyPalette(team);
  const S = new Sculpt(26, 35, 25, 13, 9, 13);

  // パイプのロールケージ
  const pipe = p.chromeDark;
  for (const sx of [-1, 1]) {
    S.tube([sx * 9, -2, 7], [sx * 7.5, 10.5, 3.5], 0.8, 0.8, pipe);
    S.tube([sx * 9, -2, -7.5], [sx * 8, 11.5, -6], 0.8, 0.8, pipe);
    S.tube([sx * 7.5, 10.5, 3.5], [sx * 8, 11.5, -6], 0.8, 0.8, pipe);
    S.tube([sx * 8, 11.5, -6], [sx * 5, -1, -10.5], 0.7, 0.7, pipe);
  }
  S.tube([-7.5, 10.5, 3.5], [7.5, 10.5, 3.5], 0.8, 0.8, pipe);
  S.tube([-8, 11.5, -6], [8, 11.5, -6], 0.8, 0.8, pipe);
  S.tube([-9, -2, -7.5], [8, 11.5, -6], 0.7, 0.7, pipe);

  // 屋根の補助灯バー
  boxC(S, [0, 11.6, 3.7], [6.2, 0.9, 0.8], p.black);
  for (const x of [-4.5, -1.5, 1.5, 4.5]) boxC(S, [x, 11.6, 4.4], [1.1, 0.7, 0.3], p.lightBar);

  // アンテナと陣営旗
  S.tube([8, 11.5, -6], [8.5, 24, -7], 0.45, 0.45, pipe);
  const flag: ReadonlyArray<readonly [number, number]> = [
    [-7, 24],
    [-7, 20.5],
    [-12.5, 22.5],
  ];
  S.region([8, 20, -13], [9, 24.5, -6.5], (_px, py, pz) => {
    if (!insidePolygon(pz, py, flag)) return 0;
    return pz > -8.2 ? p.accent : p.body;
  });

  // ドライバー（陣営色のヘルメット・ゴーグル・なびくスカーフ・ハンドルを握る手）
  S.ellipsoid([0, -4.2, -2.5], [3, 1.5, 2.5], p.jacket);
  S.ellipsoid([0, -1.2, -3.2], [3.2, 3.6, 2.4], (_nx, _ny, _nz, px) => (Math.abs(px) < 1 ? p.body : p.jacket));
  for (const sx of [-1, 1]) {
    S.chain([[sx * 3, 0.8, -3], [sx * 3.6, -0.8, 0.2], [sx * 2.2, -0.6, 2.8]], [1.1, 1.0, 0.95], p.jacket);
    S.ellipsoid([sx * 2, -0.6, 3.1], [1.1, 1.1, 1.1], p.black);
  }
  S.ellipsoid([0, 4.6, -2.6], [3.3, 3.4, 3.3], (_nx, _ny, _nz, px) => (Math.abs(px) < 0.8 ? 0xf8f9fa : p.body));
  S.recolor((px, py, pz) => {
    if (pz < -1.2) return 0;
    if (py > 4.4 && py < 6.2) return Math.abs(px) < 0.7 || Math.abs(px) > 2.6 ? p.black : p.lens;
    if (py > 1.4 && py <= 4.4) return p.skin;
    return 0;
  });
  for (const x of [-0.5, 0.5]) castPaint(S, [x, 2.5, 6], [0, 0, -1], 0x8a2b1a);
  S.chain([[0.5, 2.0, -5.2], [3, 2.6, -8.5], [5.5, 2.0, -10.2]], [1.0, 0.8, 0.6], p.scarf);

  return S.spec(0.021);
}

/** 風船のように丸いオフロードタイヤ（V 字トレッド・メッキのリム・陣営色のハブ）。X が車軸 */
export function buildBuggyWheel(team: Team, R: number, W: number): DragonPartSpec {
  const p = buggyPalette(team);
  const n = R + 1;
  const S = new Sculpt(W + 2, 2 * n, 2 * n, (W + 2) / 2, n, n);
  const halfW = W / 2;
  const rimR = R * 0.55;
  S.fill((px, py, pz) => {
    const d = Math.hypot(py, pz);
    if (d > R) return 0;
    const ax = Math.abs(px);
    if (d >= rimR) {
      // 肩の丸いタイヤ断面
      const shoulder = d > R - 2.2 ? Math.sqrt(Math.max(0, 1 - ((d - (R - 2.2)) / 2.4) ** 2)) : 1;
      if (ax > halfW * shoulder) return 0;
      if (d > R - 1.4) {
        const q = (Math.atan2(py, pz) * R) / 2.4 + (ax / halfW) * 0.8;
        if (q - Math.floor(q) > 0.58) return 0; // トレッドの溝
        return p.tread;
      }
      return Math.abs(d - R * 0.78) < 0.5 ? p.sidewall : p.rubber;
    }
    // リム（スポークの間はくぼませる）とハブ
    if (d < R * 0.22) return ax > halfW - 0.5 ? 0 : p.body;
    const spoke = Math.abs(Math.sin(Math.atan2(py, pz) * 2.5)) < 0.4;
    if (!spoke && d > R * 0.27 && d < R * 0.48) return ax > halfW - 2 ? 0 : p.rimHole;
    if (ax > halfW - 1) return 0;
    if (Math.abs(d - R * 0.33) < 0.5 && spoke) return p.chromeDark;
    return p.rim;
  });
  return S.spec(0.02);
}

// ---------------------------------------------------------------
// 巨大ロボット: 白と陣営色の装甲・胸のリアクター・大きな丸い目・トサカと角・
// 大きな肩当てと拳・どっしりした足
// ---------------------------------------------------------------

interface RobotPalette {
  white: number;
  whiteShade: number;
  frame: number;
  frameLight: number;
  team: number;
  teamDark: number;
  accent: number;
  yellow: number;
  eye: number;
  sparkle: number;
  coreRing: number;
  core: number;
  coreWhite: number;
  red: number;
  thruster: number;
  glow: number;
  visor: number;
  fist: number;
  fistLight: number;
  fistLine: number;
  sole: number;
}

function robotPalette(team: Team): RobotPalette {
  const tc = TEAM_COLORS[team];
  return {
    white: 0xeef1f4,
    whiteShade: 0xc9d0d8,
    frame: 0x2f343b,
    frameLight: 0x4a515b,
    team: tc.shirt,
    teamDark: shade(tc.shirt, 0.7),
    accent: tc.accent,
    yellow: 0xffc531,
    eye: 0x7ff6ff,
    sparkle: 0xffffff,
    coreRing: 0xdde3ea,
    core: 0x4fd8ff,
    coreWhite: 0xeaffff,
    red: 0xff4d5a,
    thruster: 0x5c636e,
    glow: 0x8ff0ff,
    visor: 0x111318,
    fist: 0x5b636e,
    fistLight: 0x7a838f,
    fistLine: 0x3f454d,
    sole: 0x24282e,
  };
}

const p4 = (v: number) => v * v * v * v;

/** 胴体（ピボット = 骨盤。肩は (±10.4, 19.6) 付近） */
export function buildRobotTorso(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(32, 30, 28, 16, 4, 13);

  // 骨盤・V 字の股間アーマー・前後左右のスカート
  S.box([-7, -2.5, -5], [7, 3.5, 5], p.frame);
  S.region([-4, -3.5, 3.5], [4, 4, 7], (px, py) => {
    if (Math.abs(px) > 0.8 + (py + 3.5) * 0.32) return 0;
    return Math.abs(px) < 0.8 ? p.yellow : p.white;
  });
  for (const sx of [-1, 1]) {
    S.box(sx < 0 ? [-8.5, -2.5, 4.5] : [3.5, -2.5, 4.5], sx < 0 ? [-3.5, 4, 7] : [8.5, 4, 7], (_px, py) => (py < -1.4 ? p.team : p.white));
    S.box(sx < 0 ? [-10.5, -1.5, -4.5] : [8, -1.5, -4.5], sx < 0 ? [-8, 5, 4.5] : [10.5, 5, 4.5], (_px, _py, pz) =>
      Math.abs(pz) < 1 ? p.team : p.white,
    );
  }
  S.box([-7, -1.5, -7], [7, 4, -5], p.white);

  // 腹部（段々の腹筋プレート）
  S.box([-5.5, 3, -4.5], [5.5, 8.5, 4.5], p.frame);
  S.box([-3.6, 3.5, 4.5], [3.6, 8, 5.6], (_px, py) => (Math.floor(py + 100) % 2 === 0 ? p.white : p.frameLight));

  // 逆台形の厚い胸板（陣営色。肩口と側面は白）
  const halfX = (py: number) => 11.5 - Math.max(0, 11 - py) * 0.55;
  const zf = (py: number) => 8.5 - Math.max(0, py - 18) * 0.8 - Math.max(0, 10.5 - py) * 0.5;
  S.region([-12, 8, -7], [12, 20.5, 9], (px, py, pz) => {
    const hx = halfX(py);
    const f = zf(py);
    if (Math.abs(px) > hx || pz > f || pz < -6.5) return 0;
    if (Math.abs(px) > hx - 1.2 && (pz > f - 1.2 || py > 19.5)) return 0;
    if (pz < -5) return p.frameLight;
    if (py > 18.6 || Math.abs(px) > hx - 2.2) return p.white;
    return p.team;
  });
  // 胸の黄色い吸気口
  S.recolor((px, py, pz) => {
    if (S.get(px, py, pz + 1) !== 0) return 0;
    if (Math.abs(px) > 4.5 && Math.abs(px) < 9 && py > 12 && py < 16) return Math.floor(py + 100) % 2 === 0 ? p.yellow : p.frame;
    return 0;
  });
  // 胸の中央で輝くリアクター（ロボットの「心臓」）
  cylinder(S, 'z', [0, 13.5, 0], 3.2, 7.5, 10, (r) => (r > 2.3 ? p.coreRing : r > 1.2 ? p.core : p.coreWhite));

  // 首まわり・肩のヨーク・肩関節
  S.box([-4, 20, -3.5], [4, 22.5, 3.5], p.frame);
  for (const sx of [-1, 1]) {
    S.box(sx < 0 ? [-10, 19.5, -5] : [5, 19.5, -5], sx < 0 ? [-5, 22, 5] : [10, 22, 5], p.white);
    S.ellipsoid([sx * 11, 19.5, 0], [3.2, 3.2, 3.2], p.frame);
  }

  // 背中のバックパック・2 基のスラスター・陣営色のフィン
  S.box([-8, 9, -11.5], [8, 21, -6], p.white);
  S.box([-6, 10, -12.5], [6, 20, -11.5], p.frame);
  for (const sx of [-1, 1]) {
    cylinder(S, 'y', [sx * 4.5, 0, -9], 2.6, 6.5, 10, (r, _px, py) => (r > 1.6 ? p.thruster : py < 7.5 ? p.glow : p.frame));
    S.region(sx < 0 ? [-13.5, 14, -10.5] : [8, 14, -10.5], sx < 0 ? [-8, 23, -9] : [13.5, 23, -9], (px, py) => {
      const x = Math.abs(px);
      if (py < 14 + (x - 8) * 0.4 || py > 23 - (x - 8) * 1.2) return 0;
      return py > 22 - (x - 8) * 1.2 ? p.white : p.team;
    });
  }

  return S.spec(0.023);
}

/** 頭部（ピボット = 首の付け根） */
export function buildRobotHead(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(28, 30, 28, 14, 5, 14);

  S.tube([0, -4, 0], [0, 1.5, 0], 2.4, 2.4, p.frame);
  // 角の丸いヘルメット（頭頂に陣営色のライン）
  S.region([-7, 0, -7], [7, 13, 8], (px, py, pz) => {
    if (p4(px / 6.6) + p4((py - 6.3) / 6.5) + p4((pz - 0.3) / 7) > 1) return 0;
    if (py > 10 && Math.abs(px) < 2.2) return p.team;
    return hash3(px, py, pz) < 0.1 ? p.whiteShade : p.white;
  });
  // 顔のくぼみ・フェイスプレート・バイザー
  S.carve([-5, 0.5, 4.5], [5, 8.6, 8], () => true);
  S.box([-4.6, 0.8, 4.2], [4.6, 8.4, 5.6], p.frame);
  S.box([-4.6, 5, 5.6], [4.6, 8.2, 6.4], p.visor);
  // 大きく光る丸い目
  for (const sx of [-1, 1]) {
    S.box(sx < 0 ? [-4.2, 5.3, 6] : [1.2, 5.3, 6], sx < 0 ? [-1.2, 7.9, 7] : [4.2, 7.9, 7], (px, py) =>
      Math.abs(px) > 3 && (py < 5.8 || py > 7.4) ? p.visor : p.eye,
    );
    S.set(sx * 1.5, 7.5, 6.5, p.sparkle);
  }
  // 口元のスリット
  S.box([-3, 1.5, 5.6], [3, 4, 6.2], (_px, py) => (Math.floor(py + 100) % 2 === 0 ? p.frameLight : p.visor));
  // 頬当て・耳のセンサー
  for (const sx of [-1, 1]) {
    S.ellipsoid([sx * 5.6, 2.6, 5], [1.6, 2.8, 2.6], p.white);
    cylinder(S, 'x', [0, 6, 0], 2.8, sx * 6, sx * 8.6, (r) => (r < 1.1 ? p.yellow : p.team));
  }
  // 額の宝石・中央のトサカ・左右の角
  S.ellipsoid([0, 9.3, 7.6], [1.4, 1.3, 1], p.red);
  const crest: ReadonlyArray<readonly [number, number]> = [
    [6.5, 10],
    [2, 19.5],
    [-1.5, 18],
    [-2, 11],
  ];
  S.region([-0.9, 9, -4], [0.9, 20, 8], (_px, py, pz) => (insidePolygon(pz, py, crest) ? p.accent : 0));
  for (const sx of [-1, 1]) {
    S.chain([mirror([2.4, 10, 5.6], sx), mirror([5.8, 14, 6.4], sx), mirror([8, 17.5, 4.8], sx)], [1.1, 0.85, 0.45], p.yellow);
  }
  // 後頭部の排気口
  S.box([-3, 3, -7.4], [3, 7, -6.6], p.frame);

  return S.spec(0.021);
}

/** 上腕（付け根に大きな丸い肩当て） */
export function buildRobotUpperArm(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(18, 21, 18, 9, 6, 9);
  S.ellipsoid([0, 0, 0], [3, 3, 3], p.frame);
  S.tube([0, 4, 0], [0, 12.5, 0], 3.2, 3.0, (_t, _px, py) => (py > 11 ? p.frame : p.white));
  S.ellipsoid([0, 13.5, 0], [3.1, 2.6, 3.1], p.frame);
  S.ellipsoid([0, 0.5, 0], [6.6, 5.2, 6.4], (_nx, ny) => (ny > 0.55 ? p.white : ny < -0.7 ? p.teamDark : p.team));
  return S.spec(0.022);
}

/** 前腕（ガントレットと大きな拳。拳の正面が +Z） */
export function buildRobotForearm(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(16, 21, 16, 8, 2, 8);
  S.region([-4.4, 0, -4.4], [4.4, 10.5, 4.6], (px, py, pz) => {
    if (p4(px / 4.4) + p4((pz - 0.1) / 4.5) > 1) return 0;
    if (py > 8.4) return p.team;
    if (pz > 3.6 && py > 2.5 && py < 6.5 && Math.abs(px) < 2) return Math.floor(py + 100) % 2 === 0 ? p.yellow : p.frame;
    return p.white;
  });
  S.region([-4, 10.5, -3.6], [4, 17, 5], (px, py, pz) => {
    if (p4(px / 4) + p4((py - 13.75) / 3.4) + p4((pz - 0.7) / 4.4) > 1) return 0;
    if (pz > 3 && py > 12 && Math.floor(px + 100) % 2 === 0) return p.fistLine;
    return pz > 3.4 ? p.fistLight : p.fist;
  });
  return S.spec(0.022);
}

/** 腿（股関節の球・陣営色の側面装甲・膝関節） */
export function buildRobotThigh(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(16, 25, 16, 8, 3.5, 8);
  S.ellipsoid([0, 0, 0], [3.3, 3.3, 3.3], p.frame);
  S.region([-4.4, 2, -4.7], [4.4, 17, 4.7], (px, py, pz) => {
    if (p4(px / 4.4) + p4(pz / 4.7) > 1) return 0;
    if (py > 9.5 && py < 10.5) return p.frameLight;
    if (Math.abs(px) > 3.4 && py > 5 && py < 14) return p.team;
    return p.white;
  });
  S.ellipsoid([0, 18.5, 0], [3, 3, 3], p.frame);
  return S.spec(0.022);
}

/** 脛と足（膝当て・脛の陣営色ライン・ふくらはぎの排気口・つま先の上がった大きな足） */
export function buildRobotShin(team: Team): DragonPartSpec {
  const p = robotPalette(team);
  const S = new Sculpt(18, 28, 24, 9, 3.5, 10);
  S.region([-5, 1.5, -4.8], [5, 17.5, 5.2], (px, py, pz) => {
    if (p4(px / 4.9) + p4((pz - 0.2) / 5) > 1) return 0;
    if (pz > 4 && Math.abs(px) < 1.4 && py > 6) return p.team;
    if (pz < -3.8 && py > 6 && py < 12 && Math.abs(px) < 2.5) return Math.floor(py + 100) % 2 === 0 ? p.frame : p.frameLight;
    return p.white;
  });
  S.ellipsoid([0, 1.5, 4], [3.9, 3.6, 2.4], (nx, ny) => (Math.hypot(nx, ny) < 0.4 ? p.yellow : p.team));
  S.ellipsoid([0, 18, 0], [3, 2.4, 3], p.frame);
  S.region([-5.4, 17.5, -6], [5.4, 23.6, 11], (px, py, pz) => {
    if (py < 17.5 + Math.max(0, pz - 4) * 0.55) return 0;
    if (p4(px / 5.4) + p4((pz - 2.5) / 8.5) > 1) return 0;
    if (py > 22.6) return p.sole;
    if (pz > 6) return p.team;
    return pz < -3.5 ? p.frameLight : p.white;
  });
  return S.spec(0.022);
}
