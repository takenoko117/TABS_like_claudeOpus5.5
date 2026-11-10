import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CombatEffectEvent } from '../src/combat/CombatSystem';
import { Battle } from '../src/game/Battle';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { getHayatoHeadGeometry } from '../src/render/HayatoHeadModel';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { Unit } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('ハヤトのモデル', () => {
  function setup(): { unit: Unit; visual: VoxelCharacterVisual; head: any } {
    const unit = new Unit(new PhysicsWorld(), UNIT_TYPES.hayato, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    return { unit, visual, head: (visual as any).hayatoHead };
  }

  it('顔だけのモデルで、胴体や手足のボクセルは表示しない', () => {
    const { visual, head } = setup();
    visual.sync();
    expect(head.visible).toBe(true);
    for (const part of Object.values((visual as any).parts) as any[]) {
      expect(part.mesh.visible).toBe(false);
    }
    visual.dispose();
  });

  it('モーフの差分があるのは顎と、開口時に動く顔のパーツだけで、頭頂は動かない', () => {
    const geometry = getHayatoHeadGeometry();
    const position = geometry.getAttribute('position');
    const delta = geometry.morphAttributes.position![0];
    expect(delta.count).toBe(position.count);
    let chinMoved = 0;
    for (let i = 0; i < position.count; i++) {
      const moved = Math.hypot(delta.getX(i), delta.getY(i), delta.getZ(i));
      if (position.getY(i) > 0.3) expect(moved).toBeLessThan(0.05);
      if (position.getY(i) < -0.35 && position.getZ(i) > 0.15) chinMoved = Math.max(chinMoved, moved);
    }
    expect(chinMoved).toBeGreaterThan(0.2);
  });

  it('攻撃の溜めで口が開き、照射中はレーザーを表示し、終わると閉じる', () => {
    const { unit, visual, head } = setup();
    const beams: any[] = (visual as any).hayatoBeam;
    visual.sync();
    unit.attackPhase = 'none';
    (visual as any).hayatoMouthOpen = 0;
    expect(beams.every((b) => !b.visible)).toBe(true);

    unit.attackPhase = 'windup';
    unit.phaseTime = unit.type.windup;
    for (let i = 0; i < 20; i++) visual.sync();
    expect(head.morphTargetInfluences[0]).toBeGreaterThan(0.9);
    expect(beams.every((b) => !b.visible)).toBe(true);

    unit.attackPhase = 'strike';
    unit.phaseTime = 0;
    visual.sync();
    expect(beams.every((b) => b.visible)).toBe(true);

    unit.attackPhase = 'recover';
    unit.phaseTime = unit.type.recover;
    for (let i = 0; i < 20; i++) visual.sync();
    expect(head.morphTargetInfluences[0]).toBeLessThan(0.05);
    expect(beams.every((b) => !b.visible)).toBe(true);
    visual.dispose();
  });
});

describe('ハヤトの口レーザー', () => {
  it('一直線に並ぶ複数の敵を貫通するが、線から外れた敵と味方には当たらない', () => {
    const battle = new Battle();
    const hayato = battle.spawnUnit('hayato', 0, -8, 0);
    const front = battle.spawnUnit('shielder', 1, 2, 0);
    const behind = battle.spawnUnit('shielder', 1, 5, 0);
    const aside = battle.spawnUnit('shielder', 1, 2, 7);
    const ally = battle.spawnUnit('shielder', 0, 0, 0);
    const hp = [front, behind, aside, ally].map((u) => u.hp);
    const from = new Vector3(-7, 1.2, 0);
    battle.combat.fireMouthLaser(hayato, from, front.chest.pos.clone(), battle.units, [], battle.fixedDt, true);
    expect(front.hp).toBeLessThan(hp[0]);
    expect(behind.hp).toBeLessThan(hp[1]);
    expect(aside.hp).toBe(hp[2]);
    expect(ally.hp).toBe(hp[3]);
  });

  it('AI が口の高さからレーザーを発射し、照射中に繰り返しダメージを与える', () => {
    const battle = new Battle();
    const hayato = battle.spawnUnit('hayato', 0, -8, 0);
    const dummy = battle.spawnUnit('giant', 1, 4, 0);
    dummy.hp = 1e7;
    let initial = 0;
    let ticks = 0;
    let fromY = 0;
    battle.combat.onEffect = (e: CombatEffectEvent) => {
      if (e.kind !== 'mouth_laser') return;
      fromY = e.from.y;
      if (e.isInitial) initial++;
      else ticks++;
    };
    battle.aiEnabled = true;
    for (let i = 0; i < 120 * 6 && initial === 0; i++) battle.step(battle.fixedDt);
    expect(initial).toBe(1);
    expect(fromY).toBeLessThan(hayato.pelvis.pos.y + 0.2);
    for (let i = 0; i < 120; i++) battle.step(battle.fixedDt);
    expect(ticks).toBeGreaterThan(6);
    expect(dummy.hp).toBeLessThan(1e7);
  });
});
