import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

/**
 * ハヤトのローポリ頭部モデル。
 * ボクセルではなく、面ごとに色を変えたフラットシェーディングの1メッシュで顔全体を作る。
 *
 * 座標系: 高さ 1 の頭で、x = 横, y = 上, z = 前（顔の向き）。原点は頭の中心。
 * 口の開閉は「顎の回転」を1枚のモーフターゲットとして持たせ、
 * mesh.morphTargetInfluences[0] を 0（閉じる）〜 1（全開）で動かす。
 */

type P3 = readonly [number, number, number];

/** 頂点 1 個。w は顎の回転の効き具合（0 = 動かない, 1 = 顎と一緒に回る）、lift は開いたときの追加の移動 */
interface V {
  p: P3;
  w?: number;
  lift?: P3;
}

/** 顎の回転軸（耳のあたりを通る x 軸）と全開時の角度 */
const HINGE_Y = -0.02;
const HINGE_Z = -0.02;
const JAW_ANGLE = 0.62;
const JAW_BACK_LIMIT = -0.03;

// 頭の輪郭: [y, 値] の表を線形補間して、高さごとの半幅・前後の奥行きを決める
const HALF_WIDTH: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0], [0.47, 0.19], [0.42, 0.3], [0.34, 0.385], [0.2, 0.42], [0.05, 0.42],
  [-0.1, 0.405], [-0.2, 0.37], [-0.3, 0.31], [-0.38, 0.245], [-0.45, 0.165], [-0.49, 0.08], [-0.5, 0],
];
/** 面長に見せるための横幅の倍率 */
const FACE_SLIM = 0.93;
const DEPTH_FRONT: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0], [0.47, 0.25], [0.42, 0.375], [0.34, 0.47], [0.2, 0.495], [0.1, 0.46], [0.05, 0.445],
  [-0.1, 0.44], [-0.2, 0.425], [-0.3, 0.395], [-0.38, 0.345], [-0.45, 0.255], [-0.49, 0.12], [-0.5, 0],
];
const DEPTH_BACK: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0], [0.45, 0.26], [0.3, 0.43], [0.1, 0.47], [-0.1, 0.42], [-0.25, 0.32], [-0.4, 0.14], [-0.5, 0],
];

/** 列の角度（0 = 顔の正面、±π = 後頭部）。顔の前を細かく刻む */
const HALF_ANGLES = [0, 0.14, 0.28, 0.42, 0.58, 0.78, 1.0, 1.3, 1.6, 2.0, 2.5];
const ANGLES = [-Math.PI, ...[...HALF_ANGLES].slice(1).reverse().map((a) => -a), ...HALF_ANGLES, Math.PI];
/** 口角の角度。これより内側の唇の合わせ目だけが開く */
const MOUTH_CORNER = 0.58;
/** 肌の段（y）。null の 2 段が上唇と下唇の合わせ目で、その前後の段が唇の外縁 */
const SKIN_ROWS: ReadonlyArray<number | null> = [
  0.5, 0.47, 0.42, 0.34, 0.24, 0.14, 0.05, -0.03, -0.09, -0.13, -0.16, null, null, -0.24, -0.29, -0.34, -0.39, -0.435, -0.47, -0.49, -0.5,
];
const UPPER_LIP_ROW = 11;
const LOWER_LIP_ROW = 12;
const LIP_TOP_Y = -0.16;
const LIP_BOTTOM_Y = -0.24;

const SKIN_LIGHT = 0xf6d3a4;
const SKIN_SIDE = 0xc98a52;
const SKIN_FLUSH = 0xe6936f;
const FOREHEAD_SHINE = 0xfff4dc;
const STUBBLE = 0x8f7560;
const LIP_UPPER = 0xa9604f;
const LIP_LOWER = 0xc77f68;
const HAIR_DARK = 0x17151a;
const HAIR_LIGHT = 0x3b3638;
const MOUTH_INNER = 0x54161a;
const MOUTH_DEEP = 0x1c0608;
const TOOTH = 0xfbf6e8;
const TOOTH_SHADE = 0xd9d2bf;
const TONGUE = 0xd8707a;
const TONGUE_SHADE = 0xb9525e;

function lerpTable(table: ReadonlyArray<readonly [number, number]>, key: number): number {
  const n = table.length;
  for (let i = 0; i < n - 1; i++) {
    const [k0, v0] = table[i];
    const [k1, v1] = table[i + 1];
    if (key <= k0 && key >= k1) {
      return v0 + ((key - k0) / (k1 - k0)) * (v1 - v0);
    }
  }
  return key > table[0][0] ? table[0][1] : table[n - 1][1];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mixHex(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number): number =>
    Math.round((((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k)) << shift;
  return ch(16) | ch(8) | ch(0);
}

/** 頭の表面の点（角度 th, 高さ y） */
function surface(th: number, y: number): P3 {
  const s = Math.sin(th);
  const c = Math.cos(th);
  const a = lerpTable(HALF_WIDTH, y) * FACE_SLIM;
  const d = lerpTable(c >= 0 ? DEPTH_FRONT : DEPTH_BACK, y);
  // 指数を 1 未満にして、顔の前面を少し平らに、側頭を角張らせる
  return [a * Math.sign(s) * Math.abs(s) ** 0.85, y, d * Math.sign(c) * Math.abs(c) ** 0.85];
}

/** 顔の前面で (x, y) にある表面の奥行き */
function faceZ(x: number, y: number): number {
  const a = Math.max(0.001, lerpTable(HALF_WIDTH, y) * FACE_SLIM);
  const s = Math.min(1, (Math.abs(x) / a) ** (1 / 0.85));
  return lerpTable(DEPTH_FRONT, y) * Math.sqrt(Math.max(0, 1 - s * s)) ** 0.85;
}

/** 唇の合わせ目の高さ（口角がやや上がる） */
function lipLineY(th: number): number {
  const k = Math.min(1, Math.abs(th) / MOUTH_CORNER);
  return -0.195 + 0.03 * k * k;
}

/** 唇の合わせ目で、列ごとの開き具合。中央が大きく口角で 0 になる */
function lipOpen(th: number): number {
  return Math.max(0, 1 - (Math.abs(th) / MOUTH_CORNER) ** 2.4);
}

/** 唇より下の肌に掛ける顎の重み */
function jawWeight(th: number, y: number): number {
  const jaw = 1 - smoothstep(0.8, 1.4, Math.abs(th));
  const lip = lipOpen(th);
  const depth = lipLineY(Math.min(MOUTH_CORNER, Math.abs(th))) - y;
  return jaw * (lip + (1 - lip) * smoothstep(0, 0.13, depth));
}

/** 頂点と色を溜めて 1 枚の非インデックスジオメトリにするビルダー */
class FacetBuilder {
  readonly positions: number[] = [];
  readonly deltas: number[] = [];
  readonly colors: number[] = [];

  private push(v: V, color: Color): void {
    const [x, y, z] = v.p;
    const w = v.w ?? 0;
    const lift = v.lift ?? [0, 0, 0];
    // 顎の軸まわりに JAW_ANGLE * w だけ回した位置との差をモーフ量にする
    const a = JAW_ANGLE * w;
    const dy = y - HINGE_Y;
    const dz = z - HINGE_Z;
    const ry = HINGE_Y + dy * Math.cos(a) - dz * Math.sin(a);
    // あごの裏が回り込んで後頭部から突き出さないよう、後ろへの移動を止める
    const rz = Math.max(w > 0 ? JAW_BACK_LIMIT : -Infinity, HINGE_Z + dy * Math.sin(a) + dz * Math.cos(a));
    this.positions.push(x, y, z);
    this.deltas.push(lift[0], ry - y + lift[1], rz - z + lift[2]);
    this.colors.push(color.r, color.g, color.b);
  }

  /** 三角形を足す。面の表は「from から離れる向き」に揃える（toward = true なら from を向く） */
  tri(a: V, b: V, c: V, hex: number, from: P3 = [0, 0, -0.08], toward = false): void {
    const ux = b.p[0] - a.p[0];
    const uy = b.p[1] - a.p[1];
    const uz = b.p[2] - a.p[2];
    const vx = c.p[0] - a.p[0];
    const vy = c.p[1] - a.p[1];
    const vz = c.p[2] - a.p[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    const cx = (a.p[0] + b.p[0] + c.p[0]) / 3 - from[0];
    const cy = (a.p[1] + b.p[1] + c.p[1]) / 3 - from[1];
    const cz = (a.p[2] + b.p[2] + c.p[2]) / 3 - from[2];
    const outward = nx * cx + ny * cy + nz * cz > 0;
    const color = new Color(hex);
    const [p, q] = outward !== toward ? [b, c] : [c, b];
    this.push(a, color);
    this.push(p, color);
    this.push(q, color);
  }

  quad(a: V, b: V, c: V, d: V, hex: number, from?: P3, toward = false): void {
    this.tri(a, b, c, hex, from, toward);
    this.tri(a, c, d, hex, from, toward);
  }

  /** 中心から放射状に張る多角形 */
  fan(center: V, ring: readonly V[], hex: number, from?: P3): void {
    for (let i = 0; i < ring.length; i++) {
      this.tri(center, ring[i], ring[(i + 1) % ring.length], hex, from);
    }
  }

  /** 表裏のある太さのない帯（髪の束）を、折れ線 + 先細りの幅で足す */
  strand(points: readonly P3[], width: number, hex: number): void {
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
      const w0 = width * (1 - i / (n - 1));
      const w1 = width * (1 - (i + 1) / (n - 1));
      const [ax, ay, az] = points[i];
      const [bx, by, bz] = points[i + 1];
      this.quad(
        { p: [ax - w0, ay, az] },
        { p: [ax + w0, ay, az] },
        { p: [bx + w1, by, bz] },
        { p: [bx - w1, by, bz] },
        i % 2 === 0 ? hex : mixHex(hex, HAIR_LIGHT, 0.35),
      );
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.morphAttributes.position = [new Float32BufferAttribute(this.deltas, 3)];
    geometry.morphTargetsRelative = true;
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** 肌の色。正面は明るく側面は濃く、頬の赤みと髭の剃り跡を足す */
function skinColor(x: number, y: number, seed: number): number {
  let c = mixHex(SKIN_LIGHT, SKIN_SIDE, smoothstep(0.08, 0.4, Math.abs(x)));
  // 面ごとに少し明暗を散らして、ポリゴンの面を見せる
  c = mixHex(c, seed % 2 === 0 ? 0xffe6c2 : 0xb97a48, 0.09);
  const flush = Math.exp(-(((Math.abs(x) - 0.25) / 0.13) ** 2) - ((y + 0.1) / 0.11) ** 2);
  c = mixHex(c, SKIN_FLUSH, flush * 0.42);
  // 額はテカリを足して目立たせる
  const shine = Math.exp(-((x / 0.22) ** 2) - ((y - 0.34) / 0.14) ** 2);
  c = mixHex(c, FOREHEAD_SHINE, shine * 0.75);
  if (Math.abs(x) < 0.26 && y < -0.11) c = mixHex(c, STUBBLE, 0.26);
  if (y < -0.4) c = mixHex(c, 0xa86f42, 0.3);
  return c;
}

function buildSkin(b: FacetBuilder): void {
  const grid: V[][] = SKIN_ROWS.map((row, r) =>
    ANGLES.map((th) => {
      if (row !== null) {
        // 唇の外縁は口角で合わせ目へ収束させ、唇を紡錘形にする
        const toCorner = Math.min(1, Math.abs(th) / MOUTH_CORNER) ** 3;
        const isLipEdge = (row === LIP_TOP_Y || row === LIP_BOTTOM_Y) && Math.abs(th) < MOUTH_CORNER;
        const y = isLipEdge ? row + (lipLineY(th) - row) * toCorner : row;
        const p = surface(th, y);
        return y < -0.2 ? { p, w: jawWeight(th, y) } : { p };
      }
      const inner = Math.abs(th) < MOUTH_CORNER;
      const y = inner ? lipLineY(th) : -0.165;
      // 閉じたときに唇の間に細い線が見えるよう、内側だけわずかに隙間を空ける
      const gap = inner ? 0.005 * lipOpen(th) : 0;
      if (r === UPPER_LIP_ROW) {
        return { p: surface(th, y + gap), lift: [0, 0.022 * lipOpen(th), 0] as P3 };
      }
      return { p: surface(th, y - gap), w: jawWeight(th, y - gap) };
    }),
  );
  for (let r = 0; r < grid.length - 1; r++) {
    if (r === UPPER_LIP_ROW) continue; // 唇の合わせ目は穴のままにする
    for (let c = 0; c < ANGLES.length - 1; c++) {
      const [a, d, e, f] = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]];
      const mid = (ANGLES[c] + ANGLES[c + 1]) / 2;
      const midX = (a.p[0] + e.p[0]) / 2;
      const midY = (a.p[1] + e.p[1]) / 2;
      const inLip = Math.abs(mid) < MOUTH_CORNER;
      let color = skinColor(midX, midY, r + c);
      if (inLip && r === UPPER_LIP_ROW - 1) color = LIP_UPPER;
      if (inLip && r === LOWER_LIP_ROW) color = LIP_LOWER;
      b.quad(a, d, e, f, color);
    }
  }
}

/** 口の中（唇の縁から奥へすぼまる袋）と、上の歯・舌 */
function buildMouth(b: FacetBuilder): void {
  const viewer: P3 = [0, -0.25, 1.2];
  // 口の中の面は閉じた形ではほぼ水平なので、天井は下を、床は上を向くよう基準点を分ける
  const belowRoof: P3 = [0, -1.5, 0.3];
  const aboveFloor: P3 = [0, 1.5, 0.3];
  const cols = ANGLES.map((th, i) => ({ th, i })).filter(({ th }) => Math.abs(th) <= MOUTH_CORNER);
  const upper = cols.map(({ th }): V => {
    const y = lipLineY(th) + 0.005 * lipOpen(th);
    return { p: surface(th, y), lift: [0, 0.022 * lipOpen(th), 0] };
  });
  const lower = cols.map(({ th }): V => {
    const y = lipLineY(th) - 0.005 * lipOpen(th);
    return { p: surface(th, y), w: jawWeight(th, y) };
  });
  const inward = (v: V, dy: number, w: number): V => ({ p: [v.p[0] * 0.8, v.p[1] + dy, v.p[2] - 0.14], w });
  const upperIn = upper.map((v) => inward(v, 0.035, 0));
  const lowerIn = lower.map((v) => inward(v, -0.03, (v.w ?? 0) * 0.9));
  const back: V = { p: [0, -0.2, 0.04], w: 0.45 };
  for (let i = 0; i < cols.length - 1; i++) {
    b.quad(upper[i], upper[i + 1], upperIn[i + 1], upperIn[i], MOUTH_INNER, belowRoof, true);
    b.quad(lower[i], lower[i + 1], lowerIn[i + 1], lowerIn[i], MOUTH_INNER, aboveFloor, true);
    b.tri(upperIn[i], upperIn[i + 1], back, MOUTH_DEEP, belowRoof, true);
    b.tri(lowerIn[i], lowerIn[i + 1], back, MOUTH_DEEP, aboveFloor, true);
  }
  // 口角は上唇と下唇が 1 点に集まるので、天井と床の端の間を塞ぐ
  const inside: P3 = [0, -0.22, 0.2];
  for (const end of [0, cols.length - 1]) {
    b.tri(upper[end], upperIn[end], back, MOUTH_DEEP, inside, true);
    b.tri(lower[end], lowerIn[end], back, MOUTH_DEEP, inside, true);
    b.tri(upper[end], lower[end], back, MOUTH_DEEP, inside, true);
  }

  // 上の歯: 上唇のすぐ裏に並べる（閉じているときは唇と顎に隠れる）
  const teeth = cols.filter(({ th }) => Math.abs(th) < MOUTH_CORNER - 0.02);
  for (let i = 0; i < teeth.length - 1; i++) {
    const t0 = surface(teeth[i].th, lipLineY(teeth[i].th));
    const t1 = surface(teeth[i + 1].th, lipLineY(teeth[i + 1].th));
    const lift: P3 = [0, 0.018, 0];
    const quadTop = (p: P3): V => ({ p: [p[0], p[1] + 0.01, p[2] - 0.04], lift });
    const quadBot = (p: P3): V => ({ p: [p[0] * 0.98, p[1] - 0.042, p[2] - 0.05], lift });
    b.quad(quadTop(t0), quadTop(t1), quadBot(t1), quadBot(t0), i % 2 === 0 ? TOOTH : TOOTH_SHADE, viewer, true);
  }

  // 舌: 顎と一緒に下がる山形のふくらみ
  const line = lipLineY(0);
  const z0 = faceZ(0, line);
  const tonguePt = (x: number, y: number, z: number): V => ({ p: [x, line + y, z0 + z], w: 0.94 });
  const tip = tonguePt(0, 0.015, -0.1);
  const root = tonguePt(0, 0.035, -0.3);
  const sideL0 = tonguePt(-0.125, -0.015, -0.14);
  const sideR0 = tonguePt(0.125, -0.015, -0.14);
  const sideL1 = tonguePt(-0.14, -0.005, -0.3);
  const sideR1 = tonguePt(0.14, -0.005, -0.3);
  b.tri(tip, sideL0, root, TONGUE, viewer, true);
  b.tri(tip, root, sideR0, TONGUE_SHADE, viewer, true);
  b.tri(sideL0, sideL1, root, TONGUE_SHADE, viewer, true);
  b.tri(sideR0, root, sideR1, TONGUE, viewer, true);
}

/** 目。白目の上に虹彩・瞳・光を重ね、見開いて上目づかいにする */
function buildEye(b: FacetBuilder, side: -1 | 1): void {
  const cx = side * 0.16;
  const cy = 0.05;
  // 見開いた目の raise は開口時に少し上がる量
  const lift: P3 = [0, 0.012, 0];
  const onFace = (x: number, y: number, off: number): V => ({
    p: [x, y, faceZ(x, y) + off],
    lift,
  });
  const ringAt = (rx: number, ry: number, ox: number, oy: number, off: number, n = 8): V[] => {
    const ring: V[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      ring.push(onFace(cx + ox + Math.cos(a) * rx, cy + oy + Math.sin(a) * ry, off));
    }
    return ring;
  };
  // 目のくぼみの影 → 白目 → 虹彩 → 瞳 → 光
  b.fan(onFace(cx, cy, 0.006), ringAt(0.088, 0.066, 0, 0, 0.004), mixHex(SKIN_SIDE, 0x8a5a3a, 0.35));
  b.fan(onFace(cx, cy, 0.013), ringAt(0.073, 0.052, 0, 0, 0.009), 0xfbfbf6);
  // 視線は写真のように上へ向ける
  const lookX = side * 0.006;
  const lookY = 0.012;
  b.fan(onFace(cx + lookX, cy + lookY, 0.019), ringAt(0.038, 0.038, lookX, lookY, 0.014), 0x2a1a12);
  b.fan(onFace(cx + lookX, cy + lookY, 0.024), ringAt(0.021, 0.021, lookX, lookY, 0.021), 0x050406);
  b.fan(
    onFace(cx + lookX - 0.014, cy + lookY + 0.016, 0.029),
    ringAt(0.011, 0.011, lookX - 0.014, lookY + 0.016, 0.027, 5),
    0xffffff,
  );
  // 上まぶたの濃い線
  const lid = (i: number, n: number, rise: number): V => {
    const t = i / n;
    const x = cx + (t - 0.5) * 2 * 0.077;
    const arch = Math.sqrt(Math.max(0, 1 - ((t - 0.5) * 2) ** 2));
    return onFace(x, cy + arch * 0.054 + rise, 0.018);
  };
  for (let i = 0; i < 6; i++) {
    b.quad(lid(i, 6, 0), lid(i + 1, 6, 0), lid(i + 1, 6, 0.014), lid(i, 6, 0.014), 0x1a1312);
  }
}

/** 太さのある眉毛。右目側は高く跳ね上げ、左目側は寄せてしかめる（写真の表情） */
function buildBrow(b: FacetBuilder, side: -1 | 1): void {
  const raised = side === 1;
  const n = 4;
  const lift: P3 = raised ? [0, 0.045, 0] : [side * -0.008, 0.02, 0];
  const path = (t: number): [number, number] => {
    const x = side * (0.07 + t * 0.195);
    const y = raised ? 0.17 + Math.sin(t * Math.PI * 0.9) * 0.045 : 0.13 + Math.sin(t * Math.PI * 0.8) * 0.06;
    return [x, y];
  };
  const center: P3 = [side * 0.18, 0.17, 0.2];
  for (let i = 0; i < n; i++) {
    const seg = (t: number, half: number, off: number): V => {
      const [x, y] = path(t);
      return { p: [x, y + half, faceZ(x, y) + off], lift };
    };
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const h0 = 0.022 * (1 - t0 * 0.62);
    const h1 = 0.022 * (1 - t1 * 0.62);
    b.quad(seg(t0, h0, 0.024), seg(t1, h1, 0.024), seg(t1, -h1, 0.024), seg(t0, -h0, 0.024), 0x201a18, center);
    b.quad(seg(t0, h0, 0.024), seg(t1, h1, 0.024), seg(t1, h1, 0), seg(t0, h0, 0), 0x35292a, center);
    b.quad(seg(t0, -h0, 0.024), seg(t1, -h1, 0.024), seg(t1, -h1, 0), seg(t0, -h0, 0), 0x120e0e, center);
  }
}

/** 鼻。鼻筋・小鼻と、下から見える鼻の穴 */
function buildNose(b: FacetBuilder): void {
  const z = (y: number): number => faceZ(0, y);
  const bridge: V = { p: [0, 0.135, z(0.135) + 0.014] };
  const browL: V = { p: [-0.04, 0.115, z(0.115) - 0.004] };
  const browR: V = { p: [0.04, 0.115, z(0.115) - 0.004] };
  const tip: V = { p: [0, -0.052, z(-0.052) + 0.095] };
  const tipLow: V = { p: [0, -0.09, z(-0.09) + 0.06] };
  const wingL: V = { p: [-0.095, -0.075, z(-0.075) + 0.0] };
  const wingR: V = { p: [0.095, -0.075, z(-0.075) + 0.0] };
  const flareL: V = { p: [-0.082, -0.062, z(-0.062) + 0.055] };
  const flareR: V = { p: [0.082, -0.062, z(-0.062) + 0.055] };
  const base: V = { p: [0, -0.112, z(-0.112) + 0.012] };
  const baseL: V = { p: [-0.07, -0.108, z(-0.108) + 0.008] };
  const baseR: V = { p: [0.07, -0.108, z(-0.108) + 0.008] };
  const center: P3 = [0, 0, 0.3];

  b.tri(bridge, browL, tip, 0xf0c18e, center);
  b.tri(bridge, tip, browR, 0xfbdcb0, center);
  b.tri(browL, wingL, flareL, 0xcf935c, center);
  b.tri(browL, flareL, tip, 0xe7b27f, center);
  b.tri(browR, flareR, wingR, 0xd9a06a, center);
  b.tri(browR, tip, flareR, 0xf3c797, center);
  b.tri(tip, flareL, tipLow, 0xd9a06a, center);
  b.tri(tip, tipLow, flareR, 0xe0a877, center);
  b.tri(wingL, baseL, flareL, 0xb97f4d, center);
  b.tri(wingR, flareR, baseR, 0xc48a57, center);
  // 鼻の穴: 中央の柱を残して左右を暗くする
  b.tri(flareL, baseL, tipLow, 0x1c0f0c, center);
  b.tri(flareR, tipLow, baseR, 0x1c0f0c, center);
  b.tri(baseL, base, tipLow, 0x9c6a42, center);
  b.tri(baseR, tipLow, base, 0xa87349, center);
}

/** 耳。髪の切れ間から耳たぶがのぞく */
function buildEar(b: FacetBuilder, side: -1 | 1): void {
  const pts: P3[] = [
    [side * 0.37, 0.015, -0.015],
    [side * 0.47, 0.01, -0.07],
    [side * 0.46, -0.1, -0.075],
    [side * 0.39, -0.175, -0.03],
    [side * 0.35, -0.12, -0.0],
  ];
  const front: V = { p: [side * 0.41, -0.07, -0.015] };
  const back: V = { p: [side * 0.41, -0.07, -0.085] };
  const ring = pts.map((p): V => ({ p }));
  const near: P3 = [side * 0.3, -0.07, -0.6];
  const far: P3 = [side * 0.3, -0.07, 0.6];
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    b.tri(front, ring[i], ring[next], i % 2 === 0 ? 0xe2a877 : 0xc98a57, near);
    b.tri(back, ring[i], ring[next], 0xb07745, far);
  }
}

/** 頭の表面より内側か（髪の根元を頭に沿わせるための判定） */
function insideSkull(x: number, y: number, z: number): boolean {
  if (Math.abs(y) >= 0.5) return false;
  const a = lerpTable(HALF_WIDTH, y) * FACE_SLIM;
  const d = lerpTable(z >= 0 ? DEPTH_FRONT : DEPTH_BACK, y);
  if (a <= 0 || d <= 0) return false;
  return (Math.abs(x) / a) ** (2 / 0.85) + (Math.abs(z) / d) ** (2 / 0.85) <= 1;
}

/** 原点から方向 dir へ進んで頭の表面に当たるまでの距離 */
function skullRadius(dir: P3): number {
  let lo = 0;
  let hi = 0.8;
  for (let i = 0; i < 18; i++) {
    const r = (lo + hi) / 2;
    if (insideSkull(dir[0] * r, dir[1] * r, dir[2] * r)) lo = r;
    else hi = r;
  }
  return lo;
}

function normalize(v: P3): P3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 分け目の位置（0 = 真上、正 = 前。ラジアン）。先頭が前の生え際で、後ろへ進むほど負になる */
const PART_ANGLES = [0.43, 0.24, -0.02, -0.3, -0.62, -1.0, -1.45, -2.0, -2.5];
/** 分け目がはっきり見える度合い（頭頂より後ろでは左右の髪が閉じる） */
const PART_OPEN = [1, 1, 0.85, 0.5, 0.15, 0, 0, 0, 0];
/** 各房の毛先の位置 [角度, 高さ]。先頭がこめかみで、耳の上を通って襟足の中央まで回る */
const HAIR_TIPS: ReadonlyArray<readonly [number, number]> = [
  [1.03, 0.25], [1.25, -0.13], [1.5, -0.01], [1.85, -0.28], [2.15, -0.33], [2.45, -0.36], [2.75, -0.37], [3.0, -0.38], [Math.PI, -0.38],
];
/** 分け目（0）から毛先（1）までの刻み */
const HAIR_STEPS = [0, 0.07, 0.17, 0.3, 0.45, 0.62, 0.8, 0.93, 1];

/** 髪の厚み。分け目で根元が低く、すぐ立ち上がってふくらみ、毛先へ向けて薄くなる */
function hairThickness(t: number, partOpen: number): number {
  const body = 0.13 * (1 - smoothstep(0.35, 1, t) * 0.62);
  const lifted = 0.035 + (body - 0.035) * smoothstep(0, 0.14, t);
  return body + (lifted - body) * partOpen;
}

/**
 * センターパートの髪。分け目から毛先へ流れる房を、前の生え際から襟足まで左右に並べる。
 * 分け目の左右は少し離して地肌の線を見せ、裾と生え際は頭へ折り返して閉じる。
 */
function buildHairSide(b: FacetBuilder, side: -1 | 1): void {
  // 房の間に中間の房を挟み、毛先をギザギザに、表面を束っぽくする
  const strands: Array<{ part: P3; tip: P3; open: number; bulge: number }> = [];
  const dirOf = (i: number): { part: P3; tip: P3; open: number } => {
    const a = PART_ANGLES[i];
    const open = PART_OPEN[i];
    const [th, y] = HAIR_TIPS[i];
    return {
      part: normalize([side * 0.032 * open, Math.cos(a), Math.sin(a)]),
      tip: normalize(surface(side * th, y)),
      open,
    };
  };
  for (let i = 0; i < PART_ANGLES.length; i++) {
    const cur = dirOf(i);
    strands.push({ ...cur, bulge: i === 0 ? -0.018 : 0.012 });
    if (i === PART_ANGLES.length - 1) break;
    const next = dirOf(i + 1);
    const mid = (u: P3, v: P3): P3 => normalize([(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2]);
    const tip = mid(cur.tip, next.tip);
    // 毛先の間は切れ込ませる（切れ込むほど tip を上へ寄せる）
    strands.push({
      part: mid(cur.part, next.part),
      tip: normalize([tip[0], tip[1] + (i === 0 ? 0 : 0.09), tip[2]]),
      open: (cur.open + next.open) / 2,
      bulge: -0.01,
    });
  }

  const skull: P3[][] = [];
  const outer: V[][] = strands.map((st, si) => {
    const row: P3[] = [];
    const points = HAIR_STEPS.map((t): V => {
      const d = normalize([
        st.part[0] + (st.tip[0] - st.part[0]) * t,
        st.part[1] + (st.tip[1] - st.part[1]) * t,
        st.part[2] + (st.tip[2] - st.part[2]) * t,
      ]);
      const r = skullRadius(d);
      row.push([d[0] * r, d[1] * r, d[2] * r]);
      const frontEase = si === 0 ? 0.78 : 1;
      const out = r + (hairThickness(t, st.open) + st.bulge * smoothstep(0.1, 0.5, t)) * frontEase;
      return { p: [d[0] * out, d[1] * out, d[2] * out] };
    });
    skull.push(row);
    return points;
  });

  const lastRow = HAIR_STEPS.length - 1;
  for (let c = 0; c < outer.length - 1; c++) {
    for (let r = 0; r < lastRow; r++) {
      // 束ごとの明暗と、ふくらみの上に乗るツヤの帯
      const sheen = r === 2 || r === 3 ? (c % 2 === 0 ? 0.62 : 0.34) : c % 2 === 0 ? 0.16 : 0;
      b.quad(outer[c][r], outer[c + 1][r], outer[c + 1][r + 1], outer[c][r + 1], mixHex(HAIR_DARK, HAIR_LIGHT, sheen));
    }
    // 裾の裏を頭へ折り返す
    b.quad(outer[c][lastRow], outer[c + 1][lastRow], { p: skull[c + 1][lastRow] }, { p: skull[c][lastRow] }, HAIR_DARK, [0, 2, 0]);
  }
  // 生え際の断面を頭へ折り返す
  for (let r = 0; r < lastRow; r++) {
    b.quad(outer[0][r], outer[0][r + 1], { p: skull[0][r + 1] }, { p: skull[0][r] }, HAIR_DARK, [side * 0.2, 0.6, -0.3]);
  }
}

function buildHair(b: FacetBuilder): void {
  buildHairSide(b, -1);
  buildHairSide(b, 1);
  // こめかみに垂れる細い毛束
  const lock = (th: number, y: number, off: number): P3 => {
    const [x, , z] = surface(th, y);
    const len = Math.max(0.001, Math.hypot(x, z));
    return [x + (x / len) * off, y, z + (z / len) * off];
  };
  b.strand([lock(0.98, 0.24, 0.05), lock(1.05, 0.1, 0.04), lock(1.1, -0.03, 0.035), lock(1.1, -0.13, 0.03)], 0.02, HAIR_DARK);
  b.strand([lock(-0.98, 0.22, 0.05), lock(-1.05, 0.08, 0.04), lock(-1.1, -0.06, 0.03)], 0.018, HAIR_DARK);
}

let cached: BufferGeometry | null = null;

/** ハヤトの頭のジオメトリ（全個体で共有する。破棄しないこと） */
export function getHayatoHeadGeometry(): BufferGeometry {
  if (cached) return cached;
  const b = new FacetBuilder();
  buildSkin(b);
  buildMouth(b);
  buildEar(b, -1);
  buildEar(b, 1);
  buildNose(b);
  buildEye(b, -1);
  buildEye(b, 1);
  buildBrow(b, -1);
  buildBrow(b, 1);
  buildHair(b);
  cached = b.build();
  return cached;
}
