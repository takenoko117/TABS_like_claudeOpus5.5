import { describe, expect, it } from 'vitest';
import { B } from '../src/openworld/OpenWorldConfig';
import { VoxelWorld } from '../src/openworld/VoxelWorld';
import type { GifuTown } from '../src/tag/GifuTown';
import { generateGifuTown } from '../src/tag/GifuTown';
import {
  TAG_HAYATO_MAX,
  TAG_HAYATO_SPAWN_INTERVAL,
  TAG_HAYATO_START,
  TAG_MAX_HP,
  TAG_METEOR_ALT,
  TAG_METEOR_FIRST,
  TAG_METEOR_STILL_TIME,
  TAG_METEOR_WARN,
  TAG_SIZE_X,
  TAG_SIZE_Z,
  TAG_ZONE_CENTER_X,
  TAG_ZONE_CENTER_Z,
  TAG_ZONE_MIN,
  TAG_ZONE_SPEED,
  TAG_ZONE_START,
} from '../src/tag/TagConfig';
import { HIT_METEOR, HIT_MISSILE, TagSim, emptyTagInput, tagZone, zoneMoving } from '../src/tag/TagSim';

const STEP = 1 / 60;
const GROUND = 6;

function run(sim: TagSim, seconds: number, input = emptyTagInput()): void {
  for (let t = 0; t < seconds; t += STEP) sim.step(STEP, input);
}

/** 町と同じ大きさ（176×192）の平らな広場。ナビ点は 8 m おき */
function flatTown(): GifuTown {
  const w = new VoxelWorld(TAG_SIZE_X, 16, TAG_SIZE_Z);
  for (let x = 0; x < TAG_SIZE_X; x++) for (let z = 0; z < TAG_SIZE_Z; z++) for (let y = 0; y < GROUND; y++) w.data[w.index(x, y, z)] = B.STONE;
  const navPoints: { x: number; z: number }[] = [];
  for (let x = 4.5; x < TAG_SIZE_X; x += 8) for (let z = 4.5; z < TAG_SIZE_Z; z += 8) navPoints.push({ x, z });
  return {
    world: w,
    navPoints,
    playerSpawns: [
      { x: 88.5, y: GROUND, z: 96.5 },
      { x: 92.5, y: GROUND, z: 96.5 },
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
const red = (sim: TagSim): number => sim.hayatos.filter((h) => h.kind === 'red').length;

describe('ハヤトは倍々に増える', () => {
  it(`${TAG_HAYATO_START} → ${TAG_HAYATO_START * 2} → ${TAG_HAYATO_START * 4} と ${TAG_HAYATO_SPAWN_INTERVAL} 秒ごとに倍になり、${TAG_HAYATO_MAX} 人で止まる`, () => {
    const sim = new TagSim(3, solo, 0, true, flatTown());
    sim.local!.invuln = 1e9;
    expect(red(sim)).toBe(TAG_HAYATO_START);
    const counts: number[] = [];
    for (let k = 1; k <= 5; k++) {
      // 試験の間は撃たれてもアウトにならないよう、HP を戻し続ける
      for (let t = 0; t < TAG_HAYATO_SPAWN_INTERVAL; t += STEP) {
        sim.local!.hp = TAG_MAX_HP;
        sim.local!.invuln = 1e9;
        sim.step(STEP, emptyTagInput());
      }
      counts.push(red(sim));
    }
    expect(counts).toEqual([8, 16, 32, 32, 32].map((n) => Math.min(n, TAG_HAYATO_MAX)));
  });
});

describe('ミサイルで移動できる所が狭まる', () => {
  it(`${TAG_ZONE_START} 秒までは町全体で、そのあと四方から狭まり、一辺 ${TAG_ZONE_MIN} m で止まる`, () => {
    expect(tagZone(0)).toEqual({ x0: 0, x1: TAG_SIZE_X, z0: 0, z1: TAG_SIZE_Z });
    expect(tagZone(TAG_ZONE_START)).toEqual({ x0: 0, x1: TAG_SIZE_X, z0: 0, z1: TAG_SIZE_Z });
    expect(zoneMoving(TAG_ZONE_START - 1)).toEqual({ x: false, z: false });
    const z = tagZone(TAG_ZONE_START + 20);
    expect(z.x0).toBeCloseTo(20 * TAG_ZONE_SPEED);
    expect(z.z1).toBeCloseTo(TAG_SIZE_Z - 20 * TAG_ZONE_SPEED);
    expect(zoneMoving(TAG_ZONE_START + 20)).toEqual({ x: true, z: true });
    const end = tagZone(TAG_ZONE_START + 10000);
    expect(end.x1 - end.x0).toBeCloseTo(TAG_ZONE_MIN);
    expect(end.z1 - end.z0).toBeCloseTo(TAG_ZONE_MIN);
    expect((end.x0 + end.x1) / 2).toBeCloseTo(TAG_ZONE_CENTER_X);
    expect((end.z0 + end.z1) / 2).toBeCloseTo(TAG_ZONE_CENTER_Z);
    expect(zoneMoving(TAG_ZONE_START + 10000)).toEqual({ x: false, z: false });
  });

  it('外縁の外へは歩いて出られない', () => {
    const sim = new TagSim(1, solo, 0, true, flatTown());
    sim.hayatos.length = 0;
    sim.time = TAG_ZONE_START + 60;
    const p = sim.local!;
    p.invuln = 1e9;
    const z0 = sim.zone().x0;
    p.pos.x = z0 + 6;
    p.pos.z = 96;
    // 西（-x）へ歩き続ける（yaw = -π/2 が西向き）
    run(sim, 4, { ...emptyTagInput(), moveZ: 1, yaw: -Math.PI / 2 });
    expect(p.pos.x).toBeGreaterThanOrEqual(sim.zone().x0 - 1e-6);
  });

  it('迫ってくる外縁に押されるとミサイルに当たり、HP が減って内側へふっとぶ', () => {
    const sim = new TagSim(1, solo, 0, true, flatTown());
    sim.hayatos.length = 0;
    sim.time = TAG_ZONE_START + 40;
    const p = sim.local!;
    p.pos.x = sim.zone().x0 + 0.6;
    p.pos.z = 96;
    run(sim, 0.5);
    expect(p.hp).toBe(TAG_MAX_HP - 1);
    expect(sim.events.some((e) => e.kind === 'hit' && e.bolt === HIT_MISSILE)).toBe(true);
    run(sim, 3);
    // 内側（+x）へ大きく飛んでいる
    expect(p.pos.x - sim.zone().x0).toBeGreaterThan(15);
  });

  it('ハヤトも外縁の外には残らず、増えるハヤトは内側に出る', () => {
    const sim = new TagSim(2, solo, 0, true, flatTown());
    sim.local!.invuln = 1e9;
    sim.time = TAG_ZONE_START + 100;
    for (const h of sim.hayatos) {
      h.pos.x = 2;
      h.pos.z = 2;
    }
    run(sim, 0.2);
    const z = sim.zone();
    for (const h of sim.hayatos) {
      expect(h.pos.x).toBeGreaterThanOrEqual(z.x0);
      expect(h.pos.z).toBeGreaterThanOrEqual(z.z0);
    }
    sim.nextSpawn = sim.time;
    const before = sim.hayatos.length;
    run(sim, 0.1);
    for (const h of sim.hayatos.slice(before)) expect(sim.inZone(h.pos)).toBe(true);
  });

  it('本物の町でも、狭まりきった真ん中に立てる所がある', () => {
    const town = generateGifuTown(1);
    const sim = new TagSim(1, solo, 0, true, town);
    sim.time = TAG_ZONE_START + 10000;
    const z = sim.zone();
    const inside = town.navPoints.filter((c) => c.x > z.x0 && c.x < z.x1 && c.z > z.z0 && c.z < z.z1);
    expect(inside.length).toBeGreaterThan(5);
  });
});

describe('隕石ハヤト', () => {
  it(`${TAG_METEOR_FIRST} 秒で空の高い所に現れる`, () => {
    const sim = new TagSim(4, solo, 0, true, flatTown());
    sim.local!.invuln = 1e9;
    run(sim, TAG_METEOR_FIRST + 0.2);
    const m = sim.hayatos.find((h) => h.kind === 'meteor');
    expect(m).toBeDefined();
    expect(m!.pos.y).toBeCloseTo(TAG_METEOR_ALT, 0);
  });

  it('動かずにいる人に隕石を落とし、当たると HP が減ってふっとぶ。地面には穴があく', () => {
    const sim = new TagSim(4, solo, 0, true, flatTown());
    sim.hayatos.length = 0;
    const h = sim.spawnMeteor()!;
    const p = sim.local!;
    h.pos.x = p.pos.x + 10;
    h.pos.z = p.pos.z;
    const blocks = sim.world.data.reduce((a, v) => a + (v ? 1 : 0), 0);
    // 止まっているだけで狙われる
    run(sim, TAG_METEOR_STILL_TIME + 0.2);
    expect(sim.meteors.length).toBe(1);
    expect(sim.events.some((e) => e.kind === 'meteor_warn')).toBe(true);
    run(sim, TAG_METEOR_WARN + 2);
    expect(sim.events.some((e) => e.kind === 'meteor_hit')).toBe(true);
    expect(sim.events.some((e) => e.kind === 'hit' && e.bolt === HIT_METEOR)).toBe(true);
    expect(p.hp).toBe(TAG_MAX_HP - 1);
    expect(sim.world.data.reduce((a, v) => a + (v ? 1 : 0), 0)).toBeLessThan(blocks);
  });

  it('走り回っている人は狙われない', () => {
    const sim = new TagSim(4, solo, 0, true, flatTown());
    sim.hayatos.length = 0;
    sim.spawnMeteor();
    const p = sim.local!;
    // 円を描いて走り続ける
    for (let t = 0; t < 12; t += STEP) {
      sim.step(STEP, { ...emptyTagInput(), moveZ: 1, yaw: t * 0.6 });
    }
    expect(sim.events.some((e) => e.kind === 'meteor_warn')).toBe(false);
    expect(p.hp).toBe(TAG_MAX_HP);
  });

  it('印が出てから走って逃げれば当たらない', () => {
    const sim = new TagSim(4, solo, 0, true, flatTown());
    sim.hayatos.length = 0;
    sim.spawnMeteor();
    const p = sim.local!;
    run(sim, TAG_METEOR_STILL_TIME + 0.2);
    expect(sim.meteors.length).toBe(1);
    run(sim, TAG_METEOR_WARN + 2, { ...emptyTagInput(), moveZ: 1, sprint: true, yaw: 0 });
    expect(sim.events.some((e) => e.kind === 'meteor_hit')).toBe(true);
    expect(p.hp).toBe(TAG_MAX_HP);
  });

  it('オンライン: ゲストにも隕石ハヤト・隕石・地面の穴・当たりが写る', () => {
    const host = new TagSim(4, duo, 0, true, flatTown());
    const guest = new TagSim(4, duo, 1, false, flatTown());
    host.hayatos.length = 0;
    host.spawnMeteor();
    // ゲストの人は止まったまま（届いた位置を写す）
    const gp = guest.local!;
    host.setRemotePlayer(1, gp.pos.x, gp.pos.y, gp.pos.z, 0);
    host.player(0)!.invuln = 1e9;
    for (let t = 0; t < TAG_METEOR_STILL_TIME + TAG_METEOR_WARN + 3; t += STEP) {
      host.step(STEP, { ...emptyTagInput(), moveZ: 1, yaw: t });
      guest.step(STEP, emptyTagInput());
      if (Math.round(t / STEP) % 6 === 0) guest.applySnapshot(host.snapshot());
    }
    guest.applySnapshot(host.snapshot());
    expect(guest.hayatos.some((h) => h.kind === 'meteor')).toBe(true);
    expect(guest.events.some((e) => e.kind === 'meteor_warn')).toBe(true);
    expect(guest.events.some((e) => e.kind === 'meteor_hit')).toBe(true);
    expect(gp.hp).toBe(TAG_MAX_HP - 1);
    expect(Array.from(guest.world.data)).toEqual(Array.from(host.world.data));
  });
});
