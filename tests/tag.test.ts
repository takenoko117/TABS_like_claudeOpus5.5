import { describe, expect, it } from 'vitest';
import { B } from '../src/openworld/OpenWorldConfig';
import { generateGifuTown, floorBelow } from '../src/tag/GifuTown';
import {
  TAG_GROUND,
  TAG_HAYATO_SPAWN_INTERVAL,
  TAG_HAYATO_START,
  TAG_LASER_CHARGE,
  TAG_MAX_HP,
  TAG_SPRINT_SPEED,
  TAG_PUNCH_STUN,
  TAG_ROCKET_PICKUPS,
  TAG_ROCKET_RESPAWN,
} from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, type Hayato } from '../src/tag/TagSim';
import { BREATH_AMOUNT, KabukunMotion, PUNI_MAX } from '../src/tag/KabukunMotion';
import { TOUCH_STICK_RADIUS, TOUCH_SPRINT_AT, stickVector } from '../src/tag/TagTouch';

const town = generateGifuTown(1);
const STEP = 1 / 60;

function run(sim: TagSim, seconds: number, input = emptyTagInput()): void {
  for (let t = 0; t < seconds; t += STEP) sim.step(STEP, input);
}

/** ハヤトを特定の場所に置く（ほかの動きを止めるため、狙いのためもリセット） */
function place(h: Hayato, x: number, y: number, z: number, yaw: number): void {
  h.pos.x = x;
  h.pos.y = y;
  h.pos.z = z;
  h.yaw = yaw;
  h.cooldown = 0;
  h.state = 'wander';
}

describe('岐阜の町', () => {
  it('同じ種なら同じ町になる（オンラインの全員が同じ町を作る）', () => {
    const again = generateGifuTown(1);
    // 170 万個の比較は toEqual だと遅いので、最初に違う位置だけを探す
    const a = again.world.data;
    const b = town.world.data;
    let firstDiff = a.length === b.length ? -1 : 0;
    for (let i = 0; i < a.length && firstDiff < 0; i++) if (a[i] !== b[i]) firstDiff = i;
    expect(firstDiff).toBe(-1);
  });

  it('長良川・金華山・信長像・駅がある', () => {
    const w = town.world;
    // 川の真ん中は水
    expect(w.get(60, TAG_GROUND - 2, 15)).toBe(B.WATER);
    // 橋の上は道
    expect(w.get(16, TAG_GROUND - 1, 15)).toBe(B.ASPHALT);
    // 金華山は町より高い
    expect(w.topSolidY(154, 70)).toBeGreaterThan(TAG_GROUND + 20);
    // 信長像は金
    let gold = 0;
    for (let y = TAG_GROUND; y < TAG_GROUND + 12; y++) for (let z = 155; z <= 161; z++) for (let x = 59; x <= 65; x++) if (w.get(x, y, z) === B.GOLD) gold++;
    expect(gold).toBeGreaterThan(10);
    expect(town.landmarks.map((l) => l.name)).toContain('JR岐阜駅');
  });

  it('出発地点とハヤトの目的地は、ふさがれていない地面の上', () => {
    for (const sp of town.playerSpawns) {
      expect(town.world.solidAt(Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z))).toBe(false);
      expect(town.world.solidAt(Math.floor(sp.x), Math.floor(sp.y) - 1, Math.floor(sp.z))).toBe(true);
    }
    expect(town.navPoints.length).toBeGreaterThan(200);
    for (const n of town.navPoints.slice(0, 200)) {
      const f = floorBelow(town.world, n.x, town.world.sizeY - 1, n.z);
      expect(town.world.solidAt(Math.floor(n.x), f, Math.floor(n.z))).toBe(false);
    }
  });
});

describe('鬼ごっこ: かぶくん', () => {
  it('走ると歩くより速く、息が切れると走れない', () => {
    const sim = new TagSim(1, [{ id: 0, name: 'A' }], 0, true, town);
    sim.hayatos.length = 0;
    const p = sim.local!;
    const input = { ...emptyTagInput(), moveZ: 1, yaw: 0, sprint: true };
    run(sim, 0.5, input);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(TAG_SPRINT_SPEED, 0);
    run(sim, 4, input);
    expect(p.exhausted).toBe(true);
  });

  it('ジャンプして地面に戻る', () => {
    const sim = new TagSim(1, [{ id: 0, name: 'A' }], 0, true, town);
    sim.hayatos.length = 0;
    const p = sim.local!;
    const y0 = p.pos.y;
    sim.step(STEP, { ...emptyTagInput(), jump: true });
    run(sim, 0.2);
    expect(p.pos.y).toBeGreaterThan(y0 + 0.5);
    run(sim, 1.5);
    expect(p.pos.y).toBeCloseTo(y0, 1);
  });
});

describe('鬼ごっこ: ハヤト', () => {
  it('最初のハヤトは 4 人で、みんなプレイヤーから離れた所に出る', () => {
    const sim = new TagSim(7, [{ id: 0, name: 'A' }], 0, true, town);
    expect(TAG_HAYATO_START).toBe(4);
    const p = sim.local!;
    for (const h of sim.hayatos) expect(Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z)).toBeGreaterThan(30);
  });

  it(`はじめは ${TAG_HAYATO_START} 人で、${TAG_HAYATO_SPAWN_INTERVAL} 秒ごとに増える`, () => {
    const sim = new TagSim(3, [{ id: 0, name: 'A' }], 0, true, town);
    expect(sim.hayatos.length).toBe(TAG_HAYATO_START);
    // 撃たれないよう無敵にしておく
    sim.local!.invuln = 1e9;
    run(sim, TAG_HAYATO_SPAWN_INTERVAL * 2 + 0.5);
    expect(sim.hayatos.length).toBe(TAG_HAYATO_START + 2);
  });

  it('見つけたらためてレーザーを撃ち、当たると HP が減る', () => {
    const sim = new TagSim(1, [{ id: 0, name: 'A' }], 0, true, town);
    sim.hayatos.splice(1);
    const p = sim.local!;
    const h = sim.hayatos[0];
    // 駅前広場で、かぶくんの北 10 m に南向きで置く
    place(h, p.pos.x, p.pos.y + 1.2, p.pos.z - 10, 0);
    expect(sim.canSee(h, p)).toBe(true);
    run(sim, TAG_LASER_CHARGE + 1);
    expect(sim.events.some((e) => e.kind === 'spot')).toBe(true);
    expect(sim.events.some((e) => e.kind === 'fire')).toBe(true);
    expect(p.hp).toBe(TAG_MAX_HP - 1);
  });

  it('後ろにいて遠ければ見えない・建物の陰も見えない', () => {
    const sim = new TagSim(1, [{ id: 0, name: 'A' }], 0, true, town);
    sim.hayatos.splice(1);
    const p = sim.local!;
    const h = sim.hayatos[0];
    // 北向き（かぶくんに背を向ける）
    place(h, p.pos.x, p.pos.y + 1.2, p.pos.z - 10, Math.PI);
    expect(sim.canSee(h, p)).toBe(false);
    // タワー43 の向こう側
    p.pos.x = 18;
    p.pos.z = 155;
    place(h, 32, TAG_GROUND + 2, 155, -Math.PI / 2);
    expect(sim.canSee(h, p)).toBe(false);
  });

  it(`${TAG_MAX_HP} 回当たるとアウトで、ソロは逃げ切った時間で終わる`, () => {
    const sim = new TagSim(1, [{ id: 0, name: 'A' }], 0, true, town);
    run(sim, 1);
    for (let k = 0; k < TAG_MAX_HP; k++) sim.applyHit(0, sim.local!.hp - 1, 0, { x: 1, y: 0, z: 0 });
    sim.step(STEP, null);
    expect(sim.local!.alive).toBe(false);
    expect(sim.phase).toBe('over');
    expect(sim.local!.survived).toBeGreaterThan(0.9);
  });
});

describe('鬼ごっこ: オンライン', () => {
  const roster = [
    { id: 0, name: 'ホスト' },
    { id: 1, name: 'ゲスト' },
    { id: 2, name: 'ゲスト2' },
  ];

  it('最後まで残った人が勝つ', () => {
    const sim = new TagSim(5, roster, 0, true, town);
    sim.applyHit(1, 0, 0, { x: 0, y: 0, z: 1 });
    sim.step(STEP, null);
    expect(sim.phase).toBe('playing');
    sim.removePlayer(2);
    expect(sim.phase).toBe('over');
    expect(sim.winner).toBe(0);
    expect(sim.ranking()[0].id).toBe(0);
  });

  it('ゲストはホストの様子を写して、ハヤト・レーザー・当たりを再現する', () => {
    const duo = roster.slice(0, 2);
    const host = new TagSim(9, duo, 0, true, town);
    const guest = new TagSim(9, duo, 1, false, town);
    expect(guest.hayatos.length).toBe(0);
    host.hayatos.splice(1);
    const target = host.player(1)!;
    // ゲストの位置をホストに届ける
    const gp = guest.local!;
    host.setRemotePlayer(1, gp.pos.x, gp.pos.y, gp.pos.z, gp.yaw);
    const h = host.hayatos[0];
    // ゲストの西 9 m に東向きで置く（ホストより近い）
    place(h, target.pos.x - 9, target.pos.y + 1.2, target.pos.z, Math.PI / 2);
    for (let t = 0; t < TAG_LASER_CHARGE + 1; t += STEP) {
      host.step(STEP, null);
      guest.step(STEP, null);
      // 1 秒に 10 回、様子を送る（JSON を通しても壊れない）
      if (Math.round(t / STEP) % 6 === 0) guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    }
    guest.applySnapshot(host.snapshot());
    expect(guest.hayatos.length).toBe(host.hayatos.length);
    expect(guest.events.some((e) => e.kind === 'fire')).toBe(true);
    expect(guest.local!.hp).toBe(host.player(1)!.hp);
    expect(guest.local!.hp).toBeLessThan(TAG_MAX_HP);
  });

  it('ホストが抜けたらゲストが権限を引き継いで続けられる', () => {
    const host = new TagSim(4, roster, 0, true, town);
    const guest = new TagSim(4, roster, 1, false, town);
    run(host, 1);
    guest.applySnapshot(host.snapshot());
    guest.removePlayer(0);
    guest.becomeAuthority();
    expect(guest.authority).toBe(true);
    const before = guest.hayatos.length;
    run(guest, TAG_HAYATO_SPAWN_INTERVAL);
    expect(guest.hayatos.length).toBeGreaterThan(before);
  });
});

describe('スマホのアナログスティック', () => {
  it('上へ倒すと前、右へ倒すと右。遊びの中は 0', () => {
    expect(stickVector(0, -TOUCH_STICK_RADIUS)).toEqual({ x: 0, z: 1, mag: 1 });
    const right = stickVector(TOUCH_STICK_RADIUS * 2, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.mag).toBe(1);
    expect(stickVector(3, 2).mag).toBe(0);
  });

  it('半分倒すと歩き、端まで倒すとダッシュの量になる', () => {
    expect(stickVector(0, -TOUCH_STICK_RADIUS * 0.5).mag).toBeLessThan(TOUCH_SPRINT_AT);
    expect(stickVector(0, -TOUCH_STICK_RADIUS).mag).toBeGreaterThanOrEqual(TOUCH_SPRINT_AT);
  });
});

describe('かぶくんのぷにぷに・よちよち', () => {
  const base = { speed: 0, air: false, vy: 0, alive: true, alarmed: false, won: false };

  it('着地でつぶれて、ぷるぷる揺れてから元に戻る', () => {
    const m = new KabukunMotion(() => 0.5);
    m.update(1 / 60, { ...base, air: true, vy: 5 });
    for (let k = 0; k < 20; k++) m.update(1 / 60, { ...base, air: true, vy: -8 });
    let min = 0;
    let max = 0;
    for (let k = 0; k < 30; k++) {
      const s = m.update(1 / 60, base).stretch;
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBeLessThan(-0.05);
    expect(min).toBeGreaterThanOrEqual(-PUNI_MAX);
    // 揺り戻しで一度伸びる
    expect(max).toBeGreaterThan(0.01);
    for (let k = 0; k < 120; k++) m.update(1 / 60, base);
    expect(Math.abs(m.update(1 / 60, base).stretch)).toBeLessThan(BREATH_AMOUNT + 0.01);
  });

  it('歩くと左右に傾き（よちよち）、止まると戻る', () => {
    const m = new KabukunMotion(() => 0.5);
    let maxRoll = 0;
    let minRoll = 0;
    for (let k = 0; k < 90; k++) {
      const p = m.update(1 / 60, { ...base, speed: 5 });
      maxRoll = Math.max(maxRoll, p.roll);
      minRoll = Math.min(minRoll, p.roll);
    }
    expect(maxRoll).toBeGreaterThan(0.08);
    expect(minRoll).toBeLessThan(-0.08);
    for (let k = 0; k < 60; k++) m.update(1 / 60, base);
    expect(Math.abs(m.update(1 / 60, base).roll)).toBeLessThan(0.01);
  });

  it('当たるとびっくり顔、アウトで悲しい顔', () => {
    const m = new KabukunMotion(() => 0.5);
    m.hit();
    expect(m.update(1 / 60, base).eyes.surprised).toBe(1);
    expect(m.update(1 / 60, { ...base, alive: false }).mouth.frown).toBe(1);
  });
});

describe('お邪魔の道具', () => {
  const duo = [
    { id: 0, name: 'A' },
    { id: 1, name: 'B' },
  ];
  /** ハヤトに邪魔されないよう全員消す */
  function quiet(sim: TagSim): TagSim {
    sim.hayatos.length = 0;
    return sim;
  }

  it(`パンチは近くの人にだけ届き、相手を ${TAG_PUNCH_STUN} 秒動けなくする`, () => {
    const sim = quiet(new TagSim(2, duo, 0, true, town));
    const a = sim.player(0)!;
    const b = sim.player(1)!;
    b.pos.x = a.pos.x + 5;
    b.pos.z = a.pos.z;
    expect(sim.punchTarget(0)).toBeUndefined();
    expect(sim.requestPunch(0)).toBe(false);
    b.pos.x = a.pos.x + 1.5;
    expect(sim.punchTarget(0)?.id).toBe(1);
    expect(sim.requestPunch(0)).toBe(true);
    expect(b.stun).toBe(TAG_PUNCH_STUN);
    // 続けては打てない
    expect(sim.requestPunch(0)).toBe(false);
  });

  it('動けない間は操作しても進まない', () => {
    const sim = quiet(new TagSim(2, duo, 1, true, town));
    const me = sim.local!;
    run(sim, 0.5);
    me.stun = TAG_PUNCH_STUN;
    const x0 = me.pos.x;
    const z0 = me.pos.z;
    run(sim, 1, { ...emptyTagInput(), moveZ: 1, yaw: 0 });
    expect(Math.hypot(me.pos.x - x0, me.pos.z - z0)).toBeLessThan(0.2);
    run(sim, TAG_PUNCH_STUN, { ...emptyTagInput(), moveZ: 1, yaw: 0 });
    expect(Math.hypot(me.pos.x - x0, me.pos.z - z0)).toBeGreaterThan(2);
  });

  it(`町にロケットが ${TAG_ROCKET_PICKUPS} 個落ちていて、近づくと拾える`, () => {
    const sim = quiet(new TagSim(2, duo, 0, true, town));
    expect(sim.pickups.length).toBe(TAG_ROCKET_PICKUPS);
    const me = sim.player(0)!;
    const pk = sim.pickups[0];
    me.pos.x = pk.pos.x;
    me.pos.y = pk.pos.y;
    me.pos.z = pk.pos.z;
    sim.step(STEP, null);
    expect(me.rockets).toBe(1);
    expect(pk.active).toBe(false);
    // 時間がたつと同じ場所にまた出る
    me.pos.x += 30;
    run(sim, TAG_ROCKET_RESPAWN + 0.2);
    expect(pk.active).toBe(true);
  });

  it('ロケットは持っていないと撃てず、壁に当たると地形を壊す', () => {
    const sim = quiet(new TagSim(2, duo, 0, true, town));
    const me = sim.player(0)!;
    expect(sim.requestRocket(0, { x: 0, y: 0, z: 1 })).toBe(false);
    // 駅舎の北側の広場から、南の駅舎へ撃つ
    me.pos.x = 100.5;
    me.pos.z = 166.5;
    me.rockets = 1;
    const before = town.world.get(100, TAG_GROUND + 1, 171);
    expect(before).not.toBe(B.AIR);
    expect(sim.requestRocket(0, { x: 0, y: 0, z: 1 })).toBe(true);
    expect(me.rockets).toBe(0);
    run(sim, 0.5);
    const boom = sim.events.find((e) => e.kind === 'explode');
    expect(boom && boom.kind === 'explode' && boom.broken).toBeGreaterThan(5);
    expect(town.world.get(100, TAG_GROUND + 1, 171)).toBe(B.AIR);
    expect(town.world.dirtyChunks.size).toBeGreaterThan(0);
  });

  it('爆風はほかの人とハヤトをひるませる', () => {
    const sim = new TagSim(2, duo, 0, true, town);
    sim.hayatos.splice(1);
    const me = sim.player(0)!;
    const other = sim.player(1)!;
    const h = sim.hayatos[0];
    me.pos.x = 100.5;
    me.pos.z = 160.5;
    other.pos.x = 100.5;
    other.pos.y = me.pos.y;
    other.pos.z = 168;
    place(h, 102, TAG_GROUND + 2, 168, Math.PI);
    me.rockets = 1;
    sim.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(sim, 0.4);
    expect(other.stun).toBeGreaterThan(0);
    expect(h.state).toBe('stun');
    expect(me.stun).toBe(0);
  });

  it('次の鬼ごっこでは、壊れた町が元に戻る', () => {
    const sim = quiet(new TagSim(2, duo, 0, true, town));
    const me = sim.player(0)!;
    me.pos.x = 100.5;
    me.pos.z = 166.5;
    me.rockets = 1;
    sim.requestRocket(0, { x: 0, y: 0, z: 1 });
    run(sim, 0.5);
    expect(town.world.get(100, TAG_GROUND + 1, 171)).toBe(B.AIR);
    new TagSim(3, duo, 0, true, town);
    expect(town.world.get(100, TAG_GROUND + 1, 171)).not.toBe(B.AIR);
  });

  it('オンライン: ゲストのパンチとロケットはホストが判定し、ゲストに写る', () => {
    const host = quiet(new TagSim(6, duo, 0, true, town));
    const guest = new TagSim(6, duo, 1, false, town);
    const hp = host.player(0)!;
    const gp = guest.local!;
    // ゲストがホストのすぐ横にいる
    gp.pos.x = hp.pos.x + 1.2;
    gp.pos.z = hp.pos.z;
    host.setRemotePlayer(1, gp.pos.x, gp.pos.y, gp.pos.z, 0);
    host.step(STEP, null);
    expect(host.requestPunch(1)).toBe(true);
    guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    // ホストが殴られて動けない（ゲストの画面でもそう見える）
    expect(hp.stun).toBeGreaterThan(0);
    expect(guest.player(0)!.stun).toBeGreaterThan(0);
    // ゲストがロケットを拾って撃つ
    host.player(1)!.rockets = 1;
    expect(host.requestRocket(1, { x: 0, y: 0, z: 1 })).toBe(true);
    guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    expect(guest.rockets.length).toBe(1);
    expect(guest.local!.rockets).toBe(0);
  });
});
