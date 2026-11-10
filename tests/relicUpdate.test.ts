import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Battle } from '../src/game/Battle';
import { MELEE_CLEAVE_DAMAGE_MAX_LEVEL, TOTEM_HEAL_RATIO_BY_LEVEL } from '../src/facilities/FacilityTypes';
import {
  BLAST_DAMAGE_RATIO,
  GATE_POISON_STACKS,
  REBIRTH_SLIME_COUNT,
  ROGUE_RELIC_POOL,
  RogueliteRun,
  RogueliteRules,
  SAMSARA_GRACE_SECONDS,
  SAMSARA_REVIVE_HP,
  SHOCK_CHAIN_BASE_DAMAGE,
  SHOCK_CHAIN_GROWTH,
  applyRogueGates,
  relicDescription,
} from '../src/game/RogueliteMode';
import type { Unit } from '../src/units/Unit';
import type { UnitTypeId } from '../src/units/UnitTypes';

const DT = 1 / 120;

function setup() {
  const battle = new Battle();
  const rules = new RogueliteRules();
  battle.rules = rules;
  battle.combat.damageListeners.push((e) => rules.onDamage(e));
  return { battle, rules };
}

/** 戦闘を始めた状態にする（ルールのフックが動く） */
function begin(battle: Battle, rules: RogueliteRules): void {
  rules.start(battle);
  battle.aiEnabled = true;
}

function kill(u: Unit): void {
  u.takeDamage(u.maxHp * 10, u.chest, new Vector3(), DT);
}

const allies = (b: Battle) => b.units.filter((u) => u.alive && u.team === 0);

describe('レリック更新: 抽選と互換', () => {
  it('増殖ゲートはレジェンド枠、衝波の門は報酬に出ない', () => {
    expect(ROGUE_RELIC_POOL.find((r) => r.id === 'multiplier_gate')?.rarity).toBe('legendary');
    expect(ROGUE_RELIC_POOL.some((r) => r.id === 'impact_gate')).toBe(false);
    expect(ROGUE_RELIC_POOL.find((r) => r.id === 'samsara_gate')?.rarity).toBe('legendary');
    for (const id of ['rebirth_gate', 'blast_gate', 'magnet_gate'] as const) {
      expect(ROGUE_RELIC_POOL.find((r) => r.id === id)?.rarity).toBe('rare');
    }
  });

  it('衝波の門を含む旧セーブを読み込むと、そのレリックが除かれる', () => {
    const run = new RogueliteRun(1);
    const state = run.toState();
    state.relics.push({ id: 'impact_gate', level: 2, active: true });
    const loaded = RogueliteRun.fromState(JSON.parse(JSON.stringify(state)));
    expect(loaded.relics.some((r) => r.id === 'impact_gate')).toBe(false);
    expect(loaded.relics.length).toBe(run.relics.length);
  });

  it('戦闘中ずっと働く門は開戦時の演出の対象にならない', () => {
    const run = new RogueliteRun(1);
    run.relicSlots = 4;
    run.relics = [
      { id: 'magnet_gate', level: 0, active: true },
      { id: 'power_gate', level: 0, active: true },
    ];
    expect(run.activeGates.map((r) => r.id)).toEqual(['power_gate']);
  });

  it('説明文が新しい効果になっている', () => {
    expect(relicDescription({ id: 'buff_totem', level: 0 })).toContain('最大HPの 4%');
    expect(relicDescription({ id: 'buff_totem', level: 3 })).toContain('トーテム自身');
    expect(relicDescription({ id: 'barracks', level: 3 })).toContain('所持カード');
    for (const id of ['rebirth_gate', 'samsara_gate', 'blast_gate', 'magnet_gate'] as const) {
      for (let lv = 0; lv < 4; lv++) expect(relicDescription({ id, level: lv })).not.toBe('');
    }
  });
});

describe('レリック更新: 加護のトーテム', () => {
  it('回復は対象の最大HP比で、HP の大きい兵ほど多く回復する', () => {
    const { battle } = setup();
    battle.spawnFacility('buff_totem', 0, 0, 0, Math.PI / 2, { relicLevel: 0 });
    const small = battle.spawnUnit('clubber', 0, 1, 1);
    const big = battle.spawnUnit('giant', 0, 1, -2);
    small.hp = small.maxHp * 0.5;
    big.hp = big.maxHp * 0.5;
    const s0 = small.hp;
    const b0 = big.hp;
    battle.aiEnabled = true;
    battle.step(DT);
    expect(small.hp - s0).toBeCloseTo(small.maxHp * TOTEM_HEAL_RATIO_BY_LEVEL[0] * DT, 4);
    expect(big.hp - b0).toBeCloseTo(big.maxHp * TOTEM_HEAL_RATIO_BY_LEVEL[0] * DT, 4);
    expect(big.hp - b0).toBeGreaterThan(small.hp - s0);
  });

  it('最大レベルではトーテム自身も再生する', () => {
    const { battle } = setup();
    const totem = battle.spawnFacility('buff_totem', 0, 0, 0, Math.PI / 2, { relicLevel: 3 });
    totem.hp = totem.maxHp * 0.5;
    battle.aiEnabled = true;
    battle.step(DT);
    expect(totem.hp).toBeGreaterThan(totem.maxHp * 0.5);
  });
});

describe('レリック更新: 属性3門', () => {
  it('毒は上限まで重なり、tick ダメージが重なり数倍になる', () => {
    const { battle, rules } = setup();
    const attacker = battle.spawnUnit('clubber', 0, -10, 0);
    begin(battle, rules);
    applyRogueGates(battle, rules, [{ id: 'venom_gate', level: 2, active: true }]);
    const enemy = battle.spawnUnit('giant', 1, 10, 0);
    for (let i = 0; i < 6; i++) enemy.takeDamage(1, enemy.chest, new Vector3(), DT, attacker);
    expect(enemy.poisonStacks).toBe(GATE_POISON_STACKS[2]);
    const seen: number[] = [];
    battle.combat.damageListeners.push((e) => {
      if (e.victim === enemy && e.kind === 'poison') seen.push(e.amount);
    });
    for (let i = 0; i < 40 && seen.length === 0; i++) enemy.update(DT, battle);
    expect(seen[0]).toBeCloseTo(6 * GATE_POISON_STACKS[2] * enemy.vulnerabilityMul);
  });

  it('雷はレベルに応じた数だけ近くの敵へ連鎖し、跳ぶほど雷撃が強まる', () => {
    const { battle, rules } = setup();
    const attacker = battle.spawnUnit('clubber', 0, -10, 0);
    begin(battle, rules);
    applyRogueGates(battle, rules, [{ id: 'thunder_gate', level: 2, active: true }]);
    const enemies = [0, 3, 6, 9].map((z) => battle.spawnUnit('giant', 1, 10, z));
    const shock = new Map<Unit, number>();
    battle.combat.damageListeners.push((e) => {
      if (e.kind === 'shock') shock.set(e.victim, (shock.get(e.victim) ?? 0) + e.amount);
    });
    enemies[0].takeDamage(1, enemies[0].chest, new Vector3(), DT, attacker);
    // Lv3 は 2 ホップ: 最初の敵 + 2 体
    expect(shock.size).toBe(3);
    expect(shock.has(enemies[3])).toBe(false);
    expect(shock.get(enemies[0])).toBeCloseTo(SHOCK_CHAIN_BASE_DAMAGE);
    expect(shock.get(enemies[1])).toBeCloseTo(SHOCK_CHAIN_BASE_DAMAGE * SHOCK_CHAIN_GROWTH);
    expect(shock.get(enemies[2])).toBeCloseTo(SHOCK_CHAIN_BASE_DAMAGE * SHOCK_CHAIN_GROWTH ** 2);
    expect(enemies[2].shockTimer).toBeGreaterThan(0);
  });

  it('雷: 単体の敵には感電だけで雷撃は出ない', () => {
    const { battle, rules } = setup();
    const attacker = battle.spawnUnit('clubber', 0, -10, 0);
    begin(battle, rules);
    applyRogueGates(battle, rules, [{ id: 'thunder_gate', level: 3, active: true }]);
    const enemy = battle.spawnUnit('giant', 1, 10, 0);
    let shockDamage = 0;
    battle.combat.damageListeners.push((e) => {
      if (e.kind === 'shock') shockDamage += e.amount;
    });
    enemy.takeDamage(1, enemy.chest, new Vector3(), DT, attacker);
    expect(enemy.shockTimer).toBeGreaterThan(0);
    expect(shockDamage).toBe(0);
  });
});

describe('レリック更新: 新規レリック', () => {
  it('転生の門: 倒れた味方がレベルに応じた数のスライムになり、スライムは転生しない', () => {
    const { battle, rules } = setup();
    const ally = battle.spawnUnit('swordsman', 0, -5, 0);
    battle.spawnUnit('clubber', 1, 15, 0);
    begin(battle, rules);
    rules.setRelics([{ id: 'rebirth_gate', level: 1, active: true }]);
    battle.step(DT);
    kill(ally);
    battle.step(DT);
    const slimes = allies(battle).filter((u) => u.type.id === 'slime');
    expect(slimes.length).toBe(REBIRTH_SLIME_COUNT[1]);
    // スライムが倒れても、分裂はするが転生はしない（分裂の子 2 体だけ増える）
    const before = allies(battle).length;
    kill(slimes[0]);
    battle.step(DT);
    expect(allies(battle).length).toBe(before - 1 + 2);
  });

  it('輪廻転生の門: 猶予内に倒れた味方は HP50% で復活し、猶予外では復活しない', () => {
    const { battle, rules } = setup();
    const ally = battle.spawnUnit('swordsman', 0, -5, 0);
    battle.spawnUnit('clubber', 1, 15, 0);
    begin(battle, rules);
    rules.setRelics([{ id: 'samsara_gate', level: 0, active: true }]);
    battle.step(DT);
    kill(ally);
    battle.step(DT);
    const revived = allies(battle).filter((u) => u.type.id === 'swordsman');
    expect(revived.length).toBe(1);
    expect(revived[0]).not.toBe(ally);
    expect(revived[0].hp).toBeCloseTo(revived[0].maxHp * SAMSARA_REVIVE_HP);
    expect(battle.result()).toBeNull();

    // 2回目の猶予（10秒）を過ぎてから倒れると復活しない
    battle.time += SAMSARA_GRACE_SECONDS[0][1] + 1;
    kill(revived[0]);
    battle.step(DT);
    expect(allies(battle).filter((u) => u.type.id === 'swordsman').length).toBe(0);
  });

  it('輪廻転生＋転生: 猶予内なら本人が復活し、初回の死亡でだけスライムも出る', () => {
    const { battle, rules } = setup();
    const ally = battle.spawnUnit('swordsman', 0, -5, 0);
    battle.spawnUnit('clubber', 1, 15, 0);
    begin(battle, rules);
    rules.setRelics([
      { id: 'samsara_gate', level: 0, active: true },
      { id: 'rebirth_gate', level: 0, active: true },
    ]);
    battle.step(DT);
    kill(ally);
    battle.step(DT);
    const count = (id: UnitTypeId) => allies(battle).filter((u) => u.type.id === id).length;
    expect(count('swordsman')).toBe(1);
    expect(count('slime')).toBe(1);
    kill(allies(battle).find((u) => u.type.id === 'swordsman')!);
    battle.step(DT);
    expect(count('swordsman')).toBe(1);
    expect(count('slime')).toBe(1);
  });

  it('爆裂の門: 倒れた味方が爆発し、敵だけにダメージを与える', () => {
    const { battle, rules } = setup();
    const ally = battle.spawnUnit('giant', 0, 0, 0);
    const friend = battle.spawnUnit('clubber', 0, 0, 2);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    begin(battle, rules);
    rules.setRelics([{ id: 'blast_gate', level: 3, active: true }]);
    battle.step(DT);
    const friendHp = friend.hp;
    const enemyHp = enemy.hp;
    kill(ally);
    battle.step(DT);
    expect(friend.hp).toBeCloseTo(friendHp, 0);
    expect(enemyHp - Math.max(0, enemy.hp)).toBeGreaterThan(ally.maxHp * BLAST_DAMAGE_RATIO[0]);
  });

  it('磁力の門: 一定間隔で敵を自軍の中心へ引き寄せる', () => {
    const { battle, rules } = setup();
    battle.spawnUnit('shielder', 0, -15, 0);
    const enemy = battle.spawnUnit('clubber', 1, 15, 10);
    begin(battle, rules);
    rules.setRelics([{ id: 'magnet_gate', level: 3, active: true }]);
    const vz0 = enemy.velocity.z;
    // 4 秒ぶん進めずに、パルスの直前まで時間を飛ばしてから 1 ステップ進める
    (rules as unknown as { magnetTimer: number }).magnetTimer = 4;
    battle.step(DT);
    expect(enemy.velocity.z).toBeLessThan(vz0 - 1);
    expect(enemy.shockTimer).toBeGreaterThan(0);
  });
});

describe('レリック更新: Lv4 特典', () => {
  it('疾風の門 Lv4: 最初の攻撃だけダメージ2倍', () => {
    const { battle, rules } = setup();
    const attacker = battle.spawnUnit('clubber', 0, -10, 0);
    begin(battle, rules);
    applyRogueGates(battle, rules, [{ id: 'swift_gate', level: 3, active: true }]);
    const enemy = battle.spawnUnit('giant', 1, 10, 0);
    const hp0 = enemy.hp;
    enemy.takeDamage(10, enemy.chest, new Vector3(), DT, attacker);
    const first = hp0 - enemy.hp;
    enemy.takeDamage(10, enemy.chest, new Vector3(), DT, attacker);
    const second = hp0 - first - enemy.hp;
    expect(first).toBeCloseTo(second * 2);
  });

  it('遠撃の門 Lv4: 近接の巻き込みダメージが 75%', () => {
    const { battle, rules } = setup();
    const u = battle.spawnUnit('clubber', 0, -10, 0);
    begin(battle, rules);
    applyRogueGates(battle, rules, [{ id: 'reach_gate', level: 3, active: true }]);
    expect(u.meleeCleaveDamage).toBeCloseTo(MELEE_CLEAVE_DAMAGE_MAX_LEVEL);
  });

  it('召喚ポータル Lv4: 所持カードの兵種を召喚する', () => {
    const { battle, rules } = setup();
    battle.spawnFacility('barracks', 0, -10, 0, Math.PI / 2, { relicLevel: 3 });
    battle.spawnUnit('clubber', 1, 15, 0);
    begin(battle, rules);
    rules.setRelics([], ['archer']);
    for (let i = 0; i < 120 * 3; i++) battle.step(DT);
    const summoned = battle.units.filter((u) => u.team === 0);
    expect(summoned.length).toBeGreaterThan(0);
    expect(summoned.every((u) => u.type.id === 'archer')).toBe(true);
  });
});
