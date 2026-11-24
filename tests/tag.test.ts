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
} from '../src/tag/TagConfig';
import { TagSim, emptyTagInput, type Hayato } from '../src/tag/TagSim';

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
