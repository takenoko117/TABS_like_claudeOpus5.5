import { describe, expect, it } from 'vitest';
import { FACILITY_TYPE_IDS } from '../src/facilities/FacilityTypes';
import { getAttackDamageDisplay, getPlaceableDetail } from '../src/ui/UnitDetailHelper';
import { UNIT_TYPE_LIST, UNIT_TYPES } from '../src/units/UnitTypes';

describe('UnitDetailHelper', () => {
  it('全ユニットで詳細情報と説明テキストが正しく取得できる', () => {
    for (const ut of UNIT_TYPE_LIST) {
      const detail = getPlaceableDetail(ut.id);
      expect(detail.id).toBe(ut.id);
      expect(detail.isFacility).toBe(false);
      expect(detail.name).toBe(ut.name);
      expect(detail.cost).toBe(ut.cost);
      expect(detail.hp).toBe(ut.hp);
      expect(detail.description).toBe(ut.description);
      expect(detail.description.length).toBeGreaterThan(5);
      expect(detail.statPills.length).toBeGreaterThanOrEqual(2);
      expect(detail.iconSvg).toContain('<svg');
    }
  });

  it('全施設で詳細情報と説明テキストが正しく取得できる', () => {
    for (const facId of FACILITY_TYPE_IDS) {
      const detail = getPlaceableDetail(facId);
      expect(detail.id).toBe(facId);
      expect(detail.isFacility).toBe(true);
      expect(detail.name).toBeTruthy();
      expect(detail.cost).toBeGreaterThan(0);
      expect(detail.hp).toBeGreaterThan(0);
      expect(detail.description.length).toBeGreaterThan(10);
      expect(detail.statPills.length).toBeGreaterThanOrEqual(2);
      expect(detail.iconSvg).toContain('<svg');
    }
  });

  it('ステージ特効フラグが正しく反映される', () => {
    const normal = getPlaceableDetail('clubber', false);
    expect(normal.isFeatured).toBe(false);
    expect(normal.featuredNote).toBeUndefined();

    const featured = getPlaceableDetail('clubber', true, '★ステージ特効ユニット！');
    expect(featured.isFeatured).toBe(true);
    expect(featured.featuredNote).toBe('★ステージ特効ユニット！');
  });

  it('特殊攻撃や各スタイルのダメージ表示が適切に行われる', () => {
    expect(getAttackDamageDisplay(UNIT_TYPES.clubber)).toBe('17');
    expect(getAttackDamageDisplay(UNIT_TYPES.archer)).toBe('22');
    expect(getAttackDamageDisplay(UNIT_TYPES.angel_ramiel)).toContain('貫通ビーム');
    expect(getAttackDamageDisplay(UNIT_TYPES.decoy)).toContain('非戦闘');
  });
});
