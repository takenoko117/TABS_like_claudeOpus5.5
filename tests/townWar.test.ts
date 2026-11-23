import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { OpenWorldSim, emptyInput, type OWInput } from '../src/openworld/OpenWorldSim';
import { OW_TOWN_FACTIONS, OW_TOWN_MAX_RANGE, OW_TOWN_POP, OW_TOWN_RESPAWN, OW_TOWN_CORPSE_TIME } from '../src/openworld/OpenWorldConfig';
import { TOWN_ROSTER, factionBase, factionHome, townCombatStats, type TownUnit } from '../src/openworld/TownWar';
import { SIDEWALK_LINES, ROAD_ORIGINS } from '../src/openworld/WorldGen';
import { UNIT_TYPES, type Team } from '../src/units/UnitTypes';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Unit } from '../src/units/Unit';

function run(sim: OpenWorldSim, seconds: number, input: Partial<OWInput> = {}): void {
  const n = Math.round(seconds * 60);
  for (let k = 0; k < n; k++) {
    sim.step(1 / 60, { ...emptyInput(), ...input, firePressed: k === 0 && !!input.firePressed });
    if (k > 0) sim.events.length = 0;
  }
}

/** 町の兵を置かない世界（テストで兵を手で置く） */
function emptyTown(seed = 1): OpenWorldSim {
  const sim = new OpenWorldSim(seed, { town: false });
  sim.peds.length = 0;
  // 車も片付けて、兵の動きだけを見る
  sim.vehicles.length = 0;
  for (let i = 0; i < OW_TOWN_FACTIONS; i++) for (let j = 0; j < OW_TOWN_FACTIONS; j++) sim.town.tension[i][j] = 0;
  return sim;
}

/** 町の中の道（交差点の真ん中） */
const street = (road: number) => ROAD_ORIGINS[road] + 4.5;

describe('町の兵: 暮らし', () => {
  it('4 つの陣営がそれぞれの街区に住んでいる', () => {
    const sim = new OpenWorldSim(1);
    expect(sim.town.units.length).toBe(OW_TOWN_FACTIONS * OW_TOWN_POP);
    for (const u of sim.town.units) {
      const h = factionHome(u.team);
      expect(u.pos.x).toBeGreaterThanOrEqual(SIDEWALK_LINES[h.a0] - 1);
      expect(u.pos.x).toBeLessThanOrEqual(SIDEWALK_LINES[h.a1] + 1);
      expect(u.pos.z).toBeGreaterThanOrEqual(SIDEWALK_LINES[h.b0] - 1);
      expect(u.pos.z).toBeLessThanOrEqual(SIDEWALK_LINES[h.b1] + 1);
    }
  });

  it('平和なら、歩き回ったり立ち話をしたりして暮らす（地面にとどまる）', () => {
    const sim = emptyTown();
    const us: TownUnit[] = [];
    for (let k = 0; k < 6; k++) us.push(sim.town.spawn(0, 'swordsman', true));
    const start = us.map((u) => ({ ...u.pos }));
    run(sim, 25);
    const moved = us.filter((u, i) => Math.hypot(u.pos.x - start[i].x, u.pos.z - start[i].z) > 2).length;
    expect(moved).toBeGreaterThan(2);
    for (const u of us) {
      expect(u.state).toBe('life');
      expect(u.hp).toBe(u.maxHp);
      // 道の上（地面の高さ）にいる
      expect(u.pos.y).toBeGreaterThan(10);
      expect(u.pos.y).toBeLessThan(13);
    }
  });

  it('町に出てくる兵種はすべて本編の兵種で、遠距離の届く距離は町の上限まで', () => {
    expect(TOWN_ROSTER.length).toBeGreaterThan(40);
    expect(TOWN_ROSTER.some((r) => r.id === 'decoy')).toBe(false);
    for (const r of TOWN_ROSTER) {
      const st = townCombatStats(UNIT_TYPES[r.id]);
      expect(st.damage).toBeGreaterThan(0);
      expect(st.range).toBeLessThanOrEqual(OW_TOWN_MAX_RANGE);
    }
    expect(townCombatStats(UNIT_TYPES.clubber).ranged).toBe(false);
    expect(townCombatStats(UNIT_TYPES.archer).ranged).toBe(true);
    expect(townCombatStats(UNIT_TYPES.bomber).blast).toBeGreaterThan(0);
  });

  it('本編のラグドールは町の兵種すべてで作れて、歩かせても崩れない', () => {
    for (const r of TOWN_ROSTER) {
      const world = new PhysicsWorld();
      const unit = new Unit(world, UNIT_TYPES[r.id], 0, new Vector3(0, 0, 0), 0);
      for (let k = 0; k < 20; k++) {
        unit.previewStep(1 / 60, 1.5);
        world.step(1 / 60);
      }
      expect(Number.isFinite(unit.pelvis.pos.y)).toBe(true);
    }
  });
});

describe('町の兵: 小競り合いと戦争', () => {
  it('仲の悪い陣営の兵が出会うと、自然に戦いが始まり、決着がつく', () => {
    const sim = emptyTown();
    sim.town.tension[0][1] = sim.town.tension[1][0] = 0.95;
    const x = street(2);
    const z = street(2);
    const red = sim.town.spawn(0, 'swordsman', false, { x: x - 3, z });
    const blue = sim.town.spawn(1, 'swordsman', false, { x: x + 3, z });
    const news: string[] = [];
    let fought = false;
    for (let k = 0; k < 60 * 40; k++) {
      sim.step(1 / 60, emptyInput());
      for (const e of sim.events) if (e.kind === 'town_news') news.push(e.text);
      sim.events.length = 0;
      if (red.state === 'fight' || blue.state === 'fight') fought = true;
      if (red.state === 'dead' || blue.state === 'dead') break;
    }
    expect(fought).toBe(true);
    expect(red.state === 'dead' || blue.state === 'dead').toBe(true);
    expect(news.some((t) => t.includes('小競り合い'))).toBe(true);
  });

  it('近くの仲間は加勢する', () => {
    const sim = emptyTown();
    const x = street(2);
    const z = street(2);
    const red = sim.town.spawn(0, 'clubber', false, { x: x - 2, z });
    const friend = sim.town.spawn(0, 'spearman', false, { x: x - 6, z });
    const blue = sim.town.spawn(1, 'giant', false, { x: x + 2, z });
    sim.town.damage(red, 5, { x: -1, y: 0, z: 0 }, { team: 1, unit: blue });
    expect(red.state).toBe('fight');
    expect(friend.state).toBe('fight');
    expect(friend.target).toBe(blue);
  });

  it('緊張が高まりきると戦争になり、攻め手は相手の拠点へ向かう', () => {
    const sim = emptyTown();
    for (let k = 0; k < 6; k++) sim.town.spawn(0, 'clubber', true);
    for (let k = 0; k < 3; k++) sim.town.spawn(3, 'clubber', true);
    sim.town.tension[0][3] = sim.town.tension[3][0] = 0.999;
    run(sim, 0.5);
    expect(sim.town.wars.length).toBe(1);
    const war = sim.town.wars[0];
    expect(war.attacker).toBe(0);
    expect(war.defender).toBe(3);
    const base = factionBase(3);
    const marchers = sim.town.units.filter((u) => u.team === 0 && u.state === 'march');
    expect(marchers.length).toBeGreaterThan(0);
    const d0 = marchers.map((u) => Math.hypot(u.pos.x - base.x, u.pos.z - base.z));
    run(sim, 8);
    const d1 = marchers.map((u) => Math.hypot(u.pos.x - base.x, u.pos.z - base.z));
    const closer = d1.filter((d, i) => d < d0[i] - 3).length;
    expect(closer).toBeGreaterThan(marchers.length / 2);
  });

  it('戦争は、攻め手が全滅するか時間切れで終わり、緊張が下がる', () => {
    const sim = emptyTown();
    const a = sim.town.spawn(1, 'clubber', true);
    sim.town.spawn(2, 'clubber', true);
    sim.town.declareWar(1, 2);
    expect(sim.town.wars.length).toBe(1);
    sim.town.damage(a, 9999, { x: 0, y: 0, z: 0 }, 'blast');
    run(sim, 0.2);
    expect(sim.town.wars.length).toBe(0);
    expect(sim.town.tension[1][2]).toBeLessThan(0.5);
  });
});

describe('町の兵: プレイヤーとの関わり・破壊・補充', () => {
  it('プレイヤーが兵を撃つと、その陣営がプレイヤーを狙う', () => {
    const sim = emptyTown();
    sim.player.pos = { x: street(2) - 6, y: 11, z: street(2) };
    run(sim, 0.3);
    const u = sim.town.spawn(2, 'swordsman', false, { x: street(2) + 2, z: street(2) });
    const friend = sim.town.spawn(2, 'archer', false, { x: street(2) + 6, z: street(2) + 1 });
    const p = sim.player.pos;
    run(sim, 0.05, { aimOrigin: { x: p.x, y: p.y + 1.6, z: p.z }, aimDir: { x: 1, y: -0.08, z: 0 }, tool: 1, fire: true, firePressed: true, yaw: Math.PI / 2 });
    expect(u.hp).toBeLessThan(u.maxHp);
    expect(sim.town.grudge[2]).toBeGreaterThan(0);
    expect(u.target).toBe('player');
    expect(friend.target).toBe('player');
  });

  it('倒れた兵はしばらくして砕け散り、拠点で補充される', () => {
    const sim = emptyTown();
    const u = sim.town.spawn(1, 'giant', true);
    sim.town.damage(u, 99999, { x: 1, y: 0, z: 0 }, 'blast');
    expect(u.state).toBe('dead');
    const debris = sim.destruction.debris.length;
    run(sim, OW_TOWN_CORPSE_TIME + 0.2);
    expect(sim.town.units.includes(u)).toBe(false);
    expect(sim.destruction.debris.length).toBeGreaterThan(debris);
    run(sim, OW_TOWN_RESPAWN + 7);
    const back = sim.town.units.filter((x) => x.team === 1);
    expect(back.length).toBe(1);
    const base = factionBase(1);
    expect(Math.hypot(back[0].pos.x - base.x, back[0].pos.z - base.z)).toBeLessThan(25);
  });

  it('爆発する攻撃の兵どうしの戦いは町を壊す', () => {
    const sim = emptyTown();
    const x = street(2);
    const z = street(2);
    const rocket = sim.town.spawn(0, 'rocket_soldier', false, { x: x - 10, z });
    const enemy = sim.town.spawn(1, 'giant', false, { x: x + 10, z });
    sim.town.damage(rocket, 1, { x: 0, y: 0, z: 0 }, { team: 1, unit: enemy });
    const before = sim.destruction.stats.explosions;
    run(sim, 6);
    expect(sim.destruction.stats.explosions).toBeGreaterThan(before);
    expect(sim.destruction.stats.blocks).toBeGreaterThan(0);
  });

  it('全員そろった町を長く動かしても壊れず、どこかで戦いが起きる', () => {
    const sim = new OpenWorldSim(4);
    let fights = 0;
    for (let k = 0; k < 60 * 90; k++) {
      sim.step(1 / 60, emptyInput());
      sim.events.length = 0;
      if (k % 60 === 0) fights += sim.town.units.filter((u) => u.state === 'fight').length;
    }
    expect(fights).toBeGreaterThan(0);
    for (const u of sim.town.units) {
      expect(Number.isFinite(u.pos.x) && Number.isFinite(u.pos.y)).toBe(true);
      expect(u.pos.y).toBeGreaterThan(0);
    }
    for (let t = 0; t < OW_TOWN_FACTIONS; t++) expect(sim.town.factionSummary(t as Team).alive).toBeGreaterThan(0);
  });
});
