/**
 * タワーディフェンスの地形。ローグライトのプロシージャル・フィールドを使い、
 * ラウンドの代わりに一定時間ごとに作り直す。
 * 両軍の城のまわり（出撃地点・砲台・レリック）は地物も水もない平地にする。
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
/** |x| がこれ以上のマスは平地にする（城・砲台・出撃地点を守る） */
export const TD_TERRAIN_CLEAR_X = 13;
/** 中心の |x| がこれ以上の地物は置かない（大きな地物が平地へはみ出さないように） */
export const TD_TERRAIN_PROP_CLEAR_X = 11;
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

/** TD 用の地形を作る */
export function buildTDTerrain(spec: TDTerrainSpec): FieldLayout {
  return clearTDBaseZones(generateField(spec));
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
