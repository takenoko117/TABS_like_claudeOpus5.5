import { Group, Mesh, type Material } from 'three';
import { meshVoxelModel } from '../openworld/ChunkMesher';
import { toGeometry } from '../openworld/OpenWorldModels';

/**
 * かぶくん（白いかぶのキャラクター）のボクセル模型。
 * 横長の白い体・頭の葉っぱ・まるい目・ピンクの口・小さな手足。
 * 目や口はボクセルを細かくせず、表面の色分けで描く（1 粒 0.09 m）。原点は足もとの中心、顔は +z を向く。
 */

export const KABUKUN_VOXEL = 0.09;
const V = KABUKUN_VOXEL;

const BODY = 0xf2fbf7;
const BODY_SHADE = 0xdcefe8;
const LINE = 0x4a4a4e;
const MOUTH = 0xf2907a;
const LEAF = 0x7fdca0;
const LEAF_DARK = 0x58c283;

/** 体の楕円（中心の高さと半径） */
const CY = 0.72;
const RX = 0.66;
const RY = 0.5;
const RZ = 0.52;
/** 脚の付け根の高さ */
export const KABUKUN_HIP_Y = 0.27;

function inBody(x: number, y: number, z: number): boolean {
  return (x / RX) ** 2 + ((y - CY) / RY) ** 2 + (z / RZ) ** 2 <= 1;
}

function inArm(x: number, y: number, z: number): boolean {
  for (const s of [-1, 1]) {
    if (((x - s * 0.62) / 0.14) ** 2 + ((y - 0.62) / 0.13) ** 2 + ((z - 0.2) / 0.2) ** 2 <= 1) return true;
  }
  return false;
}

/** 頭の 3 枚の葉っぱ（中央はまっすぐ、左右は外へ傾く） */
function inLeaf(x: number, y: number, z: number): boolean {
  const base = CY + RY - 0.08;
  if (y < base || Math.abs(z) > 0.06) return false;
  const h = y - base;
  if (Math.abs(x) <= 0.05 && h <= 0.36) return true;
  for (const s of [-1, 1]) {
    if (Math.abs(x - s * (0.08 + h * 0.6)) <= 0.05 && h <= 0.26) return true;
  }
  return false;
}

/** 顔の模様（顔の正面の表面だけ）。-1 なら体の色 */
function faceColor(x: number, y: number): number {
  // 目: 3×3 の輪（黒い縁と白い中）
  for (const s of [-1, 1]) {
    const dx = Math.round((x - s * 0.17) / V);
    const dy = Math.round((y - 0.82) / V);
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) return LINE;
    if (dx === 0 && dy === 0) return BODY;
  }
  // 鼻
  if (Math.round(x / V) === 0 && Math.round((y - 0.67) / V) === 0) return LINE;
  // 口: 5×3 の楕円（黒い縁とピンクの中）
  const mx = Math.round(x / V);
  const my = Math.round((y - 0.52) / V);
  if (Math.abs(mx) <= 2 && Math.abs(my) <= 1) {
    if (Math.abs(mx) === 2 && Math.abs(my) === 1) return -1;
    if (Math.abs(mx) === 2 || Math.abs(my) === 1) return LINE;
    return MOUTH;
  }
  return -1;
}

/** 体（脚以外）の形と色 */
function bodyGeometry() {
  const sx = 18;
  const sy = 17;
  const sz = 13;
  const ox = -(sx * V) / 2;
  const oy = 0.18;
  const oz = -(sz * V) / 2;
  const at = (i: number, j: number, k: number) => ({ x: ox + (i + 0.5) * V, y: oy + (j + 0.5) * V, z: oz + (k + 0.5) * V });
  return toGeometry(
    meshVoxelModel(
      sx,
      sy,
      sz,
      (i, j, k) => {
        const { x, y, z } = at(i, j, k);
        if (inLeaf(x, y, z)) return (i + j) % 2 === 0 ? LEAF : LEAF_DARK;
        if (inBody(x, y, z)) {
          // 正面の表面なら顔を描く
          if (z > 0 && !inBody(x, y, z + V)) {
            const f = faceColor(x, y);
            if (f >= 0) return f;
          }
          return y < 0.42 ? BODY_SHADE : BODY;
        }
        if (inArm(x, y, z)) return BODY;
        return -1;
      },
      V,
      ox,
      oy,
      oz,
    ),
  );
}

/** 脚（付け根を原点に、下へ伸びる） */
function legGeometry() {
  return toGeometry(meshVoxelModel(2, 3, 2, (_i, j) => (j === 0 ? BODY_SHADE : BODY), V, -V, -3 * V, -V));
}

export interface KabukunModel {
  root: Group;
  /** 体（弾む・傾く） */
  body: Group;
  legs: [Mesh, Mesh];
}

/** かぶくんの模型を作る（形は共有し、毎回 Mesh だけ作る） */
let cache: { body: ReturnType<typeof bodyGeometry>; leg: ReturnType<typeof legGeometry> } | null = null;

export function buildKabukun(material: Material): KabukunModel {
  cache ??= { body: bodyGeometry(), leg: legGeometry() };
  const root = new Group();
  const body = new Group();
  const bodyMesh = new Mesh(cache.body, material);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  root.add(body);
  const legs: Mesh[] = [];
  for (const s of [-1, 1]) {
    const leg = new Mesh(cache.leg, material);
    leg.position.set(s * 0.2, KABUKUN_HIP_Y, 0);
    leg.castShadow = true;
    root.add(leg);
    legs.push(leg);
  }
  return { root, body, legs: legs as [Mesh, Mesh] };
}

/**
 * 動きをつける。phase は歩きの位相、air は宙にいるか、dead はアウトで倒れているか。
 */
export function poseKabukun(m: KabukunModel, phase: number, moving: boolean, air: boolean, dead: boolean): void {
  const swing = moving && !air ? Math.sin(phase) * 0.7 : 0;
  m.legs[0].rotation.x = air ? -0.5 : swing;
  m.legs[1].rotation.x = air ? -0.5 : -swing;
  const bob = moving && !air ? Math.abs(Math.sin(phase)) * 0.06 : 0;
  m.body.position.y = bob;
  // 着地や歩きで少しつぶれる
  const squash = air ? 1.06 : 1 - bob * 0.6;
  m.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  m.root.rotation.x = dead ? -Math.PI / 2 : 0;
  m.root.position.y += dead ? 0.5 : 0;
}
