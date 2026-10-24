import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ARCADE_STAGES,
  computeStageStars,
  createInitialArcadeSave,
  getStageEnemyCost,
  isInsideStageRedZone,
  isUnitUnlocked,
  recordStageClear,
} from '../src/game/ArcadeStages';
import { Battle } from '../src/game/Battle';
import { DistanceConstraint } from '../src/physics/Constraint';
import { Particle } from '../src/physics/Particle';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VoxelCharacterVisual, VoxelGrid } from '../src/render/VoxelModel';
import { J, PELVIS_HEIGHT } from '../src/units/Skeleton';
import { UNIT_TYPE_LIST, type UnitTypeId } from '../src/units/UnitTypes';

/** 指定秒数だけシミュレーションを進める */
function simulate(battle: Battle, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) {
    battle.step(battle.fixedDt);
    if (until?.()) return;
  }
}

describe('物理エンジン', () => {
  it('粒子が落下して地面で静止する', () => {
    const world = new PhysicsWorld();
    const p = world.addParticle(new Particle(new Vector3(0, 3, 0), { radius: 0.1 }));
    for (let i = 0; i < 600; i++) world.step(1 / 120);
    expect(p.pos.y).toBeCloseTo(0.1, 3);
    expect(p.grounded).toBe(true);
  });

  it('距離拘束が維持される', () => {
    const world = new PhysicsWorld();
    const a = world.addParticle(new Particle(new Vector3(0, 2, 0)));
    const b = world.addParticle(new Particle(new Vector3(1, 2, 0)));
    world.addConstraint(new DistanceConstraint(a, b, 1));
    a.addVelocity(new Vector3(0, 5, 3), 1 / 120);
    for (let i = 0; i < 240; i++) world.step(1 / 120);
    expect(a.pos.distanceTo(b.pos)).toBeCloseTo(1, 2);
  });

  it('異なるボディの粒子同士は重ならない', () => {
    const world = new PhysicsWorld();
    const a = world.addParticle(new Particle(new Vector3(0, 0.2, 0), { radius: 0.2, bodyId: 1 }));
    const b = world.addParticle(new Particle(new Vector3(0.1, 0.2, 0), { radius: 0.2, bodyId: 2 }));
    for (let i = 0; i < 60; i++) world.step(1 / 120);
    expect(a.pos.distanceTo(b.pos)).toBeGreaterThan(0.39);
  });
});

describe('ユニット', () => {
  const types: UnitTypeId[] = ['clubber', 'swordsman', 'spearman', 'archer', 'giant'];
  for (const id of types) {
    it(`${id} が待機状態で直立を維持する`, () => {
      const battle = new Battle();
      const u = battle.spawnUnit(id, 0, 0, 0);
      simulate(battle, 4);
      const H = PELVIS_HEIGHT * u.scale;
      expect(u.pelvis.pos.y).toBeGreaterThan(H * 0.85);
      expect(u.pelvis.pos.y).toBeLessThan(H * 1.15);
      expect(u.head.pos.y - u.pelvis.pos.y).toBeGreaterThan(0.6 * u.scale);
      // その場から大きく流れていない
      expect(Math.hypot(u.pelvis.pos.x, u.pelvis.pos.z)).toBeLessThan(0.5 * u.scale);
      // 足が地面付近にある
      expect(u.joints[J.FootL].pos.y).toBeLessThan(0.2 * u.scale);
    });
  }

  it('目標に向かって歩いて移動できる', () => {
    const battle = new Battle();
    const red = battle.spawnUnit('swordsman', 0, -10, 0);
    battle.spawnUnit('swordsman', 1, 10, 0);
    battle.aiEnabled = true;
    simulate(battle, 3);
    // 3 秒で 4m 以上前進し、転倒していない
    expect(red.pelvis.pos.x).toBeGreaterThan(-6);
    expect(red.head.pos.y - red.pelvis.pos.y).toBeGreaterThan(0.5);
  });

  it('ノックバックで倒れても起き上がる', () => {
    const battle = new Battle();
    const u = battle.spawnUnit('clubber', 0, 0, 0);
    simulate(battle, 1);
    u.takeDamage(1, u.head, new Vector3(6, 2, 0), battle.fixedDt);
    simulate(battle, 5);
    expect(u.alive).toBe(true);
    expect(u.head.pos.y - u.pelvis.pos.y).toBeGreaterThan(0.5);
  });
});

describe('戦闘', () => {
  it('近接戦で決着がつく', () => {
    const battle = new Battle();
    for (let i = 0; i < 3; i++) {
      battle.spawnUnit('swordsman', 0, -4, (i - 1) * 1.5);
      battle.spawnUnit('clubber', 1, 4, (i - 1) * 1.5);
    }
    let hits = 0;
    battle.combat.onHit = () => hits++;
    battle.aiEnabled = true;
    simulate(battle, 90, () => battle.result() !== null);
    expect(hits).toBeGreaterThan(0);
    expect(battle.result()).not.toBeNull();
  });

  it('弓兵の矢が敵に命中する', () => {
    const battle = new Battle();
    battle.spawnUnit('archer', 0, -10, 0);
    const target = battle.spawnUnit('giant', 1, 10, 0);
    let arrowHits = 0;
    battle.combat.onHit = (e) => {
      if (e.kind === 'arrow') arrowHits++;
    };
    battle.aiEnabled = true;
    simulate(battle, 8);
    expect(arrowHits).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('各兵種が混在する大規模戦でも数値が発散しない', () => {
    const battle = new Battle();
    const types: UnitTypeId[] = ['clubber', 'swordsman', 'spearman', 'archer', 'giant'];
    for (let i = 0; i < 30; i++) {
      const t = types[i % types.length];
      battle.spawnUnit(t, (i % 2) as 0 | 1, (i % 2 === 0 ? -1 : 1) * (5 + (i % 3) * 2), ((i % 10) - 5) * 1.6);
    }
    battle.aiEnabled = true;
    simulate(battle, 20);
    for (const p of battle.world.particles) {
      expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true);
      expect(p.pos.y).toBeGreaterThan(-0.01);
      expect(p.pos.y).toBeLessThan(30);
    }
  });
});

describe('ボクセルモデル', () => {
  it('隣接ボクセルの隠れ面をカリングしてジオメトリを生成する', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.set(1, 1, 1, 0xff0000);
    const single = grid.toGeometry(0.1);
    // 1 ボクセル = 6 面 × 4 頂点 = 24 頂点
    expect(single.getAttribute('position').count).toBe(24);

    // 隣にもう 1 ボクセル置くと共有する 2 面が消え、10 面 × 4 頂点 = 40 頂点になる
    grid.set(2, 1, 1, 0x00ff00);
    const pair = grid.toGeometry(0.1);
    expect(pair.getAttribute('position').count).toBe(40);
  });

  it('全兵種のボクセルキャラクターを生成し、物理姿勢に同期できる', () => {
    const battle = new Battle();
    const visuals: VoxelCharacterVisual[] = [];
    UNIT_TYPE_LIST.forEach((ut, i) => {
      const u = battle.spawnUnit(ut.id, (i % 2) as 0 | 1, (i - 7) * 1.5, 0);
      visuals.push(new VoxelCharacterVisual(u));
    });
    battle.aiEnabled = true;
    simulate(battle, 1);
    for (const v of visuals) {
      v.sync();
      expect(v.group.children.length).toBeGreaterThanOrEqual(10);
      v.dispose();
    }
  });

  it('被弾時にボクセルの欠損・部位破壊が発生し、不透明ボクセルがドロップされる', () => {
    const battle = new Battle();
    const u = battle.spawnUnit('swordsman', 0, 0, 0);
    const vis = new VoxelCharacterVisual(u);
    vis.sync();

    // 1 回目の被弾: 頭部のボクセルが一部削れてドロップする
    const res1 = vis.applyHitDamage(u.head, u.head.pos.clone(), 20, false);
    expect(res1.drops.length).toBeGreaterThan(0);

    // 2 回目の強打: 頭部の耐久値が尽きて部位破壊が発生し、大量のボクセルがドロップする
    const res2 = vis.applyHitDamage(u.head, u.head.pos.clone(), 50, true);
    expect(res2.partBroken).toBe(true);
    expect(res2.drops.length).toBeGreaterThan(10);
    vis.dispose();
  });
});

describe('新ユニット10体の固有ギミック検証', () => {
  it('雷導師 (archmage) が連鎖雷撃を放ち、複数の敵を感電麻痺させる', () => {
    const battle = new Battle();
    battle.spawnUnit('archmage', 0, -6, 0);
    const e1 = battle.spawnUnit('clubber', 1, 4, -0.8);
    const e2 = battle.spawnUnit('clubber', 1, 4, 0.8);
    let lightningCount = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'lightning') lightningCount++;
    };
    battle.aiEnabled = true;
    simulate(battle, 3);
    expect(lightningCount).toBeGreaterThan(0);
    expect(e1.hp).toBeLessThan(e1.maxHp);
    expect(e2.hp).toBeLessThan(e2.maxHp);
  });

  it('重力術師 (gravimancer) がブラックホール球を放ち、吸引後に重力爆縮を起こす', () => {
    const battle = new Battle();
    battle.spawnUnit('gravimancer', 0, -6, 0);
    const e1 = battle.spawnUnit('swordsman', 1, 4, 0);
    let blasts = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'gravity_blast') blasts++;
    };
    battle.aiEnabled = true;
    simulate(battle, 5);
    expect(blasts).toBeGreaterThan(0);
    expect(e1.hp).toBeLessThan(e1.maxHp);
  });

  it('対物スナイパー (sniper) がレーザー照準を行い、複数の敵を直線貫通する', () => {
    const battle = new Battle();
    const sniper = battle.spawnUnit('sniper', 0, -14, 0);
    const e1 = battle.spawnUnit('swordsman', 1, 4, 0);
    const e2 = battle.spawnUnit('swordsman', 1, 6.5, 0);
    battle.aiEnabled = true;
    simulate(battle, 1.0);
    expect(sniper.laserActive).toBe(true);
    simulate(battle, 2.0);
    expect(e1.hp).toBeLessThan(e1.maxHp);
    expect(e2.hp).toBeLessThan(e2.maxHp);
  });

  it('ガトリング重装兵 (minigunner) が高速連射を行い、反動で少しずつ後退する', () => {
    const battle = new Battle();
    const mg = battle.spawnUnit('minigunner', 0, -5, 0);
    battle.spawnUnit('giant', 1, 5, 0);
    const startX = mg.pelvis.pos.x;
    let shots = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'minigun_shot') shots++;
    };
    battle.aiEnabled = true;
    simulate(battle, 3.0);
    expect(shots).toBeGreaterThan(10);
    expect(mg.pelvis.pos.x).toBeLessThan(startX);
  });

  it('居合の剣豪 (samurai) が敵の背後へすり抜けダッシュし、時間差斬撃を与える', () => {
    const battle = new Battle();
    const sam = battle.spawnUnit('samurai', 0, -2.2, 0);
    const victim = battle.spawnUnit('swordsman', 1, 2.0, 0);
    let dashed = false;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'iaido_dash') dashed = true;
    };
    battle.aiEnabled = true;
    simulate(battle, 2.5);
    expect(dashed).toBe(true);
    expect(sam.pelvis.pos.x).toBeGreaterThan(0);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('からくり忍者 (ninja) が手裏剣3連投を行い、被弾時に変わり身の術で回避する', () => {
    const battle = new Battle();
    const ninja = battle.spawnUnit('ninja', 0, -4, 0);
    const enemy = battle.spawnUnit('swordsman', 1, 4, 0);
    let kawariCount = 0;
    let shurikenCount = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'ninja_kawari') kawariCount++;
      if (ev.kind === 'shuriken_throw') shurikenCount++;
    };
    battle.aiEnabled = true;
    simulate(battle, 1.5);
    expect(shurikenCount).toBeGreaterThan(0);

    // 被弾による変わり身発動を確認
    const prevHp = ninja.hp;
    ninja.takeDamage(30, ninja.chest, new Vector3(-3, 1, 0), battle.fixedDt, enemy);
    expect(kawariCount).toBe(1);
    expect(ninja.hp).toBe(prevHp);
  });

  it('鎧戦象 (warelephant) と大鷲 (giant_eagle) と紅蓮ドラゴン (dragon) が正しく稼働する', () => {
    const battle = new Battle();
    const eagle = battle.spawnUnit('giant_eagle', 0, -6, -3);
    const dragon = battle.spawnUnit('dragon', 0, -6, 3);
    const elephant = battle.spawnUnit('warelephant', 1, 6, 0);
    battle.spawnUnit('clubber', 1, 2, 3);
    battle.aiEnabled = true;
    simulate(battle, 4.0);
    // 大鷲が空中に浮いている
    expect(eagle.pelvis.pos.y).toBeGreaterThan(2.0);
    // ドラゴンの火炎ブレスで延焼またはダメージが発生している
    expect(elephant.hp).toBeLessThan(elephant.maxHp);
    expect(dragon.alive).toBe(true);
  });

  it('分裂キングスライム (slime) が撃破時に小型スライム2体へ分裂増殖する', () => {
    const battle = new Battle();
    const king = battle.spawnUnit('slime', 0, -3, 0);
    const attacker = battle.spawnUnit('giant', 1, 3, 0);
    battle.aiEnabled = true;
    // キングスライムに致死ダメージを与える
    king.takeDamage(999, king.chest, new Vector3(-2, 2, 0), battle.fixedDt, attacker);
    expect(king.alive).toBe(false);
    const children = battle.units.filter((u) => u.type.id === 'slime' && u.alive && u.splitGen === 1);
    expect(children.length).toBe(2);
  });
});

describe('アーケードモード追加ユニット（盾兵・突撃兵・爆弾兵）と地形ギミック', () => {
  it('盾兵 (shielder) が正面からの矢を大盾でガードしダメージを90%軽減する', () => {
    const battle = new Battle();
    const shielder = battle.spawnUnit('shielder', 0, -5, 0);
    battle.spawnUnit('archer', 1, 5, 0);
    let blockEvents = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'shield_block') blockEvents++;
    };
    battle.aiEnabled = true;
    simulate(battle, 3.0);
    expect(blockEvents).toBeGreaterThan(0);
    // 通常の弓矢ダメージ(22)に対して大幅に軽減されている
    expect(shielder.hp).toBeGreaterThan(shielder.maxHp - 10);
  });

  it('突撃兵 (charger) が跳躍チャージを発動し、爆弾兵 (bomber) が範囲爆撃を行う', () => {
    const battle = new Battle();
    battle.spawnUnit('charger', 0, -3.5, -2);
    battle.spawnUnit('bomber', 0, -8, 2);
    const e1 = battle.spawnUnit('swordsman', 1, 1.0, -2);
    const e2 = battle.spawnUnit('clubber', 1, 4.0, 2);
    let chargeLeaps = 0;
    let explosions = 0;
    battle.combat.onEffect = (ev) => {
      if (ev.kind === 'charge_leap') chargeLeaps++;
      if (ev.kind === 'bomb_explosion') explosions++;
    };
    battle.aiEnabled = true;
    simulate(battle, 4.0);
    expect(chargeLeaps).toBeGreaterThan(0);
    expect(explosions).toBeGreaterThan(0);
    expect(e1.hp < e1.maxHp || e2.hp < e2.maxHp).toBe(true);
  });

  it('一本橋ステージの奈落 (chasm) に落ちたユニットが落下死し、石柱 (obstacles) が飛翔体を遮る', () => {
    const battle = new Battle();
    battle.world.chasm = { minX: -4, maxX: 4, bridgeHalfWidth: 3.0 };
    battle.world.obstacles = [{ x: 0, z: 0, radius: 1.2, height: 4.0 }];

    // 奈落の真上 (x=0, z=6) にスポーンした地上ユニットは落下して死亡する
    const victim = battle.spawnUnit('clubber', 1, 0, 6);
    // 石柱を挟んで弓兵とターゲットを配置すると石柱が矢をブロックする
    battle.spawnUnit('archer', 0, -8, 0);
    const behindPillar = battle.spawnUnit('giant', 1, 8, 0);

    battle.aiEnabled = true;
    simulate(battle, 2.5);
    expect(victim.alive).toBe(false);
    expect(behindPillar.hp).toBe(behindPillar.maxHp);
  });

  it('アーケードモード全10ステージの定義・予算・スター評価・兵種アンロックが正しく機能する', () => {
    expect(ARCADE_STAGES.length).toBe(10);
    for (const st of ARCADE_STAGES) {
      expect(st.enemies.length).toBeGreaterThan(0);
      // すべての面で敵総コスト > プレイヤー予算（戦術パズル性）になっていることを確認
      expect(getStageEnemyCost(st)).toBeGreaterThan(st.budget);
      expect(st.star2Budget).toBeLessThanOrEqual(st.budget);
      expect(st.star3Budget).toBeLessThanOrEqual(st.star2Budget);
    }

    // 第8面の側面奇襲エリアが配置可能ゾーンとして判定される
    const stage8 = ARCADE_STAGES[7];
    expect(isInsideStageRedZone(stage8, -10, 0)).toBe(true);
    expect(isInsideStageRedZone(stage8, 10, -12)).toBe(true); // 北側の奇襲ゾーン
    expect(isInsideStageRedZone(stage8, 10, 0)).toBe(false); // 敵本陣のど真ん中は不可

    // クリアによる段階的ユニット解放とスター評価の検証
    const save = createInitialArcadeSave();
    expect(isUnitUnlocked(save, 'clubber')).toBe(true);
    expect(isUnitUnlocked(save, 'shielder')).toBe(false);

    const stars = computeStageStars(ARCADE_STAGES[0], 180, 0.8);
    expect(stars).toBe(3);
    const unlocked = recordStageClear(save, ARCADE_STAGES[0], stars);
    expect(unlocked).toContain('shielder');
    expect(isUnitUnlocked(save, 'shielder')).toBe(true);
    expect(save.clearedStars[1]).toBe(3);
  });
});


