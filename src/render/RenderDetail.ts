/**
 * ユニットの描画の簡略化（アウトライン・影）を決める。描画だけの話なので端末ごとに変えてよい
 * （シミュレーションの値は一切変えない。物理側の軽量化は全端末一律の定数で行う）。
 * Three.js に依存させず、tests/ から検証できるようにしている。
 */

/** アウトラインの段階（2: 黒＋陣営色の 2 枚 / 1: 陣営色だけ / 0: なし） */
export type OutlineDetail = 0 | 1 | 2;
/** 影を落とす部位の段階（2: 全部位と武器 / 1: 胴と頭 / 0: 胴だけ） */
export type ShadowDetail = 0 | 1 | 2;

export interface UnitRenderDetail {
  outline: OutlineDetail;
  shadow: ShadowDetail;
}

/** これ以下のユニット数なら、画質が最高のときは簡略化しない */
export const RENDER_CROWD_FULL_UNITS = 40;
/** これを超えるユニット数では、影を胴だけにする */
export const RENDER_CROWD_HEAVY_UNITS = 90;
/** 混雑時、カメラからこの距離（m）までは 2 枚のアウトラインを描く */
export const RENDER_OUTLINE_FULL_DIST = 22;
/** 混雑時、カメラからこの距離（m）までは陣営色のアウトラインを描く（その先は描かない） */
export const RENDER_OUTLINE_THIN_DIST = 45;
/** 画質段階ごとの距離の倍率（0: 低 / 1: 中 / 2: 高） */
export const RENDER_DIST_SCALE_BY_QUALITY: readonly [number, number, number] = [0.5, 0.75, 1];

/**
 * 1 体ぶんの描画の細かさを決める。
 * @param distance カメラからユニットまでの距離（m）
 * @param unitCount 描画しているユニットの数（死体を含む）
 * @param quality 画質段階（0: 低 / 1: 中 / 2: 高）
 * @param alive 生きているか（死体は陣営を見分ける必要がないので軽くする）
 */
export function unitRenderDetail(distance: number, unitCount: number, quality: 0 | 1 | 2, alive: boolean): UnitRenderDetail {
  if (quality === 2 && unitCount <= RENDER_CROWD_FULL_UNITS) {
    return { outline: alive ? 2 : 1, shadow: alive ? 2 : 1 };
  }
  // 画質を落としたとき、または混雑時は距離で間引く（ユニットが多いほど近くまで間引く）
  const crowd = Math.max(1, unitCount / RENDER_CROWD_FULL_UNITS);
  const scale = RENDER_DIST_SCALE_BY_QUALITY[quality] / Math.sqrt(crowd);
  let outline: OutlineDetail;
  if (distance <= RENDER_OUTLINE_FULL_DIST * scale) outline = 2;
  else if (distance <= RENDER_OUTLINE_THIN_DIST * scale) outline = 1;
  else outline = 0;
  let shadow: ShadowDetail = unitCount > RENDER_CROWD_HEAVY_UNITS || quality === 0 ? 0 : 1;
  if (!alive) {
    outline = Math.min(outline, 1) as OutlineDetail;
    shadow = 0;
  }
  return { outline, shadow };
}
