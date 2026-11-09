import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Battle } from '../src/game/Battle';
import { DamageStats } from '../src/game/DamageStats';
import {
  GATE_OPENING_WIDTHS,
  MARCH_GATE_OPENING_WIDTHS,
  MAX_GATE_LEVEL,
  getGateOpeningWidth,
} from '../src/facilities/FacilityTypes';
import {
  ROGUE_FINAL_ROUND,
  ROGUE_MAX_OWNED_UNITS,
  ROGUE_STARTERS,
  ROGUE_START_BUDGET,
  ROGUE_START_LIVES,
  RogueliteRules,
  RogueliteRun,
  UNIT_TAGS,
  applyReward,
  countTags,
  generateRewardOptions,
  generateRogueEnemyLineup,
  getRogueEnemyBudget,
  getTagTier,
  isStarterUnlocked,
  mergeRogueMeta,
} from '../src/game/RogueliteMode';
import { createSeededRng } from '../src/game/ChallengeMode';
import { UNIT_TYPES, UNIT_TYPE_LIST } from '../src/units/UnitTypes';
import {
  damageFontSize,
  formatDamage,
  isSignificantDamage,
} from '../src/render/DamageOverlay';

function simulate(battle: Battle, duration: number, dt: number = 1 / 60): void {
  const steps = Math.ceil(duration / dt);
  for (let i = 0; i < steps; i++) battle.step(dt);
}

describe('ローグライト: 属性タグとシナジー', () => {
  it('全兵種に1つ以上のタグがある', () => {
    for (const ut of UNIT_TYPE_LIST) {
      expect(UNIT_TAGS[ut.id].length).toBeGreaterThan(0);
    }
  });

  it('タグは兵種の種類数で数え、同じ兵種を増やしても増えない', () => {
    const counts = countTags(['clubber', 'clubber', 'clubber', 'spearman']);
    expect(counts.get('swarm')).toBe(2);
    expect(counts.get('ranged')).toBe(0);
  });

  it('門で得たタグもその兵種の分として数える', () => {
    const counts = countTags(['clubber', 'giant'], new Map([['clubber', new Set(['giant' as const])]]));
    expect(counts.get('giant')).toBe(2);
  });

  it('段階は2種で2、4種で4になる', () => {
    expect(getTagTier(1)).toBe(0);
    expect(getTagTier(2)).toBe(2);
    expect(getTagTier(3)).toBe(2);
    expect(getTagTier(4)).toBe(4);
  });

  it('群れ2種で群れの兵の被ダメージが下がり、射撃2種で攻撃が上がる', () => {
    const battle = new Battle();
    const rules = new RogueliteRules();
    battle.rules = rules;
    const clubber = battle.spawnUnit('clubber', 0, -6, 0);
    battle.spawnUnit('spearman', 0, -6, 2);
    const archer = battle.spawnUnit('archer', 0, -8, 0);
    battle.spawnUnit('sniper', 0, -8, 2);
    battle.spawnUnit('clubber', 1, 8, 0);
    rules.start(battle);
    expect(rules.tier('swarm')).toBe(2);
    expect(rules.tier('ranged')).toBe(2);
    expect(clubber.permVulnerabilityMul).toBeCloseTo(0.85);
    expect(archer.permDamageMul).toBeCloseTo(1.2);
    // 2回目の start でも二重にかからない
    rules.start(battle);
    expect(clubber.permVulnerabilityMul).toBeCloseTo(0.85);
  });

  it('巨体2種で巨体の兵の最大HPが25%上がる', () => {
    const battle = new Battle();
    const rules = new RogueliteRules();
    battle.rules = rules;
    const giant = battle.spawnUnit('giant', 0, -6, 0);
    battle.spawnUnit('warelephant', 0, -10, 4);
    rules.start(battle);
    expect(giant.maxHp).toBeCloseTo(UNIT_TYPES.giant.hp * 1.25);
    expect(giant.hp).toBeCloseTo(giant.maxHp);
  });

  it('爆発4種の誘爆は4段で止まる（無限に連鎖しない）', () => {
    const battle = new Battle();
    const stats = new DamageStats(0);
    const rules = new RogueliteRules(stats);
    battle.rules = rules;
    battle.combat.damageListeners.push((e) => rules.onDamage(e));
    battle.combat.damageListeners.push((e) => stats.record(e));
    const bomber = battle.spawnUnit('bomber', 0, -10, 0);
    battle.spawnUnit('rocket_soldier', 0, -10, 2);
    battle.spawnUnit('giant_tank', 0, -14, 0);
    battle.spawnUnit('yamamuron', 0, -16, 6);
    // 密集した瀕死の敵の列
    const enemies = [];
    for (let i = 0; i < 12; i++) {
      const u = battle.spawnUnit('decoy', 1, 6 + i * 1.6, 0);
      u.hp = 1;
      enemies.push(u);
    }
    battle.aiEnabled = true;
    rules.start(battle);
    expect(rules.tier('explosive')).toBe(4);
    battle.combat.applyRadialBlast(bomber, new Vector3(6, 0.5, 0), 1.5, 50, 5, 0.5, battle.units, 1 / 120, 'explosion', [], 0);
    const dead = enemies.filter((u) => !u.alive).length;
    // 起点 + 最大4段の誘爆までしか届かない
    expect(dead).toBeGreaterThan(1);
    expect(dead).toBeLessThan(12);
    expect(stats.bySource.get('爆発: 誘爆') ?? 0).toBeGreaterThan(0);
  });
});

describe('ローグライト: ダメージの通知', () => {
  it('ダメージを受けると種類つきで通知される', () => {
    const battle = new Battle();
    const events: string[] = [];
    battle.combat.damageListeners.push((e) => events.push(e.kind));
    const a = battle.spawnUnit('bomber', 0, -2, 0);
    const v = battle.spawnUnit('giant', 1, 2, 0);
    battle.combat.applyRadialBlast(a, v.pelvis.pos.clone(), 3, 40, 5, 0.5, battle.units, 1 / 120);
    v.takeDamage(10, v.chest, new Vector3(), 1 / 120, a);
    expect(events).toContain('explosion');
    expect(events).toContain('physical');
  });

  it('戦闘後の集計は自軍の攻撃だけを兵種ごとに数える', () => {
    const battle = new Battle();
    const stats = new DamageStats(0);
    battle.combat.damageListeners.push((e) => stats.record(e));
    const a = battle.spawnUnit('swordsman', 0, -2, 0);
    const v = battle.spawnUnit('giant', 1, 2, 0);
    v.takeDamage(40, v.chest, new Vector3(), 1 / 120, a);
    a.takeDamage(25, a.chest, new Vector3(), 1 / 120, v);
    expect(stats.total).toBeCloseTo(40);
    expect(stats.byUnitType.get('swordsman')).toBeCloseTo(40);
    expect(stats.maxHitBy).toBe('swordsman');
  });

  it('数値表示: 大きいものの判定・文字サイズ・整形', () => {
    expect(isSignificantDamage(5, 900, false)).toBe(false);
    expect(isSignificantDamage(95, 900, false)).toBe(true);
    expect(isSignificantDamage(3, 900, true)).toBe(true);
    expect(damageFontSize(1000)).toBeGreaterThan(damageFontSize(10));
    expect(damageFontSize(1e9)).toBeLessThanOrEqual(34);
    expect(formatDamage(1234.4)).toBe('1,234');
  });
});

describe('ローグライト: 門のサイズと効果', () => {
  it('門の柱は開口の外側に立ち、サイズ段階で開口が広がる', () => {
    for (let level = 0; level <= MAX_GATE_LEVEL; level++) {
      const battle = new Battle();
      const gate = battle.spawnFacility('multiplier_gate', 0, 0, 0, Math.PI / 2, { gateLevel: level });
      expect(gate.gateOpening).toBe(GATE_OPENING_WIDTHS[level]);
      const [l, r] = gate.obstacles;
      const gap = Math.hypot(l.x - r.x, l.z - r.z) - l.radius - r.radius;
      expect(gap).toBeCloseTo(getGateOpeningWidth(level), 5);
    }
  });

  it('大門なら巨人が通過して複製される', () => {
    const battle = new Battle();
    battle.spawnFacility('multiplier_gate', 0, 0, 0, Math.PI / 2, { gateLevel: 2 });
    battle.spawnUnit('giant', 0, -1.0, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 12, 0);
    battle.aiEnabled = true;
    simulate(battle, 2.5);
    expect(battle.units.filter((u) => u.team === 0 && u.type.id === 'giant').length).toBeGreaterThanOrEqual(2);
  });

  it('巨大化の門を通ると体格・HPが上がり、巨体タグを得る', () => {
    const battle = new Battle();
    battle.spawnFacility('giant_gate', 0, 0, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 0, -0.4, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 8, 0);
    battle.aiEnabled = true;
    simulate(battle, 1.5);
    const red = battle.units.filter((u) => u.team === 0);
    expect(red.length).toBe(1);
    expect(red[0].scale).toBeCloseTo(1.6);
    expect(red[0].maxHp).toBeCloseTo(UNIT_TYPES.clubber.hp * 1.6);
    expect(red[0].grantedTags).toContain('giant');
    expect(red[0].permDamageMul).toBeGreaterThan(1);
  });

  it('属性の門を通ると攻撃に状態異常が乗り、タグを得る', () => {
    const battle = new Battle();
    battle.spawnFacility('fire_gate', 0, 0, 0, Math.PI / 2);
    const u = battle.spawnUnit('clubber', 0, -0.4, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 8, 0);
    battle.aiEnabled = true;
    simulate(battle, 1.2);
    expect(u.elementInfusion).toBe('fire');
    expect(u.grantedTags).toContain('fire');
  });
});

describe('ローグライト: 進軍門', () => {
  const MARCH = { marchFromX: -22 };
  const stepUntilCombat = (battle: Battle) => {
    battle.beginCombat();
    let guard = 0;
    while (battle.gateMarching && guard++ < 1000) battle.step(battle.fixedDt);
  };

  it('開戦時に帯の中の止まった遠距離兵にも効き、帯の外と門より前には効かない', () => {
    const battle = new Battle();
    const gate = battle.spawnFacility('fire_gate', 0, -5, 0, Math.PI / 2, MARCH);
    const inLane = battle.spawnUnit('sniper', 0, -18, 1, Math.PI / 2);
    const outside = battle.spawnUnit('sniper', 0, -18, 8, Math.PI / 2);
    const ahead = battle.spawnUnit('archer', 0, -2, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 20, 0);
    stepUntilCombat(battle);
    expect(inLane.elementInfusion).toBe('fire');
    expect(outside.elementInfusion).toBeNull();
    expect(ahead.elementInfusion).toBeNull();
    expect(gate.pos.x).toBeCloseTo(-5);
  });

  it('滑っている間は全軍が待機し、終わると制限時間0から戦闘が始まる', () => {
    const battle = new Battle();
    battle.spawnFacility('fire_gate', 0, -5, 0, Math.PI / 2, MARCH);
    battle.spawnUnit('clubber', 0, -10, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 20, 0);
    battle.beginCombat();
    expect(battle.gateMarching).toBe(true);
    expect(battle.aiEnabled).toBe(false);
    let guard = 0;
    while (battle.gateMarching && guard++ < 1000) battle.step(battle.fixedDt);
    expect(battle.aiEnabled).toBe(true);
    expect(battle.time).toBeLessThanOrEqual(battle.fixedDt);
  });

  it('増殖ゲートは巨体も帯の中の全員を上限なしで1回ずつ複製する', () => {
    const battle = new Battle();
    battle.spawnFacility('multiplier_gate', 0, -2, 0, Math.PI / 2, { ...MARCH, gateLevel: 3 });
    for (let i = 0; i < 5; i++) battle.spawnUnit('giant', 0, -18 + i * 3, -4 + i * 2, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 20, 0);
    stepUntilCombat(battle);
    simulate(battle, 1);
    expect(battle.units.filter((u) => u.team === 0 && u.type.id === 'giant').length).toBe(10);
  });

  it('滑り終えた門は残り、後から来た味方にも効く', () => {
    const battle = new Battle();
    battle.spawnFacility('fire_gate', 0, -5, 0, Math.PI / 2, MARCH);
    battle.spawnUnit('clubber', 1, 20, 0);
    stepUntilCombat(battle);
    const late = battle.spawnUnit('clubber', 0, -5.3, 0, Math.PI / 2);
    simulate(battle, 1);
    expect(late.elementInfusion).toBe('fire');
  });

  it('進軍門には柱の当たり判定がなく、帯の幅はサイズ段階で広がる', () => {
    for (let level = 0; level <= MAX_GATE_LEVEL; level++) {
      const gate = new Battle().spawnFacility('fire_gate', 0, -5, 0, Math.PI / 2, { ...MARCH, gateLevel: level });
      expect(gate.obstacles.length).toBe(0);
      expect(gate.gateOpening).toBe(MARCH_GATE_OPENING_WIDTHS[level]);
    }
  });

  it('巨大化で作り直された個体は後継をたどれる', () => {
    const battle = new Battle();
    battle.spawnFacility('giant_gate', 0, -5, 0, Math.PI / 2, MARCH);
    const original = battle.spawnUnit('clubber', 0, -10, 0, Math.PI / 2);
    battle.spawnUnit('clubber', 1, 20, 0);
    stepUntilCombat(battle);
    expect(original.alive).toBe(false);
    expect(original.replacedBy?.alive).toBe(true);
  });
});

describe('ローグライト: ランの進行', () => {
  it('敵予算は式どおりに増え、エリートは15%多い', () => {
    expect(getRogueEnemyBudget(1)).toBe(500);
    expect(getRogueEnemyBudget(4)).toBe(Math.round((500 + 540 + 126) / 50) * 50);
    expect(getRogueEnemyBudget(5)).toBe(Math.round(((500 + 720 + 224) * 1.15) / 50) * 50);
    expect(getRogueEnemyBudget(15)).toBeGreaterThan(getRogueEnemyBudget(14));
  });

  it('敵編成は同じシードなら同じで、予算を超えない', () => {
    for (const round of [1, 6, 12]) {
      const a = generateRogueEnemyLineup(round, 42);
      const b = generateRogueEnemyLineup(round, 42);
      expect(a).toEqual(b);
      expect(a.every((r) => r.team === 1)).toBe(true);
      const cost = a.reduce((s, r) => s + (r.typeId ? UNIT_TYPES[r.typeId].cost : 0), 0);
      expect(cost).toBeLessThanOrEqual(getRogueEnemyBudget(round));
    }
  });

  it('最終ラウンドには使徒・神のボスが1体入る', () => {
    const lineup = generateRogueEnemyLineup(ROGUE_FINAL_ROUND, 7);
    const bosses = lineup.filter((r) => r.boss);
    expect(bosses.length).toBe(1);
    expect(UNIT_TYPES[bosses[0].typeId!].category).toBe('divine');
  });

  it('スターターの兵種とレリックでランが始まる', () => {
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    expect(run.budget).toBe(ROGUE_START_BUDGET);
    expect(run.lives).toBe(ROGUE_START_LIVES);
    expect(run.ownedUnits).toEqual([...ROGUE_STARTERS[0].units]);
    expect(run.relics).toEqual([{ id: ROGUE_STARTERS[0].relic, level: 0 }]);
  });

  it('報酬の3択は種類が重ならず、同じ状態なら同じ内容になる', () => {
    const run = new RogueliteRun(99);
    const a = generateRewardOptions(run, createSeededRng(5));
    const b = generateRewardOptions(run, createSeededRng(5));
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    expect(new Set(a.map((o) => o.kind)).size).toBe(3);
    for (const o of a) {
      if (o.kind === 'unit') expect(run.ownsUnit(o.unitId!)).toBe(false);
      if (o.kind === 'relic') expect(run.ownsRelic(o.relicId!)).toBe(false);
    }
  });

  it('エリートラウンドの報酬には施設スロットが必ず入る', () => {
    const run = new RogueliteRun(3);
    run.round = 5;
    for (let i = 0; i < 10; i++) {
      const opts = generateRewardOptions(run, createSeededRng(i));
      expect(opts.some((o) => o.kind === 'slot')).toBe(true);
    }
  });

  it('兵種が上限の8種なら兵種カードは出ない', () => {
    const run = new RogueliteRun(3);
    run.ownedUnits = UNIT_TYPE_LIST.slice(0, ROGUE_MAX_OWNED_UNITS).map((u) => u.id);
    for (let i = 0; i < 20; i++) {
      expect(generateRewardOptions(run, createSeededRng(i)).some((o) => o.kind === 'unit')).toBe(false);
    }
  });

  it('門の拡張で門のサイズが1段階上がる', () => {
    const run = new RogueliteRun(3, ROGUE_STARTERS[0]);
    applyReward(run, { kind: 'gate_upgrade', rarity: 'common', title: '', description: '', relicIndex: 0 });
    expect(run.relics[0].level).toBe(1);
  });

  it('勝つと報酬が用意され、負けるとライフが減って0で終わる', () => {
    const run = new RogueliteRun(11);
    run.recordWin(1, 500, 80);
    expect(run.clearedRounds).toBe(1);
    expect(run.pendingRewards?.length).toBe(3);
    run.chooseReward(null);
    expect(run.pendingRewards).toBeNull();
    run.advanceRound();
    expect(run.round).toBe(2);
    run.recordLoss(10, 5);
    expect(run.lives).toBe(ROGUE_START_LIVES - 1);
    expect(run.ended).toBe(false);
    run.recordLoss(10, 5);
    run.recordLoss(10, 5);
    expect(run.ended).toBe(true);
    expect(run.endReason).toBe('defeat');
  });

  it('引き直しは回数を消費し、0回になるとできない', () => {
    const run = new RogueliteRun(11);
    run.recordWin(1, 0, 0);
    const first = run.pendingRewards;
    expect(run.reroll()).toBe(true);
    expect(run.pendingRewards).not.toEqual(first);
    expect(run.reroll()).toBe(true);
    expect(run.reroll()).toBe(false);
  });

  it('最終ラウンドに勝つとクリアになり、残りライフがスコアに入る', () => {
    const run = new RogueliteRun(11);
    run.round = ROGUE_FINAL_ROUND;
    const before = run.score;
    run.recordWin(0, 0, 0);
    expect(run.endReason).toBe('clear');
    expect(run.score - before).toBe(1000 + run.lives * 500);
  });

  it('ランの状態を保存して復元できる', () => {
    const run = new RogueliteRun(123, ROGUE_STARTERS[2]);
    run.recordWin(0.5, 100, 50);
    run.budget += 300;
    const copy = RogueliteRun.fromState(JSON.parse(JSON.stringify(run.toState())));
    expect(copy.toState()).toEqual(run.toState());
  });

  it('スターターの解放条件とメタ進行の反映', () => {
    const meta = { bestScore: 0, bestRound: 0, clears: 0, runs: 0 };
    expect(isStarterUnlocked(ROGUE_STARTERS[3], meta)).toBe(false);
    const run = new RogueliteRun(1);
    run.round = ROGUE_FINAL_ROUND;
    run.recordWin(1, 0, 0);
    const next = mergeRogueMeta(meta, run);
    expect(next.clears).toBe(1);
    expect(next.bestRound).toBe(ROGUE_FINAL_ROUND);
    expect(isStarterUnlocked(ROGUE_STARTERS[3], next)).toBe(true);
    expect(isStarterUnlocked(ROGUE_STARTERS[4], next)).toBe(true);
  });
});

describe('ローグライト: 敵の兵種の上限', () => {
  it('序盤の敵には高コストの兵種が出ない', async () => {
    const { getRogueEnemyPool } = await import('../src/game/RogueliteMode');
    const pool1 = getRogueEnemyPool(1);
    expect(pool1.every((id) => UNIT_TYPES[id].cost <= 180)).toBe(true);
    expect(pool1).not.toContain('gravimancer');
    expect(getRogueEnemyPool(12).length).toBeGreaterThan(pool1.length);
  });
});
