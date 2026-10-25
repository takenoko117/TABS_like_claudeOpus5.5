import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { FACILITY_TYPES } from '../src/facilities/FacilityTypes';

function simulate(battle: Battle, duration: number, dt: number = 1 / 60): void {
  const steps = Math.ceil(duration / dt);
  for (let i = 0; i < steps; i++) {
    battle.step(dt);
  }
}

describe('施設システム (Facilities)', () => {
  it('全4種類の施設が正常に生成され、物理コライダーが登録される', () => {
    const battle = new Battle();
    const barracks = battle.spawnFacility('barracks', 0, -5, 0);
    const totem = battle.spawnFacility('buff_totem', 0, -8, 2);
    const gate = battle.spawnFacility('multiplier_gate', 0, 0, 0);
    const cannon = battle.spawnFacility('cannon_tower', 1, 6, -3);

    expect(battle.facilities.length).toBe(4);
    expect(battle.world.obstacles.length).toBeGreaterThanOrEqual(5); // gateは2本柱

    expect(barracks.hp).toBe(FACILITY_TYPES.barracks.hp);
    expect(totem.hp).toBe(FACILITY_TYPES.buff_totem.hp);
    expect(gate.hp).toBe(FACILITY_TYPES.multiplier_gate.hp);
    expect(cannon.hp).toBe(FACILITY_TYPES.cannon_tower.hp);

    // 削除時にコライダーも解除される
    battle.removeFacility(gate);
    expect(battle.facilities.length).toBe(3);
  });

  it('召喚ポータル (barracks) が破壊されるまで定期的にユニットを召喚する', () => {
    const battle = new Battle();
    battle.spawnFacility('barracks', 0, -6, 0);
    battle.aiEnabled = true;

    expect(battle.units.length).toBe(0);

    // 初回スポーンディレイ（1.8秒後）経過
    simulate(battle, 2.2);
    expect(battle.units.length).toBeGreaterThanOrEqual(1);
    expect(battle.units[0].team).toBe(0);

    const countBefore = battle.units.length;
    // ポータルを破壊
    const portal = battle.facilities[0];
    portal.takeDamage(1000);
    expect(portal.alive).toBe(false);

    // 破壊後は時間が経過しても新規召喚されない
    simulate(battle, 6.0);
    expect(battle.units.length).toBe(countBefore);
  });

  it('加護のトーテム (buff_totem) が範囲内の味方にバフを与え、HPを回復する', () => {
    const battle = new Battle();
    battle.spawnFacility('buff_totem', 0, 0, 0);
    const ally = battle.spawnUnit('swordsman', 0, 2, 0);
    const enemy = battle.spawnUnit('swordsman', 1, 2, 0);
    const farAlly = battle.spawnUnit('swordsman', 0, 15, 0);

    // ダメージを受けている状態にする
    ally.hp = 30;

    battle.aiEnabled = true;
    simulate(battle, 0.5);

    // 範囲内の味方にバフ（攻撃力倍率・速度倍率・リジェネ）が付与される
    expect(ally.damageMul).toBeGreaterThan(1.0);
    expect(ally.speedMul).toBeGreaterThan(1.0);
    expect(ally.hasBuff).toBe(true);
    expect(ally.hp).toBeGreaterThan(30);

    // 敵や遠くの味方にはバフが付与されない
    expect(enemy.damageMul).toBe(1.0);
    expect(enemy.hasBuff).toBe(false);
    expect(farAlly.damageMul).toBe(1.0);
    expect(farAlly.hasBuff).toBe(false);

    // トーテム破壊後はバフが消滅する
    const totem = battle.facilities[0];
    totem.takeDamage(1000);
    simulate(battle, 0.1);
    expect(ally.hasBuff).toBe(false);
  });

  it('増殖ゲート (multiplier_gate) を通過した味方ユニットが複製（+1体）される', () => {
    const battle = new Battle();
    // 原点に正面向き（facing = PI/2, +X方向）でゲートを配置
    battle.spawnFacility('multiplier_gate', 0, 0, 0, Math.PI / 2);

    // ゲートの手前（x = -0.5）から奥（+X方向）へ歩かせる味方ユニット
    const unit = battle.spawnUnit('clubber', 0, -0.4, 0, Math.PI / 2);
    // 青軍の敵をゲートの奥に置いておびき寄せる
    battle.spawnUnit('clubber', 1, 6, 0);

    battle.aiEnabled = true;
    expect(battle.units.filter((u) => u.team === 0).length).toBe(1);

    // シミュレーションを進めてゲートを通過させる
    simulate(battle, 1.2);

    // 複製されて味方ユニットが2体以上になる
    const redUnits = battle.units.filter((u) => u.team === 0);
    expect(redUnits.length).toBeGreaterThanOrEqual(2);
    expect(unit.gateCooldown).toBeGreaterThan(0);
  });

  it('防衛キャノン砲台 (cannon_tower) が接近する敵に砲撃を行って迎撃する', () => {
    const battle = new Battle();
    battle.spawnFacility('cannon_tower', 0, -5, 0);
    const target = battle.spawnUnit('giant', 1, 4, 0);
    const initHp = target.hp;

    let fired = false;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'cannon_fire') fired = true;
    };

    battle.aiEnabled = true;
    simulate(battle, 3.0);

    expect(fired).toBe(true);
    // 着弾して巨人にダメージが入っている
    expect(target.hp).toBeLessThan(initHp);
  });

  it('敵ユニットが敵施設をターゲットとして認識し、接近して破壊できる', () => {
    const battle = new Battle();
    const enemyPortal = battle.spawnFacility('barracks', 1, 3, 0);
    // 近接剣士を複数体配置
    battle.spawnUnit('swordsman', 0, -2, -1);
    battle.spawnUnit('swordsman', 0, -2, 1);

    battle.aiEnabled = true;
    expect(enemyPortal.alive).toBe(true);

    // 剣士たちがポータルへ突撃して攻撃
    simulate(battle, 5.0);

    // ポータルがダメージを受けているか破壊されている
    expect(enemyPortal.hp).toBeLessThan(enemyPortal.maxHp);
  });

  it('召喚ポータルが残っている間は、ユニットが全滅しても敗北判定にならない', () => {
    const battle = new Battle();
    battle.spawnFacility('barracks', 0, -10, 0);
    battle.spawnUnit('swordsman', 1, 5, 0);

    expect(battle.aliveCount(0)).toBe(0);
    expect(battle.aliveCount(1)).toBe(1);

    // ユニットは0だがポータルがあるので決着しない (null)
    expect(battle.result()).toBeNull();
  });
});
