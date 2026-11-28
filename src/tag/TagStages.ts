import { parseTagStage, TAG_STAGE_IDS, type TagStageId } from '../net/tagProtocol';
import { generateGifuStation } from './GifuStation';
import { generateGifuTown, type GifuTown } from './GifuTown';

/**
 * 鬼ごっこの舞台の一覧と生成。
 * town は試合ごとに区画が入れ替わる（variant を使う）。station は実在の形を写したものなので、いつも同じ形。
 */
export interface TagStageInfo {
  /** メニューに出す名前 */
  name: string;
  /** ひとことの説明 */
  note: string;
}

export const TAG_STAGES: Record<TagStageId, TagStageInfo> = {
  town: { name: '岐阜の町（お昼）', note: '長良川・柳ケ瀬・金華山。試合ごとに町の一部が入れ替わる' },
  station: { name: 'JR岐阜駅', note: '実際の地図をもとに再現。高架の駅、2 階の改札、3 階のホーム、杜の架け橋' },
};

export { TAG_STAGE_IDS, parseTagStage, type TagStageId };

/** 舞台を作る */
export function generateTagStage(stage: TagStageId, variant?: number): GifuTown {
  return stage === 'station' ? generateGifuStation() : generateGifuTown(1, variant);
}

/** 次の舞台（ボタンで切り替えるとき） */
export function nextTagStage(stage: TagStageId): TagStageId {
  return TAG_STAGE_IDS[(TAG_STAGE_IDS.indexOf(stage) + 1) % TAG_STAGE_IDS.length];
}
