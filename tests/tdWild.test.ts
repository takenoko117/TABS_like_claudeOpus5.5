import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { ROGUE_STARTERS, type RogueStarter } from '../src/game/RogueliteMode';
import { TDDuel, TDLockstep } from '../src/game/TDDuel';
import { withSimRandom } from '../src/game/SimRandom';
import {
  TD_WILD_CAMPS,
  TD_WILD_KINDS,
  TD_WILD_NOTICE,
  TD_WILD_TEAM,
  getWildHpMul,
} from '../src/game/TDWildCamps';
import { TD_CASTLE_X, TD_CORRIDOR_END } from '../src/game/TDTerrain';
import { UNIT_TYPE_LIST, UNIT_TYPES } from '../src/units/UnitTypes';
import type { TDVersusClientMessage } from '../src/net/tdVersusProtocol';
import type { Unit } from '../src/units/Unit';

const STARTERS: [RogueStarter, RogueStarter] = [ROGUE_STARTERS[0], ROGUE_STARTERS[1]];

function makeDuel(seed: number) {
  const battle = new Battle();
  battle.configureStage();
  const duel = new TDDuel(seed, STARTERS);
  duel.setup(battle);
  battle.beginCombat();
  return { battle, duel };
}

/** 物理を進めずに、時間と魔物の巣だけを seconds 秒進める */
function advanceCamps(battle: Battle, duel: TDDuel, seconds: number, dt = 0.25): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    for (const s of duel.sides) s.step(battle, dt);
    duel.stepWild(battle, dt);
  }
}

function wildUnits(battle: Battle): Unit[] {
  return battle.units.filter((u) => u.alive && u.team === TD_WILD_TEAM);
}

function kill(duel: TDDuel, victim: Unit, attacker?: Unit): void {
  withSimRandom(duel.simRng, () => victim.takeDamage(1e9, victim.chest, new Vector3(0, 3, 0), 1 / 120, attacker));
}

function simulate(battle: Battle, seconds: number, dt = 1 / 60): void {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) battle.step(dt);
}

describe('オンライン対戦の第三勢力: 兵種', () => {
  it('魔物3種は新しい兵種で、カードや敵編成の一覧には入らない', () => {
    for (const k of Object.values(TD_WILD_KINDS)) {
      expect(UNIT_TYPES[k.unit]).toBeDefined();
      expect(UNIT_TYPE_LIST.some((u) => u.id === k.unit)).toBe(false);
    }
  });

  it('小型は速くてもろく、大型は硬くて遅く、ヌシが一番大きい', () => {
    const imp = UNIT_TYPES.wild_imp;
    const troll = UNIT_TYPES.wild_troll;
    const chief = UNIT_TYPES.wild_chief;
    expect(imp.speed).toBeGreaterThan(troll.speed);
    expect(imp.hp).toBeLessThan(troll.hp);
    expect(troll.hp).toBeLessThan(chief.hp);
    expect(chief.scale).toBeGreaterThan(troll.scale);
    expect(TD_WILD_KINDS.imp.xp).toBeLessThan(TD_WILD_KINDS.troll.xp);
    expect(TD_WILD_KINDS.troll.xp).toBeLessThan(TD_WILD_KINDS.chief.xp);
    expect(TD_WILD_KINDS.chief.chest).not.toBeNull();
  });
});

describe('オンライン対戦の第三勢力: 巣', () => {
  it('巣は両陣営から同じ距離（x = 0 をはさんで左右対称）で、砲台の射程と通路の外にある', () => {
    for (const c of TD_WILD_CAMPS) {
      if (c.x !== 0) expect(TD_WILD_CAMPS.some((o) => o.kind === c.kind && o.x === -c.x && o.z === c.z)).toBe(true);
      expect(Math.abs(c.x)).toBeLessThan(TD_CASTLE_X - TD_CORRIDOR_END);
      expect(TD_CASTLE_X - Math.abs(c.x) - c.radius).toBeGreaterThan(15.5);
    }
    expect(TD_WILD_CAMPS.filter((c) => c.kind === 'chief').length).toBe(1);
  });

  it('小型は最初から湧いて上限まで増え、大型は 1 分、ヌシは 2 分 30 秒から湧く', () => {
    const { battle, duel } = makeDuel(11);
    advanceCamps(battle, duel, 1);
    expect(duel.wild.aliveCount('imp')).toBe(6);
    expect(duel.wild.aliveCount('troll')).toBe(0);
    advanceCamps(battle, duel, 59);
    expect(duel.wild.aliveCount('imp')).toBe(14);
    expect(duel.wild.aliveCount('troll')).toBe(2);
    expect(duel.wild.aliveCount('chief')).toBe(0);
    advanceCamps(battle, duel, 91);
    expect(duel.wild.aliveCount('troll')).toBe(4);
    expect(duel.wild.aliveCount('chief')).toBe(1);
    expect(duel.sides[0].events.some((e) => e.kind === 'wild_boss')).toBe(true);
    expect(duel.sides[1].events.some((e) => e.kind === 'wild_boss')).toBe(true);
    for (const u of wildUnits(battle)) {
      expect(u.leash).not.toBeNull();
      expect(u.team).toBe(TD_WILD_TEAM);
    }
  });

  it('同じ種なら両端末で同じ魔物が同じ場所に湧く', () => {
    const a = makeDuel(77);
    const b = makeDuel(77);
    advanceCamps(a.battle, a.duel, 160);
    advanceCamps(b.battle, b.duel, 160);
    const key = (battle: Battle) => wildUnits(battle).map((u) => `${u.type.id}:${u.pelvis.pos.x.toFixed(4)}:${u.pelvis.pos.z.toFixed(4)}:${u.maxHp}`);
    expect(key(a.battle)).toEqual(key(b.battle));
    expect(a.duel.wild.spawned).toBe(b.duel.wild.spawned);
  });

  it('時間がたつほど湧く魔物の HP が増える', () => {
    expect(getWildHpMul(600)).toBeGreaterThan(getWildHpMul(0));
    const { battle, duel } = makeDuel(5);
    advanceCamps(battle, duel, 70);
    const troll = wildUnits(battle).find((u) => u.type.id === 'wild_troll')!;
    expect(troll.maxHp).toBeCloseTo(UNIT_TYPES.wild_troll.hp * getWildHpMul(60), 3);
  });

  it('縄張りに兵がいなければ、傷ついた魔物は回復する', () => {
    const { battle, duel } = makeDuel(6);
    advanceCamps(battle, duel, 1);
    const imp = wildUnits(battle)[0];
    imp.hp = imp.maxHp * 0.5;
    advanceCamps(battle, duel, 4);
    expect(imp.hp).toBeGreaterThan(imp.maxHp * 0.6);
  });
});

describe('オンライン対戦の第三勢力: 報酬', () => {
  it('魔物を倒した陣営に経験値とお金が入る（相手には入らない）', () => {
    const { battle, duel } = makeDuel(21);
    advanceCamps(battle, duel, 1);
    const [host, guest] = duel.sides;
    const imp = wildUnits(battle)[0];
    const hunter = battle.spawnUnit('swordsman', 1, imp.pelvis.pos.x + 1, imp.pelvis.pos.z);
    const money = guest.money;
    const xp = guest.totalXp;
    kill(duel, imp, hunter);
    expect(guest.wildKills).toBe(1);
    expect(guest.totalXp - xp).toBeCloseTo(TD_WILD_KINDS.imp.xp);
    expect(guest.money - money).toBe(TD_WILD_KINDS.imp.money);
    expect(guest.kills).toBe(0);
    expect(host.wildKills).toBe(0);
    expect(host.totalXp).toBe(0);
  });

  it('攻撃した兵のいない倒れ方（燃焼など）は、最後に傷を負わせた陣営の手柄になる', () => {
    const { battle, duel } = makeDuel(22);
    advanceCamps(battle, duel, 1);
    const imp = wildUnits(battle)[0];
    const hunter = battle.spawnUnit('archer', 0, imp.pelvis.pos.x + 5, imp.pelvis.pos.z);
    withSimRandom(duel.simRng, () => imp.takeDamage(1, imp.chest, new Vector3(), 1 / 120, hunter));
    kill(duel, imp);
    expect(duel.sides[0].wildKills).toBe(1);
  });

  it('ヌシを倒すと、倒した陣営に宝箱が積まれ、両陣営に知らせが出る', () => {
    const { battle, duel } = makeDuel(23);
    advanceCamps(battle, duel, 151);
    const chief = wildUnits(battle).find((u) => u.type.id === 'wild_chief')!;
    expect(chief.isBoss).toBe(true);
    const hunter = battle.spawnUnit('giant', 0, chief.pelvis.pos.x + 2, chief.pelvis.pos.z);
    for (const s of duel.sides) s.events.length = 0;
    kill(duel, chief, hunter);
    expect(duel.sides[0].pendingChests.length).toBe(1);
    expect(duel.sides[0].pendingChests[0].tier).toBe(TD_WILD_KINDS.chief.chest);
    expect(duel.sides[1].pendingChests.length).toBe(0);
    expect(duel.sides[0].events).toContainEqual({ kind: 'wild_boss_down', value: 0 });
    expect(duel.sides[1].events).toContainEqual({ kind: 'wild_boss_down', value: 0 });
    // 倒されてから interval 秒たつと、次のヌシが湧く
    const chiefDef = TD_WILD_CAMPS.find((c) => c.kind === 'chief')!;
    advanceCamps(battle, duel, chiefDef.interval - 5);
    expect(duel.wild.aliveCount('chief')).toBe(0);
    advanceCamps(battle, duel, 6);
    expect(duel.wild.aliveCount('chief')).toBe(1);
  });

  it('戦況のハッシュに魔物の狩りの数が入る', () => {
    const { battle, duel } = makeDuel(24);
    advanceCamps(battle, duel, 1);
    const imp = wildUnits(battle)[0];
    const hunter = battle.spawnUnit('swordsman', 0, imp.pelvis.pos.x + 1, imp.pelvis.pos.z);
    const before = duel.hash(battle);
    kill(duel, imp, hunter);
    expect(duel.hash(battle)).not.toBe(before);
  });
});

describe('オンライン対戦の第三勢力: 縄張りの動き', () => {
  function leashed(battle: Battle, x: number, z: number, radius = 8): Unit {
    const u = battle.spawnUnit('wild_imp', TD_WILD_TEAM, x, z, 0);
    u.leash = { x, z, radius, notice: TD_WILD_NOTICE };
    return u;
  }

  it('縄張りの外の敵は襲わず、巣のそばにとどまる', () => {
    const battle = new Battle();
    battle.aiEnabled = true;
    const imp = leashed(battle, 0, 0);
    battle.spawnUnit('swordsman', 0, 15, 0);
    simulate(battle, 3);
    expect(Math.hypot(imp.pelvis.pos.x, imp.pelvis.pos.z)).toBeLessThan(2.5);
  });

  it('縄張りに入った敵は追いかけ、縄張りから出たら巣へ帰る', () => {
    const battle = new Battle();
    battle.aiEnabled = true;
    const imp = leashed(battle, 0, 0, 6);
    const intruder = battle.spawnUnit('swordsman', 0, 4, 0);
    simulate(battle, 0.8);
    expect(imp.pelvis.pos.x).toBeGreaterThan(1);
    // 侵入者を縄張りの外へ移すと、魔物は巣へ戻る
    battle.removeUnit(intruder);
    battle.spawnUnit('swordsman', 0, 30, 0);
    simulate(battle, 4);
    expect(Math.hypot(imp.pelvis.pos.x, imp.pelvis.pos.z)).toBeLessThan(2.5);
  });

  it('ほかの兵は、遠くの魔物には寄り道しない（notice より近い魔物だけ狙う）', () => {
    const battle = new Battle();
    battle.aiEnabled = true;
    leashed(battle, 0, 0);
    const far = battle.spawnUnit('swordsman', 0, -(TD_WILD_NOTICE + 6), 0);
    const x0 = far.pelvis.pos.x;
    simulate(battle, 2);
    expect(Math.abs(far.pelvis.pos.x - x0)).toBeLessThan(0.6);
    const near = battle.spawnUnit('swordsman', 0, 0, -(TD_WILD_NOTICE - 4));
    const z0 = near.pelvis.pos.z;
    simulate(battle, 1.5);
    expect(near.pelvis.pos.z - z0).toBeGreaterThan(1);
  });

  it('砲台は魔物を撃たない', () => {
    const battle = new Battle();
    battle.aiEnabled = true;
    battle.spawnFacility('cannon_tower', 0, -5, 0);
    const imp = leashed(battle, 2, 0, 3);
    let fired = false;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'cannon_fire') fired = true;
    };
    simulate(battle, 3);
    expect(fired).toBe(false);
    expect(imp.alive).toBe(true);
  });
});

describe('オンライン対戦の第三勢力: ロックステップ', () => {
  it('魔物がいても、2 端末の戦況のハッシュは一致する', () => {
    const make = (slot: 0 | 1) => {
      const { battle, duel } = makeDuel(4321);
      const outbox: TDVersusClientMessage[] = [];
      const ls = new TDLockstep(duel, slot, (m) => outbox.push(m));
      return { battle, duel, ls, outbox };
    };
    const a = make(0);
    const b = make(1);
    const deliver = (from: typeof a, to: typeof a) => {
      for (const m of from.outbox.splice(0)) {
        if (m.t === 'input') to.ls.receiveInput(m.turn, m.cmds);
        else if (m.t === 'hash') to.ls.receiveHash(m.turn, m.h);
      }
    };
    // 6 秒ぶん（ハッシュの照合は 2 秒ごと）
    for (let i = 0; i < 360; i++) {
      a.ls.advance(a.battle, 1 / 60);
      b.ls.advance(b.battle, 1 / 60);
      deliver(a, b);
      deliver(b, a);
    }
    expect(wildUnits(a.battle).length).toBeGreaterThan(0);
    expect(a.ls.turn).toBeGreaterThan(40);
    expect(a.ls.desyncTurn).toBeNull();
    expect(b.ls.desyncTurn).toBeNull();
    expect(a.duel.hash(a.battle)).toBe(b.duel.hash(b.battle));
  });
});
