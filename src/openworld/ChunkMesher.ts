import { BLOCK_DEFS, B, isSolid } from './OpenWorldConfig';

/**
 * ボクセルを面の集まり（頂点・法線・色・添字）にする。Three.js には依存しない。
 * 隣が埋まっている面は作らず、頂点ごとに角の影（アンビエントオクルージョン）を付ける。
 */

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

interface FaceDef {
  n: [number, number, number];
  corners: [number, number, number][];
  /** 面に沿った 2 つの軸 */
  t1: number;
  t2: number;
}

/** 6 方向の面。頂点は外から見て反時計回りになるよう、起動時に並べ直す */
const FACES: FaceDef[] = (
  [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ] as [[number, number, number], [number, number, number][]][]
).map(([n, corners]) => {
  const a = corners[0];
  const b = corners[1];
  const c = corners[2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
  const ordered = dot < 0 ? [...corners].reverse() : corners;
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const others = [0, 1, 2].filter((k) => k !== axis);
  return { n, corners: ordered, t1: others[0], t2: others[1] };
});

/** 角の影の明るさ（周りの埋まり具合 0〜3 → 明るさ） */
const AO_LEVELS = [0.5, 0.68, 0.84, 1];

/** sRGB の 0〜255 → 描画で使う線形の明るさ（頂点色は線形で渡す） */
const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/** 座標から決まる、ブロックごとの色のゆらぎ */
function jitter(x: number, y: number, z: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return 0.93 + (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.12;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  quad(
    face: FaceDef,
    bx: number,
    by: number,
    bz: number,
    size: number,
    color: number,
    shade: number,
    ao: [number, number, number, number],
    ox: number,
    oy: number,
    oz: number,
  ): void {
    const base = this.pos.length / 3;
    const r = SRGB_TO_LINEAR[(color >> 16) & 255];
    const g = SRGB_TO_LINEAR[(color >> 8) & 255];
    const b = SRGB_TO_LINEAR[color & 255];
    for (let k = 0; k < 4; k++) {
      const c = face.corners[k];
      this.pos.push(ox + (bx + c[0]) * size, oy + (by + c[1]) * size, oz + (bz + c[2]) * size);
      this.nor.push(face.n[0], face.n[1], face.n[2]);
      const l = shade * AO_LEVELS[ao[k]];
      this.col.push(r * l, g * l, b * l);
    }
    // 影の付き方で対角線を選ぶと、縞模様が出にくい
    if (ao[0] + ao[2] < ao[1] + ao[3]) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  finish(): MeshArrays {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      indices: new Uint32Array(this.idx),
    };
  }
}

function aoFor(
  occ: (x: number, y: number, z: number) => boolean,
  face: FaceDef,
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  const out: [number, number, number, number] = [3, 3, 3, 3];
  const bx = x + face.n[0];
  const by = y + face.n[1];
  const bz = z + face.n[2];
  for (let k = 0; k < 4; k++) {
    const c = face.corners[k];
    const s1 = c[face.t1] === 1 ? 1 : -1;
    const s2 = c[face.t2] === 1 ? 1 : -1;
    const d1 = [0, 0, 0];
    const d2 = [0, 0, 0];
    d1[face.t1] = s1;
    d2[face.t2] = s2;
    const side1 = occ(bx + d1[0], by + d1[1], bz + d1[2]);
    const side2 = occ(bx + d2[0], by + d2[1], bz + d2[2]);
    const corner = occ(bx + d1[0] + d2[0], by + d1[1] + d2[1], bz + d1[2] + d2[2]);
    out[k] = side1 && side2 ? 0 : 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
  }
  return out;
}

const isOpaque = (id: number): boolean => isSolid(id) && !BLOCK_DEFS[id].translucent;

/**
 * 世界の一区画（チャンク）を面にする。不透明なブロックと、半透明なブロック（ガラス・水）を別々に返す。
 * get は範囲外も読める関数（隣のチャンクとの境目の面を正しく消すため）。
 */
export function meshWorldRegion(
  get: (x: number, y: number, z: number) => number,
  x0: number,
  y0: number,
  z0: number,
  sx: number,
  sy: number,
  sz: number,
): { opaque: MeshArrays; translucent: MeshArrays } {
  const opaque = new Builder();
  const trans = new Builder();
  const occ = (x: number, y: number, z: number): boolean => isOpaque(get(x, y, z));
  for (let y = y0; y < y0 + sy; y++) {
    for (let z = z0; z < z0 + sz; z++) {
      for (let x = x0; x < x0 + sx; x++) {
        const id = get(x, y, z);
        if (id === B.AIR) continue;
        const def = BLOCK_DEFS[id];
        const translucent = def.translucent;
        const jit = jitter(x, y, z);
        for (const face of FACES) {
          const nid = get(x + face.n[0], y + face.n[1], z + face.n[2]);
          if (translucent) {
            // ガラスどうし・水どうしの間の面は作らない。水は固いブロックに接する面も作らない
            if (nid === id || isOpaque(nid)) continue;
            if (id === B.WATER && nid !== B.AIR) continue;
          } else if (isOpaque(nid)) continue;
          // 世界の底は見えないので作らない
          if (face.n[1] === -1 && y === 0) continue;
          const ao = translucent ? ([3, 3, 3, 3] as [number, number, number, number]) : aoFor(occ, face, x, y, z);
          (translucent ? trans : opaque).quad(face, x, y, z, 1, def.color, jit, ao, 0, 0, 0);
        }
      }
    }
  }
  return { opaque: opaque.finish(), translucent: trans.finish() };
}

/**
 * 小さなボクセルの模型（車・人・戦車）を面にする。
 * colorAt は色（0xRRGGBB）か、空なら -1 を返す。原点は模型の (ox, oy, oz)。
 */
export function meshVoxelModel(
  sx: number,
  sy: number,
  sz: number,
  colorAt: (x: number, y: number, z: number) => number,
  voxel: number,
  ox = 0,
  oy = 0,
  oz = 0,
): MeshArrays {
  const b = new Builder();
  const filled = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && colorAt(x, y, z) >= 0;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const c = colorAt(x, y, z);
        if (c < 0) continue;
        const jit = jitter(x, y, z) * 0.5 + 0.5;
        for (const face of FACES) {
          if (filled(x + face.n[0], y + face.n[1], z + face.n[2])) continue;
          b.quad(face, x, y, z, voxel, c, jit, aoFor(filled, face, x, y, z), ox, oy, oz);
        }
      }
    }
  }
  return b.finish();
}

/** 落ちている塊（ブロックの一覧）を面にする */
export function meshBlockList(blocks: Int32Array): MeshArrays {
  const map = new Map<string, number>();
  const n = blocks.length / 4;
  for (let k = 0; k < n; k++) map.set(`${blocks[k * 4]},${blocks[k * 4 + 1]},${blocks[k * 4 + 2]}`, blocks[k * 4 + 3]);
  const get = (x: number, y: number, z: number): number => map.get(`${x},${y},${z}`) ?? B.AIR;
  const occ = (x: number, y: number, z: number): boolean => isOpaque(get(x, y, z));
  const b = new Builder();
  for (let k = 0; k < n; k++) {
    const x = blocks[k * 4];
    const y = blocks[k * 4 + 1];
    const z = blocks[k * 4 + 2];
    const id = blocks[k * 4 + 3];
    const def = BLOCK_DEFS[id];
    for (const face of FACES) {
      const nid = get(x + face.n[0], y + face.n[1], z + face.n[2]);
      if (isOpaque(nid) || nid === id) continue;
      b.quad(face, x, y, z, 1, def.color, jitter(x, y, z), aoFor(occ, face, x, y, z), 0, 0, 0);
    }
  }
  return b.finish();
}
