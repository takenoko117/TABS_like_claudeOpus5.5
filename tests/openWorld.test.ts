import { describe, expect, it } from 'vitest';
import { B, OW_GROUND_Y, OW_ROAD_WIDTH, OW_TOOLS, OW_VEHICLES } from '../src/openworld/OpenWorldConfig';
import { VoxelWorld } from '../src/openworld/VoxelWorld';
import { DestructionSystem } from '../src/openworld/Destruction';
import { generateOpenWorld, ROAD_ORIGINS, makeRng } from '../src/openworld/WorldGen';
import { meshVoxelModel, meshWorldRegion } from '../src/openworld/ChunkMesher';
import { OpenWorldSim, emptyInput, moveBox, viewDir, type OWInput } from '../src/openworld/OpenWorldSim';

/** 岩盤と平らな地面だけの小さな世界 */
function flatWorld(size = 32, height = 32, ground = 4): VoxelWorld {
  const w = new VoxelWorld(size, height, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      w.setRaw(x, 0, z, B.BEDROCK);
      for (let y = 1; y <= ground; y++) w.setRaw(x, y, z, B.STONE);
    }
  }
  return w;
}

function stepSim(sim: OpenWorldSim, seconds: number, input: Partial<OWInput> = {}): void {
  const n = Math.round(seconds * 60);
  for (let k = 0; k < n; k++) {
    const base = emptyInput();
    const first = k === 0;
    sim.step(1 / 60, {
      ...base,
      ...input,
      firePressed: first ? (input.firePressed ?? false) : false,
      interactPressed: first ? (input.interactPressed ?? false) : false,
      altPressed: first ? (input.altPressed ?? false) : false,
      toggleFlyPressed: first ? (input.toggleFlyPressed ?? false) : false,
    });
    sim.events.length = 0;
  }
}

describe('オープンワールド: 世界の生成', () => {
  const layout = generateOpenWorld(1);
  const w = layout.world;

  it('同じ種なら同じ世界になる', () => {
    const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
    expect(same(generateOpenWorld(1).world.data, w.data)).toBe(true);
    expect(same(generateOpenWorld(2).world.data, w.data)).toBe(false);
  });

  it('底は岩盤、街の道路はアスファルトと歩道', () => {
    expect(w.get(10, 0, 10)).toBe(B.BEDROCK);
    const o = ROAD_ORIGINS[1];
    // 道路の帯（x 方向に延びる道）の上
    const x = ROAD_ORIGINS[1] + OW_ROAD_WIDTH + 5;
    expect(w.get(x, OW_GROUND_Y, o)).toBe(B.SIDEWALK);
    expect([B.ASPHALT, B.ROAD_LINE]).toContain(w.get(x, OW_GROUND_Y, o + 2));
    expect(w.get(x, OW_GROUND_Y + 1, o + 2)).toBe(B.AIR);
  });

  it('ビル（ガラス窓）・水・木がある', () => {
    let glass = 0;
    let water = 0;
    let leaves = 0;
    for (const id of w.data) {
      if (id === B.GLASS) glass++;
      else if (id === B.WATER) water++;
      else if (id === B.LEAVES) leaves++;
    }
    expect(glass).toBeGreaterThan(1000);
    expect(water).toBeGreaterThan(1000);
    expect(leaves).toBeGreaterThan(200);
  });

  it('スタート地点は空いていて、足もとは地面', () => {
    const s = layout.spawn;
    expect(w.solidAt(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))).toBe(false);
    expect(w.solidAt(Math.floor(s.x), Math.floor(s.y) - 1, Math.floor(s.z))).toBe(true);
  });

  it('駐車場の車と、基地の戦車が置かれる', () => {
    expect(layout.parked.some((p) => p.kind === 'tank')).toBe(true);
    expect(layout.parked.filter((p) => p.kind === 'car').length).toBeGreaterThan(0);
  });
});

describe('オープンワールド: ボクセルの世界', () => {
  it('光線は最初の固いブロックで止まり、当たった面を返す', () => {
    const w = flatWorld();
    const hit = w.raycast({ x: 10.5, y: 10.5, z: 10.5 }, { x: 0, y: -1, z: 0 }, 50);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBe(4);
    expect(hit!.ny).toBe(1);
    expect(hit!.dist).toBeCloseTo(5.5, 3);
    // 水は通り抜ける
    w.setRaw(10, 5, 10, B.WATER);
    expect(w.raycast({ x: 10.5, y: 10.5, z: 10.5 }, { x: 0, y: -1, z: 0 }, 50)!.y).toBe(4);
  });

  it('書き換えると描画の作り直しが記録される（境目は隣のチャンクも）', () => {
    const w = flatWorld();
    w.dirtyChunks.clear();
    w.set(16, 5, 5, B.BRICK);
    expect(w.dirtyChunks.size).toBe(2);
    expect(w.chunkCoords(w.chunkIndex(1, 1, 0))).toEqual([1, 1, 0]);
  });
});

describe('オープンワールド: 破壊と崩落', () => {
  it('ブロックを壊すと統計が増え、岩盤は壊れない', () => {
    const w = flatWorld();
    const d = new DestructionSystem(w, makeRng(1));
    expect(d.breakBlock(5, 4, 5)).toBe(true);
    expect(w.get(5, 4, 5)).toBe(B.AIR);
    expect(d.stats.blocks).toBe(1);
    expect(d.stats.damageYen).toBeGreaterThan(0);
    expect(d.breakBlock(5, 0, 5)).toBe(false);
  });

  it('ライフルは硬さぶん当てると壊れる', () => {
    const w = flatWorld();
    w.setRaw(5, 5, 5, B.BRICK); // 硬さ 3
    const d = new DestructionSystem(w, makeRng(1));
    expect(d.damageBlock(5, 5, 5, 1)).toBe(false);
    expect(d.damageBlock(5, 5, 5, 1)).toBe(false);
    expect(d.damageBlock(5, 5, 5, 1)).toBe(true);
    expect(w.get(5, 5, 5)).toBe(B.AIR);
  });

  it('柱を壊すと、上の床が支えを失って落ち、地面に着地する', () => {
    const w = flatWorld();
    // 高さ 6 の柱の上に 5×5 の床
    for (let y = 5; y <= 10; y++) w.setRaw(10, y, 10, B.CONCRETE);
    for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) w.setRaw(x, 11, z, B.CONCRETE);
    const d = new DestructionSystem(w, makeRng(3));
    d.breakBlock(10, 5, 10);
    expect(d.falling.length).toBe(1);
    expect(d.stats.collapses).toBe(1);
    expect(w.get(10, 11, 10)).toBe(B.AIR);
    for (let k = 0; k < 240 && d.falling.length > 0; k++) d.step(1 / 60);
    expect(d.falling.length).toBe(0);
    // 柱の残り（5 ブロック）の底が地面（y = 4 の上）に着く: 床は柱の 5 段ぶん下へ
    expect(d.events.some((e) => e.kind === 'collapse_land')).toBe(true);
    let floorBlocks = 0;
    for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) if (w.get(x, 10, z) === B.CONCRETE) floorBlocks++;
    expect(floorBlocks).toBeGreaterThan(10);
    expect(w.get(10, 11, 10)).toBe(B.AIR);
  });

  it('地面につながっている建物は落ちない', () => {
    const w = flatWorld();
    for (let y = 5; y <= 10; y++) {
      w.setRaw(10, y, 10, B.CONCRETE);
      w.setRaw(12, y, 10, B.CONCRETE);
    }
    for (let x = 10; x <= 12; x++) w.setRaw(x, 11, 10, B.CONCRETE);
    const d = new DestructionSystem(w, makeRng(3));
    d.breakBlock(10, 5, 10);
    expect(d.falling.length).toBe(0);
    expect(w.get(11, 11, 10)).toBe(B.CONCRETE);
  });

  it('爆発は半径の中を壊し、岩盤と遠くのブロックは残す', () => {
    const w = flatWorld(32, 32, 8);
    const d = new DestructionSystem(w, makeRng(5));
    const n = d.explode({ x: 16, y: 8.5, z: 16 }, 4);
    expect(n).toBeGreaterThan(30);
    expect(w.get(16, 8, 16)).toBe(B.AIR);
    expect(w.get(16, 0, 16)).toBe(B.BEDROCK);
    expect(w.get(16, 8, 26)).toBe(B.STONE);
    expect(d.debris.length).toBeGreaterThan(0);
    // 破片はやがて消える
    for (let k = 0; k < 60 * 8; k++) d.step(1 / 60);
    expect(d.debris.length).toBe(0);
  });
});

describe('オープンワールド: 面の生成', () => {
  it('1 つの箱は 6 面、隣り合う 2 つは 10 面', () => {
    const one = meshVoxelModel(1, 1, 1, () => 0xffffff, 1);
    expect(one.indices.length).toBe(36);
    const two = meshVoxelModel(2, 1, 1, () => 0xffffff, 1);
    expect(two.indices.length).toBe(60);
  });

  it('三角形は外向き（巻き方向と法線が一致）', () => {
    const m = meshVoxelModel(1, 1, 1, () => 0xffffff, 1);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
      expect(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it('埋まった地面は上面だけ、ガラスは別のメッシュになる', () => {
    const w = flatWorld(16, 16, 4);
    w.setRaw(5, 5, 5, B.GLASS);
    const res = meshWorldRegion((x, y, z) => w.get(x, y, z), 0, 0, 0, 16, 16, 16);
    // 上面は 16×16 面（ガラスの下の地面も透けて見えるので作る）
    let up = 0;
    for (let i = 0; i < res.opaque.normals.length; i += 3) if (res.opaque.normals[i + 1] === 1) up++;
    expect(up / 4).toBe(16 * 16);
    // ガラスの底は地面に接するので作らない（5 面）
    expect(res.translucent.indices.length).toBe(30);
  });
});

describe('オープンワールド: プレイヤーと乗り物', () => {
  it('箱の移動: 壁で止まり、1 ブロックの段差は上る', () => {
    const w = flatWorld();
    for (let y = 5; y <= 8; y++) w.setRaw(12, y, 10, B.BRICK);
    w.setRaw(10, 5, 14, B.BRICK);
    const pos = { x: 10.5, y: 5, z: 10.5 };
    const vel = { x: 5, y: 0, z: 0 };
    for (let k = 0; k < 60; k++) moveBox(w, pos, vel, 0.3, 1.8, 1 / 60, true, true);
    expect(pos.x).toBeLessThan(12 - 0.29);
    const p2 = { x: 10.5, y: 5, z: 12.5 };
    const v2 = { x: 0, y: 0, z: 4 };
    let ground = true;
    for (let k = 0; k < 60; k++) {
      v2.z = 4;
      v2.y -= 26 / 60;
      ground = moveBox(w, p2, v2, 0.3, 1.8, 1 / 60, true, ground);
    }
    expect(p2.z).toBeGreaterThan(15);
    expect(p2.y).toBeGreaterThanOrEqual(5);
  });

  it('歩く・跳ぶ・ブロックを素手で壊す・置く', () => {
    const sim = new OpenWorldSim(1);
    stepSim(sim, 0.5);
    expect(sim.player.onGround).toBe(true);
    const start = { ...sim.player.pos };
    // yaw = π/2 で +x へ（交差点を道なりに）
    stepSim(sim, 1, { moveZ: 1, yaw: Math.PI / 2 });
    expect(sim.player.pos.x - start.x).toBeGreaterThan(3);
    stepSim(sim, 0.1, { jump: true, yaw: Math.PI / 2 });
    expect(sim.player.pos.y).toBeGreaterThan(start.y + 0.3);
    stepSim(sim, 1);
    // 真下の地面を見て殴る
    const p = sim.player.pos;
    const below = Math.floor(p.y) - 1;
    const aim = { aimOrigin: { x: p.x, y: p.y + 1.6, z: p.z }, aimDir: { x: 0.001, y: -1, z: 0.001 } };
    const before = sim.destruction.stats.blocks;
    stepSim(sim, 0.05, { ...aim, tool: 0, fire: true, firePressed: true });
    expect(sim.destruction.stats.blocks).toBe(before + 1);
    expect(sim.world.get(Math.floor(p.x), below, Math.floor(p.z))).not.toBe(B.ASPHALT);
    // 建築: 横の地面の上に置く（パンチの間隔が空くのを待つ）
    stepSim(sim, 0.3);
    const tx = Math.floor(p.x) + 2;
    const tz = Math.floor(p.z);
    const ty = sim.world.topSolidY(tx, tz);
    const origin = { x: tx + 0.5, y: ty + 3, z: tz + 0.5 };
    stepSim(sim, 0.05, { aimOrigin: origin, aimDir: { x: 0, y: -1, z: 0 }, tool: OW_TOOLS.findIndex((t) => t.id === 'build'), fire: true, firePressed: true, blockIndex: 0 });
    expect(sim.world.get(tx, ty + 1, tz)).toBe(B.CONCRETE);
  });

  it('車に乗って走り、勢いよく壁を突き破る', () => {
    const sim = new OpenWorldSim(1);
    // 世界の上空に平らな舞台を作り、車を置く
    const w = sim.world;
    const y0 = 40;
    for (let x = 100; x < 160; x++) for (let z = 100; z < 106; z++) w.set(x, y0, z, B.CONCRETE);
    for (let y = y0 + 1; y <= y0 + 3; y++) for (let z = 100; z < 106; z++) w.set(150, y, z, B.BRICK);
    for (let x = 100; x < 160; x++) for (let z = 100; z < 106; z++) for (let y = y0 + 1; y < y0 + 5; y++) if (x !== 150) w.set(x, y, z, B.AIR);
    sim.vehicles.length = 0;
    sim.peds.length = 0;
    const car = sim.addVehicle('car', 104, 103, Math.PI / 2, null);
    car.pos.y = y0 + 1;
    sim.player.pos = { x: 104, y: y0 + 1, z: 101.2 };
    stepSim(sim, 0.05, { interactPressed: true });
    expect(sim.player.vehicle).toBe(car);
    // 柱が無いので、壁を壊すと浮いた部分は落ちる。統計だけ確かめる
    const before = sim.destruction.stats.blocks;
    stepSim(sim, 3.5, { moveZ: 1 });
    expect(car.pos.x).toBeGreaterThan(150);
    expect(sim.destruction.stats.blocks).toBeGreaterThan(before);
    expect(car.hp).toBeLessThan(OW_VEHICLES.car.hp);
    // 降りる
    stepSim(sim, 0.05, { interactPressed: true });
    expect(sim.player.vehicle).toBeNull();
  });

  it('ロケットは壁に当たって爆発し、ブロックを壊す', () => {
    const sim = new OpenWorldSim(1);
    stepSim(sim, 0.3);
    const p = sim.player.pos;
    const dir = viewDir(Math.PI / 2, -0.3);
    const before = sim.destruction.stats.explosions;
    stepSim(sim, 1.5, { aimOrigin: { x: p.x, y: p.y + 1.6, z: p.z }, aimDir: dir, tool: 2, fire: true, firePressed: true, yaw: Math.PI / 2 });
    expect(sim.destruction.stats.explosions).toBeGreaterThan(before);
    expect(sim.destruction.stats.blocks).toBeGreaterThan(5);
  });

  it('街の車は道路の上を走り続ける', () => {
    const sim = new OpenWorldSim(3);
    sim.peds.length = 0;
    stepSim(sim, 20);
    const traffic = sim.vehicles.filter((v) => v.kind === 'car' && !v.wrecked && v.ai);
    expect(traffic.length).toBeGreaterThan(5);
    for (const v of traffic) {
      const under = sim.world.get(Math.floor(v.pos.x), Math.floor(v.pos.y) - 1, Math.floor(v.pos.z));
      expect([B.ASPHALT, B.ROAD_LINE, B.SIDEWALK]).toContain(under);
    }
  });

  it('爆発で車が壊れると、少し遅れて車も爆発する', () => {
    const sim = new OpenWorldSim(1);
    const v = sim.vehicles.find((x) => x.kind === 'car')!;
    sim.destruction.explode({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, 4.5);
    stepSim(sim, 0.02);
    expect(v.wrecked).toBe(true);
    const ex = sim.destruction.stats.explosions;
    stepSim(sim, 1);
    expect(sim.destruction.stats.explosions).toBeGreaterThan(ex);
    expect(sim.stats.wrecks).toBeGreaterThanOrEqual(1);
  });

  it('歩行者は爆発で吹き飛び、しばらくすると起き上がる', () => {
    const sim = new OpenWorldSim(1);
    const ped = sim.peds[0];
    stepSim(sim, 0.5);
    sim.destruction.explode({ x: ped.pos.x + 1, y: ped.pos.y + 0.5, z: ped.pos.z }, 3);
    stepSim(sim, 0.05);
    expect(ped.state).toBe('knocked');
    stepSim(sim, 8);
    expect(ped.state).not.toBe('knocked');
  });
});

describe('オープンワールド: 重さ', () => {
  it('世界の生成と全チャンクの面の生成が十分速い', () => {
    const t0 = performance.now();
    const layout = generateOpenWorld(7);
    const t1 = performance.now();
    const w = layout.world;
    let faces = 0;
    for (let cy = 0; cy < w.chunksY; cy++)
      for (let cz = 0; cz < w.chunksZ; cz++)
        for (let cx = 0; cx < w.chunksX; cx++) {
          const r = meshWorldRegion((x, y, z) => w.get(x, y, z), cx * 16, cy * 16, cz * 16, 16, 16, 16);
          faces += (r.opaque.indices.length + r.translucent.indices.length) / 6;
        }
    const t2 = performance.now();
    console.log(`生成 ${(t1 - t0).toFixed(0)}ms / 面 ${(t2 - t1).toFixed(0)}ms / ${faces} 面`);
    expect(t1 - t0).toBeLessThan(3000);
    expect(t2 - t1).toBeLessThan(8000);
  });
});
