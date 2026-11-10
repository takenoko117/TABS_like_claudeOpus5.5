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
  ROGUE_MID_BOSS_ROUND,
  ROGUE_HARD_START_ROUND,
  ROGUE_HIGH_COST_UNIT_MIN,
  GATE_CLONE_CHANCE,
  GATE_GIANT_SCALE,
  GATE_SEQUENCE_MAX_SECONDS,
  GATE_SHRINK_SPEED,
  ROGUE_FACILITY_POSITIONS,
  ROGUE_MAX_RELIC_SLOTS,
  ROGUE_MAX_UNIT_LEVEL,
  ROGUE_MAX_UNIT_SLOTS,
  ROGUE_SKIP_GOLD,
  ROGUE_STARTERS,
  ROGUE_START_GOLD,
  ROGUE_START_LIVES,
  ROGUE_START_UNIT_SLOTS,
  RogueGateSequence,
  RogueliteRules,
  RogueliteRun,
  UNIT_TAGS,
  applyReward,
  applyRogueGates,
  formationBand,
  generateRogueFormation,
  getRelicLevelPrice,
  getRelicSlotPrice,
  gateEffectText,
  countTags,
  generateRewardOptions,
  generateRogueEnemyLineup,
  getLossUnitRarityWeights,
  getRarityWeights,
  getRogueLossGold,
  getRogueRoundKind,
  isRogueHardMode,
  unitRarity,
  getRogueEnemyBudget,
  getRogueRoundIncome,
  getRogueWinBonus,
  getSquadSize,
  getTagTier,
  getUnitLevelMul,
  getUnitLevelPrice,
  getUnitSlotCost,
  getUnitSlotPrice,
  isStarterUnlocked,
  mergeRogueMeta,
  type OwnedRelic,
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
    expect(ROGUE_FINAL_ROUND).toBe(30);
    const lineup = generateRogueEnemyLineup(ROGUE_FINAL_ROUND, 7);
    const bosses = lineup.filter((r) => r.boss);
    expect(bosses.length).toBe(1);
    expect(UNIT_TYPES[bosses[0].typeId!].category).toBe('divine');
  });

  it('15面はボス戦で、突破すると16面からハードモードに突入し高額強力な敵が増加する', () => {
    expect(getRogueRoundKind(ROGUE_MID_BOSS_ROUND)).toBe('boss');
    expect(isRogueHardMode(ROGUE_MID_BOSS_ROUND)).toBe(false);
    expect(isRogueHardMode(ROGUE_HARD_START_ROUND)).toBe(true);

    // 15面にも使徒・神のボスが1体入る
    const boss15 = generateRogueEnemyLineup(ROGUE_MID_BOSS_ROUND, 7).filter((r) => r.boss);
    expect(boss15.length).toBe(1);
    expect(UNIT_TYPES[boss15[0].typeId!].category).toBe('divine');

    // 15面を勝ってもクリア終了にはならず、3回の報酬選択を経て16面（ハードモード）へ進む
    const run = new RogueliteRun(17);
    run.round = ROGUE_MID_BOSS_ROUND;
    run.recordWin(1, 500, 100);
    expect(run.ended).toBe(false);
    expect(run.eliteRewardPicks).toBe(3);
    expect(run.pendingRewards!.some((o) => o.kind === 'unit_slot')).toBe(true);
    run.chooseReward(null);
    run.chooseReward(null);
    run.chooseReward(null);
    run.advanceRound();
    expect(run.round).toBe(ROGUE_HARD_START_ROUND);
    expect(run.isHardMode).toBe(true);

    // ハードモード（16〜30面）では通常モードより高額強力なユニット（コスト480以上）が大幅に増える
    const countHighCost = (round: number, seed: number) =>
      generateRogueEnemyLineup(round, seed).filter(
        (r) => r.typeId && UNIT_TYPES[r.typeId].cost >= ROGUE_HIGH_COST_UNIT_MIN,
      ).length;
    let normalHigh = 0;
    let hardStartHigh = 0;
    let hardLateHigh = 0;
    for (let s = 1; s <= 20; s++) {
      normalHigh += countHighCost(14, s);
      hardStartHigh += countHighCost(16, s);
      hardLateHigh += countHighCost(28, s);
    }
    expect(hardStartHigh).toBeGreaterThan(normalHigh * 2);
    expect(hardLateHigh).toBeGreaterThan(hardStartHigh);
  });

  it('スターターのカードとレリックでランが始まり、先頭から枠に収まるだけデッキに入る', () => {
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    expect(run.gold).toBe(ROGUE_START_GOLD);
    expect(run.lives).toBe(ROGUE_START_LIVES);
    expect(run.unitSlots).toBe(ROGUE_START_UNIT_SLOTS);
    expect(run.cards.map((c) => c.id)).toEqual([...ROGUE_STARTERS[0].units]);
    expect(run.cards.every((c) => c.level === 1)).toBe(true);
    expect(run.deck.map((c) => c.id)).toEqual(['clubber', 'spearman', 'swordsman']);
    expect(run.bench.map((c) => c.id)).toEqual(['archer']);
    expect(run.relics).toEqual([{ id: ROGUE_STARTERS[0].relic, level: 0, active: true }]);
    const mage = new RogueliteRun(1, ROGUE_STARTERS[3]);
    expect(mage.deck.map((c) => c.id)).toEqual(['archmage', 'archer']);
  });

  it('報酬は3枚で、1・2枠目は別々のユニットカード、同じ状態なら同じ内容になる', () => {
    const run = new RogueliteRun(99);
    for (let i = 0; i < 40; i++) {
      const a = generateRewardOptions(run, createSeededRng(i));
      expect(a).toEqual(generateRewardOptions(run, createSeededRng(i)));
      expect(a.length).toBe(3);
      expect(a[0].kind).toBe('unit');
      expect(a[1].kind).toBe('unit');
      expect(a[0].unitId).not.toBe(a[1].unitId);
      expect(['relic', 'gold']).toContain(a[2].kind);
    }
  });

  it('枠に収まらない兵種とレベル上限のカードは報酬に出ない', () => {
    const run = new RogueliteRun(99);
    run.round = 15;
    run.card('clubber')!.level = ROGUE_MAX_UNIT_LEVEL;
    for (let i = 0; i < 200; i++) {
      for (const o of generateRewardOptions(run, createSeededRng(i))) {
        if (!o.unitId) continue;
        expect(getUnitSlotCost(o.unitId)).toBeLessThanOrEqual(run.unitSlots);
        expect(o.unitId).not.toBe('clubber');
      }
    }
  });

  it('エリートラウンドの報酬の3枠目はユニット枠になる', () => {
    const run = new RogueliteRun(3);
    run.round = 5;
    for (let i = 0; i < 10; i++) {
      expect(generateRewardOptions(run, createSeededRng(i))[2].kind).toBe('unit_slot');
    }
    applyReward(run, { kind: 'unit_slot', rarity: 'rare', title: '', description: '' });
    expect(run.unitSlots).toBe(ROGUE_START_UNIT_SLOTS + 1);
  });

  it('全カードがレベル上限でもレリックやゴールドで報酬が出る', () => {
    const run = new RogueliteRun(3);
    run.cards = UNIT_TYPE_LIST.map((u) => ({ id: u.id, level: ROGUE_MAX_UNIT_LEVEL, inDeck: false }));
    for (let i = 0; i < 20; i++) {
      const options = generateRewardOptions(run, createSeededRng(i));
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((o) => o.kind === 'unit')).toBe(false);
    }
  });

  it('持っている兵種は報酬に出ない', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = new RogueliteRun(seed, ROGUE_STARTERS[seed % 3]);
      run.round = 1 + (seed % 14);
      run.unitSlots = 12;
      for (const option of generateRewardOptions(run, createSeededRng(seed))) {
        if (option.unitId) expect(run.ownsUnit(option.unitId)).toBe(false);
      }
    }
  });

  it('持っているカードやレリックの報酬はレベルが上がる', () => {
    const run = new RogueliteRun(3, ROGUE_STARTERS[0]);
    applyReward(run, { kind: 'unit', rarity: 'common', title: '', description: '', unitId: 'clubber' });
    expect(run.card('clubber')!.level).toBe(2);
    applyReward(run, { kind: 'relic', rarity: 'common', title: '', description: '', relicId: ROGUE_STARTERS[0].relic });
    expect(run.relics[0].level).toBe(1);
  });

  it('空き枠に収まる新しいカードはデッキに入り、収まらなければ控えになる', () => {
    const run = new RogueliteRun(3, ROGUE_STARTERS[0]);
    applyReward(run, { kind: 'unit', rarity: 'rare', title: '', description: '', unitId: 'dragon' });
    expect(run.card('dragon')!.inDeck).toBe(false);
    run.unitSlots = 6;
    applyReward(run, { kind: 'unit', rarity: 'rare', title: '', description: '', unitId: 'giant' });
    expect(run.card('giant')!.inDeck).toBe(true);
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
    run.gold += 3000;
    run.buyCardLevel('charger');
    run.buyUnitSlot();
    run.toggleDeck('ninja');
    run.recordLoss(0, 0);
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

describe('ローグライト v3: カードと部隊', () => {
  it('枠コストと人数は仕様の表と一致する', () => {
    const table: Array<[keyof typeof UNIT_TYPES, number, number]> = [
      ['decoy', 1, 8], ['clubber', 1, 8], ['spearman', 1, 4], ['archer', 1, 4], ['shielder', 1, 3],
      ['swordsman', 1, 3], ['charger', 1, 3], ['bomber', 1, 2], ['ninja', 1, 2], ['lightspeed_ant', 1, 2],
      ['giant_eagle', 2, 3], ['samurai', 2, 3], ['archmage', 2, 3], ['rocket_soldier', 2, 3], ['sniper', 2, 2],
      ['slime', 2, 2], ['gravimancer', 2, 2], ['buggy', 2, 2], ['minigunner', 2, 2], ['hongon', 2, 2],
      ['satellite_soldier', 2, 2], ['zaisan', 2, 2], ['sezain', 2, 1], ['anaconda', 2, 1],
      ['deoxys', 3, 2], ['hayato', 3, 2], ['giant', 3, 2], ['warelephant', 3, 1], ['dragon', 3, 1], ['angel_sachiel', 3, 1],
      ['giant_tank', 4, 1], ['giant_robot', 4, 1], ['angel_ramiel', 4, 1], ['yamamuron', 4, 1],
      ['angel_sahaquiel', 4, 1], ['angel_zeruel', 4, 1],
    ];
    expect(table.length).toBe(UNIT_TYPE_LIST.length);
    for (const [id, slot, size] of table) {
      expect([id, getUnitSlotCost(id), getSquadSize(id)]).toEqual([id, slot, size]);
    }
  });

  it('枠を超えてデッキに入れられず、外すと入れられる', () => {
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    expect(run.usedUnitSlots).toBe(3);
    expect(run.toggleDeck('archer')).toBe(false);
    expect(run.toggleDeck('clubber')).toBe(true);
    expect(run.toggleDeck('archer')).toBe(true);
    expect(run.usedUnitSlots).toBe(3);
    expect(run.toggleDeck('dragon')).toBe(false);
  });

  it('控えのカードはレベルを保持する', () => {
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    run.gold = 1000;
    run.buyCardLevel('clubber');
    run.toggleDeck('clubber');
    run.toggleDeck('clubber');
    expect(run.card('clubber')!.level).toBe(2);
  });

  it('ユニット枠は200Gから100Gずつ上がり、上限で買えない', () => {
    expect(getUnitSlotPrice(3)).toBe(200);
    expect(getUnitSlotPrice(4)).toBe(300);
    const run = new RogueliteRun(5);
    run.gold = 200;
    expect(run.buyUnitSlot()).toBe(true);
    expect(run.gold).toBe(0);
    expect(run.buyUnitSlot()).toBe(false);
    run.unitSlots = ROGUE_MAX_UNIT_SLOTS;
    run.gold = 99999;
    expect(run.unitSlotPrice).toBeNull();
    expect(run.buyUnitSlot()).toBe(false);
  });

  it('レベルの価格は 100 × 枠コスト × 現在のレベルで、上限で止まる', () => {
    expect([1, 2, 3, 4].map((l) => getUnitLevelPrice('clubber', l))).toEqual([100, 200, 300, 400]);
    expect(getUnitLevelPrice('giant_tank', 2)).toBe(800);
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    run.gold = 1000;
    for (let i = 0; i < 4; i++) expect(run.buyCardLevel('clubber')).toBe(true);
    expect(run.gold).toBe(0);
    expect(run.card('clubber')!.level).toBe(ROGUE_MAX_UNIT_LEVEL);
    run.gold = 99999;
    expect(run.buyCardLevel('clubber')).toBe(false);
    expect(run.buyCardLevel('dragon')).toBe(false);
  });

  it('ゴールドが足りなければレベルは上がらない', () => {
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    run.gold = 99;
    expect(run.buyCardLevel('clubber')).toBe(false);
    expect(run.card('clubber')!.level).toBe(1);
    expect(run.gold).toBe(99);
  });

  it('レベルの倍率は Lv5 で 1.8 倍', () => {
    expect([1, 2, 3, 4, 5].map((l) => Number(getUnitLevelMul(l).toFixed(1)))).toEqual([1, 1.2, 1.4, 1.6, 1.8]);
  });

  it('デッキのカードだけが正しい人数とレベルで編成される', () => {
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    run.gold = 1000;
    run.buyCardLevel('spearman');
    const records = generateRogueFormation(run.deckRoster, run.relics, run.deckLevels);
    expect(records.filter((r) => r.typeId === 'clubber').length).toBe(8);
    expect(records.filter((r) => r.typeId === 'spearman').length).toBe(4);
    expect(records.filter((r) => r.typeId === 'spearman').every((r) => r.level === 2)).toBe(true);
    expect(records.filter((r) => r.typeId === 'swordsman').length).toBe(3);
    expect(records.some((r) => r.typeId === 'archer')).toBe(false);
    expect(run.deckBodies).toBe(15);
  });

  it('戦闘の勝敗でカードは減らない', () => {
    const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
    const before = run.cards.length;
    run.recordLoss(0, 0);
    run.advanceRound();
    expect(run.cards.length).toBe(before);
  });

  it('複製と分裂にもレベルの倍率が乗る', () => {
    const battle = new Battle();
    const slime = battle.spawnUnit('slime', 0, -6, 0);
    slime.maxHp *= 1.8;
    slime.hp = slime.maxHp;
    slime.levelHpMul = 1.8;
    slime.permDamageMul *= 1.8;
    const clone = battle.spawnCloneUnit(slime, -6, 3);
    expect(clone.maxHp).toBeCloseTo(slime.maxHp);
    expect(clone.permDamageMul).toBeCloseTo(1.8);
    const split = battle.spawnSplitSlime(slime, -6, -3, 1);
    expect(split.maxHp).toBe(Math.round(90 * 1.8));
    expect(split.permDamageMul).toBeCloseTo(1.8);
  });

  it('勝利ボーナスとラウンド収入を受け取る', () => {
    const run = new RogueliteRun(5);
    const gold = run.gold;
    run.recordWin(1, 0, 0);
    expect(run.gold).toBe(gold + getRogueWinBonus(1));
    run.chooseReward(null);
    expect(run.gold).toBe(gold + getRogueWinBonus(1) + ROGUE_SKIP_GOLD);
    run.advanceRound();
    expect(run.gold).toBe(gold + getRogueWinBonus(1) + ROGUE_SKIP_GOLD + getRogueRoundIncome(2));
  });
});

describe('ローグライト v3: レリックのレベル', () => {
  it('門以外のレリックもレベルで効果と耐久力が上がる', () => {
    const battle = new Battle();
    const base = battle.spawnFacility('cannon_tower', 0, -4, -8);
    const high = battle.spawnFacility('cannon_tower', 0, -4, 8, undefined, { relicLevel: 3 });
    expect(high.maxHp).toBeCloseTo(base.maxHp * 2);
    expect(high.cannonDamageMul).toBeCloseTo(2.2);
    expect(base.cannonDamageMul).toBe(1);
  });

  it('編成にレリックのレベルが渡る', () => {
    const records = generateRogueFormation({ clubber: 1 }, [{ id: 'buff_totem', level: 2, active: true }]);
    expect(records.find((r) => r.facilityId === 'buff_totem')!.relicLevel).toBe(2);
  });
});

describe('ローグライト: 敗北のルール', () => {
  it('敗北のゴールドは勝利ボーナスの2倍', () => {
    expect(getRogueLossGold(1)).toBe(getRogueWinBonus(1) * 2);
    const run = new RogueliteRun(5);
    run.round = 7;
    const gold = run.gold;
    expect(run.recordLoss(0, 0)).toBe(getRogueWinBonus(7) * 2);
    expect(run.gold).toBe(gold + getRogueWinBonus(7) * 2);
  });

  it('敗北後は報酬の3択を2回受け取ってから次へ進み、勝利後は1回', () => {
    const run = new RogueliteRun(5);
    run.recordLoss(0, 0);
    expect(run.lossRewardPicks).toBe(2);
    expect(run.pendingRewards?.length).toBe(3);
    run.chooseReward(run.pendingRewards![0]);
    expect(run.lossRewardPicks).toBe(1);
    expect(run.pendingRewards?.length).toBe(3);
    run.chooseReward(null);
    expect(run.lossRewardPicks).toBe(0);
    expect(run.pendingRewards).toBeNull();
    run.advanceRound();
    run.recordWin(1, 0, 0);
    run.chooseReward(null);
    expect(run.pendingRewards).toBeNull();
  });

  it('敗北後の抽選はユニットのレア以上が出やすい', () => {
    const rareShare = ([c, r, l]: [number, number, number]) => (r + l) / (c + r + l);
    for (const round of [1, 5, 10]) {
      expect(rareShare(getLossUnitRarityWeights(round))).toBeGreaterThan(rareShare(getRarityWeights(round)));
    }
    const countRare = (picks: number) => {
      const run = new RogueliteRun(5, ROGUE_STARTERS[0]);
      run.unitSlots = 12;
      run.lossRewardPicks = picks;
      let rare = 0;
      for (let i = 0; i < 400; i++) {
        for (const o of generateRewardOptions(run, createSeededRng(i))) {
          if (o.unitId && unitRarity(o.unitId) !== 'common') rare++;
        }
      }
      return rare;
    };
    expect(countRare(2)).toBeGreaterThan(countRare(0));
  });

  it('通算3敗で勝ちを挟んでも終了し、最後の敗北では報酬もゴールドも出ない', () => {
    const run = new RogueliteRun(5);
    run.recordLoss(0, 0);
    run.chooseReward(null);
    run.chooseReward(null);
    run.advanceRound();
    run.recordWin(1, 0, 0);
    run.chooseReward(null);
    run.advanceRound();
    run.recordLoss(0, 0);
    run.chooseReward(null);
    run.chooseReward(null);
    run.advanceRound();
    expect(run.ended).toBe(false);
    const gold = run.gold;
    expect(run.recordLoss(0, 0)).toBe(0);
    expect(run.gold).toBe(gold);
    expect(run.ended).toBe(true);
    expect(run.endReason).toBe('defeat');
    expect(run.pendingRewards).toBeNull();
  });

  it('エリートに勝ってもライフは回復しない', () => {
    const run = new RogueliteRun(5);
    run.recordLoss(0, 0);
    run.round = 5;
    run.lossRewardPicks = 0;
    run.recordWin(1, 0, 0);
    expect(run.lives).toBe(ROGUE_START_LIVES - 1);
  });

  it('ユニット枠 +1 はエリートの勝利後だけで、敗北後には出ない', () => {
    const run = new RogueliteRun(5);
    run.round = 5;
    run.recordWin(1, 0, 0);
    expect(run.pendingRewards!.some((o) => o.kind === 'unit_slot')).toBe(true);
    const lost = new RogueliteRun(5);
    lost.round = 5;
    lost.recordLoss(0, 0);
    expect(lost.pendingRewards!.some((o) => o.kind === 'unit_slot')).toBe(false);
  });

  it('エリートの勝利後は報酬の3択を3回受け取れ、ユニット枠は1回目だけ出る', () => {
    const run = new RogueliteRun(5);
    run.round = 5;
    run.recordWin(1, 0, 0);
    expect(run.eliteRewardPicks).toBe(3);
    expect(run.pendingRewards!.some((o) => o.kind === 'unit_slot')).toBe(true);
    run.chooseReward(null);
    expect(run.pendingRewards!.some((o) => o.kind === 'unit_slot')).toBe(false);
    run.chooseReward(null);
    expect(run.pendingRewards?.length).toBe(3);
    run.chooseReward(null);
    expect(run.pendingRewards).toBeNull();
    expect(run.eliteRewardPicks).toBe(0);
  });

  it('最終ラウンドで負けてもラウンドは進まず、同じボスに再挑戦する', () => {
    const run = new RogueliteRun(5);
    run.round = ROGUE_FINAL_ROUND;
    run.recordLoss(0, 0);
    run.chooseReward(null);
    run.chooseReward(null);
    const gold = run.gold;
    run.advanceRound();
    expect(run.round).toBe(ROGUE_FINAL_ROUND);
    expect(run.gold).toBe(gold + getRogueRoundIncome(ROGUE_FINAL_ROUND));
    expect(run.ended).toBe(false);
    run.recordWin(1, 0, 0);
    expect(run.endReason).toBe('clear');
  });

  it('報酬の途中で保存しても残り回数が戻る', () => {
    const run = new RogueliteRun(5);
    run.recordLoss(0, 0);
    run.chooseReward(null);
    const copy = RogueliteRun.fromState(JSON.parse(JSON.stringify(run.toState())));
    expect(copy.lossRewardPicks).toBe(1);
    expect(copy.pendingRewards).toEqual(run.pendingRewards);
  });
});

describe('ローグライト v2: 自動配置', () => {
  const zone = (r: { x: number; z: number }) => r.x >= -22 && r.x <= -1.5 && Math.abs(r.z) <= 16;

  it('所持している全員が配置エリアの中に並び、重ならない', () => {
    const roster = { clubber: 12, spearman: 8, archer: 10, giant: 3, sniper: 4 };
    const records = generateRogueFormation(roster, []);
    expect(records.length).toBe(37);
    for (const id of Object.keys(roster) as Array<keyof typeof roster>) {
      expect(records.filter((r) => r.typeId === id).length).toBe(roster[id]);
    }
    expect(records.every(zone)).toBe(true);
    for (let i = 0; i < records.length; i++) {
      for (let k = i + 1; k < records.length; k++) {
        expect(Math.hypot(records[i].x - records[k].x, records[i].z - records[k].z)).toBeGreaterThan(1);
      }
    }
  });

  it('近接が前、遠距離が後ろで、毎回同じ並びになる', () => {
    const roster = { archer: 3, clubber: 3 };
    const a = generateRogueFormation(roster, []);
    expect(a).toEqual(generateRogueFormation(roster, []));
    expect(formationBand('clubber')).toBe(0);
    expect(formationBand('archer')).toBe(2);
    const minMelee = Math.min(...a.filter((r) => r.typeId === 'clubber').map((r) => r.x));
    const maxArcher = Math.max(...a.filter((r) => r.typeId === 'archer').map((r) => r.x));
    expect(maxArcher).toBeLessThan(minMelee);
  });

  it('極端に多くてもエリアからはみ出さない', () => {
    expect(generateRogueFormation({ giant: 200, clubber: 200 }, []).every(zone)).toBe(true);
  });

  it('ゲートは戦場に置かず、発動中の門以外の施設だけが決まった位置に置かれる', () => {
    const records = generateRogueFormation({ clubber: 1 }, [
      { id: 'fire_gate', level: 0, active: true },
      { id: 'buff_totem', level: 0, active: true },
      { id: 'cannon_tower', level: 0, active: false },
    ]);
    const facilities = records.filter((r) => r.facilityId);
    expect(facilities.map((r) => r.facilityId)).toEqual(['buff_totem']);
    expect(facilities[0].x).toBe(ROGUE_FACILITY_POSITIONS.buff_totem!.x);
  });
});

describe('ローグライト v2: ゲートの全員適用', () => {
  const setup = (counts = 8) => {
    const battle = new Battle();
    const rules = new RogueliteRules();
    battle.rules = rules;
    for (let i = 0; i < counts; i++) battle.spawnUnit('clubber', 0, -10, -8 + i * 2);
    battle.spawnUnit('clubber', 1, 10, 0);
    rules.start(battle);
    return { battle, rules };
  };
  const red = (b: Battle) => b.units.filter((u) => u.team === 0);

  it('増殖はレベルの確率で複製され、最大レベルなら全員が増える', () => {
    const low = setup();
    let i = 0;
    applyRogueGates(low.battle, low.rules, [{ id: 'multiplier_gate', level: 0, active: true }], () => (i++ % 2 === 0 ? 0.1 : 0.9));
    expect(red(low.battle).length).toBeGreaterThan(8);
    const max = setup();
    applyRogueGates(max.battle, max.rules, [{ id: 'multiplier_gate', level: 3, active: true }], createSeededRng(1));
    expect(red(max.battle).length).toBe(16);
    const none = setup();
    applyRogueGates(none.battle, none.rules, [{ id: 'multiplier_gate', level: 0, active: true }], () => GATE_CLONE_CHANCE[0]);
    expect(red(none.battle).length).toBe(8);
  });

  it('巨大化はレベルの倍率で全員に効き、敵には効かない', () => {
    const { battle, rules } = setup();
    applyRogueGates(battle, rules, [{ id: 'giant_gate', level: 1, active: true }]);
    expect(red(battle).length).toBe(8);
    for (const u of red(battle)) {
      expect(u.scale).toBeCloseTo(GATE_GIANT_SCALE[1]);
      expect(u.maxHp).toBeCloseTo(UNIT_TYPES.clubber.hp * GATE_GIANT_SCALE[1]);
    }
    expect(battle.units.find((u) => u.team === 1)!.scale).toBe(1);
  });

  it('縮小はレベルで移動速度が上がる', () => {
    const { battle, rules } = setup(2);
    applyRogueGates(battle, rules, [{ id: 'shrink_gate', level: 3, active: true }]);
    expect(red(battle)[0].permSpeedMul).toBeCloseTo(GATE_SHRINK_SPEED[3]);
    expect(red(battle)[0].scale).toBeCloseTo(0.6);
  });

  it('複製には巨大化が引き継がれる', () => {
    const { battle, rules } = setup(2);
    applyRogueGates(battle, rules, [
      { id: 'multiplier_gate', level: 3, active: true },
      { id: 'giant_gate', level: 3, active: true },
    ]);
    expect(red(battle).length).toBe(4);
    for (const u of red(battle)) expect(u.scale).toBeCloseTo(1.6);
  });

  it('ゲートはシナジーの数に入らない', () => {
    const { battle, rules } = setup();
    applyRogueGates(battle, rules, [
      { id: 'fire_gate', level: 3, active: true },
      { id: 'giant_gate', level: 0, active: true },
    ]);
    expect(rules.tier('fire')).toBe(0);
    expect(rules.tier('giant')).toBe(0);
    for (const u of red(battle)) expect(u.grantedTags).not.toContain('giant');
  });

  it('属性ゲートは重ねられ、レベルで持続が伸びる', () => {
    const { battle, rules } = setup(1);
    battle.aiEnabled = true;
    battle.combat.damageListeners.push((e) => rules.onDamage(e));
    applyRogueGates(battle, rules, [
      { id: 'fire_gate', level: 3, active: true },
      { id: 'venom_gate', level: 0, active: true },
    ]);
    const attacker = red(battle)[0];
    const enemy = battle.spawnUnit('giant', 1, 12, 4);
    enemy.takeDamage(1, enemy.chest, new Vector3(), 1 / 120, attacker);
    expect(enemy.burnTimer).toBeCloseTo(2.5 * 2.5);
    expect(enemy.poisonTimer).toBeCloseTo(3);
  });

  it('発動するゲートがなければ何も起きない', () => {
    const { battle, rules } = setup(3);
    applyRogueGates(battle, rules, []);
    expect(red(battle).length).toBe(3);
    expect(rules.gateInfusions).toEqual([]);
  });

  it('説明文はレベルの数値を出す', () => {
    expect(gateEffectText('multiplier_gate', 1)).toContain('50%');
    expect(gateEffectText('giant_gate', 3)).toContain('1.6');
  });
});

describe('ローグライト v3: レリック枠と強化', () => {
  it('レリック枠は1000Gから500Gずつ上がり、上限で買えなくなる', () => {
    expect(getRelicSlotPrice(2)).toBe(1000);
    expect(getRelicSlotPrice(3)).toBe(1500);
    const run = new RogueliteRun(1);
    run.gold = 2500;
    expect(run.buyRelicSlot()).toBe(true);
    expect(run.gold).toBe(1500);
    expect(run.buyRelicSlot()).toBe(true);
    expect(run.gold).toBe(0);
    expect(run.relicSlots).toBe(ROGUE_MAX_RELIC_SLOTS);
    run.gold = 99999;
    expect(run.relicSlotPrice).toBeNull();
    expect(run.buyRelicSlot()).toBe(false);
  });

  it('ゴールドが足りなければレリック枠もレベルも買えない', () => {
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    run.gold = 0;
    expect(run.buyRelicSlot()).toBe(false);
    expect(run.buyRelicLevel(0)).toBe(false);
    expect(run.relics[0].level).toBe(0);
  });

  it('レリックの強化はレベルで値上がりし、最大で止まる。門以外も強化できる', () => {
    expect([0, 1, 2].map(getRelicLevelPrice)).toEqual([500, 1000, 1500]);
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    run.gold = 3000;
    expect(run.buyRelicLevel(0)).toBe(true);
    expect(run.buyRelicLevel(0)).toBe(true);
    expect(run.buyRelicLevel(0)).toBe(true);
    expect(run.relics[0].level).toBe(3);
    expect(run.gold).toBe(0);
    expect(run.relicLevelPrice(0)).toBeNull();
    const heavy = new RogueliteRun(1, ROGUE_STARTERS[1]);
    expect(heavy.relicLevelPrice(0)).toBe(500);
  });

  it('枠に空きがなければ新しいレリックはOFFで入り、ONにもできない', () => {
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    run.gainRelic('fire_gate');
    run.gainRelic('venom_gate');
    expect(run.relics.map((r) => r.active)).toEqual([true, true, false]);
    expect(run.toggleRelic(2)).toBe(false);
    expect(run.toggleRelic(0)).toBe(true);
    expect(run.toggleRelic(2)).toBe(true);
    expect(run.activeRelics.map((r) => r.id)).toEqual(['fire_gate', 'venom_gate']);
  });

  it('枠を増やすと待機中のレリックが発動する', () => {
    const run = new RogueliteRun(1, ROGUE_STARTERS[0]);
    run.gainRelic('fire_gate');
    run.gainRelic('venom_gate');
    run.addRelicSlot();
    expect(run.activeRelics.length).toBe(3);
  });
});

describe('ローグライト: 開戦時のゲート演出', () => {
  const setup = (counts = 6) => {
    const battle = new Battle();
    const rules = new RogueliteRules();
    battle.rules = rules;
    for (let i = 0; i < counts; i++) battle.spawnUnit('clubber', 0, -8 - i * 2, -6 + i * 2);
    battle.spawnUnit('clubber', 1, 18, 0);
    rules.start(battle);
    return { battle, rules };
  };
  const GATES: OwnedRelic[] = [
    { id: 'fire_gate', level: 1, active: true },
    { id: 'multiplier_gate', level: 1, active: true },
    { id: 'giant_gate', level: 2, active: true },
    { id: 'shrink_gate', level: 0, active: true },
  ];
  const summary = (battle: Battle) =>
    battle.units
      .filter((u) => u.team === 0)
      .map((u) => [u.scale.toFixed(3), u.maxHp.toFixed(2), u.permDamageMul.toFixed(3), u.permSpeedMul.toFixed(3), u.elementInfusion, u.isClone])
      .map(String)
      .sort();
  const runToEnd = (battle: Battle) => {
    let steps = 0;
    while (battle.opening && steps++ < 2000) battle.step(battle.fixedDt);
    return steps;
  };

  it('演出ありでも途中スキップでも一括適用でも最終結果が一致する', () => {
    const bulk = setup();
    applyRogueGates(bulk.battle, bulk.rules, GATES, createSeededRng(7));

    const played = setup();
    played.battle.beginCombat(new RogueGateSequence(played.battle, played.rules, GATES, createSeededRng(7)));
    runToEnd(played.battle);

    const skipped = setup();
    const seq = new RogueGateSequence(skipped.battle, skipped.rules, GATES, createSeededRng(7));
    skipped.battle.beginCombat(seq);
    for (let i = 0; i < 90; i++) skipped.battle.step(skipped.battle.fixedDt);
    seq.skip();

    expect(summary(played.battle)).toEqual(summary(bulk.battle));
    expect(summary(skipped.battle)).toEqual(summary(bulk.battle));
    expect(played.rules.gateInfusions).toEqual(bulk.rules.gateInfusions);
    expect(skipped.rules.gateInfusions).toEqual(bulk.rules.gateInfusions);
  });

  it('演出は2秒以内に終わり、その間は制限時間も行動も進まず、終わると0秒から始まる', () => {
    const { battle, rules } = setup();
    battle.timeLimitSeconds = 90;
    const u = battle.units.find((x) => x.team === 0)!;
    const startX = u.pelvis.pos.x;
    battle.beginCombat(new RogueGateSequence(battle, rules, GATES.slice(0, 2), createSeededRng(1)));
    expect(battle.aiEnabled).toBe(false);
    for (let i = 0; i < 60; i++) {
      battle.step(battle.fixedDt);
      expect(battle.time).toBe(0);
    }
    expect(battle.aiEnabled).toBe(false);
    const steps = runToEnd(battle) + 60;
    expect(steps * battle.fixedDt).toBeLessThanOrEqual(GATE_SEQUENCE_MAX_SECONDS + 0.02);
    expect(battle.aiEnabled).toBe(true);
    expect(battle.time).toBeLessThanOrEqual(battle.fixedDt);
    void startX;
  });

  it('ゲートが通過した兵から順に強化され、ゲートは最後に消える', () => {
    const { battle, rules } = setup();
    battle.beginCombat(new RogueGateSequence(battle, rules, [{ id: 'giant_gate', level: 3, active: true }], createSeededRng(1)));
    battle.step(battle.fixedDt);
    expect(battle.facilities.filter((f) => f.isEnchantGate).length).toBe(1);
    const counts: number[] = [];
    for (let i = 0; i < 80 && battle.opening; i++) {
      battle.step(battle.fixedDt);
      counts.push(battle.units.filter((u) => u.team === 0 && u.scale > 1.5).length);
    }
    expect(counts.some((c) => c > 0 && c < 6)).toBe(true);
    runToEnd(battle);
    expect(battle.units.filter((u) => u.team === 0).every((u) => u.scale > 1.5)).toBe(true);
    expect(battle.facilities.length).toBe(0);
  });

  it('隊列より大きいゲートは柱の当たり判定を持たず、幅が隊列を覆う', () => {
    const { battle, rules } = setup();
    battle.beginCombat(new RogueGateSequence(battle, rules, [{ id: 'fire_gate', level: 0, active: true }], createSeededRng(1)));
    battle.step(battle.fixedDt);
    const gate = battle.facilities[0];
    expect(gate.obstacles.length).toBe(0);
    expect(gate.gateOpening).toBeGreaterThanOrEqual(28);
  });

  it('属性の見た目は複製にも付き、敵には付かない', () => {
    const { battle, rules } = setup(3);
    applyRogueGates(battle, rules, [
      { id: 'multiplier_gate', level: 3, active: true },
      { id: 'venom_gate', level: 0, active: true },
    ], createSeededRng(2));
    const red = battle.units.filter((u) => u.team === 0);
    expect(red.length).toBe(6);
    expect(red.every((u) => u.elementInfusion === 'poison')).toBe(true);
    expect(battle.units.find((u) => u.team === 1)!.elementInfusion).toBeNull();
  });

  it('ゲートがなければ演出なしで即座に開戦する', () => {
    const { battle } = setup();
    battle.beginCombat(null);
    expect(battle.aiEnabled).toBe(true);
    expect(battle.opening).toBeNull();
  });
});

describe('ローグライト v3: カードのボクセルモデル', () => {
  it('全兵種が歩き続けても崩れず、原点から離れない', async () => {
    const { UnitPreviewActor } = await import('../src/render/UnitPreviews');
    for (const ut of UNIT_TYPE_LIST) {
      const actor = new UnitPreviewActor(ut.id);
      actor.setLooking(true);
      for (let i = 0; i < 45; i++) actor.advance(1 / 30);
      actor.setLooking(false);
      for (let i = 0; i < 45; i++) actor.advance(1 / 30);
      for (const p of actor.world.particles) {
        expect([ut.id, Number.isFinite(p.pos.x + p.pos.y + p.pos.z)]).toEqual([ut.id, true]);
        expect(Math.abs(p.pos.x)).toBeLessThan(40);
      }
      expect(Math.hypot(actor.unit.pelvis.pos.x, actor.unit.pelvis.pos.z)).toBeLessThan(0.01);
      expect(actor.unit.alive).toBe(true);
    }
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
