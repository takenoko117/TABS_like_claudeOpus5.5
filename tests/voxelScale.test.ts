import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { VOXEL_SIZE_MIN, WORLD_VOXEL_SIZE_MIN } from '../src/render/VoxelScaleRules';
import { UNIT_TYPES, type UnitTypeId } from '../src/units/UnitTypes';

/**
 * ルールを決める前に作られ、まだ下限を満たしていないモデル（作り直したら外す）。
 * 新しいモデルをここに足してはいけない。
 */
const LEGACY_FINE_VOXEL_UNITS: readonly UnitTypeId[] = [
  // 獣・機械・ドラゴンの彫刻モデル（BeastModels / MachineModels / DragonModel）。テンプレートが 0.018〜0.023 と細かい
  'warelephant',
  'giant_eagle',
  'anaconda',
  'super_anaconda',
  'dragon',
  'buggy',
  'giant_tank',
  'giant_robot',
  // 標準の人型を scale で縮めたため、画面上のボクセルが小さい
  'lightspeed_ant',
  'wild_imp',
];

interface PartView {
  template: { voxelSize: number };
}

/** 兵種ごとに、全部位の中でいちばん小さいボクセル寸法（テンプレート・画面上）を測る */
function measure(id: UnitTypeId): { template: number; world: number; scale: number } {
  const battle = new Battle();
  const u = battle.spawnUnit(id, 0, 0, 0);
  const visual = new VoxelCharacterVisual(u) as unknown as { parts: Record<string, PartView> };
  const sizes = Object.values(visual.parts).map((p) => p.template.voxelSize);
  const template = Math.min(...sizes);
  return { template, world: template * u.scale, scale: u.scale };
}

const EPS = 1e-6;

describe('ボクセルの粒度のデザインルール', () => {
  const ids = Object.keys(UNIT_TYPES) as UnitTypeId[];
  const results = ids.map((id) => ({ id, ...measure(id) }));
  const passes = (r: (typeof results)[number]) =>
    r.template >= VOXEL_SIZE_MIN - EPS && r.world >= WORLD_VOXEL_SIZE_MIN - EPS;

  it('全兵種のボクセルが細かすぎない（テンプレート・画面上の両方）', () => {
    const bad = results
      .filter((r) => !passes(r) && !LEGACY_FINE_VOXEL_UNITS.includes(r.id))
      .map((r) => `${r.id}: テンプレート ${r.template.toFixed(3)} / 画面上 ${r.world.toFixed(3)}（scale ${r.scale}）`);
    expect(bad).toEqual([]);
  });

  it('作り直して下限を満たした兵種は例外リストから外す', () => {
    const fixed = results.filter((r) => LEGACY_FINE_VOXEL_UNITS.includes(r.id) && passes(r)).map((r) => r.id);
    expect(fixed).toEqual([]);
  });
});
