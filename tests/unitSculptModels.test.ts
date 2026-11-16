import { describe, expect, it } from 'vitest';
import { Box3, Quaternion, Vector3, type Mesh } from 'three';
import { Battle } from '../src/game/Battle';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import type { UnitTypeId } from '../src/units/UnitTypes';

/** 兵種を出して少し動かし、見た目を同期した状態で返す */
function spawnVisual(id: UnitTypeId, team: 0 | 1 = 0) {
  const battle = new Battle();
  const unit = battle.spawnUnit(id, team, 0, 0);
  for (let i = 0; i < 120; i++) battle.step(battle.fixedDt);
  const visual = new VoxelCharacterVisual(unit);
  visual.sync();
  visual.group.updateMatrixWorld(true);
  const parts = (visual as any).parts as Record<string, { mesh: Mesh }>;
  const fwd = unit.forward.clone().setY(0).normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), fwd);
  return { unit, visual, parts, fwd, right };
}

const vertexCount = (m: Mesh) => m.geometry.getAttribute('position').count;
/** 部位メッシュのローカル軸をワールドへ */
const localAxis = (m: Mesh, x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(m.getWorldQuaternion(new Quaternion())).normalize();

const SCULPTED: UnitTypeId[] = ['warelephant', 'giant_eagle', 'anaconda', 'giant_tank', 'buggy', 'giant_robot'];

describe('彫刻的に作り直したユニットのボクセルモデル', () => {
  for (const id of SCULPTED) {
    it(`${id}: 頭と胴が細かいボクセルで作り込まれ、陣営ごとに色が違う`, () => {
      const a = spawnVisual(id, 0);
      const b = spawnVisual(id, 1);
      expect(vertexCount(a.parts.head.mesh)).toBeGreaterThan(1500);
      expect(vertexCount(a.parts.torso.mesh)).toBeGreaterThan(3000);
      // 陣営色が入っている（同じジオメトリではない）
      const ca = a.parts.torso.mesh.geometry.getAttribute('color').array;
      const cb = b.parts.torso.mesh.geometry.getAttribute('color').array;
      let diff = 0;
      for (let i = 0; i < Math.min(ca.length, cb.length); i++) diff += Math.abs(ca[i] - cb[i]);
      expect(diff).toBeGreaterThan(1);
    });
  }

  it('鎧戦象: 頭は胴の前にあり、脚の膝当てと爪は進行方向を向く', () => {
    const { unit, parts, fwd } = spawnVisual('warelephant');
    const head = parts.head.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos);
    expect(head.dot(fwd)).toBeGreaterThan(0.6);
    for (const key of ['forearmL', 'forearmR', 'shinL', 'shinR']) {
      expect(localAxis(parts[key].mesh, 0, 0, 1).dot(fwd)).toBeGreaterThan(0.7);
    }
  });

  it('大鷲: 胴は水平に構え、頭が前、翼は左右へ広がり、風切羽は後ろへ流れる', () => {
    const { unit, parts, fwd, right } = spawnVisual('giant_eagle');
    const torso = parts.torso.mesh;
    // 胴のローカル +Z（頭側）がほぼ水平な前方を向く
    const bodyFwd = localAxis(torso, 0, 0, 1);
    expect(bodyFwd.dot(fwd)).toBeGreaterThan(0.8);
    const head = parts.head.mesh.getWorldPosition(new Vector3()).sub(torso.getWorldPosition(new Vector3()));
    expect(head.dot(fwd)).toBeGreaterThan(0.2);
    const wingL = parts.forearmL.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos).dot(right);
    const wingR = parts.forearmR.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos).dot(right);
    expect(Math.sign(wingL)).toBe(-Math.sign(wingR));
    // 翼のローカル -Z（羽根の広がる側）は後方
    expect(localAxis(parts.forearmL.mesh, 0, 0, -1).dot(fwd)).toBeLessThan(-0.5);
    // 翼を広げた幅は胴の長さより大きい
    const box = new Box3().setFromObject(parts.forearmL.mesh).union(new Box3().setFromObject(parts.forearmR.mesh));
    expect(box.getSize(new Vector3()).length()).toBeGreaterThan(1.5);
  });

  it('巨大アナコンダ: 頭の上と背中の節の +Z（背）が上を向き、尾の節まで表示される', () => {
    const { unit, parts, fwd } = spawnVisual('anaconda');
    expect(localAxis(parts.head.mesh, 0, 1, 0).y).toBeGreaterThan(0.7);
    const head = parts.head.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos);
    expect(head.dot(fwd)).toBeGreaterThan(0.3);
    for (const key of ['thighL', 'shinL', 'thighR', 'shinR', 'upperArmL', 'forearmL']) {
      expect(parts[key].mesh.visible).toBe(true);
      expect(localAxis(parts[key].mesh, 0, 0, 1).y).toBeGreaterThan(0.7);
    }
    const tail = parts.forearmL.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos);
    expect(tail.dot(fwd)).toBeLessThan(-0.8);
  });

  it('巨大ロボット: 拳とつま先が胴体の正面を向く', () => {
    const { parts } = spawnVisual('giant_robot');
    const torsoFwd = localAxis(parts.torso.mesh, 0, 0, 1);
    for (const key of ['shinL', 'shinR', 'forearmL', 'forearmR']) {
      expect(localAxis(parts[key].mesh, 0, 0, 1).dot(torsoFwd)).toBeGreaterThan(0.5);
    }
  });

  it('超重戦車: 左右の履帯が車体を挟み、砲塔は車体の上に載る', () => {
    const { unit, parts, right } = spawnVisual('giant_tank');
    const l = parts.upperArmL.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos).dot(right);
    const r = parts.upperArmR.mesh.getWorldPosition(new Vector3()).sub(unit.pelvis.pos).dot(right);
    expect(Math.sign(l)).toBe(-Math.sign(r));
    expect(parts.head.mesh.getWorldPosition(new Vector3()).y).toBeGreaterThan(unit.pelvis.pos.y);
  });
});
