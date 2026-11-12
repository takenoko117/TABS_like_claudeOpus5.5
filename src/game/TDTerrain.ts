/**
 * タワーディフェンスの地形。ローグライトのプロシージャル・フィールドを使い、
 * ラウンドの代わりに一定時間ごとに作り直す。
 * 戦場は標準の2倍の長さ。両軍の城のまわり（出撃地点・砲台・レリック）は地物も水もない平地にし、
 * 城を円形の城壁で囲む。城壁の正面は開いていて、まっすぐな通路（道）が戦場へ伸びる。
 */
import { TRAITS } from '../field/BiomeDefs';
import { BASE_GROUND, generateField } from '../field/FieldGenerator';
import { fieldRng, hashSeed, pick } from '../field/FieldRng';
import type { FieldRuntime } from '../field/FieldRuntime';
import {
  FIELD_COLS,
  FIELD_ROWS,
  GROUND,
  WATER,
  cellAt,
  cellCenterX,
  cellCenterZ,
  cellIndex,
  cellOfX,
  cellOfZ,
  inGrid,
  type BiomeId,
  type FieldLayout,
  type FieldTraitId,
} from '../field/FieldTypes';
import { FLYING_UNIT_IDS, type Unit } from '../units/Unit';

/** 地形を作り直す間隔（秒） */
export const TD_TERRAIN_SECONDS = 120;

/** 戦場の見えない壁（標準の戦場 ±25 の約2倍の長さ。城どうしの距離が2倍になる） */
export const TD_FIELD_WALLS = { maxX: 47, maxZ: 19 } as const;
/** 城の x 座標（自軍は -、敵は +） */
export const TD_CASTLE_X = 44;
/** 城壁（円）の半径 */
export const TD_CASTLE_WALL_RADIUS = 13;
/** 城壁の正面の通路の半分の幅（通路の壁は z = ±(この値 + 0.5) のマス） */
export const TD_CORRIDOR_HALF_WIDTH = 3;
/** 通路の先端（城からの距離）。ここで戦場に出る */
export const TD_CORRIDOR_END = 23;
/** 門を置ける範囲（城からの距離）。通路の中 */
export const TD_GATE_ZONE_FROM = 14;
export const TD_GATE_ZONE_TO = 22;

/** |x| がこれ以上のマスは平地にする（城・通路を守る） */
export const TD_TERRAIN_CLEAR_X = TD_CASTLE_X - TD_CORRIDOR_END - 1;
/** 中心の |x| がこれ以上の地物は置かない（大きな地物が平地へはみ出さないように） */
export const TD_TERRAIN_PROP_CLEAR_X = TD_TERRAIN_CLEAR_X - 2;
/** 作り直しで出るバイオーム（専用フィールドは除く） */
export const TD_TERRAIN_BIOMES: readonly BiomeId[] = ['plains', 'forest', 'town', 'desert', 'swamp', 'snow', 'volcano'];
/** 特性が付く確率 */
export const TD_TERRAIN_TRAIT_CHANCE = 0.5;
/** 地物・水域に埋まったユニットを動かす最大の距離（マス） */
const RELOCATE_MAX_CELLS = 10;

export interface TDTerrainSpec {
  seed: number;
  biome: BiomeId;
  trait: FieldTraitId | null;
}

/** index 回目の地形（0 が開始時）。同じシード・回数なら同じ結果で、直前と同じバイオームは避ける */
export function pickTDTerrain(runSeed: number, index: number, prev: BiomeId | null): TDTerrainSpec {
  const seed = hashSeed(runSeed, index, 0x7d7e);
  if (index === 0) return { seed, biome: 'plains', trait: null };
  const rng = fieldRng(seed);
  const pool = TD_TERRAIN_BIOMES.filter((b) => b !== prev);
  const biome = pick(rng, pool);
  let trait: FieldTraitId | null = null;
  if (rng() < TD_TERRAIN_TRAIT_CHANCE) {
    const cands = (Object.keys(TRAITS) as FieldTraitId[]).filter((t) => TRAITS[t].biomes.includes(biome));
    if (cands.length > 0) trait = pick(rng, cands);
  }
  return { seed, biome, trait };
}

/** 城のまわりを平地にした地形を返す（元の layout は変えない） */
export function clearTDBaseZones(layout: FieldLayout): FieldLayout {
  const ground = layout.ground.slice();
  const water = layout.water.slice();
  const body = layout.body.slice();
  const flowX = layout.flowX.slice();
  const flowZ = layout.flowZ.slice();
  const base = BASE_GROUND[layout.biome];
  for (let j = 0; j < FIELD_ROWS; j++) {
    for (let i = 0; i < FIELD_COLS; i++) {
      if (Math.abs(cellCenterX(i)) < TD_TERRAIN_CLEAR_X) continue;
      const k = cellIndex(i, j);
      if (ground[k] === GROUND.bridge || water[k] !== WATER.none) ground[k] = base;
      water[k] = WATER.none;
      body[k] = -1;
      flowX[k] = 0;
      flowZ[k] = 0;
    }
  }
  const usedBodies = new Set<number>();
  for (const b of body) if (b >= 0) usedBodies.add(b);
  const outside = (p: { x: number; radius?: number }) => Math.abs(p.x) + (p.radius ?? 0) < TD_TERRAIN_CLEAR_X;
  return {
    ...layout,
    ground,
    water,
    body,
    flowX,
    flowZ,
    bodies: layout.bodies.filter((b) => usedBodies.has(b.id)),
    props: layout.props.filter((p) => Math.abs(p.x) < TD_TERRAIN_PROP_CLEAR_X),
    pits: layout.pits.filter(outside),
    waterfalls: layout.waterfalls.filter(outside),
    vents: layout.vents.filter(outside),
  };
}

/** マスの中心 (x, z) が、城 (castleX) の城壁・通路の壁になるか。forward は城から見た戦場の向き（+1 / -1） */
export function isTDCastleWallCell(x: number, z: number, castleX: number, forward: number): boolean {
  const ahead = (x - castleX) * forward;
  const az = Math.abs(z);
  const inCorridorWidth = az < TD_CORRIDOR_HALF_WIDTH + 0.01;
  // 円形の城壁（正面の通路の幅だけ開ける）
  const d = Math.hypot(x - castleX, z);
  if (Math.abs(d - TD_CASTLE_WALL_RADIUS) < 0.6 && !(ahead > 0 && inCorridorWidth)) return true;
  // 通路の左右の壁（城壁の円の外側から通路の先端まで）
  const onCorridorWall = az > TD_CORRIDOR_HALF_WIDTH && az < TD_CORRIDOR_HALF_WIDTH + 1;
  return onCorridorWall && ahead > 0 && d > TD_CASTLE_WALL_RADIUS && ahead < TD_CORRIDOR_END;
}

/** マスの中心が、城 (castleX) の正面の通路の中か */
export function isTDCorridorCell(x: number, z: number, castleX: number, forward: number): boolean {
  const ahead = (x - castleX) * forward;
  return Math.abs(z) < TD_CORRIDOR_HALF_WIDTH && ahead > TD_CASTLE_WALL_RADIUS - 1 && ahead < TD_CORRIDOR_END;
}

/** 両軍の城の城壁（壊れない石積み）と、正面の通路の道を足した地形を返す */
export function addTDCastleWalls(layout: FieldLayout): FieldLayout {
  const ground = layout.ground.slice();
  const props = layout.props.slice();
  let nextId = props.reduce((m, p) => Math.max(m, p.id), -1) + 1;
  for (let j = 0; j < FIELD_ROWS; j++) {
    for (let i = 0; i < FIELD_COLS; i++) {
      const x = cellCenterX(i);
      const z = cellCenterZ(j);
      for (const [castleX, forward] of [
        [-TD_CASTLE_X, 1],
        [TD_CASTLE_X, -1],
      ] as const) {
        if (isTDCastleWallCell(x, z, castleX, forward)) {
          props.push({ id: nextId++, kind: 'castle_block', x, z, rot: 0, seed: i + j });
        } else if (isTDCorridorCell(x, z, castleX, forward)) {
          ground[cellIndex(i, j)] = GROUND.road;
        }
      }
    }
  }
  return { ...layout, ground, props };
}

/** TD 用の地形を作る（グリッドの横幅は TD_FIELD_WALLS に合わせておくこと） */
export function buildTDTerrain(spec: TDTerrainSpec): FieldLayout {
  return addTDCastleWalls(clearTDBaseZones(generateField(spec)));
}

/**
 * 新しい地形の地物・深い水・溶岩・奈落に重なったユニットを、近くの空いたマスへ動かす。
 * 飛んでいるユニットはそのまま。動かした数を返す。
 */
export function relocateUnitsOutOfTerrain(field: FieldRuntime, units: readonly Unit[]): number {
  let moved = 0;
  for (const u of units) {
    if (!u.alive || FLYING_UNIT_IDS.has(u.type.id)) continue;
    const { x, z } = u.pelvis.pos;
    const k = cellAt(x, z);
    if (k < 0 || field.isSpawnable(k, 0)) continue;
    const spot = nearestSpawnable(field, x, z);
    if (!spot) continue;
    const dx = spot.x - x;
    const dz = spot.z - z;
    for (const p of [...u.joints, ...u.weaponParticles]) {
      p.pos.x += dx;
      p.pos.z += dz;
      p.prev.copy(p.pos);
      p.force.set(0, 0, 0);
    }
    moved++;
  }
  return moved;
}

function nearestSpawnable(field: FieldRuntime, x: number, z: number): { x: number; z: number } | null {
  const i0 = cellOfX(x);
  const j0 = cellOfZ(z);
  for (let r = 1; r <= RELOCATE_MAX_CELLS; r++) {
    let best: { x: number; z: number; d: number } | null = null;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (!inGrid(i, j) || !field.isSpawnable(cellIndex(i, j), 0)) continue;
        const d = di * di + dj * dj;
        if (!best || d < best.d) best = { x: cellCenterX(i), z: cellCenterZ(j), d };
      }
    }
    if (best) return { x: best.x, z: best.z };
  }
  return null;
}
