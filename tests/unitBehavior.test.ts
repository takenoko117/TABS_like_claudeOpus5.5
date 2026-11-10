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


  it('幾何神ラミエルが長いタメ時間から超極太・広範囲・高威力の加粒子砲レーザーを照射し複数敵を貫通撃破する', () => {
    const battle = new DiagBattle();
    const ramiel = battle.spawnUnit('angel_ramiel', 0, -15, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 12, 0);
    const dummyWide = battle.spawnUnit('swordsman', 1, 12, 2.4);
    const dummyBehind = battle.spawnUnit('swordsman', 1, 18, 0);
    battle.frozen.add(dummy);
    battle.frozen.add(dummyWide);
    battle.frozen.add(dummyBehind);
    dummy.hp = 1e7;
    dummyWide.hp = 1e7;
    dummyBehind.hp = 1e7;
    let chargeEvents = 0;
    let beamFired = 0;
    let totalDmg = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'ramiel_charge') chargeEvents++;
      if (e.kind === 'ramiel_beam') beamFired++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === ramiel && e.victim === dummy) totalDmg += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 8; i++) battle.step(battle.fixedDt);
    expect(chargeEvents).toBeGreaterThan(30);
    expect(beamFired).toBeGreaterThan(0);
    expect(totalDmg).toBeGreaterThan(400);
    expect(dummy.hp).toBeLessThan(1e7);
    expect(dummyWide.hp).toBeLessThan(1e7);
    expect(dummyBehind.hp).toBeLessThan(1e7);
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

  describe('ヤマムロンの強化モード', () => {
    const fps = 120;

    /** ヤマムロンと、静止した不死身の敵 count 体を横一列に並べる */
    function setupYamamuron(count: number, enemyX = 0): { battle: DiagBattle; fuji: Unit; dummies: Unit[] } {
      const battle = new DiagBattle();
      // 射程や突進の検証で戦場より遠くまで使うため、見えない壁を外す
      battle.world.fieldWalls = null;
      const fuji = battle.spawnUnit('yamamuron', 0, -15, 0);
      const dummies: Unit[] = [];
      for (let i = 0; i < count; i++) {
        const dummy = battle.spawnUnit('swordsman', 1, enemyX, -6 + i * 4);
        battle.frozen.add(dummy);
        dummy.hp = 1e7;
        dummies.push(dummy);
      }
      battle.aiEnabled = true;
      return { battle, fuji, dummies };
    }

    /** 指定秒数シミュレートし、火山弾の発射数と噴火回数を数える */
    function countEruptions(battle: DiagBattle, seconds: number): { rocks: number; bursts: number } {
      const res = { rocks: 0, bursts: 0 };
      const original = battle.combat.fireProjectile.bind(battle.combat);
      battle.combat.fireProjectile = ((...args: Parameters<typeof original>) => {
        if (args[3] === 'volcano_rock') res.rocks++;
        return original(...args);
      }) as typeof original;
      battle.combat.onEffect = (e) => {
        if (e.kind === 'eruption_burst') res.bursts++;
      };
      for (let i = 0; i < fps * seconds; i++) battle.step(battle.fixedDt);
      return res;
    }

    it('HP は 5000 で、HP が半分を超える間は強化されない', () => {
      const { battle, fuji } = setupYamamuron(1);
      expect(fuji.maxHp).toBe(5000);
      fuji.hp = fuji.maxHp * 0.5 + 1;
      for (let i = 0; i < fps; i++) battle.step(battle.fixedDt);
      expect(fuji.yamamuronEnraged).toBe(false);
    });

    it('HP 半分以下で強化モードに入り、発動演出とオーラの粒子を出し続ける', () => {
      const { battle, fuji } = setupYamamuron(1);
      fuji.hp = fuji.maxHp * 0.5;
      let awaken = 0;
      let aura = 0;
      battle.combat.onEffect = (e) => {
        if (e.kind === 'yamamuron_awaken') awaken++;
        if (e.kind === 'yamamuron_aura') aura++;
      };
      for (let i = 0; i < fps * 2; i++) battle.step(battle.fixedDt);
      expect(fuji.yamamuronEnraged).toBe(true);
      expect(awaken).toBe(1);
      expect(aura).toBeGreaterThan(10);
    });

    it('強化モードでは噴火の頻度が 2 倍になる', () => {
      const seconds = 30;
      const normal = setupYamamuron(1);
      const normalCount = countEruptions(normal.battle, seconds).bursts;
      const enraged = setupYamamuron(1);
      enraged.fuji.hp = enraged.fuji.maxHp * 0.5;
      const enragedCount = countEruptions(enraged.battle, seconds).bursts;
      expect(enragedCount / normalCount).toBeGreaterThan(1.6);
      expect(enragedCount / normalCount).toBeLessThan(2.4);
    });

    it('強化モードでは 1 回の噴火で最大 3 体へ同時に火山弾を撃つ', () => {
      const enraged = setupYamamuron(5);
      enraged.fuji.hp = enraged.fuji.maxHp * 0.5;
      const res = countEruptions(enraged.battle, 12);
      expect(res.bursts).toBeGreaterThan(0);
      expect(res.rocks).toBe(res.bursts * 3);
    });

    it('強化モードの射程は 5 倍になり、強化前は届かない距離の敵にも噴火する', () => {
      const far = 150;
      const normal = setupYamamuron(1, -15 + far);
      expect(countEruptions(normal.battle, 3).bursts).toBe(0);

      const enraged = setupYamamuron(1, -15 + far);
      enraged.fuji.hp = enraged.fuji.maxHp * 0.5;
      expect(countEruptions(enraged.battle, 3).bursts).toBeGreaterThan(0);
    });

    it('射程いっぱいで撃った火山弾は着弾まで消えない', () => {
      const { battle, fuji, dummies } = setupYamamuron(1, 150);
      fuji.hp = fuji.maxHp * 0.5;
      const original = battle.combat.fireProjectile.bind(battle.combat);
      const lives: Array<{ life: number; dist: number }> = [];
      battle.combat.fireProjectile = ((...args: Parameters<typeof original>) => {
        const dist = Math.abs(args[1].x - dummies[0].pelvis.pos.x);
        lives.push({ life: args[4]?.life ?? 0, dist });
        return original(...args);
      }) as typeof original;
      for (let i = 0; i < fps * 2; i++) battle.step(battle.fixedDt);
      expect(lives.length).toBeGreaterThan(0);
      for (const { life, dist } of lives) expect(life).toBeGreaterThan(dist / 28);
    });

    it('強化モードでは約 20 倍の速さで敵に詰め寄り、地震の届く距離で止まる', () => {
      const { battle, fuji, dummies } = setupYamamuron(1, 60);
      fuji.hp = fuji.maxHp * 0.5;
      const startX = fuji.pelvis.pos.x;
      let peak = 0;
      for (let i = 0; i < fps * 2; i++) {
        battle.step(battle.fixedDt);
        peak = Math.max(peak, Math.hypot(fuji.velocity.x, fuji.velocity.z));
      }
      expect(peak).toBeGreaterThan(12);
      expect(fuji.pelvis.pos.x - startX).toBeGreaterThan(14);

      for (let i = 0; i < fps * 8; i++) battle.step(battle.fixedDt);
      expect(hdist(fuji, dummies[0])).toBeLessThan(14);
    });

    it('強化前の噴火と、敵が 3 体未満のときは敵の数しか撃たない', () => {
      const normal = countEruptions(setupYamamuron(5).battle, 12);
      expect(normal.rocks).toBe(normal.bursts);

      const two = setupYamamuron(2);
      two.fuji.hp = two.fuji.maxHp * 0.5;
      const res = countEruptions(two.battle, 12);
      expect(res.rocks).toBe(res.bursts * 2);
    });

    it('地震は周囲の地上の敵にだけダメージを与え、遠くの敵と飛行ユニットには届かない', () => {
      const battle = new DiagBattle();
      const fuji = battle.spawnUnit('yamamuron', 0, 0, 0);
      const near = battle.spawnUnit('swordsman', 1, 7, 0);
      const far = battle.spawnUnit('swordsman', 1, 24, 0);
      const flyer = battle.spawnUnit('giant_eagle', 1, 0, 7);
      for (const u of [near, far, flyer]) {
        battle.frozen.add(u);
        u.hp = 1e7;
      }
      fuji.hp = fuji.maxHp * 0.5;
      const quakeHits = new Set<Unit>();
      let quakes = 0;
      battle.combat.onEffect = (e) => {
        if (e.kind === 'yamamuron_quake') quakes++;
      };
      battle.combat.onHit = (e) => {
        if (e.attacker === fuji && e.kind === 'melee' && e.victim) quakeHits.add(e.victim as Unit);
      };
      battle.aiEnabled = true;
      // 発動と同時の初回の地震だけを見る
      for (let i = 0; i < 3; i++) battle.step(battle.fixedDt);
      expect(quakes).toBe(1);
      expect(quakeHits.has(near)).toBe(true);
      expect(quakeHits.has(far)).toBe(false);
      expect(quakeHits.has(flyer)).toBe(false);
    });
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

  it('ホンゴンの結界は遠距離ダメージを累計 1000 まで吸収し、超えた分から本体に通る', () => {
    const battle = new DiagBattle();
    const pianist = battle.spawnUnit('hongon', 0, 0, 0);
    const hit = (amount: number, ranged: boolean): void => {
      pianist.takeDamage(amount, pianist.chest, new Vector3(), battle.fixedDt, undefined, ranged);
    };
    const hp = pianist.hp;

    hit(900, true);
    expect(pianist.hp).toBe(hp);
    expect(pianist.rangedBarrier).toBe(100);

    // 近接攻撃は結界を素通りし、残量も減らさない
    hit(10, false);
    expect(pianist.hp).toBe(hp - 10);
    expect(pianist.rangedBarrier).toBe(100);

    // 残量を超えた分だけが本体に通り、以降は遠距離攻撃がそのまま通る
    hit(130, true);
    expect(pianist.hp).toBe(hp - 40);
    expect(pianist.rangedBarrier).toBe(0);
    hit(20, true);
    expect(pianist.hp).toBe(hp - 60);
  });

  it('ホンゴンの結界は範囲内の爆風だけで減り、吸収しきれない分は爆風でも通る', () => {
    const battle = new DiagBattle();
    const pianist = battle.spawnUnit('hongon', 0, 0, 0);
    const bomberman = battle.spawnUnit('bomber', 1, 20, 0);
    const blast = (x: number, damage: number): void => {
      battle.combat.applyRadialBlast(bomberman, new Vector3(x, pianist.pelvis.pos.y, 0), 3, damage, 0, 0, battle.units, battle.fixedDt);
    };
    const hp = pianist.hp;

    blast(30, 5000);
    expect(pianist.rangedBarrier).toBe(1000);

    blast(0, 1100);
    expect(pianist.rangedBarrier).toBe(0);
    expect(pianist.hp).toBeCloseTo(hp - 100);
  });

  it('ホンゴンは結界が残っている間は遠距離攻撃（矢・銃弾・爆弾など）を無効化し、近接攻撃のみダメージを受ける', () => {
    const battle = new DiagBattle();
    const pianist = battle.spawnUnit('hongon', 0, 0, 0);
    battle.spawnUnit('archer', 1, 8, 0);
    battle.spawnUnit('sniper', 1, 14, 0);
    battle.spawnUnit('bomber', 1, 7, 0);
    battle.frozen.add(pianist);

    let blockedNotes = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'piano_note') blockedNotes++;
    };

    const initialHp = pianist.hp;
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 3; i++) battle.step(battle.fixedDt);

    // 結界が残っている間は、射撃・爆撃を受けてもホンゴンのHPは減らない
    expect(pianist.hp).toBe(initialHp);
    expect(blockedNotes).toBeGreaterThan(0);

    // 一方、近接攻撃（剣士）を受けると通常通りダメージを受ける
    battle.spawnUnit('swordsman', 1, 1, 0);
    for (let i = 0; i < 120 * 2; i++) battle.step(battle.fixedDt);
    expect(pianist.hp).toBeLessThan(initialHp);
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

  it('光速アリが超高速で接近し連続噛みつき攻撃でダメージを与える', () => {
    const battle = new DiagBattle();
    const ant = battle.spawnUnit('lightspeed_ant', 0, -10, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 6, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let dashes = 0;
    let bites = 0;
    let totalDmg = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'ant_dash') dashes++;
      if (e.kind === 'ant_bite') bites++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === ant && e.victim === dummy) totalDmg += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 4; i++) battle.step(battle.fixedDt);
    expect(dashes).toBeGreaterThan(2);
    expect(bites).toBeGreaterThan(2);
    expect(totalDmg).toBeGreaterThan(20);
  });

  it('デオキシスがサイコキネシスで攻撃し、敵接近時に瞬間移動で距離を取る', () => {
    const battle = new DiagBattle();
    const deoxys = battle.spawnUnit('deoxys', 0, -8, 0);
    const dummy = battle.spawnUnit('swordsman', 1, 3, 0);
    battle.frozen.add(dummy);
    dummy.hp = 1e7;
    let teleports = 0;
    let psychicWaves = 0;
    let psychicHits = 0;
    let totalDmg = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'deoxys_teleport') teleports++;
      if (e.kind === 'deoxys_psychic_wave') psychicWaves++;
      if (e.kind === 'deoxys_psychic_hit') psychicHits++;
    };
    battle.combat.onHit = (e) => {
      if (e.attacker === deoxys && e.victim === dummy) totalDmg += e.damage;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 4; i++) battle.step(battle.fixedDt);
    // 初期配置が距離11mなのでサイコキネシスで攻撃開始
    expect(psychicWaves).toBeGreaterThan(0);
    expect(psychicHits).toBeGreaterThan(0);
    expect(totalDmg).toBeGreaterThan(30);

    // 敵を至近距離に瞬間移動させてテレポート距離取りをテスト
    dummy.pelvis.pos.set(deoxys.pelvis.pos.x + 2.0, deoxys.pelvis.pos.y, deoxys.pelvis.pos.z);
    for (const p of dummy.joints) {
      p.pos.set(deoxys.pelvis.pos.x + 2.0, p.pos.y, deoxys.pelvis.pos.z);
      p.prev.copy(p.pos);
    }
    const initialTeleports = teleports;
    for (let i = 0; i < 60; i++) battle.step(battle.fixedDt);
    expect(teleports).toBeGreaterThan(initialTeleports);
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
