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
  return Math.max(t.range * t.scale + 4, 8);
}

describe('全兵種: 静止した的に攻撃が当たる（届かない攻撃を繰り返さない）', () => {
  for (const ut of UNIT_TYPE_LIST) {
    for (const dummy of ['swordsman', 'giant'] as UnitTypeId[]) {
      it(`${ut.name} (${ut.id}) → ${UNIT_TYPES[dummy].name}`, () => {
        const r = attackDummy(ut.id, dummy, approachDist(ut.id), 18);
        expect(r.strikes).toBeGreaterThan(0);
        expect(r.damage).toBeGreaterThan(0);
      });
    }
  }
});

describe('兵種固有の不具合の回帰テスト', () => {
  it('紅蓮ドラゴンの火炎ブレスが人型サイズの敵に直撃し、地面に延焼ゾーンを作る', () => {
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

  it('紅蓮ドラゴンは足元に潜り込んだ敵も焼ける', () => {
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
});

describe('1対1 総当たりで膠着しない', () => {
  // スライムは分裂で個体数が増えるため、決着時間が極端に伸びうるので総当たりから除外する
  const ids = UNIT_TYPE_LIST.map((u) => u.id).filter((id) => id !== 'slime');
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
