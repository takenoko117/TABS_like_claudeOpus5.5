import { FACILITY_TYPES, isFacilityTypeId, type FacilityTypeId } from '../facilities/FacilityTypes';
import {
  CATEGORY_ICONS,
  CATEGORY_THEME_COLORS,
  COST_ICON_SVG,
  HP_ICON_SVG,
  getFacilityIconSvg,
  getUnitIconSvg,
} from './UnitIcons';
import {
  CATEGORY_LABELS,
  UNIT_TYPES,
  type UnitType,
  type UnitTypeId,
} from '../units/UnitTypes';

/** 攻撃力表示用のテキストを取得 */
export function getAttackDamageDisplay(ut: UnitType): string {
  if (ut.id === 'decoy') return '0 (非戦闘)';
  if (ut.id === 'sezain') return `${ut.projectile?.damage ?? 10} × 両手連射`;
  if (ut.id === 'yamamuron') return `${ut.projectile?.damage ?? 120} (噴火爆発)`;
  if (ut.id === 'hongon') return '24 × 音楽波動';
  if (ut.id === 'zaisan') return '38 × 3連回転斬撃';
  if (ut.projectile) {
    if (ut.id === 'minigunner') return `${ut.projectile.damage} × 連射`;
    if (ut.id === 'ninja') return `${ut.projectile.damage} × 3`;
    if (ut.id === 'dragon') return `${ut.projectile.damage} (火炎)`;
    return `${ut.projectile.damage}`;
  }
  if (ut.weapon) {
    return `${ut.weapon.damage}`;
  }
  if (ut.id === 'angel_ramiel') return '160 (貫通ビーム)';
  if (ut.id === 'angel_zeruel') return '120 (高速切断)';
  if (ut.id === 'angel_sachiel') return '100 (光杭・閃光)';
  if (ut.id === 'satellite_soldier') return '160 (衛星砲)';
  if (ut.id === 'giant_eagle') return '45 (急降下)';
  if (ut.id === 'anaconda') return '50 (締め付け)';
  if (ut.id === 'buggy') return '35 (突撃)';
  return '-';
}

export interface UnitStatPill {
  label: string;
  value: string | number;
  className: string;
  iconSvg?: string;
  title: string;
}

export interface PlaceableDetailData {
  id: UnitTypeId | FacilityTypeId;
  isFacility: boolean;
  name: string;
  categoryLabel: string;
  categoryIcon: string;
  theme: { bg: string; border: string };
  iconSvg: string;
  description: string;
  cost: number;
  hp: number;
  isFeatured: boolean;
  featuredNote?: string;
  statPills: UnitStatPill[];
}

/**
 * ユニットまたは施設IDから詳細表示用データを生成する純粋関数
 */
export function getPlaceableDetail(
  id: UnitTypeId | FacilityTypeId,
  isFeatured = false,
  featuredNote?: string,
): PlaceableDetailData {
  if (isFacilityTypeId(id)) {
    const fac = FACILITY_TYPES[id];
    const theme = CATEGORY_THEME_COLORS.facility;
    return {
      id,
      isFacility: true,
      name: fac.name,
      categoryLabel: '防衛施設',
      categoryIcon: CATEGORY_ICONS.facility,
      theme,
      iconSvg: getFacilityIconSvg(id),
      description: fac.description,
      cost: fac.cost,
      hp: fac.hp,
      isFeatured: false,
      statPills: [
        {
          label: 'コスト',
          value: fac.cost,
          className: 'stat-pill cost',
          iconSvg: COST_ICON_SVG,
          title: '配置コスト',
        },
        {
          label: '耐久力',
          value: fac.hp,
          className: 'stat-pill hp',
          iconSvg: HP_ICON_SVG,
          title: '施設耐久力 (HP)',
        },
        {
          label: '影響範囲',
          value: `半径 ${fac.radius}m`,
          className: 'stat-pill range',
          title: '占有・影響半径',
        },
      ],
    };
  }

  const ut = UNIT_TYPES[id];
  const theme = CATEGORY_THEME_COLORS[ut.category];
  const pills: UnitStatPill[] = [
    {
      label: 'コスト',
      value: ut.cost,
      className: 'stat-pill cost',
      iconSvg: COST_ICON_SVG,
      title: '配置コスト',
    },
    {
      label: 'HP',
      value: ut.hp,
      className: 'stat-pill hp',
      iconSvg: HP_ICON_SVG,
      title: '最大HP',
    },
  ];

  const dmg = getAttackDamageDisplay(ut);
  if (dmg !== '-') {
    pills.push({
      label: '攻撃',
      value: `⚔️ ${dmg}`,
      className: 'stat-pill damage',
      title: '攻撃力 / 単発ダメージ',
    });
  }

  if (ut.range > 0) {
    pills.push({
      label: '射程',
      value: `🎯 ${ut.range}m`,
      className: 'stat-pill range',
      title: '攻撃射程距離',
    });
  }

  if (ut.cooldown > 0) {
    pills.push({
      label: '間隔',
      value: `⏱ ${ut.cooldown}s`,
      className: 'stat-pill cooldown',
      title: '攻撃クールダウン間隔',
    });
  }

  if (ut.speed > 0) {
    pills.push({
      label: '速度',
      value: `👟 ${ut.speed}m/s`,
      className: 'stat-pill speed',
      title: '移動速度',
    });
  }

  return {
    id,
    isFacility: false,
    name: ut.name,
    categoryLabel: CATEGORY_LABELS[ut.category],
    categoryIcon: CATEGORY_ICONS[ut.category],
    theme,
    iconSvg: getUnitIconSvg(ut.id),
    description: ut.description,
    cost: ut.cost,
    hp: ut.hp,
    isFeatured,
    featuredNote: isFeatured ? (featuredNote ?? '★このステージの特効ユニット！') : undefined,
    statPills: pills,
  };
}
