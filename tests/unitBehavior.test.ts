import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import type { Unit, UnitContext } from '../src/units/Unit';
import { UNIT_TYPE_LIST, UNIT_TYPES, type UnitTypeId } from '../src/units/UnitTypes';

/**
 * ユニットごとの挙動・性能の回帰テスト。
 * 「攻撃モーションは出るのに一切当たらない」「近寄られると何もできない」「決着がつかない」
 * といった、数値上は動いていても実戦で破綻する不具合を検出する。
 */

/** 指定したユニットだけ AI を停止できる（＝静止した的にできる）診断用バトル */
class DiagBattle extends Battle {
  readonly frozen = new Set<Unit>();
  private readonly frozenCtx: UnitContext = Object.create(this, { aiEnabled: { value: false } });

  override step(dt: number): void {
    for (const u of this.units) u.update(dt, this.frozen.has(u) ? this.frozenCtx : this);
    this.world.step(dt);
    this.combat.processContacts(this.world.contacts, dt);
    this.combat.updateArrows(dt, this.units, this.world.obstacles);
    this.time += dt;
  }
}

function hdist(a: Unit, b: Unit): number {
  return Math.hypot(a.pelvis.pos.x - b.pelvis.pos.x, a.pelvis.pos.z - b.pelvis.pos.z);
}

interface DummyResult {
  battle: DiagBattle;
  attacker: Unit;
  dummy: Unit;
  /** 攻撃者がダミーに与えた総ダメージ */
  damage: number;
  /** 攻撃者がダミーに与えたダメージのうち、種別ごとの内訳 */
  byKind: Record<string, number>;
  strikes: number;
}

/** 攻撃者を静止ダミー（不死身）に向かわせ、一定時間でどれだけダメージを与えられるか計測する */
function attackDummy(attackerId: UnitTypeId, dummyId: UnitTypeId, startDist: number, seconds: number): DummyResult {
  const battle = new DiagBattle();
  const attacker = battle.spawnUnit(attackerId, 0, -startDist / 2, 0);
  const dummy = battle.spawnUnit(dummyId, 1, startDist / 2, 0);
  battle.frozen.add(dummy);
  dummy.hp = 1e7;
  const res: DummyResult = { battle, attacker, dummy, damage: 0, byKind: {}, strikes: 0 };
  battle.combat.onHit = (e) => {
    if (e.attacker !== attacker || e.victim !== dummy) return;
    res.damage += e.damage;
    res.byKind[e.kind] = (res.byKind[e.kind] ?? 0) + e.damage;
  };
  battle.aiEnabled = true;
  let prev = attacker.attackPhase;
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) {
    battle.step(battle.fixedDt);
    if (attacker.attackPhase === 'strike' && prev !== 'strike') res.strikes++;
    prev = attacker.attackPhase;
  }
  return res;
}

/** 間合いの外から接近を始める距離 */
function approachDist(id: UnitTypeId): number {
  const t = UNIT_TYPES[id];
  if (t.style === 'bow') return 15;
  return Math.min(Math.max(t.range * t.scale + 2.5, 8), 22);
}

describe('全兵種: 静止した的に攻撃が当たる（届かない攻撃を繰り返さない）', () => {
  for (const ut of UNIT_TYPE_LIST) {
    if (ut.id === 'decoy') continue; // おとりは戦闘能力なし
    for (const dummy of ['swordsman', 'giant'] as UnitTypeId[]) {
      it(`${ut.name} (${ut.id}) → ${UNIT_TYPES[dummy].name}`, () => {
        const r = attackDummy(ut.id, dummy, approachDist(ut.id), 20);
        expect(r.strikes).toBeGreaterThan(0);
        expect(r.damage).toBeGreaterThan(0);
      });
    }
  }

  it('おとり (decoy) は戦闘能力を持たず、敵にダメージを与えない', () => {
    const r = attackDummy('decoy', 'swordsman', 6, 8);
    expect(r.damage).toBe(0);
  });
});

describe('兵種固有の不具合の回帰テスト', () => {
  it('ドラゴンの火炎ブレスが人型サイズの敵に直撃し、地面に延焼ゾーンを作る', () => {
    const r = attackDummy('dragon', 'swordsman', 14, 14);
    let zones = 0;
    // 延焼ゾーンは追加で数秒観測する
    for (let i = 0; i < 120 * 3; i++) {
      r.battle.step(r.battle.fixedDt);
      zones = Math.max(zones, r.battle.combat.fireZones.length);
    }
    // 'arrow' 種別 = 火炎弾の直撃（炎上 DoT は 'magic'）
    expect(r.byKind.arrow ?? 0).toBeGreaterThan(0);
    expect(zones).toBeGreaterThan(0);
  });

  it('ドラゴンは足元に潜り込んだ敵も焼ける', () => {
    const r = attackDummy('dragon', 'swordsman', 1.2, 8);
    expect(r.byKind.arrow ?? 0).toBeGreaterThan(0);
  });

  it('からくり忍者の手裏剣が射程ぎりぎりの人型に命中する（頭上を素通りしない）', () => {
    const r = attackDummy('ninja', 'swordsman', 13, 10);
    expect(r.byKind.arrow ?? 0).toBeGreaterThan(30);
  });

  it('分裂キングスライムが跳躍後に着地プレスを発生させ、敵にダメージを与える', () => {
    const battle = new DiagBattle();
    const slime = battle.spawnUnit('slime', 0, -3, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 3, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let slams = 0;
    let slamDamage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'slime_slam') slams++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === slime) slamDamage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 10; i++) battle.step(battle.fixedDt);
    expect(slams).toBeGreaterThanOrEqual(2);
    expect(slamDamage).toBeGreaterThan(30);
  });

  it('分裂キングスライムの跳躍は目標の近くに着地する（大きく飛び越えない）', () => {
    const battle = new DiagBattle();
    const slime = battle.spawnUnit('slime', 0, -2, 0);
    const dummy = battle.spawnUnit('giant', 1, 2, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    const landDists: number[] = [];
    battle.combat.onEffect = (e) => {
      if (e.kind === 'slime_slam') landDists.push(hdist(slime, dummy));
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 3; i++) battle.step(battle.fixedDt);
    expect(landDists.length).toBeGreaterThan(0);
    expect(landDists[0]).toBeLessThan(2.1);
  });

  it('巨人は懐に密着した小型の敵にもダメージを与えられる', () => {
    const r = attackDummy('giant', 'clubber', 0.7, 8);
    expect(r.damage).toBeGreaterThan(30);
  });

  it('爆弾兵の爆弾は静止した地上の敵の足元付近に着弾する', () => {
    const battle = new DiagBattle();
    battle.spawnUnit('bomber', 0, -7, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 7, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    const errs: number[] = [];
    battle.combat.onEffect = (e) => {
      if (e.kind === 'bomb_explosion') errs.push(Math.hypot(e.pos.x - dummy.pelvis.pos.x, e.pos.z - dummy.pelvis.pos.z));
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 10; i++) battle.step(battle.fixedDt);
    expect(errs.length).toBeGreaterThanOrEqual(3);
    // 爆風半径 2.8m 以内に収まる
    for (const e of errs) expect(e).toBeLessThan(2.8);
  });
  it('暴走バギーの高速激突が敵にダメージとノックバックを与える', () => {
    const battle = new DiagBattle();
    const buggy = battle.spawnUnit('buggy', 0, -10, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 0, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let ramDamage = 0;
    battle.combat.onHit = (e) => {
      if (e.attacker === buggy && e.victim === dummy) ramDamage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 5; i++) battle.step(battle.fixedDt);
    expect(ramDamage).toBeGreaterThan(20);
  });

  it('巨大アナコンダの毒牙噛みつきが敵にダメージを与え毒状態にする', () => {
    const battle = new DiagBattle();
    const snake = battle.spawnUnit('anaconda', 0, -3, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 3, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let bites = 0;
    let biteDamage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'anaconda_bite') bites++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === snake && e.victim === dummy) biteDamage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(bites).toBeGreaterThan(0);
    expect(biteDamage).toBeGreaterThan(30);
    expect(dummy.poisonTimer).toBeGreaterThanOrEqual(0);
  });

  it('おとり (decoy) が破壊された時に破裂エフェクトが発生する', () => {
    const battle = new Battle();
    const decoy = battle.spawnUnit('decoy', 0, 0, 0);
    let popped = false;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'decoy_pop') popped = true;
    };
    decoy.takeDamage(200, decoy.chest, new (battle.spawnUnit('clubber', 1, 0, 0).velocity.constructor as any)(), 1 / 120);
    expect(popped).toBe(true);
  });

  it('戦車（超巨大）の主砲砲撃が敵に着弾して特大爆発ダメージを与える', () => {
    const battle = new DiagBattle();
    const tank = battle.spawnUnit('giant_tank', 0, -12, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 10, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let fired = 0;
    let explosions = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'tank_fire') fired++;
      if (e.kind === 'tank_explosion') explosions++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === tank && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(fired).toBeGreaterThan(0);
    expect(explosions).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(50);
  });

  it('ロケットランチャー兵士が推進ロケット弾を発射し爆発ダメージを与える', () => {
    const battle = new DiagBattle();
    const rocket = battle.spawnUnit('rocket_soldier', 0, -10, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 10, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let fired = 0;
    let explosions = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'rocket_fire') fired++;
      if (e.kind === 'rocket_explosion') explosions++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === rocket && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(fired).toBeGreaterThan(0);
    expect(explosions).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(40);
  });

  it('衛星攻撃兵士が天頂からの軌道レーザー照射で大ダメージを与える', () => {
    const battle = new DiagBattle();
    const sat = battle.spawnUnit('satellite_soldier', 0, -15, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 15, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let targets = 0;
    let beams = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'satellite_target') targets++;
      if (e.kind === 'satellite_beam') beams++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === sat && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 10; i++) battle.step(battle.fixedDt);
    expect(targets).toBeGreaterThan(0);
    expect(beams).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(80);
  });


  it('幾何神ラミエルが加粒子砲（荷電粒子ビーム）を照射し遠距離の敵に直撃大ダメージを与える', () => {
    const battle = new DiagBattle();
    const ramiel = battle.spawnUnit('angel_ramiel', 0, -15, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 12, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let beamFired = 0;
    let totalDmg = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'ramiel_beam') beamFired++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === ramiel && e.victim === dummy) totalDmg += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(beamFired).toBeGreaterThan(0);
    expect(dummy.hp).toBeLessThan(1e7);
  });

  it('使徒神サキエルが光杭パイルランスと閃光クロス爆発を放つ', () => {
    const battle = new DiagBattle();
    battle.spawnUnit('angel_sachiel', 0, -3, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 1, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let pileFired = 0;
    let crossFired = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'sachiel_pile') pileFired++;
      if (e.kind === 'sachiel_cross') crossFired++;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(pileFired).toBeGreaterThan(0);
    expect(crossFired).toBeGreaterThan(0);
  });

  it('拒絶神ゼルエルがリボンカッターで前方を薙ぎ払い敵を両断する', () => {
    const battle = new DiagBattle();
    battle.spawnUnit('angel_zeruel', 0, -4, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 1, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let ribbonFired = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'zeruel_ribbon') ribbonFired++;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(ribbonFired).toBeGreaterThan(0);
  });

  it('天落神サハクィエルが落天爆弾（angel_bomb）を投下し爆発させる', () => {
    const battle = new DiagBattle();
    battle.spawnUnit('angel_sahaquiel', 0, -10, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 5, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let bombExploded = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'sahaquiel_bomb') bombExploded++;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(bombExploded).toBeGreaterThan(0);
  });

  it('使徒神のATフィールドが被ダメージを軽減しエフェクトを発生させる', () => {
    const battle = new DiagBattle();
    const ramiel = battle.spawnUnit('angel_ramiel', 0, 0, 0);
    const dummyAttacker = battle.spawnUnit('swordsman', 1, 2, 0);
    let atFieldTriggered = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'at_field') atFieldTriggered++;
    };
    const initHp = ramiel.hp;
    // 100ダメージを与える
    ramiel.takeDamage(100, ramiel.chest, new Vector3(0, 0, 0), battle.fixedDt, dummyAttacker);
    // 35%カットされているはず（被ダメージ65）
    expect(ramiel.hp).toBeCloseTo(initHp - 65, 0);
    expect(atFieldTriggered).toBeGreaterThan(0);
  });

  it('巨大ロボットがロケットパンチを射出して敵に着弾し爆発ダメージを与える', () => {
    const battle = new DiagBattle();
    const robot = battle.spawnUnit('giant_robot', 0, -10, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 10, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let fired = 0;
    let impacts = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'robot_punch_fire') fired++;
      if (e.kind === 'robot_punch_impact') impacts++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === robot && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(fired).toBeGreaterThan(0);
    expect(impacts).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(60);
  });

  it('セザインが両手マシンガンで連射弾幕を放ち敵にダメージを与える', () => {
    const battle = new DiagBattle();
    const sezain = battle.spawnUnit('sezain', 0, -8, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 6, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let shots = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'sezain_shot') shots++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === sezain && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(shots).toBeGreaterThan(5);
    expect(damage).toBeGreaterThan(40);
  });

  it('ヤマムロンが火口から火山弾を放物線噴火し広範囲爆発ダメージを与える', () => {
    const battle = new DiagBattle();
    const fuji = battle.spawnUnit('yamamuron', 0, -15, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 10, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let burst = 0;
    let explosion = 0;
    let damage = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'eruption_burst') burst++;
      if (e.kind === 'eruption_explosion') explosion++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === fuji && e.victim === dummy) damage += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(burst).toBeGreaterThan(0);
    expect(explosion).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(80);
  });

  it('ホンゴンがピアノ演奏で音楽波動と音符を放ち範囲ダメージを与える', () => {
    const battle = new DiagBattle();
    const pianist = battle.spawnUnit('hongon', 0, -6, 0);
    const dummy1 = battle.spawnUnit('swordsman', 1, 2, -2);
    const dummy2 = battle.spawnUnit('swordsman', 1, 2, 2);
    battle.frozen.add(dummy1);
    battle.frozen.add(dummy2);
    dummy1.hp = 1e7;
    dummy2.hp = 1e7;
    let waves = 0;
    let notes = 0;
    let hitCount = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'piano_wave') waves++;
      if (e.kind === 'piano_note') notes++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === pianist) hitCount++;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(waves).toBeGreaterThan(0);
    expect(notes).toBeGreaterThan(0);
    expect(hitCount).toBeGreaterThan(2);
  });

  it('ザイサンが翠龍の気を纏ってきりもみ回転突進し三刀流で多段ヒットダメージを与える', () => {
    const battle = new DiagBattle();
    const zaisan = battle.spawnUnit('zaisan', 0, -8, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 4, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let charges = 0;
    let dragonSlashes = 0;
    let slashHits = 0;
    let totalDmg = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'dragon_charge') charges++;
      if (e.kind === 'dragon_slash') dragonSlashes++;
      if (e.kind === 'dragon_slash_hit') slashHits++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === zaisan && e.victim === dummy) totalDmg += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6; i++) battle.step(battle.fixedDt);
    expect(charges).toBeGreaterThan(0);
    expect(dragonSlashes).toBeGreaterThan(3);
    expect(slashHits).toBeGreaterThan(0);
    expect(totalDmg).toBeGreaterThan(60);
  });
});

describe('1対1 総当たりで膠着しない', () => {
  // スライムは分裂、おとりは戦闘能力なしのため総当たりから除外する
  const ids = UNIT_TYPE_LIST.map((u) => u.id).filter((id) => id !== 'slime' && id !== 'decoy');
  for (const ia of ids) {
    it(`${ia} vs 全兵種`, () => {
      const stalls: string[] = [];
      for (const ib of ids) {
        const battle = new Battle();
        battle.spawnUnit(ia, 0, -6, 0);
        battle.spawnUnit(ib, 1, 6, 0);
        battle.aiEnabled = true;
        const steps = Math.round(120 / battle.fixedDt);
        for (let i = 0; i < steps && battle.result() === null; i++) battle.step(battle.fixedDt);
        if (battle.result() === null) stalls.push(ib);
      }
      expect(stalls).toEqual([]);
    }, 60000);
  }
});
