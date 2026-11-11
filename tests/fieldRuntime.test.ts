import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/Battle';
import { SEG_GONE, SEG_INTACT } from '../src/field/FieldRuntime';
import {
  FIELD_COLS,
  FIELD_ROWS,
  WATER,
  cellAt,
  type FieldLayout,
  type PropKind,
} from '../src/field/FieldTypes';
import { generateField } from '../src/field/FieldGenerator';

const N = FIELD_COLS * FIELD_ROWS;

function emptyLayout(props: { kind: PropKind; x: number; z: number }[] = []): FieldLayout {
  return {
    seed: 1,
    biome: 'plains',
    trait: null,
    ground: new Uint8Array(N),
    water: new Uint8Array(N),
    body: new Int16Array(N).fill(-1),
    flowX: new Float32Array(N),
    flowZ: new Float32Array(N),
    bodies: [],
    props: props.map((p, i) => ({ id: i, kind: p.kind, x: p.x, z: p.z, rot: 0, seed: 100 + i })),
    pits: [],
    waterfalls: [],
    vents: [],
    attempts: 1,
    fallback: false,
  };
}

function run(battle: Battle, seconds: number): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) battle.step(battle.fixedDt);
}

describe('戦闘中のフィールド', () => {
  it('幹を壊すと葉が倒れ、着地で消える', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'tree_small', x: 0, z: 0 }]))!;
    battle.aiEnabled = true;
    expect(field.segments).toHaveLength(2);
    field.damageSegment(0, 1000, 1, 0);
    expect(field.segments[0].state).toBe(SEG_GONE);
    expect(field.segments[1].state).not.toBe(SEG_INTACT);
    expect(field.clusters).toHaveLength(1);
    run(battle, 1.2);
    expect(field.clusters).toHaveLength(0);
    expect(field.segments[1].state).toBe(SEG_GONE);
    expect(field.events.some((e) => e.kind === 'collapse')).toBe(true);
  });

  it('耐久力が半分を切るとボクセルが欠ける', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'rock_mid', x: 0, z: 0 }]))!;
    const before = field.vhidden.reduce((a, b) => a + b, 0);
    field.damageSegment(0, 250);
    expect(field.segments[0].chipped).toBe(true);
    expect(field.vhidden.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    expect(field.segments[0].state).toBe(SEG_INTACT);
  });

  it('地物の箱がユニットを通さない', () => {
    const battle = new Battle();
    battle.configureStage({});
    battle.setField(emptyLayout([{ kind: 'wall_stone', x: 0, z: 0 }]));
    const u = battle.spawnUnit('decoy', 0, 0, 3);
    // 壁に向かって投げる
    for (const p of u.joints) p.addVelocity(new Vector3(0, 0, -12), battle.fixedDt);
    run(battle, 1);
    expect(Math.abs(u.pelvis.pos.z)).toBeGreaterThan(0.6);
  });

  it('爆発樽は誘爆して両軍にダメージを与える', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'barrel_explosive', x: 0, z: 0 }]))!;
    battle.aiEnabled = true;
    const a = battle.spawnUnit('swordsman', 0, -1.5, 0);
    const b = battle.spawnUnit('swordsman', 1, 1.5, 0);
    const ha = a.hp;
    const hb = b.hp;
    field.damageSegment(0, 100);
    run(battle, 0.3);
    expect(a.hp).toBeLessThan(ha);
    expect(b.hp).toBeLessThan(hb);
  });

  it('深い川の流れでユニットが流される', () => {
    const battle = new Battle();
    battle.configureStage({});
    const layout = emptyLayout();
    layout.bodies.push({ id: 0, kind: 'river', flowSpeed: 3 });
    for (let k = 0; k < N; k++) {
      layout.water[k] = WATER.deep;
      layout.body[k] = 0;
      layout.flowZ[k] = 1;
    }
    battle.setField(layout);
    battle.aiEnabled = true;
    const u = battle.spawnUnit('decoy', 0, 0, -5);
    run(battle, 1.5);
    expect(u.pelvis.pos.z).toBeGreaterThan(-3);
  });

  it('リセットで地物が元に戻る', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'tree_small', x: 0, z: 0 }]))!;
    field.damageSegment(0, 1000);
    battle.clear();
    expect(field.segments.every((s) => s.state === SEG_INTACT && s.box.active)).toBe(true);
    expect(field.vhidden.every((v) => v === 0)).toBe(true);
  });

  it('延焼する区画の数には上限がある', () => {
    const battle = new Battle();
    battle.configureStage({});
    const props: { kind: PropKind; x: number; z: number }[] = [];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) props.push({ kind: 'bush', x: -14 + i * 2, z: -14 + j * 2 });
    const field = battle.setField({ ...emptyLayout(props), trait: 'dry' })!;
    battle.aiEnabled = true;
    field.igniteNear(new Vector3(-14, 0.5, -14), 30, 1);
    const burning = () => field.segments.filter((s) => s.burning > 0).length;
    expect(burning()).toBeLessThanOrEqual(40);
    run(battle, 2);
    expect(burning()).toBeLessThanOrEqual(40);
  });

  it('射線の判定で地物に当たる', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'wall_stone', x: 0, z: 0 }]))!;
    const hit = field.raycast(new Vector3(0, 1, 5), new Vector3(0, 1, -5));
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0.3);
    expect(hit!.t).toBeLessThan(0.5);
    expect(field.raycast(new Vector3(10, 1, 5), new Vector3(10, 1, -5))).toBeNull();
  });

  it('生成位置が地物に重なれば空いたマスへずらす', () => {
    const battle = new Battle();
    battle.configureStage({});
    const field = battle.setField(emptyLayout([{ kind: 'rock_mid', x: 10, z: 0 }]))!;
    const spot = field.findFreeSpot(10, 0, 1);
    expect(spot).not.toBeNull();
    expect(field.blocked[cellAt(spot!.x, spot!.z)]).toBe(0);
    expect(spot!.x).toBeGreaterThan(0);
    expect(field.findFreeSpot(-15, 10, 0)).toBeNull();
  });

  it('生成したフィールドで戦闘を進めても壊れない', () => {
    for (const biome of ['town', 'forest', 'volcano', 'snow', 'castle'] as const) {
      const battle = new Battle();
      battle.configureStage({});
      battle.setField(generateField({ seed: 4242, biome, trait: null }));
      battle.spawnUnit('swordsman', 0, -12, 0);
      battle.spawnUnit('archer', 0, -14, 4);
      battle.spawnUnit('swordsman', 1, 12, 0);
      battle.spawnUnit('archer', 1, 14, -4);
      battle.aiEnabled = true;
      run(battle, 4);
      for (const u of battle.units) expect(Number.isFinite(u.pelvis.pos.x), biome).toBe(true);
    }
  });
});

describe('ローグライトの進路', () => {
  it('進路の選択は保存・再開で引き継がれ、フィールドが再現できる', async () => {
    const { RogueliteRun } = await import('../src/game/RogueliteMode');
    const run = new RogueliteRun(12345);
    expect(run.needsRouteChoice).toBe(false); // R1 は平原固定
    expect(run.currentField().biome).toBe('plains');
    run.round = 3;
    expect(run.needsRouteChoice).toBe(true);
    run.chooseRoute(1);
    expect(run.needsRouteChoice).toBe(false);
    const picked = run.currentField();
    const resumed = RogueliteRun.fromState(JSON.parse(JSON.stringify(run.toState())));
    expect(resumed.currentField()).toEqual(picked);
    const a = generateField(picked);
    const b = generateField(resumed.currentField());
    expect(a.props).toEqual(b.props);
    run.round = 5; // エリートは選ばない
    expect(run.needsRouteChoice).toBe(false);
    expect(run.currentField().biome).toBe('pass');
  });
});
