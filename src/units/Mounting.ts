import type { UnitTypeId } from './UnitTypes';

/**
 * かさね配置（試作）の対象定義。
 *
 * 土台（mount）の上に乗り手（rider）を重ねて配置できるようにする仕組み。
 * 結合方式や挙動の本体は Unit.ts の applyMountBinding / Battle.ts の
 * spawnMountedUnit を参照。ここでは「どの兵種が土台・乗り手になれるか」と
 * 「土台の胸からどれだけ上が乗り手の立つ面か」だけを定義する。
 */

/** 土台になれる兵種（大型で上面があるもの） */
export const MOUNT_TYPE_IDS: readonly UnitTypeId[] = [
  'giant',
  'warelephant',
  'dragon',
  'giant_tank',
  'giant_robot',
  'buggy',
  'yamamuron',
];

/** 乗り手になれる兵種（人型の遠距離・魔法系のみ。近接は試作対象外） */
export const RIDER_TYPE_IDS: readonly UnitTypeId[] = [
  'archer',
  'sniper',
  'archmage',
  'gravimancer',
  'hongon',
  'bomber',
  'rocket_soldier',
  'satellite_soldier',
];

export function isMountType(id: UnitTypeId): boolean {
  return MOUNT_TYPE_IDS.includes(id);
}

export function isRiderType(id: UnitTypeId): boolean {
  return RIDER_TYPE_IDS.includes(id);
}

/**
 * 乗り手が立つ面の、土台の胸（J.Chest）粒子からの高さ（土台の scale 1 あたり）。
 * 頭頂・肩・車体上面のおおよその位置。試作値であり、種別ごとの微調整は後工程。
 */
const MOUNT_SEAT_RISE_PER_SCALE: Partial<Record<UnitTypeId, number>> = {
  giant: 0.45,
  warelephant: 0.5,
  dragon: 0.45,
  giant_tank: 0.35,
  giant_robot: 0.5,
  buggy: 0.3,
  yamamuron: 0.5,
};

/** 土台の胸からの「立つ面」までの高さ（m）。土台の scale に比例する */
export function mountSeatRise(mountTypeId: UnitTypeId, mountScale: number): number {
  return (MOUNT_SEAT_RISE_PER_SCALE[mountTypeId] ?? 0.45) * mountScale;
}
