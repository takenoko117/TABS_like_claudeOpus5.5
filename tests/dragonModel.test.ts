import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { Unit } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';

describe('Dragon Voxel Model Quality & Structure', () => {
  it('西洋ドラゴンのモデルが大角の頭部・水平な胴体・S字の首・尾・大きな皮膜翼を備えている', () => {
    const world = new PhysicsWorld();
    const unit = new Unit(world, UNIT_TYPES.dragon, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    const anyVisual = visual as any;

    // 彫刻的に作り込まれた頭部と胴体（旧モデルより大幅に高密度）
    const headMesh = anyVisual.parts.head.mesh;
    const torsoMesh = anyVisual.parts.torso.mesh;
    expect(headMesh.geometry.getAttribute('position').count).toBeGreaterThan(3000);
    expect(torsoMesh.geometry.getAttribute('position').count).toBeGreaterThan(3000);

    // 胴体は腰で前半身（部位破壊対象）と後半身（装飾）の 2 パーツに分かれ、合わせると前後に長い
    const rearMesh = anyVisual.dragonRear;
    expect(rearMesh).not.toBeNull();
    torsoMesh.geometry.computeBoundingBox();
    rearMesh.geometry.computeBoundingBox();
    const fb = torsoMesh.geometry.boundingBox!;
    const rb = rearMesh.geometry.boundingBox!;
    expect(fb.min.z).toBeGreaterThan(rb.min.z); // 前半身は後半身より前方
    expect(fb.max.z - rb.min.z).toBeGreaterThan((fb.max.x - fb.min.x) * 1.5);

    // 前脚 2 本・首の節・尾の節・尾先の装飾メッシュ
    expect(anyVisual.dragonForelegs.length).toBe(2);
    expect(anyVisual.dragonNeck.length).toBe(5);
    expect(anyVisual.dragonTail.length).toBe(7);
    expect(anyVisual.dragonTailTip).not.toBeNull();

    visual.sync();
    visual.group.updateMatrixWorld(true);

    // 翼を広げた全幅は 3.5m 以上（迫力のあるシルエット）
    const box = new Box3().setFromObject(visual.group);
    const size = box.getSize(new Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(3.5);

    // 頭は胴体（骨盤）より前方かつ高い位置にあり、尾先は後方にある
    const fwd = unit.forward.clone().setY(0).normalize();
    const pelvis = unit.pelvis.pos;
    const headPos = headMesh.getWorldPosition(new Vector3());
    const tipPos = anyVisual.dragonTailTip.getWorldPosition(new Vector3());
    expect(headPos.clone().sub(pelvis).dot(fwd)).toBeGreaterThan(0.2);
    expect(headPos.y).toBeGreaterThan(pelvis.y + 0.8);
    expect(tipPos.clone().sub(pelvis).dot(fwd)).toBeLessThan(-1.5);

    // 左右の翼は胴体を挟んで反対側に配置される（交差しない）
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), fwd);
    const wingL = anyVisual.parts.forearmL.mesh.getWorldPosition(new Vector3()).sub(pelvis).dot(right);
    const wingR = anyVisual.parts.forearmR.mesh.getWorldPosition(new Vector3()).sub(pelvis).dot(right);
    expect(Math.sign(wingL)).toBe(-Math.sign(wingR));
    expect(Math.abs(wingL)).toBeGreaterThan(0.6);

    visual.dispose();
  });

  it('羽ばたき位相に応じて翼が大きく上下し、前後半身がしなる', () => {
    const world = new PhysicsWorld();
    const unit = new Unit(world, UNIT_TYPES.dragon, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    const anyVisual = visual as any;
    const pelvisY = unit.pelvis.pos.y;

    // 位相 π/2 / 0.8 で翼は最も高く、3π/2 / 0.8 で最も低い
    const sample = (phase: number) => {
      unit.walkPhase = phase / 0.8;
      visual.sync();
      visual.group.updateMatrixWorld(true);
      const wingTip = new Box3().setFromObject(anyVisual.parts.forearmR.mesh);
      return {
        wingY: (wingTip.max.y + wingTip.min.y) / 2 - pelvisY,
        frontQ: anyVisual.parts.torso.mesh.quaternion.clone(),
        rearQ: anyVisual.dragonRear.quaternion.clone(),
      };
    };
    const up = sample(Math.PI / 2);
    const down = sample((Math.PI * 3) / 2);
    expect(up.wingY - down.wingY).toBeGreaterThan(1.0); // 1m 以上のストローク
    // 前半身と後半身は別々の向きで揺れる（2 パーツ構成）
    expect(up.frontQ.angleTo(up.rearQ)).toBeGreaterThan(0.02);

    visual.dispose();
  });

  it('全チームカラーでドラゴンを生成・同期できる', () => {
    for (const team of [0, 1, 2, 3] as const) {
      const world = new PhysicsWorld();
      const unit = new Unit(world, UNIT_TYPES.dragon, team, new Vector3(0, 0, 0), 0);
      const visual = new VoxelCharacterVisual(unit);
      expect(() => visual.sync()).not.toThrow();
      visual.dispose();
    }
  });
});
