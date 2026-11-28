import { describe, expect, it } from 'vitest';
import { B } from '../src/openworld/OpenWorldConfig';
import { VoxelWorld } from '../src/openworld/VoxelWorld';
import type { GifuTown } from '../src/tag/GifuTown';
import { generateGifuTown } from '../src/tag/GifuTown';
import {
  TAG_BLUE_FIRST,
  TAG_BLUE_GIVEUP,
  TAG_BLUE_HOVER,
  TAG_BLUE_RADIUS,
  TAG_BLUE_SIZE,
  TAG_KNOCKBACK,
  TAG_ONI_DELAY,
  TAG_ONI_SPEED,
  TAG_PUNCH_COMBO_MUL,
  TAG_PUNCH_STUN,
  TAG_SPRINT_SPEED,
} from '../src/tag/TagConfig';
import { HIT_METEOR, TagSim, emptyTagInput, type Hayato } from '../src/tag/TagSim';
import { BREATH_AMOUNT, KabukunMotion, PUNCH_RECOVER, PUNCH_STRIKE, PUNCH_WIND } from '../src/tag/KabukunMotion';
import { boxCollides } from '../src/openworld/OpenWorldSim';

const STEP = 1 / 60;
const GROUND = 6;

function run(sim: TagSim, seconds: number, input = emptyTagInput()): void {
  for (let t = 0; t < seconds; t += STEP) sim.step(STEP, input);
}

/**
 * 実験用の平らな広場（64×64）。alley なら、真ん中に幅 2 ブロックの路地をはさんだ 2 棟の建物を建てる。
 * 建物: x 20〜29 と x 32〜41、z 20〜40、高さ 7。路地は x 30〜31。
 */
function arena(alley = false, size = 64): GifuTown {
  const w = new VoxelWorld(size, 16, size);
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) for (let y = 0; y < GROUND; y++) w.data[w.index(x, y, z)] = B.STONE;
  if (alley) {
    for (let y = GROUND; y < GROUND + 7; y++) {
      for (let z = 20; z <= 40; z++) {
        for (let x = 20; x <= 29; x++) w.data[w.index(x, y, z)] = B.CONCRETE;
        for (let x = 32; x <= 41; x++) w.data[w.index(x, y, z)] = B.CONCRETE;
      }
    }
  }
  return {
    world: w,
    navPoints: [
      { x: 8.5, z: 8.5 },
      { x: 55.5, z: 8.5 },
      { x: 8.5, z: 55.5 },
      { x: 55.5, z: 55.5 },
    ],
    playerSpawns: [
      { x: 10.5, y: GROUND, z: 50.5 },
      { x: 14.5, y: GROUND, z: 50.5 },
    ],
    landmarks: [],
    pristine: w.data.slice(),
  };
}

const solo = [{ id: 0, name: 'A' }];
const duo = [
  { id: 0, name: 'A' },
  { id: 1, name: 'B' },
];

/** ふつうのハヤトを消して、青鬼を 1 人だけ置く */
function withBlue(sim: TagSim, x: number, z: number): Hayato {
  sim.hayatos.length = 0;
  const h = sim.spawnBlue()!;
  h.pos.x = x;
  h.pos.y = GROUND + TAG_BLUE_HOVER + TAG_BLUE_SIZE / 2;
  h.pos.z = z;
  return h;
}

describe('青鬼ハヤト', () => {
  it(`${TAG_BLUE_FIRST} 秒で現れ、体が入りきる広い所に出る`, () => {
    const town = generateGifuTown(1);
    const sim = new TagSim(5, solo, 0, true, town);
    sim.local!.invuln = 1e9;
    // ふつうのハヤトは増やさない
    sim.nextSpawn = 1e9;
    sim.time = TAG_BLUE_FIRST - 0.05;
    expect(sim.hayatos.some((h) => h.kind === 'blue')).toBe(false);
    run(sim, 0.1);
    const blue = sim.hayatos.filter((h) => h.kind === 'blue');
    expect(blue.length).toBe(1);
    const h = blue[0];
    expect(boxCollides(sim.world, h.pos.x, h.pos.y - TAG_BLUE_SIZE / 2, h.pos.z, TAG_BLUE_RADIUS, TAG_BLUE_SIZE)).toBe(false);
    expect(sim.events.some((e) => e.kind === 'spawn' && e.blue)).toBe(true);
  });

  it('ダッシュと同じ速さで追ってきて、触れたら食べられてアウト（ソロなら終わり）', () => {
    const sim = new TagSim(1, solo, 0, true, arena());
    const p = sim.local!;
    const h = withBlue(sim, 10.5, 20.5);
    run(sim, 0.3);
    expect(h.state).toBe('chase');
    expect(h.target).toBe(0);
    const z0 = h.pos.z;
    run(sim, 1);
    expect(h.pos.z - z0).toBeGreaterThan(TAG_SPRINT_SPEED * 0.9);
    expect(h.pos.z - z0).toBeLessThan(TAG_SPRINT_SPEED * 1.1);
    run(sim, 4);
    expect(p.alive).toBe(false);
    expect(sim.events.some((e) => e.kind === 'eaten' && e.player === 0 && e.hayato === h.id)).toBe(true);
    expect(sim.phase).toBe('over');
  });

  it('無敵の間でも、触れられたら食べられる', () => {
    const sim = new TagSim(1, solo, 0, true, arena());
    const p = sim.local!;
    p.invuln = 1e9;
    withBlue(sim, p.pos.x + 1.5, p.pos.z);
    run(sim, 0.1);
    expect(p.alive).toBe(false);
  });

  it('幅 2 ブロックの路地には入れず、近づけないまま時間がたつとあきらめる', () => {
    const sim = new TagSim(1, solo, 0, true, arena(true));
    const p = sim.local!;
    // 路地の奥に立つ
    p.pos.x = 31;
    p.pos.z = 30.5;
    const h = withBlue(sim, 31, 12);
    run(sim, 0.5);
    expect(h.target).toBe(0);
    run(sim, TAG_BLUE_GIVEUP + 4);
    expect(p.alive).toBe(true);
    expect(h.ignore).toBe(0);
    expect(h.target).not.toBe(0);
    // 路地の中には入っていない
    expect(h.pos.z < 20 - TAG_BLUE_RADIUS + 0.2 || h.pos.z > 40 + TAG_BLUE_RADIUS - 0.2 || h.pos.x < 20 || h.pos.x > 41).toBe(true);
  });

  it('もっと近いほかのプレイヤーがいると、そちらへ狙いを移す', () => {
    const sim = new TagSim(1, duo, 0, true, arena());
    const a = sim.player(0)!;
    const b = sim.player(1)!;
    a.pos.x = 10.5;
    a.pos.z = 50.5;
    b.pos.x = 55.5;
    b.pos.z = 10.5;
    const h = withBlue(sim, 10.5, 30.5);
    run(sim, 0.1);
    expect(h.target).toBe(0);
    // B が青鬼のすぐ近くに来た
    b.pos.x = h.pos.x + 3.5;
    b.pos.z = h.pos.z;
    run(sim, STEP);
    expect(h.target).toBe(1);
    expect(sim.events.filter((e) => e.kind === 'spot').length).toBeGreaterThanOrEqual(2);
  });

  it('オンライン: ゲストにも青鬼が写り、食べられた知らせでゲストもアウトになる', () => {
    const host = new TagSim(9, duo, 0, true, arena());
    const guest = new TagSim(9, duo, 1, false, arena());
    const h = withBlue(host, 40.5, 20.5);
    guest.applySnapshot(host.snapshot());
    const gh = guest.hayatos.find((e) => e.id === h.id)!;
    expect(gh.kind).toBe('blue');
    // ゲストのかぶくんが青鬼に触れる
    const victim = host.player(1)!;
    victim.pos.x = h.pos.x + 1.5;
    victim.pos.z = h.pos.z;
    run(host, STEP * 2);
    expect(victim.alive).toBe(false);
    guest.applySnapshot(host.snapshot());
    expect(guest.local!.alive).toBe(false);
    expect(guest.events.some((e) => e.kind === 'eaten' && e.player === 1)).toBe(true);
    expect(guest.hayatos.find((e) => e.id === h.id)!.state).toBe('eat');
  });
});

describe('当たったときの動き（レーザーはスタンなし・隕石やミサイルは大きくふっとぶ）', () => {
  it('ハヤトのレーザーに当たってもスタン・ふっとびせず、直後からすぐ操作できる', () => {
    const sim = new TagSim(1, solo, 0, true, arena(false, 128));
    sim.hayatos.length = 0;
    const p = sim.local!;
    const x0 = p.pos.x;
    sim.applyHit(0, 2, 1, { x: 1, y: 0, z: 0 });
    expect(p.hp).toBe(2);
    expect(p.invuln).toBeGreaterThan(0);
    expect(p.fling).toBe(0);
    expect(p.stun).toBe(0);
    // 当たった直後から逆向き（-x）へ自由に動ける
    const back = { ...emptyTagInput(), moveX: 1, yaw: 0 };
    run(sim, 0.5, back);
    expect(p.pos.x).toBeLessThan(x0 - 1);
  });

  it('隕石やミサイルに当たると開けた所なら 50 m ほどふっとび、その間は操作が効かず、止まると操作が戻る', () => {
    const sim = new TagSim(1, solo, 0, true, arena(false, 128));
    sim.hayatos.length = 0;
    const p = sim.local!;
    const x0 = p.pos.x;
    sim.applyHit(0, 2, HIT_METEOR, { x: 1, y: 0, z: 0 });
    expect(p.fling).toBeGreaterThan(0);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(TAG_KNOCKBACK);
    // 逆向き（-x）に歩こうとしても押し戻せない
    const back = { ...emptyTagInput(), moveX: 1, yaw: 0 };
    run(sim, 0.5, back);
    expect(p.pos.x - x0).toBeGreaterThan(5);
    for (let t = 0; t < 8 && p.fling > 0; t += STEP) sim.step(STEP, emptyTagInput());
    expect(p.fling).toBe(0);
    expect(p.pos.x - x0).toBeGreaterThan(40);
    expect(p.pos.x - x0).toBeLessThan(65);
    // 高く舞い上がる
    expect(sim.events.some((e) => e.kind === 'hit')).toBe(true);
    // 操作が戻る
    const x1 = p.pos.x;
    run(sim, 0.5, back);
    expect(p.pos.x).toBeLessThan(x1 - 1);
  });

  it('壁に当たると跳ね返る', () => {
    const sim = new TagSim(1, solo, 0, true, arena(true));
    sim.hayatos.length = 0;
    const p = sim.local!;
    p.pos.x = 17;
    p.pos.z = 30.5;
    sim.applyHit(0, 2, HIT_METEOR, { x: 1, y: 0, z: 0 });
    run(sim, 0.4);
    // 壁（x = 20）の手前で跳ね返されて、来た向きへ戻っている
    expect(p.pos.x).toBeLessThan(19.5);
    expect(p.vel.x).toBeLessThan(0);
  });
});

describe('パンチでもふっとぶ', () => {
  it('殴られた人はレーザーと同じくらい遠くへふっとび、着地してから動けない時間が数えられる', () => {
    // 殴られる B（id 1）をこの端末で動かす（鎖なしで、ひとりのときの飛び方を確かめる）
    const sim = new TagSim(1, duo, 1, true, arena(false, 128));
    sim.chained = false;
    sim.hayatos.length = 0;
    const a = sim.player(0)!;
    const b = sim.player(1)!;
    b.pos.x = a.pos.x + 1.5;
    b.pos.z = a.pos.z;
    const x0 = b.pos.x;
    expect(sim.requestPunch(0)).toBe(true);
    expect(b.fling).toBeGreaterThan(0);
    expect(b.vel.x).toBeCloseTo(TAG_KNOCKBACK);
    for (let t = 0; t < 8 && b.fling > 0; t += STEP) sim.step(STEP, emptyTagInput());
    expect(b.pos.x - x0).toBeGreaterThan(40);
    // 飛んでいる間は減らないので、着地した時点でまだほぼまるごと残っている
    expect(b.stun).toBeGreaterThan(TAG_PUNCH_STUN - 0.1);
  });
});

describe('動けない所をまた殴ると 10 倍ふっとぶ（連続パンチのハメ技を防ぐ）', () => {
  it('1 発目はふつう、動けない間の 2 発目は横へ 10 倍の速さでふっとぶ', () => {
    const sim = new TagSim(1, duo, 1, true, arena(false, 128));
    sim.hayatos.length = 0;
    const a = sim.player(0)!;
    const b = sim.player(1)!;
    b.pos.x = a.pos.x + 1.5;
    b.pos.z = a.pos.z;
    expect(sim.requestPunch(0)).toBe(true);
    expect(b.vel.x).toBeCloseTo(TAG_KNOCKBACK);
    expect(sim.events.some((e) => e.kind === 'punch' && !e.combo)).toBe(true);
    // 飛び終わって動けないところへ、また近づいて殴る
    for (let t = 0; t < 8 && b.fling > 0; t += STEP) sim.step(STEP, emptyTagInput());
    expect(b.stun).toBeGreaterThan(0);
    a.pos.x = b.pos.x - 1.5;
    a.pos.y = b.pos.y;
    a.pos.z = b.pos.z;
    a.punchCooldown = 0;
    expect(sim.requestPunch(0)).toBe(true);
    expect(b.vel.x).toBeCloseTo(TAG_KNOCKBACK * TAG_PUNCH_COMBO_MUL);
    expect(sim.events.some((e) => e.kind === 'punch' && e.combo)).toBe(true);
  });

  it('速くても建物の壁をすり抜けず、跳ね返る', () => {
    const sim = new TagSim(1, duo, 1, true, arena(true, 64));
    sim.hayatos.length = 0;
    const b = sim.player(1)!;
    // 建物（x 20〜29）の西 6 m から東へ 190 m/s でふっとばす
    b.pos.x = 14;
    b.pos.y = GROUND;
    b.pos.z = 30;
    b.stun = 1;
    const a = sim.player(0)!;
    a.pos.x = 12.5;
    a.pos.y = GROUND;
    a.pos.z = 30;
    expect(sim.requestPunch(0)).toBe(true);
    for (let t = 0; t < 0.3; t += STEP) {
      sim.step(STEP, emptyTagInput());
      // 建物の中に入っていない
      expect(boxCollides(sim.world, b.pos.x, b.pos.y, b.pos.z, 0.5, 1.3)).toBe(false);
    }
    expect(b.pos.x < 20 || b.pos.y >= GROUND + 7).toBe(true);
  });

  it('オンライン: ゲストにも 10 倍の知らせが届き、殴られたゲストが大きくふっとぶ', () => {
    const host = new TagSim(1, duo, 0, true, arena(false, 128));
    const guest = new TagSim(1, duo, 1, false, arena(false, 128));
    host.hayatos.length = 0;
    const b = host.player(1)!;
    const a = host.player(0)!;
    b.stun = 2;
    b.pos.x = a.pos.x + 1.5;
    b.pos.z = a.pos.z;
    expect(host.requestPunch(0)).toBe(true);
    guest.applySnapshot(host.snapshot());
    expect(guest.local!.vel.x).toBeCloseTo(TAG_KNOCKBACK * TAG_PUNCH_COMBO_MUL);
    expect(guest.events.some((e) => e.kind === 'punch' && e.combo)).toBe(true);
  });
});

describe('ふっとびの跳ね返り（つづき）', () => {
  it('町の端に当たっても跳ね返る', () => {
    const sim = new TagSim(1, solo, 0, true, arena());
    sim.hayatos.length = 0;
    const p = sim.local!;
    p.pos.x = 58;
    sim.applyHit(0, 2, HIT_METEOR, { x: 1, y: 0, z: 0 });
    run(sim, 0.6);
    expect(p.vel.x).toBeLessThan(0);
  });

  it('天井に当たると下へ跳ね返る', () => {
    const town = arena();
    const w = town.world;
    // 頭の少し上に屋根
    for (let x = 0; x < 64; x++) for (let z = 40; z < 64; z++) w.data[w.index(x, GROUND + 3, z)] = B.CONCRETE;
    town.pristine = w.data.slice();
    const sim = new TagSim(1, solo, 0, true, town);
    sim.hayatos.length = 0;
    const p = sim.local!;
    sim.applyHit(0, 2, HIT_METEOR, { x: 1, y: 0, z: 0 });
    let hitCeiling = false;
    for (let t = 0; t < 0.5; t += STEP) {
      sim.step(STEP, emptyTagInput());
      if (p.vel.y < -4 && p.pos.y > GROUND + 1.5) hitCeiling = true;
    }
    expect(hitCeiling).toBe(true);
    expect(p.pos.y + 1.3).toBeLessThanOrEqual(GROUND + 3 + 0.01);
  });
});

describe('かぶくんの立ちモーション', () => {
  const idle = { speed: 0, air: false, vy: 0, alive: true, alarmed: false, won: false };

  it('立っていると呼吸でゆっくりふくらんだりしぼんだりする', () => {
    const m = new KabukunMotion(() => 0.5);
    for (let t = 0; t < 1; t += STEP) m.update(STEP, idle);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 3; t += STEP) {
      const s = m.update(STEP, idle).stretch;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    expect(hi).toBeGreaterThan(BREATH_AMOUNT * 0.8);
    expect(lo).toBeLessThan(-BREATH_AMOUNT * 0.8);
    expect(hi).toBeLessThan(BREATH_AMOUNT * 1.5);
  });

  it('パンチは振りかぶってから右腕を前へ突き出し、体ごと伸びて、元に戻る', () => {
    const m = new KabukunMotion(() => 0.5);
    m.punch();
    let minArm = 0;
    let maxArm = 0;
    let maxLean = 0;
    let maxStretch = -1;
    const total = PUNCH_WIND + PUNCH_STRIKE + PUNCH_RECOVER;
    let armAtWind = 0;
    for (let t = 0; t < total + 0.2; t += STEP) {
      const pose = m.update(STEP, idle);
      if (t < PUNCH_WIND) armAtWind = Math.min(armAtWind, pose.punchArm);
      minArm = Math.min(minArm, pose.punchArm);
      maxArm = Math.max(maxArm, pose.punchArm);
      maxLean = Math.max(maxLean, pose.lean);
      if (t > PUNCH_WIND) maxStretch = Math.max(maxStretch, pose.stretch);
    }
    expect(armAtWind).toBeLessThan(-0.5);
    expect(maxArm).toBeGreaterThan(0.9);
    expect(maxLean).toBeGreaterThan(0.4);
    expect(maxStretch).toBeGreaterThan(0.1);
    const end = m.update(STEP, idle);
    expect(end.punchArm).toBe(0);
    expect(end.twist).toBe(0);
  });

  it('ふっとんでいる間はぐるぐる回り、終わると元の姿勢に戻る', () => {
    const m = new KabukunMotion(() => 0.5);
    for (let t = 0; t < 0.5; t += STEP) m.update(STEP, { ...idle, air: true, flung: true });
    expect(m.update(STEP, { ...idle, air: true, flung: true }).spin).toBeGreaterThan(3);
    let spin = 1;
    for (let t = 0; t < 1.5; t += STEP) spin = m.update(STEP, idle).spin;
    expect(spin).toBe(0);
  });
});

describe('先にアウトになった人は青鬼になって復活する（オンライン）', () => {
  const trio = [
    { id: 0, name: 'A' },
    { id: 1, name: 'B' },
    { id: 2, name: 'C' },
  ];
  /** ハヤト（NPC）を消した 3 人の部屋。localId の人をこの端末で動かす */
  function room(localId: number, authority = true): TagSim {
    const sim = new TagSim(4, trio, localId, authority, arena(false, 96));
    sim.hayatos.length = 0;
    sim.nextSpawn = 1e9;
    sim.nextBlue = 1e9;
    return sim;
  }

  it(`アウトから ${TAG_ONI_DELAY} 秒で、生きている人から離れた広い所に青鬼として出てくる`, () => {
    const sim = room(0);
    sim.applyHit(2, 0, 0, { x: 1, y: 0, z: 0 });
    const c = sim.player(2)!;
    expect(c.alive).toBe(false);
    run(sim, TAG_ONI_DELAY - 0.2);
    expect(c.oni).toBe(false);
    run(sim, 0.4);
    expect(c.oni).toBe(true);
    expect(c.alive).toBe(false);
    expect(sim.events.some((e) => e.kind === 'oni' && e.player === 2)).toBe(true);
    expect(boxCollides(sim.world, c.pos.x, c.pos.y, c.pos.z, TAG_BLUE_RADIUS, TAG_BLUE_SIZE)).toBe(false);
    for (const p of sim.players.filter((q) => q.alive)) expect(Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z)).toBeGreaterThan(20);
    expect(sim.phase).toBe('playing');
  });

  it('ソロでは青鬼にならない（アウトで終わり）', () => {
    const sim = new TagSim(4, solo, 0, true, arena());
    sim.hayatos.length = 0;
    sim.applyHit(0, 0, 0, { x: 1, y: 0, z: 0 });
    run(sim, TAG_ONI_DELAY + 1);
    expect(sim.local!.oni).toBe(false);
    expect(sim.phase).toBe('over');
  });

  it('青鬼は自分で操作でき、ダッシュと同じ速さで歩き、ジャンプはできない', () => {
    const sim = room(2);
    sim.applyHit(2, 0, 0, { x: 1, y: 0, z: 0 });
    run(sim, TAG_ONI_DELAY + 0.1);
    const c = sim.local!;
    expect(c.oni).toBe(true);
    // 人から遠い所で試す
    c.pos.x = 48;
    c.pos.z = 10;
    const z0 = c.pos.z;
    const fwd = { ...emptyTagInput(), moveZ: 1, yaw: 0, jump: true };
    run(sim, 0.3, fwd);
    const z1 = c.pos.z;
    run(sim, 1, fwd);
    expect(c.pos.z - z1).toBeGreaterThan(TAG_ONI_SPEED * 0.9);
    expect(c.pos.z - z1).toBeLessThan(TAG_ONI_SPEED * 1.1);
    expect(z1).toBeGreaterThan(z0);
    expect(c.pos.y).toBeCloseTo(GROUND);
  });

  it('青鬼が生きている人に触れると食べ、最後に残った人が勝つ', () => {
    const sim = room(0);
    sim.applyHit(2, 0, 0, { x: 1, y: 0, z: 0 });
    run(sim, TAG_ONI_DELAY + 0.1);
    const c = sim.player(2)!;
    const b = sim.player(1)!;
    // 青鬼の C のすぐ横に B
    b.pos.x = c.pos.x + 1.5;
    b.pos.y = c.pos.y;
    b.pos.z = c.pos.z;
    run(sim, STEP * 2);
    expect(b.alive).toBe(false);
    expect(c.eats).toBe(1);
    expect(c.stun).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.kind === 'eaten' && e.player === 1 && e.byPlayer === 2)).toBe(true);
    expect(sim.phase).toBe('over');
    expect(sim.winner).toBe(0);
  });

  it('ゲストにも、青鬼になった知らせと食べた知らせが写る', () => {
    const host = room(0);
    const guest = room(1, false);
    host.applyHit(2, 0, 0, { x: 1, y: 0, z: 0 });
    run(host, TAG_ONI_DELAY + 0.1);
    guest.applySnapshot(host.snapshot());
    const gc = guest.player(2)!;
    expect(gc.oni).toBe(true);
    expect(gc.pos.x).toBeCloseTo(host.player(2)!.pos.x, 1);
    // 青鬼の C がゲストの B を食べる
    const hc = host.player(2)!;
    const hb = host.player(1)!;
    hb.pos.x = hc.pos.x + 1.5;
    hb.pos.y = hc.pos.y;
    hb.pos.z = hc.pos.z;
    run(host, STEP * 2);
    guest.applySnapshot(host.snapshot());
    expect(guest.local!.alive).toBe(false);
    expect(guest.player(2)!.eats).toBe(1);
    expect(guest.events.some((e) => e.kind === 'eaten' && e.byPlayer === 2)).toBe(true);
  });
});
