import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial, type Material } from 'three';
import { meshVoxelModel, type MeshArrays } from './ChunkMesher';

/**
 * オープンワールドの登場物（人・車・戦車・弾）のボクセル模型。
 * 大きめのブロックを積んだ見た目に合わせ、細かく刻みすぎない（人は 0.14、車は 0.25 の粒）。
 */

export function toGeometry(m: MeshArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('color', new BufferAttribute(m.colors, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** 人の粒の大きさ */
export const PERSON_VOXEL = 0.14;
const V = PERSON_VOXEL;

export interface PersonColors {
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
  /** 帽子をかぶるか（プレイヤーの目印） */
  cap?: number;
}

/** 体の部位（関節を軸に回す） */
export interface PersonModel {
  root: Group;
  /** 体ごと倒すための軸（腰の高さ） */
  body: Group;
  head: Group;
  armL: Group;
  armR: Group;
  legL: Group;
  legR: Group;
  /** 手に持つ道具を付ける場所 */
  hand: Group;
}

function part(geo: BufferGeometry, mat: Material, x: number, y: number, z: number): Group {
  const g = new Group();
  g.position.set(x, y, z);
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  g.add(m);
  return g;
}

/** 人の模型を作る。原点は足もと、+z が正面 */
export function buildPerson(colors: PersonColors, mat: Material): PersonModel {
  const head = toGeometry(
    meshVoxelModel(
      4,
      4,
      4,
      (x, y, z) => {
        if (colors.cap !== undefined) {
          if (y === 3) return colors.cap;
          if (y === 2 && z === 3) return colors.cap;
        }
        if (y === 3 || (z === 0 && y >= 1)) return colors.hair;
        // 目（色の帯で描く）
        if (z === 3 && y === 2 && (x === 1 || x === 2)) return 0x1d1d22;
        return colors.skin;
      },
      V,
      -2 * V,
      0,
      -2 * V,
    ),
  );
  const torso = toGeometry(
    meshVoxelModel(4, 4, 2, (x, y) => (y === 0 ? colors.pants : y === 3 && (x === 1 || x === 2) ? colors.skin : colors.shirt), V, -2 * V, 0, -V),
  );
  const arm = toGeometry(meshVoxelModel(1, 4, 1, (_x, y) => (y === 0 ? colors.skin : colors.shirt), V, -0.5 * V, -4 * V, -0.5 * V));
  const leg = toGeometry(meshVoxelModel(2, 5, 2, (_x, y) => (y === 0 ? 0x2a2622 : colors.pants), V, -V, -5 * V, -V));

  const root = new Group();
  const body = new Group();
  body.position.y = 5 * V;
  root.add(body);
  const torsoG = part(torso, mat, 0, 0, 0);
  body.add(torsoG);
  const headG = part(head, mat, 0, 4 * V, 0);
  body.add(headG);
  const armL = part(arm, mat, 2.5 * V, 4 * V, 0);
  const armR = part(arm, mat, -2.5 * V, 4 * V, 0);
  body.add(armL, armR);
  const legL = part(leg, mat, V, 0, 0);
  const legR = part(leg, mat, -V, 0, 0);
  body.add(legL, legR);
  const hand = new Group();
  hand.position.set(0, -4 * V, 0);
  armR.add(hand);
  return { root, body, head: headG, armL, armR, legL, legR, hand };
}

/** 歩き・走り・殴りなどのポーズをつける */
export function posePerson(m: PersonModel, opts: { walk: number; speed: number; tumble: number; action: number; aim: boolean }): void {
  const swing = Math.sin(opts.walk) * Math.min(1, opts.speed / 3) * 0.9;
  m.legL.rotation.x = swing;
  m.legR.rotation.x = -swing;
  m.armL.rotation.x = -swing * 0.8;
  m.armR.rotation.x = swing * 0.8;
  if (opts.aim) m.armR.rotation.x = -Math.PI / 2;
  if (opts.action < 0.25) {
    // 殴る・投げる: 右腕を前へ突き出す
    const t = opts.action / 0.25;
    m.armR.rotation.x = -Math.PI / 2 - Math.sin(t * Math.PI) * 0.6;
  }
  m.body.rotation.x = opts.tumble;
}

/** 車（幅 8・長さ 16 の粒）。原点は車体の底の中心、+z が前 */
export function buildCarGeometry(color: number): BufferGeometry {
  const w = 8;
  const l = 16;
  const h = 6;
  const dark = 0x1e1f22;
  const glass = 0x7fb8d6;
  return toGeometry(
    meshVoxelModel(
      w,
      h,
      l,
      (x, y, z) => {
        const wheelZ = (z >= 2 && z <= 4) || (z >= 11 && z <= 13);
        const wheelX = x === 0 || x === w - 1;
        if (y === 0) return wheelZ && (x <= 1 || x >= w - 2) ? dark : -1;
        if (y === 1) {
          if (wheelZ && wheelX) return dark;
          if (z === 0 || z === l - 1) return 0x8a8d92;
          return color;
        }
        if (y === 2 || y === 3) {
          if (y === 2 && z === l - 1 && (x === 1 || x === w - 2)) return 0xfff2b0;
          if (y === 2 && z === 0 && (x === 1 || x === w - 2)) return 0xd8262b;
          if (y === 3 && (z <= 1 || z >= l - 2) && x > 0 && x < w - 1) return color;
          return color;
        }
        // 屋根と窓
        if (z < 4 || z > 11 || x < 1 || x > w - 2) return -1;
        if (y === 5) return color;
        const edgeX = x === 1 || x === w - 2;
        const edgeZ = z === 4 || z === 11;
        if (edgeX && edgeZ) return color;
        if (edgeX || edgeZ) return glass;
        return 0x34363b;
      },
      0.25,
      -1,
      0,
      -2,
    ),
  );
}

/** 戦車の車体（幅 12・長さ 20）。原点は底の中心 */
export function buildTankHullGeometry(color: number): BufferGeometry {
  const w = 12;
  const l = 20;
  return toGeometry(
    meshVoxelModel(
      w,
      5,
      l,
      (x, y, z) => {
        const track = x <= 2 || x >= w - 3;
        if (y <= 2 && track) {
          // 履帯の転輪の模様
          if (y === 1 && (x === 0 || x === w - 1) && z % 3 === 1) return 0x55565a;
          return 0x2a2b2e;
        }
        if (y <= 2) return y === 0 ? -1 : color;
        if (y === 3) return color;
        if (z < 1 || z > l - 2) return -1;
        return (x + z) % 7 === 0 ? 0x4b5730 : color;
      },
      0.25,
      -1.5,
      0,
      -2.5,
    ),
  );
}

/** 戦車の砲塔と砲身。原点は砲塔の回転軸の下 */
export function buildTankTurretGeometry(color: number): BufferGeometry {
  return toGeometry(
    meshVoxelModel(
      6,
      3,
      16,
      (x, y, z) => {
        if (z < 6) return y < 3 ? (y === 2 && x === 4 && z === 1 ? 0x2a2b2e : color) : -1;
        // 砲身
        if (y === 1 && x >= 2 && x <= 3 && z >= 6) return 0x3d4429;
        return -1;
      },
      0.25,
      -0.75,
      0,
      -0.75,
    ),
  );
}

/** 単色の箱の形を、ボクセル 1 粒で作る（弾など） */
export function buildBlock(sx: number, sy: number, sz: number, color: number, voxel: number): BufferGeometry {
  return toGeometry(meshVoxelModel(sx, sy, sz, () => color, voxel, (-sx * voxel) / 2, (-sy * voxel) / 2, (-sz * voxel) / 2));
}

/** 共通の材質（頂点色を使う） */
export function voxelMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ vertexColors: true });
}
