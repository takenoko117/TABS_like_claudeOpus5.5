import type { ConstraintMode } from '../physics/Constraint';

/**
 * ラグドールの関節インデックス。
 * ローカル座標系: x = 右, y = 上, z = 前（骨盤を原点とする）
 */
export const J = {
  Pelvis: 0,
  Chest: 1,
  Head: 2,
  ShoulderL: 3,
  ShoulderR: 4,
  ElbowL: 5,
  ElbowR: 6,
  HandL: 7,
  HandR: 8,
  HipL: 9,
  HipR: 10,
  KneeL: 11,
  KneeR: 12,
  FootL: 13,
  FootR: 14,
} as const;

export const JOINT_COUNT = 15;

export interface JointDef {
  name: string;
  /** 直立時の骨盤からの相対位置（スケール 1 基準） */
  pos: readonly [number, number, number];
  mass: number;
  radius: number;
  /** 姿勢を保つ筋肉のバネ定数（加速度ベース） */
  k: number;
  /** 筋肉の減衰係数 */
  d: number;
  /** 地面摩擦 */
  friction: number;
}

export const JOINTS: readonly JointDef[] = [
  { name: '骨盤', pos: [0, 0, 0], mass: 3.0, radius: 0.17, k: 0, d: 0, friction: 0.4 },
  { name: '胸', pos: [0, 0.42, 0], mass: 3.0, radius: 0.19, k: 90, d: 12, friction: 0.4 },
  { name: '頭', pos: [0, 0.78, 0], mass: 1.5, radius: 0.17, k: 110, d: 12, friction: 0.4 },
  { name: '左肩', pos: [-0.24, 0.45, 0], mass: 1.0, radius: 0.11, k: 90, d: 12, friction: 0.4 },
  { name: '右肩', pos: [0.24, 0.45, 0], mass: 1.0, radius: 0.11, k: 90, d: 12, friction: 0.4 },
  { name: '左肘', pos: [-0.3, 0.17, 0.04], mass: 0.6, radius: 0.08, k: 50, d: 7, friction: 0.4 },
  { name: '右肘', pos: [0.3, 0.17, 0.04], mass: 0.6, radius: 0.08, k: 50, d: 7, friction: 0.4 },
  { name: '左手', pos: [-0.3, -0.08, 0.12], mass: 0.5, radius: 0.08, k: 60, d: 8, friction: 0.4 },
  { name: '右手', pos: [0.3, -0.08, 0.12], mass: 0.5, radius: 0.08, k: 60, d: 8, friction: 0.4 },
  { name: '左股', pos: [-0.12, -0.06, 0], mass: 1.2, radius: 0.11, k: 90, d: 12, friction: 0.4 },
  { name: '右股', pos: [0.12, -0.06, 0], mass: 1.2, radius: 0.11, k: 90, d: 12, friction: 0.4 },
  { name: '左膝', pos: [-0.13, -0.47, 0.04], mass: 0.8, radius: 0.09, k: 80, d: 10, friction: 0.4 },
  { name: '右膝', pos: [0.13, -0.47, 0.04], mass: 0.8, radius: 0.09, k: 80, d: 10, friction: 0.4 },
  { name: '左足', pos: [-0.13, -0.87, 0], mass: 0.8, radius: 0.09, k: 80, d: 10, friction: 0.25 },
  { name: '右足', pos: [0.13, -0.87, 0], mass: 0.8, radius: 0.09, k: 80, d: 10, friction: 0.25 },
];

/** 直立時の骨盤の高さ（足の粒子半径を含む、スケール 1 基準） */
export const PELVIS_HEIGHT = 0.87 + 0.09;

/** [関節A, 関節B, 剛性, モード, 既定長倍率] */
export type ConstraintDef = readonly [number, number, number, ConstraintMode, number];

function buildConstraintDefs(): ConstraintDef[] {
  const defs: ConstraintDef[] = [];
  // 胴体はすべての組み合わせを結んでほぼ剛体にする
  const torso = [J.Pelvis, J.Chest, J.ShoulderL, J.ShoulderR, J.HipL, J.HipR];
  for (let i = 0; i < torso.length; i++) {
    for (let j = i + 1; j < torso.length; j++) {
      defs.push([torso[i], torso[j], 1, 'equal', 1]);
    }
  }
  // 頭（首は前後に少しだけ曲がる）
  defs.push([J.Head, J.Chest, 1, 'equal', 1]);
  defs.push([J.Head, J.ShoulderL, 1, 'equal', 1]);
  defs.push([J.Head, J.ShoulderR, 1, 'equal', 1]);
  defs.push([J.Head, J.Pelvis, 0.15, 'equal', 1]);
  // 腕・脚の骨
  defs.push([J.ShoulderL, J.ElbowL, 1, 'equal', 1]);
  defs.push([J.ElbowL, J.HandL, 1, 'equal', 1]);
  defs.push([J.ShoulderR, J.ElbowR, 1, 'equal', 1]);
  defs.push([J.ElbowR, J.HandR, 1, 'equal', 1]);
  defs.push([J.HipL, J.KneeL, 1, 'equal', 1]);
  defs.push([J.KneeL, J.FootL, 1, 'equal', 1]);
  defs.push([J.HipR, J.KneeR, 1, 'equal', 1]);
  defs.push([J.KneeR, J.FootR, 1, 'equal', 1]);
  // 可動域の制限（肘・膝が完全に折りたたまれないように）
  defs.push([J.ShoulderL, J.HandL, 0.5, 'min', 0.45]);
  defs.push([J.ShoulderR, J.HandR, 0.5, 'min', 0.45]);
  defs.push([J.HipL, J.FootL, 0.5, 'min', 0.55]);
  defs.push([J.HipR, J.FootR, 0.5, 'min', 0.55]);
  // 脚同士が交差しないように
  defs.push([J.FootL, J.FootR, 0.3, 'min', 0.6]);
  defs.push([J.KneeL, J.KneeR, 0.3, 'min', 0.6]);
  return defs;
}

export const SKELETON_CONSTRAINTS: readonly ConstraintDef[] = buildConstraintDefs();
