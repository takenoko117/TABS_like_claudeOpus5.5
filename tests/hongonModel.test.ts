import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VoxelCharacterVisual } from '../src/render/VoxelModel';
import { Unit } from '../src/units/Unit';
import { UNIT_TYPES } from '../src/units/UnitTypes';
import { Vector3 } from 'three';

describe('Hongon Voxel Model Quality & Structure', () => {
  it('ホンゴンのボクセルモデルが正常に生成され、巨大グランドピアノとブロンド女性のパーツを保持している', () => {
    const world = new PhysicsWorld();
    const unit = new Unit(world, UNIT_TYPES.hongon, 0, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);

    expect(visual).toBeDefined();
    expect(visual.group).toBeDefined();

    const anyVisual = visual as any;

    // 胴体（巨大グランドピアノ＋女性ピアニスト）
    const torsoMesh = anyVisual.parts.torso.mesh;
    expect(torsoMesh).toBeDefined();
    expect(torsoMesh.geometry.getAttribute('position').count).toBeGreaterThan(500);

    // 頭部（ブロンド長髪＋ティアラ＋表情）
    const headMesh = anyVisual.parts.head.mesh;
    expect(headMesh).toBeDefined();
    expect(headMesh.geometry.getAttribute('position').count).toBeGreaterThan(200);

    // 四肢（ロンググローブ腕、ドレス脚）
    expect(anyVisual.parts.upperArmL.mesh).toBeDefined();
    expect(anyVisual.parts.forearmL.mesh).toBeDefined();
    expect(anyVisual.parts.thighL.mesh).toBeDefined();
    expect(anyVisual.parts.shinL.mesh).toBeDefined();

    // sync() を呼んでも例外が発生せず正常に更新される
    visual.sync();

    // ボックスサイズが巨大グランドピアノ（奥行き1.5m以上）になっていること
    torsoMesh.geometry.computeBoundingBox();
    const bbox = torsoMesh.geometry.boundingBox!;
    const depthZ = bbox.max.z - bbox.min.z;
    const widthX = bbox.max.x - bbox.min.x;
    expect(depthZ).toBeGreaterThan(1.2); // 奥行き1.2m以上の巨大グランドピアノ
    expect(widthX).toBeGreaterThan(0.8); // 横幅0.8m以上の堂々たるサイズ

    // 頭部のバウンディングボックス（背中まで流れる長髪の高さ）
    headMesh.geometry.computeBoundingBox();
    const headBbox = headMesh.geometry.boundingBox!;
    const headHeightY = headBbox.max.y - headBbox.min.y;
    expect(headHeightY).toBeGreaterThan(0.45); // 長髪を含む豊かなボリューム

    visual.dispose();
  });
});
