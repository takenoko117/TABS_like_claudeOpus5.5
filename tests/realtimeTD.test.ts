import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import {
  getDeployCooldown,
  getDeployCost,
  getCounterEliteCount,
  getEnemyCannonCount,
  getEnemyTimeMul,
  getWaveEliteCount,
  TD_ALWAYS_ELITE_FROM_WAVE,
  TD_ELITE_WAVES,
  TD_ENEMY_CANNON_INTERVAL,
  TD_ENEMY_CANNON_POSITIONS,
  getWaveAt,
  getWaveBudget,
  getWaveRound,
  levelForTotalXp,
  pickWaveEnemies,
  TD_ALLY_CAP,
  TD_COUNTER_BONUS_MONEY,
  TD_DURATION_SECONDS,
  TD_ENEMY_BASE_HP,
  TD_PLAYER_BASE_HP,
  TD_START_MONEY,
  TD_START_PLAYER_CANNONS,
  TD_BASE_PRICE_START,
  TD_BASE_RANGED_DAMAGE_MUL,
  TD_BASE_RANGED_DAMAGE_MUL_STAGE2,
  TD_BASE_STAGE2_RATIO,
  TD_EARLY_ELITE_LAST_WAVE,
  TD_CORPSE_SECONDS,
  TDRun,
  xpForKill,
  xpForLevel,
  TD_ENEMY_BASE_X,
  TD_PLAYER_BASE_X,
} from '../src/game/RealtimeTDMode';
import { ROGUE_STARTERS, getSquadSize, getUnitSlotCost } from '../src/game/RogueliteMode';
import { createSeededRng } from '../src/game/ChallengeMode';
import { FACILITY_TYPE_LIST } from '../src/facilities/FacilityTypes';
import { TEAM_COLORS, UNIT_TYPES, setAllyBluePalette } from '../src/units/UnitTypes';

function setup(seed = 1): { battle: Battle; td: TDRun } {
  const battle = new Battle();
  battle.configureStage();
  const td = new TDRun(seed, ROGUE_STARTERS[0], createSeededRng(seed));
  td.setup(battle);
  battle.beginCombat();
  return { battle, td };
}

function advance(battle: Battle, seconds: number): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) battle.step(battle.fixedDt);
}

describe('タワーディフェンスの計算式', () => {
  it('クールタイムと出撃コストは枠コストで決まる', () => {
    expect(getDeployCooldown('clubber')).toBe(5);
    expect(getDeployCost('clubber')).toBe(120);
    const big = getUnitSlotCost('giant_tank');
    expect(big).toBe(4);
    expect(getDeployCooldown('giant_tank')).toBe(30);
    expect(getDeployCost('giant_tank')).toBe(480);
  });

  it('Wave は30秒ごとに進み、20 で止まる', () => {
    expect(getWaveAt(0)).toBe(1);
    expect(getWaveAt(29.9)).toBe(1);
    expect(getWaveAt(30)).toBe(2);
    expect(getWaveAt(599)).toBe(20);
    expect(getWaveAt(900)).toBe(20);
  });

  it('Wave をローグライトのラウンドに読み替え、敵予算は増えていく', () => {
    expect(getWaveRound(1)).toBe(1);
    expect(getWaveRound(20)).toBe(29);
    for (let w = 2; w <= 20; w++) {
      if (TD_ELITE_WAVES.includes(w - 1)) continue; // エリートの直後は割増がなくなるので除く
      expect(getWaveBudget(w)).toBeGreaterThanOrEqual(getWaveBudget(w - 1));
    }
    expect(getWaveBudget(3)).toBeGreaterThan(getWaveBudget(2));
  });

  it('敵は時間とともに強くなり、10分を過ぎると急に強くなる', () => {
    expect(getEnemyTimeMul(0)).toBe(1);
    expect(getEnemyTimeMul(TD_DURATION_SECONDS)).toBeCloseTo(1.7);
    expect(getEnemyTimeMul(TD_DURATION_SECONDS + 60) - getEnemyTimeMul(TD_DURATION_SECONDS)).toBeCloseTo(0.2);
  });

  it('敵の兵種は予算を超えない', () => {
    const rng = createSeededRng(3);
    for (const wave of [1, 8, 20]) {
      const budget = getWaveBudget(wave);
      const ids = pickWaveEnemies(getWaveRound(wave), budget, rng);
      const total = ids.reduce((s, id) => s + UNIT_TYPES[id].cost, 0);
      expect(ids.length).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(budget);
    }
  });

  it('必要経験値はレベルとともに増える', () => {
    expect(xpForLevel(2)).toBeGreaterThan(xpForLevel(1));
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(5));
  });

  it('経験値の合計からレベルとたまっている経験値を求められる（経験値バーの表示用）', () => {
    expect(levelForTotalXp(0)).toEqual({ level: 1, xp: 0 });
    expect(levelForTotalXp(xpForLevel(1) - 1)).toEqual({ level: 1, xp: xpForLevel(1) - 1 });
    expect(levelForTotalXp(xpForLevel(1))).toEqual({ level: 2, xp: 0 });
    expect(levelForTotalXp(xpForLevel(1) + xpForLevel(2) + 3)).toEqual({ level: 3, xp: 3 });
  });

  it('城の HP は自軍 1000・敵軍 100000', () => {
    expect(TD_PLAYER_BASE_HP).toBe(1000);
    expect(TD_ENEMY_BASE_HP).toBe(100000);
  });

  it('タワーディフェンス用に自軍を青・敵軍を赤へ入れ替えられる', () => {
    const red = TEAM_COLORS[0];
    const blue = TEAM_COLORS[1];
    setAllyBluePalette(true);
    expect(TEAM_COLORS[0]).toBe(blue);
    expect(TEAM_COLORS[1]).toBe(red);
    setAllyBluePalette(false);
    expect(TEAM_COLORS[0]).toBe(red);
    expect(TEAM_COLORS[1]).toBe(blue);
  });

  it('基地はパレットや施設一覧に出ない', () => {
    expect(FACILITY_TYPE_LIST.some((f) => f.id === 'hq')).toBe(false);
  });
});

describe('タワーディフェンスのラン', () => {
  it('開始時は加護のトーテムと城の砲台2基があり、スターターの全ユニットが出撃でき、両軍の基地がある', () => {
    const { battle, td } = setup();
    expect(td.run.relics.map((r) => r.id)).toEqual(['buff_totem']);
    expect(battle.facilities.filter((f) => f.type.id === 'buff_totem' && f.team === 0)).toHaveLength(1);
    expect(td.playerCannons).toHaveLength(TD_START_PLAYER_CANNONS);
    expect(td.basePrice).toBe(TD_BASE_PRICE_START);
    expect(td.run.cards.map((c) => c.id)).toEqual([...ROGUE_STARTERS[0].units]);
    for (const c of td.run.cards) expect(td.deployBlock(battle, c.id)).toBeNull();
    expect(td.money).toBe(TD_START_MONEY);
    expect(td.playerBase?.maxHp).toBe(TD_PLAYER_BASE_HP);
    expect(td.enemyBase?.maxHp).toBe(TD_ENEMY_BASE_HP);
    expect(battle.facilities.filter((f) => f.type.id === 'hq')).toHaveLength(2);
  });

  it('出撃するとお金を払い、部隊が出て、クールタイムに入る', () => {
    const { battle, td } = setup();
    const spawned = td.deploy(battle, 'clubber');
    expect(spawned).toHaveLength(getSquadSize('clubber'));
    expect(td.money).toBe(TD_START_MONEY - getDeployCost('clubber'));
    expect(td.deployBlock(battle, 'clubber')).toBe('cooldown');
    expect(td.deploy(battle, 'clubber')).toHaveLength(0);
    advance(battle, getDeployCooldown('clubber') + 0.1);
    expect(td.deployBlock(battle, 'clubber')).toBeNull();
  });

  it('お金が足りなければ出撃できず、時間で貯まる', () => {
    const { battle, td } = setup();
    td.run.gold = 50;
    expect(td.deployBlock(battle, 'spearman')).toBe('money');
    advance(battle, 13);
    expect(td.money).toBeGreaterThanOrEqual(150);
    expect(td.deployBlock(battle, 'spearman')).toBeNull();
  });

  it('自軍の同時数が上限なら出撃できない', () => {
    const { battle, td } = setup();
    for (let i = 0; i < TD_ALLY_CAP; i++) battle.spawnUnit('decoy', 0, -10, (i % 20) - 10);
    td.run.gold = 1000;
    expect(td.deployBlock(battle, 'clubber')).toBe('full');
  });

  it('持っていないカードは出撃できない', () => {
    const { battle, td } = setup();
    expect(td.run.ownsUnit('giant_tank')).toBe(false);
    expect(td.deployBlock(battle, 'giant_tank')).toBe('not_owned');
  });

  it('枠はなく、手に入れたユニットとレリックはすべて使える', () => {
    const { battle, td } = setup();
    td.run.gold = 99999;
    for (const id of ['giant_tank', 'giant', 'warelephant', 'dragon', 'samurai'] as const) td.run.gainUnit(id);
    for (const c of td.run.cards) expect(td.deployBlock(battle, c.id)).toBeNull();
    for (const id of ['power_gate', 'fire_gate', 'thunder_gate', 'venom_gate', 'buff_totem'] as const) td.run.gainRelic(id);
    expect(td.run.relics.every((r) => r.active)).toBe(true);
  });

  it('時間とともに Wave が始まり、敵が湧く', () => {
    const { battle, td } = setup();
    advance(battle, 4);
    expect(td.wavesStarted).toBe(1);
    expect(battle.aliveCount(1)).toBeGreaterThan(0);
    expect(td.events.some((e) => e.kind === 'wave' && e.value === 1)).toBe(true);
  });

  it('敵を倒すと経験値とお金が入り、レベルアップで選択権がたまる', () => {
    const { battle, td } = setup();
    const victim = battle.spawnUnit('giant', 1, 10, 0);
    const before = td.money;
    td.onEnemyKilled(victim);
    expect(td.money).toBeGreaterThan(before);
    expect(td.level).toBeGreaterThan(1);
    expect(td.choices).toBe(td.level - 1);
    expect(td.totalXp).toBeCloseTo(xpForKill(victim));
    expect(levelForTotalXp(td.totalXp).level).toBe(td.level);
    const options = td.currentOptions();
    expect(options).not.toBeNull();
    expect(options!.length).toBe(3);
    const choices = td.choices;
    td.choose(battle, 0);
    expect(td.choices).toBe(choices - 1);
  });

  it('レリックを手に入れると基地の出口に門が置かれ、出撃した兵がくぐると効果が掛かる', () => {
    const { battle, td } = setup();
    td.run.gainRelic('power_gate');
    td.rebuildRelics(battle);
    const gate = battle.facilities.find((f) => f.type.id === 'power_gate');
    expect(gate).toBeDefined();
    expect(gate!.invulnerable).toBe(true);
    const [u] = td.deploy(battle, 'swordsman');
    const before = u.permDamageMul;
    // 門の先へ運ぶ
    for (const j of u.joints) j.pos.x += gate!.pos.x - u.pelvis.pos.x + 1;
    advance(battle, 0.05);
    expect(u.gatesPassed.has(gate!.id)).toBe(true);
    expect(u.permDamageMul).toBeGreaterThan(before);
  });

  it('門は攻撃を受けない', () => {
    const { battle, td } = setup();
    td.run.gainRelic('fire_gate');
    td.rebuildRelics(battle);
    const gate = battle.facilities.find((f) => f.type.id === 'fire_gate')!;
    expect(gate.takeDamage(9999)).toBe(false);
    expect(gate.alive).toBe(true);
  });

  it('敵基地を削るとお金が入り、10%ごとに反撃部隊が出る', () => {
    const { battle, td } = setup();
    const base = td.enemyBase!;
    const before = td.money;
    const enemiesBefore = battle.aliveCount(1);
    base.takeDamage(base.maxHp * 0.25);
    advance(battle, 3);
    expect(td.counters).toBe(2);
    expect(td.money).toBeGreaterThan(before + 2 * TD_COUNTER_BONUS_MONEY);
    expect(td.events.filter((e) => e.kind === 'counter')).toHaveLength(2);
    expect(battle.aliveCount(1)).toBeGreaterThan(enemiesBefore);
  });

  it('自軍の基地が壊れたら負け、敵の基地が壊れたら勝ち', () => {
    const { battle, td } = setup();
    expect(battle.result()).toBeNull();
    td.enemyBase!.takeDamage(TD_ENEMY_BASE_HP * 2);
    expect(battle.result()).toBe(0);

    const second = setup(2);
    second.td.playerBase!.takeDamage(TD_PLAYER_BASE_HP * 2);
    expect(second.battle.result()).toBe(1);
  });

  it('敵兵より敵基地のほうが近い兵は、基地を攻撃する', () => {
    const { battle, td } = setup();
    battle.spawnUnit('swordsman', 0, TD_ENEMY_BASE_X - 5, 0);
    battle.spawnUnit('decoy', 1, TD_PLAYER_BASE_X + 8, 0);
    const hp = td.enemyBase!.hp;
    advance(battle, 4);
    expect(td.enemyBase!.hp).toBeLessThan(hp);
  });

  it('ユニットが全滅しても決着しない', () => {
    const { battle } = setup();
    expect(battle.aliveCount(0)).toBe(0);
    expect(battle.result()).toBeNull();
  });

  it('作戦室で資金供給力と基地強化を買える', () => {
    const { td } = setup();
    td.run.gold = 5000;
    const income = td.fundIncome;
    expect(td.buyFund()).toBe(true);
    expect(td.fundIncome).toBeGreaterThan(income);
    const base = td.playerBase!;
    const max = base.maxHp;
    expect(td.baseRegen).toBe(0);
    expect(td.upgradeBase()).toBe(true);
    expect(base.maxHp).toBeGreaterThan(max);
    expect(td.baseRegen).toBeGreaterThan(0);
  });

  it('基地強化の自動回復で基地の HP が戻る（最大 HP は超えない）', () => {
    const { battle, td } = setup();
    td.run.gold = 5000;
    td.upgradeBase();
    const base = td.playerBase!;
    base.hp = base.maxHp - 50;
    advance(battle, 2);
    expect(base.hp).toBeGreaterThan(base.maxHp - 50);
    advance(battle, 10);
    expect(base.hp).toBeLessThanOrEqual(base.maxHp);
  });

  it('敵の城には砲台が常設され、時間で増える（壊れない）', () => {
    const { battle, td } = setup();
    const enemyCannons = () => battle.facilities.filter((f) => f.type.id === 'cannon_tower' && f.team === 1);
    expect(enemyCannons()).toHaveLength(1);
    expect(getEnemyCannonCount(TD_ENEMY_CANNON_INTERVAL * 3)).toBe(4);
    td.time = TD_ENEMY_CANNON_INTERVAL * 3 - 0.01;
    advance(battle, 0.5);
    expect(enemyCannons()).toHaveLength(4);
    expect(enemyCannons()[0].takeDamage(99999)).toBe(false);
    expect(getEnemyCannonCount(99999)).toBe(TD_ENEMY_CANNON_POSITIONS.length);
  });

  it('城強化で自軍の城に砲台が1基ずつ増える', () => {
    const { battle, td } = setup();
    td.run.gold = 99999;
    const mine = () => battle.facilities.filter((f) => f.type.id === 'cannon_tower' && f.team === 0);
    expect(mine()).toHaveLength(TD_START_PLAYER_CANNONS);
    td.upgradeBase();
    td.upgradeBase();
    expect(mine()).toHaveLength(TD_START_PLAYER_CANNONS + 2);
    expect(td.playerCannons).toHaveLength(TD_START_PLAYER_CANNONS + 2);
  });

  it('エリートは数が多く、反撃部隊にも毎回エリートが混ざる', () => {
    expect(getWaveEliteCount(3)).toBe(1);
    expect(getWaveEliteCount(18)).toBe(4);
    expect(getWaveEliteCount(TD_ALWAYS_ELITE_FROM_WAVE)).toBe(1);
    expect(getWaveEliteCount(1)).toBe(0);
    expect(getCounterEliteCount(1)).toBeGreaterThanOrEqual(1);
    expect(getCounterEliteCount(9)).toBeGreaterThan(getCounterEliteCount(1));
  });

  it('基地強化は上限まで上げると買えなくなる', () => {
    const { td } = setup();
    td.run.gold = 99999;
    while (td.upgradeBase());
    expect(td.basePrice).toBeNull();
    // 置き場所が足りて、強化のたびに砲台が増えている
    expect(td.playerCannons).toHaveLength(TD_START_PLAYER_CANNONS + td.baseLevel - 1);
    expect(td.baseLevel).toBeGreaterThan(1);
  });

  it('宝箱を開けると中身がその場で適用される', () => {
    const { battle, td } = setup();
    const rewards = td.openChest(battle, 2);
    expect(rewards.length).toBe(5);
  });

  it('倒れた兵はしばらくすると戦場から消える', () => {
    const { battle, td } = setup();
    const u = battle.spawnUnit('decoy', 1, 0, 30);
    u.die();
    td.step(battle, 0.1);
    expect(battle.units.includes(u)).toBe(true);
    td.step(battle, TD_CORPSE_SECONDS - 0.5);
    expect(battle.units.includes(u)).toBe(true);
    td.step(battle, 1);
    expect(battle.units.includes(u)).toBe(false);
  });

  it('城は遠距離攻撃のダメージを半分しか受けない（近接はそのまま）', () => {
    const { battle, td } = setup();
    const base = td.enemyBase!;
    const archer = battle.spawnUnit('archer', 0, 0, 20);
    const sword = battle.spawnUnit('swordsman', 0, 0, -20);
    const hp = base.hp;
    base.takeDamage(100, archer);
    expect(base.hp).toBeCloseTo(hp - 100 * TD_BASE_RANGED_DAMAGE_MUL);
    base.takeDamage(100, sword);
    expect(base.hp).toBeCloseTo(hp - 100 * TD_BASE_RANGED_DAMAGE_MUL - 100);
    const player = td.playerBase!;
    const enemyArcher = battle.spawnUnit('archer', 1, 0, 25);
    const php = player.hp;
    player.takeDamage(80, enemyArcher);
    expect(player.hp).toBeCloseTo(php - 80 * TD_BASE_RANGED_DAMAGE_MUL);
  });

  it('城の HP が第二段階に入ると、遠距離攻撃は 1/10 しか効かない（近接はそのまま）', () => {
    const { battle, td } = setup();
    const base = td.enemyBase!;
    const archer = battle.spawnUnit('archer', 0, 0, 20);
    const sword = battle.spawnUnit('swordsman', 0, 0, -20);
    expect(base.inLowHpStage).toBe(false);
    base.hp = base.maxHp * TD_BASE_STAGE2_RATIO;
    expect(base.inLowHpStage).toBe(true);
    const hp = base.hp;
    base.takeDamage(100, archer);
    expect(base.hp).toBeCloseTo(hp - 100 * TD_BASE_RANGED_DAMAGE_MUL_STAGE2);
    base.takeDamage(100, sword);
    expect(base.hp).toBeCloseTo(hp - 100 * TD_BASE_RANGED_DAMAGE_MUL_STAGE2 - 100);
  });

  it('序盤（5分まで）はエリートが控えめ', () => {
    for (let w = 1; w <= TD_EARLY_ELITE_LAST_WAVE; w++) expect(getWaveEliteCount(w)).toBeLessThanOrEqual(1);
    expect(TD_ALWAYS_ELITE_FROM_WAVE).toBeGreaterThan(TD_EARLY_ELITE_LAST_WAVE);
  });
});
