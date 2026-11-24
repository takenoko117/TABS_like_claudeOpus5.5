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
  TAG_SPRINT_SPEED,
} from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, type Hayato } from '../src/tag/TagSim';
import { BREATH_AMOUNT, KabukunMotion } from '../src/tag/KabukunMotion';
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
function arena(alley = false): GifuTown {
  const w = new VoxelWorld(64, 16, 64);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 0; y < GROUND; y++) w.data[w.index(x, y, z)] = B.STONE;
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

describe('当たると大きくふっとぶ', () => {
  it('レーザーに当たると遠くまでふっとび、その間は操作が効かず、止まると操作が戻る', () => {
    const sim = new TagSim(1, solo, 0, true, arena());
    sim.hayatos.length = 0;
    const p = sim.local!;
    const x0 = p.pos.x;
    sim.applyHit(0, 2, 0, { x: 1, y: 0, z: 0 });
    expect(p.fling).toBeGreaterThan(0);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(TAG_KNOCKBACK);
    // 逆向き（-x）に歩こうとしても押し戻せない
    const back = { ...emptyTagInput(), moveX: 1, yaw: 0 };
    run(sim, 0.5, back);
    expect(p.pos.x - x0).toBeGreaterThan(5);
    run(sim, 2.5);
    expect(p.pos.x - x0).toBeGreaterThan(10);
    expect(p.fling).toBe(0);
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
    sim.applyHit(0, 2, 0, { x: 1, y: 0, z: 0 });
    run(sim, 0.4);
    // 壁（x = 20）の手前で跳ね返されて、来た向きへ戻っている
    expect(p.pos.x).toBeLessThan(19.5);
    expect(p.vel.x).toBeLessThan(0);
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

  it('ふっとんでいる間はぐるぐる回り、終わると元の姿勢に戻る', () => {
    const m = new KabukunMotion(() => 0.5);
    for (let t = 0; t < 0.5; t += STEP) m.update(STEP, { ...idle, air: true, flung: true });
    expect(m.update(STEP, { ...idle, air: true, flung: true }).spin).toBeGreaterThan(3);
    let spin = 1;
    for (let t = 0; t < 1.5; t += STEP) spin = m.update(STEP, idle).spin;
    expect(spin).toBe(0);
  });
});
