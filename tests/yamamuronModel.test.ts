import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { Unit } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */
function vertexCount(mesh: any): number {
  return mesh.geometry.getAttribute('position').count;
}

describe('ヤマムロンの強化形態モデル', () => {
  function setup(): { unit: Unit; visual: VoxelCharacterVisual; parts: any } {
    const unit = new Unit(new PhysicsWorld(), UNIT_TYPES.yamamuron, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    return { unit, visual, parts: (visual as any).parts };
  }

  it('強化モードに入ると胴体と頭がより精細なモデルに変身し、解除されると元に戻る', () => {
    const { unit, visual, parts } = setup();
    const baseTorso = parts.torso.mesh.geometry;
    const baseHead = parts.head.mesh.geometry;

    unit.yamamuronEnraged = true;
    visual.sync();
    expect(parts.torso.mesh.geometry).not.toBe(baseTorso);
    expect(parts.head.mesh.geometry).not.toBe(baseHead);
    expect(vertexCount(parts.torso.mesh)).toBeGreaterThan(baseTorso.getAttribute('position').count * 3);

    unit.yamamuronEnraged = false;
    visual.sync();
    expect(parts.torso.mesh.geometry).toBe(baseTorso);
    expect(parts.head.mesh.geometry).toBe(baseHead);
    visual.dispose();
  });

  it('変身すると破壊されていた頭も修復され、強化形態は被弾で再構築されない', () => {
    const { unit, visual, parts } = setup();
    parts.head.destroyed = true;
    parts.head.mesh.visible = false;

    unit.yamamuronEnraged = true;
    visual.sync();
    expect(parts.head.destroyed).toBe(false);
    expect(parts.head.mesh.visible).toBe(true);

    const geometry = parts.torso.mesh.geometry;
    const carved = (visual as any).carveVoxelsAt(parts.torso, unit.chest.pos, 3, []);
    expect(carved).toBe(0);
    expect(parts.torso.mesh.geometry).toBe(geometry);
    visual.dispose();
  });
});
