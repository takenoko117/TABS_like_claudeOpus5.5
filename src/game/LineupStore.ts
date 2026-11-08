import { FACILITY_TYPES, type FacilityTypeId } from '../facilities/FacilityTypes';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';

/** ブラウザに保存する 1 体ぶんの配置（陣営は常に自軍なので持たない） */
export interface StoredPlacement {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  x: number;
  z: number;
  facing?: number;
}

const STORAGE_PREFIX = 'tabs_voxel_lineup_v1:';
/** 壊れたデータや極端に長いデータで読み込みが重くならないようにする上限 */
const MAX_STORED_PLACEMENTS = 300;

function toStoredPlacement(value: unknown): StoredPlacement | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.z !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.z)) {
    return null;
  }
  const facing = typeof v.facing === 'number' && Number.isFinite(v.facing) ? v.facing : undefined;
  if (typeof v.typeId === 'string' && Object.hasOwn(UNIT_TYPES, v.typeId)) {
    return { typeId: v.typeId as UnitTypeId, x: v.x, z: v.z, facing };
  }
  if (typeof v.facilityId === 'string' && Object.hasOwn(FACILITY_TYPES, v.facilityId)) {
    return { facilityId: v.facilityId as FacilityTypeId, x: v.x, z: v.z, facing };
  }
  return null;
}

/** 保存文字列を検証して配置リストに戻す。不正な項目は読み飛ばす */
export function parseStoredLineup(raw: string | null): StoredPlacement[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(0, MAX_STORED_PLACEMENTS)
    .map(toStoredPlacement)
    .filter((p): p is StoredPlacement => p !== null);
}

export function loadStoredLineup(key: string): StoredPlacement[] {
  try {
    return parseStoredLineup(window.localStorage.getItem(STORAGE_PREFIX + key));
  } catch {
    // localStorage が使えない環境では保存なしとして扱う
    return [];
  }
}

export function saveStoredLineup(key: string, placements: readonly StoredPlacement[]): void {
  try {
    if (placements.length === 0) {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
      return;
    }
    const compact = placements.map(({ typeId, facilityId, x, z, facing }) => ({ typeId, facilityId, x, z, facing }));
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(compact));
  } catch {
    // 保存できない環境では何もしない
  }
}
