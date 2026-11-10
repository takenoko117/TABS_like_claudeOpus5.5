import { describe, expect, it } from 'vitest';
import { STAT_GATES, GATE_TYPE_IDS, type FacilityTypeId } from '../src/facilities/FacilityTypes';
import { Battle } from '../src/game/Battle';
import { ROGUE_RELIC_POOL, RogueliteRules, applyRogueGates, gateEffectText } from '../src/game/RogueliteMode';
import { buildGoldVoxelGrid, buildRelicVoxelGrid } from '../src/render/RewardVoxelModels';

function setup(typeId: Parameters<Battle['spawnUnit']>[0] = 'swordsman') {
  const battle = new Battle();
  const rules = new RogueliteRules();
  const unit = battle.spawnUnit(typeId, 0, 0, 0, Math.PI / 2);
  rules.start(battle);
  return { battle, rules, unit };
}

const countVoxels = (data: Int32Array) => data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);

describe('ステータスを上げる門', () => {
  const STAT_GATE_IDS = Object.keys(STAT_GATES) as FacilityTypeId[];

  it('すべて報酬に出て、4段階の効果と説明を持つ', () => {
    expect(STAT_GATE_IDS.length).toBeGreaterThanOrEqual(7);
    for (const id of STAT_GATE_IDS) {
      expect(GATE_TYPE_IDS).toContain(id);
      expect(ROGUE_RELIC_POOL.some((r) => r.id === id)).toBe(true);
      expect(STAT_GATES[id]!.values).toHaveLength(4);
      for (let level = 0; level < 4; level++) expect(gateEffectText(id, level)).not.toBe('');
    }
  });

  it('レベルに応じて各ステータスを変える', () => {
    const apply = (id: FacilityTypeId, level: number) => {
      const { battle, rules, unit } = setup();
      applyRogueGates(battle, rules, [{ id, level, active: true }]);
      return unit;
    };
    expect(apply('power_gate', 0).permDamageMul).toBeCloseTo(1.2);
    expect(apply('power_gate', 3).permDamageMul).toBeCloseTo(2);
    expect(apply('reach_gate', 1).permRangeMul).toBeCloseTo(1.4);
    expect(apply('haste_gate', 2).permAttackRateMul).toBeCloseTo(1.5);
    expect(apply('swift_gate', 0).permSpeedMul).toBeCloseTo(1.2);
    expect(apply('guard_gate', 3).permVulnerabilityMul).toBeCloseTo(0.5);
    expect(apply('impact_gate', 1).knockbackMul).toBeCloseTo(1.6);

    const { battle, rules, unit } = setup();
    const baseHp = unit.maxHp;
    applyRogueGates(battle, rules, [{ id: 'vitality_gate', level: 1, active: true }]);
    expect(unit.maxHp).toBeCloseTo(baseHp * 1.5);
    expect(unit.hp).toBeCloseTo(baseHp * 1.5);
  });

  it('射程の倍率が遠距離の射程と近接の巻き込みに反映される', () => {
    const { battle, rules, unit } = setup('archer');
    const base = unit.attackRange;
    expect(unit.meleeCleaveRadius).toBe(0);
    applyRogueGates(battle, rules, [{ id: 'reach_gate', level: 3, active: true }]);
    expect(unit.attackRange).toBeCloseTo(base * 1.85);
    expect(unit.meleeCleaveRadius).toBeCloseTo(4.25);
  });

  it('増殖ゲートの複製や巨大化の作り直しにも強化が引き継がれる', () => {
    const { battle, rules } = setup();
    applyRogueGates(
      battle,
      rules,
      [
        { id: 'haste_gate', level: 0, active: true },
        { id: 'reach_gate', level: 0, active: true },
        { id: 'giant_gate', level: 0, active: true },
        { id: 'multiplier_gate', level: 3, active: true },
      ],
      () => 0.1,
    );
    const allies = battle.units.filter((u) => u.alive && u.team === 0);
    expect(allies).toHaveLength(2);
    for (const u of allies) {
      expect(u.permAttackRateMul).toBeCloseTo(1.15);
      expect(u.permRangeMul).toBeCloseTo(1.2);
    }
  });

  it('戦場で通過した味方にも効く', () => {
    const { battle, unit } = setup();
    const gate = battle.spawnFacility('guard_gate', 0, 0, 0, Math.PI / 2, { gateLevel: 1 });
    expect(gate.isGate).toBe(true);
    unit.gatesPassed.clear();
    battle.aiEnabled = true;
    for (let i = 0; i < 10 && unit.permVulnerabilityMul === 1; i++) battle.step(battle.fixedDt);
    expect(unit.permVulnerabilityMul).toBeCloseTo(0.72);
  });
});

describe('報酬のボクセルモデル', () => {
  it('ゴールドのモデルを作れる', () => {
    expect(countVoxels(buildGoldVoxelGrid().grid.data)).toBeGreaterThan(500);
  });

  it('報酬に出るレリックはすべてモデルを作れ、門は種類ごとに形が違う', () => {
    const seen = new Set<string>();
    for (const { id } of ROGUE_RELIC_POOL) {
      const { grid } = buildRelicVoxelGrid(id);
      expect(countVoxels(grid.data)).toBeGreaterThan(50);
      const shape = grid.data.map((v) => (v !== 0 ? 1 : 0)).join('');
      expect(seen.has(shape)).toBe(false);
      seen.add(shape);
    }
  });
});
