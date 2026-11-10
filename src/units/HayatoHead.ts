import { Vector3 } from 'three';

/**
 * ハヤト（顔だけのユニット）の寸法。
 * 当たり判定側の Unit とモデル側の HayatoHeadModel の両方がここを参照し、
 * レーザーの発射位置と見た目の口の位置を揃える。
 */

/** scale 1 あたりの顔の高さ（m）。モデルは高さ 1 で作り、この値で拡大する */
export const HAYATO_HEAD_HEIGHT = 1.3;
/** 骨盤の浮く高さの倍率（通常の立ち姿を 1 とする） */
export const HAYATO_HOVER_MUL = 1.05;
/** 骨盤から顔の中心までの高さ（scale 1 あたり） */
export const HAYATO_HEAD_RISE = 0.12;
/** 顔の中心から見た、開いた口の中心（高さ 1 のモデル座標。y = 上, z = 前） */
export const HAYATO_MOUTH_Y = -0.29;
export const HAYATO_MOUTH_Z = 0.36;

/** 口レーザーが照準の先へ突き抜ける距離（m） */
export const MOUTH_LASER_PIERCE = 10;
/** 口レーザーの当たり判定の半径（m） */
export const MOUTH_LASER_RADIUS = 0.7;
/** 光線の高さと標的の高さの許容差（m） */
export const MOUTH_LASER_HEIGHT_TOLERANCE = 3;

/** 骨盤の位置から顔の中心を求める */
export function hayatoHeadCenter(out: Vector3, pelvis: Vector3, scale: number): Vector3 {
  return out.copy(pelvis).setY(pelvis.y + HAYATO_HEAD_RISE * scale);
}

/** 骨盤の位置と向きから口の位置を求める */
export function hayatoMouthPos(out: Vector3, pelvis: Vector3, forward: Vector3, scale: number): Vector3 {
  const size = HAYATO_HEAD_HEIGHT * scale;
  hayatoHeadCenter(out, pelvis, scale);
  out.y += HAYATO_MOUTH_Y * size;
  return out.addScaledVector(forward, HAYATO_MOUTH_Z * size);
}
