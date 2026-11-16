import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Battle } from '../src/game/Battle';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { FLYING_UNIT_IDS } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';
import { GREAT_SWORD_DEFLECT_CHANCE, SAUCE_SLOW_MUL } from '../src/combat/CosmicSkills';

function stepBattle(battle: Battle, seconds: number): void {
  const steps = Math.round(seconds / battle.fixedDt);
  for (let i = 0; i < steps; i++) {
    battle.step(battle.fixedDt);
  }
}

describe('新規ユニット8体（第8弾）', () => {
  it('8体とも定義があり、ボクセルモデルを作れる', () => {
    const ids = ['giant_octopus', 'whale_squid', 'takoyaki', 'the_earth', 'the_universe', 'ovidia', 'great_swordsman', 'ufo'] as const;
    const battle = new Battle();
    for (const id of ids) {
      expect(UNIT_TYPES[id].name.length).toBeGreaterThan(0);
      const u = battle.spawnUnit(id, 0, 0, 0);
      expect(() => new VoxelCharacterVisual(u)).not.toThrow();
    }
  });

  it('大タコ: 八本の足で周りの複数の敵を同時に叩く', () => {
    const battle = new Battle();
    battle.spawnUnit('giant_octopus', 0, 0, 0);
    const enemies = [
      battle.spawnUnit('swordsman', 1, 2.5, 0),
      battle.spawnUnit('swordsman', 1, -2.5, 0),
      battle.spawnUnit('swordsman', 1, 0, 2.5),
      battle.spawnUnit('swordsman', 1, 0, -2.5),
    ];
    battle.aiEnabled = true;
    stepBattle(battle, 3);
    const hurt = enemies.filter((e) => e.hp < e.maxHp).length;
    expect(hurt).toBeGreaterThanOrEqual(3);
  });

  it('マッコウクジラ＆ダイオウイカ: 空を泳ぎ、ソナーで一直線上の敵を麻痺させる', () => {
    expect(FLYING_UNIT_IDS.has('whale_squid')).toBe(true);
    const battle = new Battle();
    battle.spawnUnit('whale_squid', 0, -6, 0);
    const near = battle.spawnUnit('giant', 1, 2, 0);
    const far = battle.spawnUnit('giant', 1, 5, 0);
    battle.aiEnabled = true;
    let sawStun = false;
    const steps = Math.round(4 / battle.fixedDt);
    for (let i = 0; i < steps; i++) {
      battle.step(battle.fixedDt);
      if (near.shockTimer > 0 || far.shockTimer > 0) sawStun = true;
    }
    expect(sawStun).toBe(true);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBeLessThan(far.maxHp);
  });

  it('たこ焼き: 投げたたこ焼きが遅れて着弾し、敵をやけどさせる', () => {
    const battle = new Battle();
    battle.spawnUnit('takoyaki', 0, -5, 0);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    battle.aiEnabled = true;
    let sawBurn = false;
    const steps = Math.round(4 / battle.fixedDt);
    for (let i = 0; i < steps; i++) {
      battle.step(battle.fixedDt);
      if (enemy.burnTimer > 0) sawBurn = true;
    }
    expect(sawBurn).toBe(true);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('ザ・アース: 浮かぶ地球が重力で敵を引き寄せ、地殻変動でダメージを与える', () => {
    expect(FLYING_UNIT_IDS.has('the_earth')).toBe(true);
    const battle = new Battle();
    const earth = battle.spawnUnit('the_earth', 0, -6, 0);
    const enemy = battle.spawnUnit('giant', 1, 3, 0);
    battle.aiEnabled = true;
    stepBattle(battle, 4);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(earth.alive).toBe(true);
  });

  it('ザ・ユニバース: ビッグバンと流星群で離れた複数の敵を攻撃する。最も高価なユニット', () => {
    const maxOther = Math.max(...Object.values(UNIT_TYPES).filter((t) => t.id !== 'the_universe').map((t) => t.cost));
    expect(UNIT_TYPES.the_universe.cost).toBeGreaterThan(maxOther);
    const battle = new Battle();
    battle.spawnUnit('the_universe', 0, -6, 0);
    const e1 = battle.spawnUnit('giant', 1, 6, -4);
    const e2 = battle.spawnUnit('giant', 1, 6, 4);
    battle.aiEnabled = true;
    stepBattle(battle, 5);
    expect(e1.hp).toBeLessThan(e1.maxHp);
    expect(e2.hp).toBeLessThan(e2.maxHp);
  });

  it('〇VIDIA: 並列演算ビームで離れた複数の敵を同時に撃ち抜く', () => {
    const battle = new Battle();
    battle.spawnUnit('ovidia', 0, -6, 0);
    const enemies = [battle.spawnUnit('giant', 1, 4, -3), battle.spawnUnit('giant', 1, 4, 0), battle.spawnUnit('giant', 1, 4, 3)];
    battle.aiEnabled = true;
    stepBattle(battle, 3);
    for (const e of enemies) expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('大剣士: 大きな剣を持ち、飛んでくる矢を確率ではじく', () => {
    expect(UNIT_TYPES.great_swordsman.weapon?.length).toBeGreaterThan(UNIT_TYPES.swordsman.weapon!.length * 1.5);
    expect(GREAT_SWORD_DEFLECT_CHANCE).toBeGreaterThan(0);
    const battle = new Battle();
    const sw = battle.spawnUnit('great_swordsman', 0, 0, 0);
    const archer = battle.spawnUnit('archer', 1, 8, 0);
    // 矢を何本も撃ち込み、一部がはじかれる（＝本体に届いた本数より撃った本数が多い）
    let parried = 0;
    battle.combat.onEffect = (e) => {
      if (e.kind === 'sword_parry') parried++;
    };
    for (let i = 0; i < 30; i++) {
      const from = sw.chest.pos.clone().add(new Vector3(3, 0, 0));
      battle.combat.fireArrow(archer, from, new Vector3(-30, 0, 0));
      stepBattle(battle, 0.25);
      if (!sw.alive) break;
    }
    expect(parried).toBeGreaterThan(0);
  });

  it('UFO: 空を飛び、焼きそばでソースまみれ（鈍足）にする', () => {
    expect(FLYING_UNIT_IDS.has('ufo')).toBe(true);
    expect(SAUCE_SLOW_MUL).toBeLessThan(1);
    const battle = new Battle();
    const ufo = battle.spawnUnit('ufo', 0, -5, 0);
    const enemy = battle.spawnUnit('giant', 1, 2, 0);
    battle.aiEnabled = true;
    let sawSauce = false;
    let maxY = 0;
    const steps = Math.round(5 / battle.fixedDt);
    for (let i = 0; i < steps; i++) {
      battle.step(battle.fixedDt);
      if (enemy.sauceTimer > 0) sawSauce = true;
      maxY = Math.max(maxY, ufo.pelvis.pos.y);
    }
    expect(maxY).toBeGreaterThan(2.0);
    expect(sawSauce).toBe(true);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});
