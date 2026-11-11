import { BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, Matrix4, type Mesh, Vector3 } from 'three';
import { TEAM_COLORS, type Team } from '../units/UnitTypes';

/**
 * タニモンのローポリの剛腕。
 * ボクセルではなく、面ごとに陰影が付くフラットシェーディングのメッシュで、
 * 盛り上がった三角筋・力こぶ・前腕の筋肉を持つ人間らしい腕を作る。
 *
 * 腕の節（上腕・前腕）は長さ 1 の +Y 方向に作り（y = 0 が根元、1 が先端）、
 * 配置時に y を実際の長さ、x と z を体格（と伸びたときの細り）で拡大する。
 * x = 外側（左腕のとき体から離れる向き）、z = 前（力こぶの向き）。太さは体格 1 のときの m 単位。
 */

/** 前腕の自然な長さ（体格 1）。これより伸びると前腕が細くなる */
export const TANIMON_FOREARM_REST = 0.26;
/** 腕が伸びきったときの太さの下限（自然な太さに対する割合） */
const MIN_STRETCH_THICKNESS = 0.42;
const RADIAL = 7;

const SKIN = 0xd9a57a;
const SKIN_SHADE = 0xc48f66;

/** 節の断面: [高さ t, 半径, 前のふくらみ, 後ろのふくらみ, 外側のふくらみ] */
type Ring = readonly [number, number, number, number, number];

// 上腕: 肩にかぶさる三角筋 → 力こぶ（前）と上腕三頭筋（後ろ）→ 肘
const UPPER_RINGS: readonly Ring[] = [
  [-0.16, 0.035, 0, 0, 0],
  [-0.08, 0.11, 0, 0, 0.02],
  [0.04, 0.15, 0.01, 0.01, 0.03],
  [0.2, 0.14, 0.02, 0.025, 0.015],
  [0.42, 0.12, 0.06, 0.035, 0],
  [0.64, 0.115, 0.045, 0.02, 0],
  [0.86, 0.095, 0.01, 0.01, 0],
  [1.02, 0.085, 0, 0.01, 0],
  [1.1, 0.04, 0, 0, 0],
];

// 前腕: 肘のすぐ先が一番太く、手首へ細くなる
const FORE_RINGS: readonly Ring[] = [
  [-0.1, 0.04, 0, 0, 0],
  [-0.02, 0.09, 0, 0.01, 0],
  [0.16, 0.11, 0.015, 0.01, 0.025],
  [0.38, 0.1, 0.01, 0, 0.012],
  [0.66, 0.078, 0, 0, 0],
  [0.9, 0.062, 0, 0, 0],
  [1.02, 0.058, 0, 0, 0],
  [1.08, 0.03, 0, 0, 0],
];

class FacetBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new Color();

  tri(a: Vector3, b: Vector3, c: Vector3, color: number): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.c.setHex(color);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    // 頂点を共有しないので、法線は面ごと（フラットシェーディング）になる
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function ringPoint(ring: Ring, k: number, out: Vector3): Vector3 {
  const [t, r, front, back, outer] = ring;
  // 少しだけ角度をずらして、つるっとした筒ではなく削り出したような面にする
  const a = (k / RADIAL) * Math.PI * 2 + (t * 1.7) % 0.5;
  const cx = Math.cos(a);
  const cz = Math.sin(a);
  let rr = r;
  if (cz > 0) rr += front * cz * cz;
  else rr += back * cz * cz;
  if (cx > 0) rr += outer * cx;
  return out.set(cx * rr, t, cz * rr);
}

function buildSegment(rings: readonly Ring[], colorAt: (t: number, k: number) => number): BufferGeometry {
  const b = new FacetBuilder();
  const a0 = new Vector3();
  const a1 = new Vector3();
  const b0 = new Vector3();
  const b1 = new Vector3();
  for (let i = 0; i < rings.length - 1; i++) {
    const tMid = (rings[i][0] + rings[i + 1][0]) * 0.5;
    for (let k = 0; k < RADIAL; k++) {
      ringPoint(rings[i], k, a0);
      ringPoint(rings[i], k + 1, a1);
      ringPoint(rings[i + 1], k, b0);
      ringPoint(rings[i + 1], k + 1, b1);
      const color = colorAt(tMid, k);
      b.tri(a0, b0, b1, color);
      b.tri(a0, b1, a1, color);
    }
  }
  // 両端のふた
  const first = rings[0];
  const last = rings[rings.length - 1];
  const tipA = new Vector3(0, first[0] - 0.03, 0);
  const tipB = new Vector3(0, last[0] + 0.03, 0);
  for (let k = 0; k < RADIAL; k++) {
    ringPoint(first, k, a0);
    ringPoint(first, k + 1, a1);
    b.tri(tipA, a0, a1, colorAt(first[0], k));
    ringPoint(last, k, b0);
    ringPoint(last, k + 1, b1);
    b.tri(tipB, b1, b0, colorAt(last[0], k));
  }
  return b.build();
}

const upperCache = new Map<Team, BufferGeometry>();
let foreCache: BufferGeometry | null = null;
let fistCache: BufferGeometry | null = null;

/** 上腕（肩口は陣営色の半袖） */
export function getTanimonUpperArmGeometry(team: Team): BufferGeometry {
  const hit = upperCache.get(team);
  if (hit) return hit;
  const sleeve = TEAM_COLORS[team].shirt;
  const geom = buildSegment(UPPER_RINGS, (t, k) => (t < 0.24 ? sleeve : k % 3 === 0 ? SKIN_SHADE : SKIN));
  upperCache.set(team, geom);
  return geom;
}

/** 前腕 */
export function getTanimonForearmGeometry(): BufferGeometry {
  if (!foreCache) foreCache = buildSegment(FORE_RINGS, (_t, k) => (k % 3 === 1 ? SKIN_SHADE : SKIN));
  return foreCache;
}

/** 握りこぶし（つかむ手）。+Y が前腕の先へ向く */
export function getTanimonFistGeometry(): BufferGeometry {
  if (fistCache) return fistCache;
  const g = new IcosahedronGeometry(0.1, 0);
  g.scale(1.15, 1.05, 0.95);
  g.translate(0, 0.07, 0.01);
  const count = g.getAttribute('position').count;
  const colors: number[] = [];
  const c = new Color();
  for (let i = 0; i < count; i += 3) {
    c.setHex((i / 3) % 4 === 0 ? SKIN_SHADE : SKIN);
    for (let j = 0; j < 3; j++) colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  fistCache = g;
  return g;
}

const _y = new Vector3();
const _x = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();

/** +Y を dir に、+Z をできるだけ forward（無理なら真上）に向けた基底で回転を決める */
function orient(mesh: Mesh, dir: Vector3, forward: Vector3): void {
  _z.copy(forward).addScaledVector(dir, -dir.dot(forward));
  if (_z.lengthSq() < 0.05) _z.set(0, 1, 0).addScaledVector(dir, -dir.y);
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0);
  _z.normalize();
  _x.crossVectors(dir, _z).normalize();
  _m.makeBasis(_x, dir, _z);
  mesh.quaternion.setFromRotationMatrix(_m);
}

/**
 * 腕の節を a（根元）→ b（先端）に沿って置く。力こぶ（+Z）は forward へ向ける。
 * 節の +X は左腕で体の外側になるので、右腕は mirror = true で左右反転して置く。
 * thickness は太さの倍率（体格込み）。
 */
export function placeTanimonSegment(
  mesh: Mesh,
  a: Vector3,
  b: Vector3,
  forward: Vector3,
  thickness: number,
  mirror: boolean,
): void {
  _y.subVectors(b, a);
  const len = _y.length();
  if (len < 1e-5) return;
  _y.divideScalar(len);
  orient(mesh, _y, forward);
  mesh.position.copy(a);
  mesh.scale.set(mirror ? -thickness : thickness, len, thickness);
}

/** 前腕の長さ len（m）に応じた太さの倍率（伸びるほど細くなる） */
export function tanimonStretchThickness(len: number, scale: number): number {
  const rest = TANIMON_FOREARM_REST * scale;
  if (len <= rest) return 1;
  return Math.max(MIN_STRETCH_THICKNESS, Math.sqrt(rest / len));
}

/** こぶしを手の位置 hand に、dir（前腕の向き）へ向けて置く */
export function placeTanimonFist(mesh: Mesh, hand: Vector3, dir: Vector3, forward: Vector3, scale: number, mirror: boolean): void {
  _y.copy(dir);
  if (_y.lengthSq() < 1e-8) _y.set(0, -1, 0);
  _y.normalize();
  orient(mesh, _y, forward);
  mesh.position.copy(hand);
  mesh.scale.set(mirror ? -scale : scale, scale, scale);
}
