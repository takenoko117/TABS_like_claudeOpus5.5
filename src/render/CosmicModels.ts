import { TEAM_COLORS, type Team, type UnitTypeId } from '../units/UnitTypes';
import { Sculpt, hash3, mirror, type DragonPartSpec, type V3 } from './DragonModel';

/**
 * 第8弾ユニット（大タコ・マッコウクジラ＆ダイオウイカ・たこ焼き・ザ・アース・ザ・ユニバース・
 * 〇VIDIA・UFO）の彫刻的なボクセルモデル。大剣士は通常の人型モデル＋大剣を使う。
 *
 * 座標はすべて「ピボット原点からのボクセル単位」。+X = 右, +Y = 上, +Z = 前。
 * 四肢は +Y が付け根→先端。胴体は骨盤、頭は CosmicModels を使う兵種では
 * VoxelCharacterVisual.syncCosmicBody が決める位置に置かれる。
 */

export interface CosmicModelSet {
  head: DragonPartSpec;
  torso: DragonPartSpec;
  upperArm: DragonPartSpec;
  forearm: DragonPartSpec;
  thigh: DragonPartSpec;
  shin: DragonPartSpec;
}

/** 胴体と頭を、肩の向きではなく水平な正面基準で置く兵種（syncCosmicBody を使う） */
export const COSMIC_BODY_IDS: ReadonlySet<UnitTypeId> = new Set<UnitTypeId>([
  'giant_octopus',
  'whale_squid',
  'the_earth',
  'the_universe',
  'ufo',
]);

/** 第8弾のボクセルモデル一式を作る（対象外なら null） */
export function buildCosmicModelSet(id: UnitTypeId, team: Team): CosmicModelSet | null {
  switch (id) {
    case 'giant_octopus':
      return buildOctopus(team);
    case 'whale_squid':
      return buildWhaleSquid(team);
    case 'takoyaki':
      return buildTakoyaki(team);
    case 'the_earth':
      return buildEarth(team);
    case 'the_universe':
      return buildUniverse(team);
    case 'ovidia':
      return buildOvidia(team);
    case 'ufo':
      return buildUfo(team);
    default:
      return null;
  }
}

// ---- 共通の部品 ----

type LimbColor = (t: number, px: number, py: number, pz: number) => number;

/** +Y 方向に伸びるテーパー付きの手足（length はスケール 1 での長さ） */
function limb(length: number, voxels: number, r0: number, r1: number, color: number | LimbColor): DragonPartSpec {
  const rm = Math.ceil(Math.max(r0, r1)) + 2;
  const S = new Sculpt(rm * 2 + 1, voxels + 2, rm * 2 + 1, rm, 0, rm);
  S.tube([0, 0.5, 0], [0, voxels - 0.5, 0], r0, r1, color);
  return S.spec(length / voxels);
}

/** 先端に球が付いた手足（衛星・惑星・星団など）。棒は細く、球は endR */
function orb(length: number, voxels: number, endR: number, stick: number, color: (nx: number, ny: number, nz: number, px: number, py: number, pz: number) => number): DragonPartSpec {
  const rm = Math.ceil(endR) + 2;
  const S = new Sculpt(rm * 2 + 1, voxels + rm + 2, rm * 2 + 1, rm, 0, rm);
  if (stick > 0) S.tube([0, 0.5, 0], [0, voxels - endR, 0], 0.5, 0.5, stick);
  S.ellipsoid([0, voxels, 0], [endR, endR, endR], color);
  return S.spec(length / voxels);
}

// ---- 大タコ ----

function buildOctopus(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  const base = 0xe8590c;
  const dark = 0xc2410c;
  const light = 0xffa94d;
  const sucker = 0xffe8cc;
  const skin = (_nx: number, ny: number, _nz: number, px: number, py: number, pz: number) => {
    const h = hash3(px, py, pz);
    if (h < 0.08) return light;
    if (ny > 0.6 && h < 0.3) return dark;
    return base;
  };

  // 頭（外套膜）: 後ろへ膨らむ大きな頭と、正面の大きな目
  const H = new Sculpt(22, 24, 22, 11, 2, 11);
  H.ellipsoid([0, 9, -2], [8, 9.5, 8.5], skin);
  H.ellipsoid([0, 2, 1], [7.5, 4, 7], skin);
  for (const sx of [-1, 1]) {
    H.ellipsoid(mirror([4.2, 4, 6.2], sx), [2.6, 2.6, 2], 0xfff9db);
    H.ellipsoid(mirror([4.4, 4, 7.6], sx), [1.2, 1.6, 0.8], 0x181820);
    H.set(4.4 * sx - 0.4, 4.8, 8.2, 0xffffff);
  }
  // ハチマキ（陣営色）
  H.recolor((_px, py, _pz, c) => (c !== 0 && py > 6.4 && py < 8.1 ? tc.shirt : 0));
  const head = H.spec(0.05);

  // 胴体: 丸い胴と、四隅から地面へ伸びる 4 本の足（残り 4 本は両腕・両脚）
  const T = new Sculpt(30, 18, 30, 15, 14, 15);
  T.ellipsoid([0, 0, 0], [6.5, 4.5, 6.5], skin);
  const suckerColor = (t: number, px: number, py: number, pz: number) => {
    // 足の内側（下向き）に吸盤の列
    const h = hash3(px, py, pz);
    return py < -3 && h > 0.55 && t > 0.15 ? sucker : t > 0.75 ? light : base;
  };
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    T.chain(
      [
        [4 * sx, -1, 4 * sz],
        [8 * sx, -6, 8 * sz],
        [11 * sx, -11, 10 * sz],
        [13 * sx, -13, 13 * sz],
      ],
      [2.6, 2.1, 1.4, 0.8],
      suckerColor,
    );
  }
  const torso = T.spec(0.05);

  const tentacle = (t: number, px: number, py: number, pz: number) =>
    pz > 0.6 && hash3(px, py, pz) > 0.5 ? sucker : t > 0.7 ? light : base;
  return {
    head,
    torso,
    upperArm: limb(0.44, 9, 1.9, 1.5, tentacle),
    forearm: limb(0.36, 8, 1.5, 0.6, tentacle),
    thigh: limb(0.44, 9, 1.9, 1.5, tentacle),
    shin: limb(0.36, 8, 1.5, 0.6, tentacle),
  };
}

// ---- マッコウクジラ＆ダイオウイカ ----

function buildWhaleSquid(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  const grey = 0x495057;
  const greyDark = 0x343a40;
  const belly = 0xadb5bd;
  const squid = 0xc92a2a;
  const squidLight = 0xff8787;
  const whaleSkin = (_nx: number, ny: number, _nz: number, px: number, py: number, pz: number) => {
    const h = hash3(px, py, pz);
    if (ny < -0.55) return belly;
    return h < 0.12 ? greyDark : h > 0.95 ? 0x868e96 : grey;
  };

  // 胴体: 四角く大きな頭の巨体（+Z が前）、尾びれ、背中に巻き付くイカの腕
  const T = new Sculpt(22, 20, 44, 11, 9, 22);
  T.box([-6, -5, 4], [6, 6, 20], (px, py, pz) => (py < -3.5 ? belly : hash3(px, py, pz) < 0.1 ? greyDark : grey));
  T.ellipsoid([0, 0, 2], [7, 6.5, 10], whaleSkin);
  T.ellipsoid([0, -0.5, -10], [5.2, 5, 10], whaleSkin);
  T.tube([0, 0, -18], [0, 0.5, -20.5], 2.2, 1.2, grey);
  // 尾びれ
  for (const sx of [-1, 1]) T.tube([0, 0.5, -20], mirror([8, 1.2, -21.5], sx), 1.4, 0.6, greyDark);
  // 細い下あごと歯
  T.box([-2, -7, 6], [2, -5, 19], belly);
  for (let z = 8; z <= 18; z += 2) {
    T.set(-2, -4.6, z, 0xf8f9fa);
    T.set(1.5, -4.6, z, 0xf8f9fa);
  }
  // 小さな目と、背中の陣営色の傷跡
  for (const sx of [-1, 1]) T.set(6.2 * sx, -1.5, 5, 0x111111);
  T.box([-1, 6, -6], [1, 7, 0], tc.shirt);
  // ダイオウイカの腕が巨体に巻き付く（らせん）
  for (let k = 0; k < 3; k++) {
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = k * 2.1 + i * 0.7;
      const z = 14 - i * 2.4;
      const r = 7.4 - i * 0.12;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.95, z]);
    }
    T.chain(pts, pts.map((_, i) => 1.3 - i * 0.05), (t, px, py, pz) =>
      hash3(px, py, pz) > 0.7 ? squidLight : t > 0.8 ? squidLight : squid,
    );
  }
  const torso = T.spec(0.07);

  // 頭: クジラの額にしがみつくダイオウイカの外套膜と巨大な目
  const H = new Sculpt(16, 14, 22, 8, 3, 8);
  H.ellipsoid([0, 3, -2], [4.5, 3.6, 9], (_nx, _ny, nz, px, py, pz) =>
    nz < -0.7 ? squidLight : hash3(px, py, pz) < 0.15 ? squidLight : squid,
  );
  H.ellipsoid([0, 3, -10], [5.5, 1.2, 2.5], squid); // ひれ
  for (const sx of [-1, 1]) {
    H.ellipsoid(mirror([4, 3.2, 5], sx), [1.8, 1.8, 1.8], 0xffd43b);
    H.ellipsoid(mirror([4.8, 3.2, 5.2], sx), [0.9, 1.1, 1.1], 0x111111);
  }
  // 額をつかむ短い腕
  for (const sx of [-1, 0, 1]) H.tube([sx * 2, 1.5, 6], [sx * 3.5, -1.5, 12], 1.2, 0.6, squid);
  const head = H.spec(0.07);

  const tentacle = (t: number, px: number, py: number, pz: number) =>
    pz > 0.5 && hash3(px, py, pz) > 0.55 ? 0xffe3e3 : t > 0.6 ? squidLight : squid;
  const flipper = (_t: number, px: number, py: number, pz: number) => (hash3(px, py, pz) < 0.15 ? greyDark : grey);
  return {
    head,
    torso,
    // 胸びれ（平たい）
    upperArm: flatFin(0.42, 8, 3.2, flipper),
    forearm: flatFin(0.3, 7, 2.2, flipper),
    // イカの長い触腕
    thigh: limb(0.55, 11, 1.5, 1.2, tentacle),
    shin: limb(0.5, 11, 1.3, 0.5, tentacle),
  };
}

/** 平たいひれ（X 方向に幅広、Z 方向に薄い） */
function flatFin(length: number, voxels: number, halfW: number, color: LimbColor): DragonPartSpec {
  const rm = Math.ceil(halfW) + 2;
  const S = new Sculpt(rm * 2 + 1, voxels + 2, 5, rm, 0, 2);
  for (let y = 0; y < voxels; y++) {
    const t = y / voxels;
    const w = halfW * (1 - t * 0.6);
    for (let x = -w; x <= w; x += 1) S.set(x, y + 0.5, 0, color(t, x, y, 0));
  }
  return S.spec(length / voxels);
}

// ---- たこ焼き ----

/** ソース・マヨネーズ・青のり・かつお節がかかったたこ焼き 1 個 */
function takoyakiBall(S: Sculpt, c: V3, r: number, toppings: boolean): void {
  const batter = 0xc9832e;
  const crisp = 0x9c5a1c;
  const sauce = 0x5c2d0e;
  S.ellipsoid(c, [r, r * 0.95, r], (_nx, ny, _nz, px, py, pz) => {
    const h = hash3(px, py, pz);
    if (toppings && ny > 0.35) {
      if (h > 0.93) return 0x2f9e44; // 青のり
      if (h > 0.88) return 0xf783ac; // かつお節
      // マヨネーズの斜めの線
      if (Math.abs((px - c[0]) + (pz - c[2]) * 0.6) % 3.2 < 0.7 && ny > 0.5) return 0xfff9db;
      return sauce;
    }
    return h < 0.18 ? crisp : batter;
  });
}

function buildTakoyaki(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  // 頭: 顔のあるたこ焼き＋つまようじ
  const H = new Sculpt(18, 22, 18, 9, 1, 9);
  takoyakiBall(H, [0, 7, 0], 7, true);
  for (const sx of [-1, 1]) {
    H.box(mirror([2.5, 6.5, 6.4], sx), mirror([3.6, 8.2, 7.2], sx), 0x181820);
    H.set(2.4 * sx, 8.1, 7.0, 0xffffff);
  }
  H.box([-1.5, 4, 6.6], [1.5, 4.6, 7.2], 0x7a1f1f); // 口
  H.box([-6, 4.8, 5.6], [-4.6, 5.6, 6.6], 0xff8787); // ほっぺ
  H.box([4.6, 4.8, 5.6], [6, 5.6, 6.6], 0xff8787);
  H.tube([1, 12, -1], [3.5, 20, -3], 0.5, 0.5, 0xe9c46a); // つまようじ
  H.set(3.5, 20.4, -3, tc.shirt);
  const head = H.spec(0.04);

  // 胴体: 舟皿（経木）に乗ったたこ焼き 2 個
  const T = new Sculpt(18, 14, 14, 9, 1, 7);
  T.box([-7.5, 0, -4.5], [7.5, 2, 4.5], 0xd9a066);
  T.box([-6.5, 2, -3.5], [6.5, 2.5, 3.5], 0xe9c48a);
  T.box([-7.5, 1, 4.5], [7.5, 1.5, 4.5], tc.shirt);
  takoyakiBall(T, [-3.2, 5.5, 0], 3.6, true);
  takoyakiBall(T, [3.2, 5.5, 0], 3.6, true);
  const torso = T.spec(0.035);

  const pick = 0xe9c46a;
  return {
    head,
    torso,
    upperArm: limb(0.24, 7, 0.6, 0.6, pick),
    forearm: limb(0.22, 6, 0.6, 0.5, pick),
    thigh: limb(0.36, 8, 0.7, 0.7, pick),
    shin: limb(0.34, 8, 0.7, 0.6, pick),
  };
}

// ---- ザ・アース ----

/** 経度・緯度から陸地か判定する（決め打ちの波の重ね合わせで大陸らしい形にする） */
function isLand(nx: number, ny: number, nz: number): boolean {
  const lon = Math.atan2(nz, nx);
  const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
  const v =
    Math.sin(lon * 2 + 0.6) * Math.cos(lat * 2.2) +
    0.55 * Math.sin(lon * 5 + 1.3) * Math.sin(lat * 3.1 + 0.4) +
    0.3 * Math.cos(lon * 9 - lat * 4);
  return v > 0.42;
}

function buildEarth(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  // 頭 = 地球本体（中心がピボット）
  const R = 11;
  const H = new Sculpt(R * 2 + 3, R * 2 + 3, R * 2 + 3, R + 1, R + 1, R + 1);
  H.ellipsoid([0, 0, 0], [R, R, R], (nx, ny, nz, px, py, pz) => {
    const h = hash3(px, py, pz);
    if (Math.abs(ny) > 0.86) return 0xf8f9fa; // 極地の氷
    if (isLand(nx, ny, nz)) {
      if (Math.abs(ny) < 0.3 && h > 0.6) return 0xe9c46a; // 赤道付近の砂漠
      return h < 0.25 ? 0x2b8a3e : 0x40c057;
    }
    if (h > 0.97) return 0xf8f9fa; // 雲
    return h < 0.3 ? 0x1864ab : 0x1c7ed6;
  });
  // 陣営色の小さな旗（北極に立つ）
  H.tube([0, R - 0.5, 0], [0, R + 0.8, 0], 0.4, 0.4, 0x868e96);
  H.set(1, R + 0.8, 0, tc.shirt);
  const head = H.spec(0.05);

  // 胴体 = 地球の中に隠れる小さな核（当たり判定・部位破壊の受け皿）
  const T = new Sculpt(7, 7, 7, 3, 3, 3);
  T.ellipsoid([0, 0, 0], [3, 3, 3], 0xff6b35);
  const torso = T.spec(0.05);

  const moon = (_nx: number, _ny: number, _nz: number, px: number, py: number, pz: number) => {
    const h = hash3(px, py, pz);
    return h < 0.2 ? 0x868e96 : h > 0.9 ? 0x495057 : 0xced4da;
  };
  const satellite = (_nx: number, ny: number, _nz: number) => (Math.abs(ny) < 0.35 ? 0x339af0 : 0xdee2e6);
  return {
    head,
    torso,
    upperArm: orb(0.3, 6, 1.6, 0, satellite), // 人工衛星
    forearm: orb(0.34, 6, 3.2, 0, moon), // 月
    thigh: orb(0.3, 6, 1.6, 0, satellite),
    shin: orb(0.3, 6, 2.0, 0, moon), // 小惑星
  };
}

// ---- ザ・ユニバース ----

function buildUniverse(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  const R = 11;
  // 頭 = 宇宙そのものを閉じ込めた球（渦巻銀河・星雲・星）
  const H = new Sculpt(R * 2 + 3, R * 2 + 3, R * 2 + 3, R + 1, R + 1, R + 1);
  H.ellipsoid([0, 0, 0], [R, R, R], (nx, ny, nz, px, py, pz) => {
    const h = hash3(px, py, pz);
    const lon = Math.atan2(nz, nx);
    const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
    // 2 本の渦巻腕
    const arm = Math.sin(lon * 2 - lat * 5);
    if (h > 0.96) return 0xffffff; // 星
    if (h > 0.93) return 0x74c0fc;
    if (arm > 0.82) return h < 0.5 ? 0xb197fc : 0xe599f7;
    if (arm > 0.6) return 0x5f3dc4;
    if (Math.abs(lat) < 0.15 && h < 0.4) return 0x3b5bdb; // 天の川の帯
    return h < 0.5 ? 0x1a1033 : 0x24124d;
  });
  H.ellipsoid([0, 0, R - 1.5], [2.2, 2.2, 1.5], 0xffd43b); // 銀河の中心核（正面）
  const head = H.spec(0.05);

  // 胴体 = 宇宙を取り巻く光の円盤（降着円盤）
  const D = 16;
  const T = new Sculpt(D * 2 + 3, 7, D * 2 + 3, D + 1, 3, D + 1);
  T.fill((px, py, pz) => {
    const r = Math.hypot(px, pz);
    if (r < 9 || r > D || Math.abs(py) > 1.2 - (r - 9) * 0.08) return 0;
    const h = hash3(px, py, pz);
    if (h > 0.92) return 0xffffff;
    return r < 11.5 ? 0xffd43b : r < 14 ? (h < 0.5 ? 0xff922b : 0xf76707) : h < 0.6 ? tc.shirt : 0x7048e8;
  });
  const torso = T.spec(0.05);

  const star = (_nx: number, _ny: number, _nz: number, px: number, py: number, pz: number) =>
    hash3(px, py, pz) < 0.3 ? 0xfff3bf : 0xffd43b;
  const planet = (_nx: number, ny: number, _nz: number, px: number, py: number, pz: number) => {
    const band = Math.floor((ny + 1) * 4) % 2 === 0;
    return hash3(px, py, pz) < 0.1 ? 0x9775fa : band ? 0xd0bfff : 0x845ef7;
  };
  return {
    head,
    torso,
    upperArm: orb(0.3, 6, 1.4, 0, star), // 恒星
    forearm: ringedPlanet(0.38, 6, 2.6, planet), // 輪のある惑星
    thigh: orb(0.3, 6, 1.4, 0, star),
    shin: orb(0.34, 6, 2.2, 0, (_nx, _ny, _nz, px, py, pz) => (hash3(px, py, pz) < 0.4 ? 0x4dabf7 : 0x1971c2)), // 青い惑星
  };
}

/** 輪のある惑星（土星のような） */
function ringedPlanet(
  length: number,
  voxels: number,
  r: number,
  color: (nx: number, ny: number, nz: number, px: number, py: number, pz: number) => number,
): DragonPartSpec {
  const rr = Math.ceil(r * 1.9) + 1;
  const S = new Sculpt(rr * 2 + 1, voxels + rr + 2, rr * 2 + 1, rr, 0, rr);
  S.ellipsoid([0, voxels, 0], [r, r, r], color);
  S.region([-rr, voxels - 0.6, -rr], [rr, voxels + 0.6, rr], (px, _py, pz) => {
    const d = Math.hypot(px, pz);
    return d > r + 0.8 && d < r * 1.9 ? 0xffe8cc : 0;
  });
  return S.spec(length / voxels);
}

// ---- 〇VIDIA ----

function buildOvidia(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  const green = 0x76b900;
  const shroud = 0x212529;
  const metal = 0x495057;

  // 胴体: 縦置きのグラフィックボード（正面に 2 連ファン、下に金の端子）
  const T = new Sculpt(16, 13, 7, 8, 0, 3);
  T.box([-7.5, 0.5, -2.5], [7.5, 12, 2.5], shroud);
  T.box([-7.5, 0.5, -2.5], [7.5, 1.5, 2.5], 0x2b8a3e); // 基板
  T.box([-6, 0, -0.5], [2, 0.5, 0.5], 0xe9c46a); // PCIe の金端子
  for (const fx of [-3.6, 3.6]) {
    T.region([fx - 3.4, 2.5, 2.5], [fx + 3.4, 10.5, 3.5], (px, py) => {
      const d = Math.hypot(px - fx, py - 6.5);
      if (d > 3.4) return 0;
      if (d < 0.9) return 0x868e96;
      // ファンの羽根
      const a = Math.atan2(py - 6.5, px - fx);
      return Math.sin(a * 5 + d) > 0.2 ? 0x343a40 : 0x181a1b;
    });
  }
  T.box([-7.5, 11, 2.5], [7.5, 12, 3.5], green); // 発光ライン
  T.box([-7.5, 0.5, -2.5], [-6.5, 12, 3.5], tc.shirt);
  const torso = T.spec(0.034);

  // 頭: GPU チップ（基板＋銀のダイ＋緑の「〇」）
  const H = new Sculpt(14, 12, 14, 7, 0, 7);
  H.box([-6.5, 0, -6.5], [6.5, 2, 6.5], 0x2b8a3e);
  H.box([-4.5, 2, -4.5], [4.5, 5, 4.5], 0xced4da);
  H.box([-3.5, 5, -3.5], [3.5, 6, 3.5], metal);
  H.region([-6.5, 2, 5.5], [6.5, 11, 7], (px, py) => {
    const d = Math.hypot(px, py - 7);
    return d > 2.2 && d < 3.6 ? green : 0;
  });
  // 基板の端のピン
  for (let x = -6; x <= 6; x += 2) {
    H.set(x, 0.5, -7, 0xe9c46a);
    H.set(x, 0.5, 6.9, 0xe9c46a);
  }
  const head = H.spec(0.034);

  const cable = (t: number) => (t > 0.85 ? green : shroud);
  return {
    head,
    torso,
    upperArm: limb(0.3, 8, 1.4, 1.2, cable),
    forearm: limb(0.28, 8, 1.2, 1.5, cable),
    thigh: limb(0.42, 10, 1.6, 1.4, cable),
    shin: limb(0.42, 10, 1.4, 1.8, cable),
  };
}

// ---- UFO ----

function buildUfo(team: Team): CosmicModelSet {
  const tc = TEAM_COLORS[team];
  // 胴体: 円盤（縁に光る窓、底に吸い上げビームの発射口）
  const R = 13;
  const T = new Sculpt(R * 2 + 3, 9, R * 2 + 3, R + 1, 4, R + 1);
  T.ellipsoid([0, 0, 0], [R, 2.6, R], (nx, ny, nz, px, py, pz) => {
    const r = Math.hypot(nx, nz);
    if (Math.abs(ny) < 0.35 && r > 0.85) {
      const a = Math.atan2(pz, px);
      return Math.sin(a * 8) > 0.6 ? 0xffd43b : Math.sin(a * 8) < -0.6 ? tc.shirt : 0x868e96;
    }
    if (ny < -0.6 && r < 0.3) return 0xfff3bf;
    return hash3(px, py, pz) < 0.1 ? 0xced4da : ny > 0 ? 0xadb5bd : 0x868e96;
  });
  const torso = T.spec(0.05);

  // 頭: ガラスのドームと中の宇宙人
  const H = new Sculpt(16, 12, 16, 8, 0, 8);
  H.ellipsoid([0, 1, 0], [6.5, 7, 6.5], (_nx, ny) => (ny > 0.75 ? 0xd0ebff : 0x74c0fc));
  H.carve([-5.5, 1, -5.5], [5.5, 6.5, 5.5], (px, py, pz) => px * px + (py - 1) * (py - 1) * 0.86 + pz * pz < 30);
  H.ellipsoid([0, 3.5, 0], [2.6, 2.8, 2.4], 0x8ce99a); // 宇宙人の頭
  for (const sx of [-1, 1]) H.ellipsoid(mirror([1.1, 3.8, 2], sx), [0.8, 1.1, 0.6], 0x111111);
  H.box([-1, 0.5, -1], [1, 1.5, 1], 0x8ce99a);
  const head = H.spec(0.05);

  const leg = (t: number) => (t > 0.85 ? 0x495057 : 0xadb5bd);
  const emitter = (t: number) => (t > 0.8 ? 0xfff3bf : 0x868e96);
  return {
    head,
    torso,
    upperArm: limb(0.28, 7, 0.8, 0.7, emitter),
    forearm: limb(0.24, 6, 0.7, 1.3, emitter),
    thigh: limb(0.26, 7, 0.8, 0.7, leg),
    shin: limb(0.24, 6, 0.7, 1.4, leg),
  };
}
