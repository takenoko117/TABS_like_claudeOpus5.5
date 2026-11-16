import { vx, type VoxelIconName } from './VoxelIcons';
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
  if (ut.id === 'angel_ramiel') return '580 (超極太貫通ビーム)';
  if (ut.id === 'angel_zeruel') return '420-500 (神速両断)';
  if (ut.id === 'angel_sachiel') return '100 (光杭・閃光)';
  if (ut.id === 'satellite_soldier') return '160 (衛星砲)';
  if (ut.id === 'giant_eagle') return '45 (急降下)';
  if (ut.id === 'anaconda') return '50 (締め付け)';
  if (ut.id === 'buggy') return '35 (突撃)';
  if (ut.id === 'lightspeed_ant') return '9 (光速噛みつき)';
  if (ut.id === 'deoxys') return '16-48 (サイコキネシス拘束・吹き飛ばし)';
  if (ut.id === 'hayato') return '12 × 照射 (貫通口レーザー)';
  if (ut.id === 'tanimon') return '150+ × 連鎖 (頭つかみ激突)';
  if (ut.id === 'super_anaconda') return '160 (超巨大毒牙)';
  if (ut.id === 'poseidon') return '150 (海割り波状攻撃)';
  if (ut.id === 'crocodile') return '45 × 連続 (デスロール)';
  if (ut.id === 'giant_sequoia') return '95+60 (避雷針雷撃＋山火事)';
  if (ut.id === 'yamanote_line') return '115 (8両編成突進)';
  if (ut.id === 'landmark_tower') return '130 (超高層広範囲衝撃波)';
  if (ut.id === 'giant_octopus') return '34 × 8本 (足の一斉攻撃＋吸盤)';
  if (ut.id === 'whale_squid') return '110+85 (ソナー麻痺＋触腕締め上げ)';
  if (ut.id === 'takoyaki') return '24 × 3個 (アツアツ・やけど)';
  if (ut.id === 'the_earth') return '320 (重力引き寄せ＋地殻変動)';
  if (ut.id === 'the_universe') return '160+130 × 10 (ビッグバン＋流星群)';
  if (ut.id === 'ovidia') return '32 × 8本 (並列演算・4回に1回3倍)';
  if (ut.id === 'ufo') return '48 (焼きそば・鈍足) / 70 (吸い上げ)';
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
  categoryIcon: VoxelIconName;
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
    const isTerrain = Boolean(fac.isTerrain);
    const theme = isTerrain ? CATEGORY_THEME_COLORS.terrain : CATEGORY_THEME_COLORS.facility;
    return {
      id,
      isFacility: true,
      name: fac.name,
      categoryLabel: isTerrain ? '地形ブロック' : '防衛施設',
      categoryIcon: isTerrain ? CATEGORY_ICONS.terrain : CATEGORY_ICONS.facility,
      theme,
      iconSvg: getFacilityIconSvg(id),
      description: fac.description,
      cost: fac.cost,
      hp: fac.hp,
      isFeatured: false,
      statPills: isTerrain
        ? [
            {
              label: 'コスト',
              value: '0 (無料)',
              className: 'stat-pill cost',
              iconSvg: COST_ICON_SVG,
              title: '配置コスト（無料）',
            },
            {
              label: '耐久力',
              value: `破壊不可`,
              iconSvg: vx('shield'),
              className: 'stat-pill hp',
              title: '地形ブロックは破壊されません',
            },
            {
              label: 'サイズ',
              value: `半径 ${fac.radius}m`,
              className: 'stat-pill range',
              title: '地形効果半径',
            },
          ]
        : [
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
      value: `${dmg}`,
      iconSvg: vx('swords'),
      className: 'stat-pill damage',
      title: '攻撃力 / 単発ダメージ',
    });
  }

  if (ut.range > 0) {
    pills.push({
      label: '射程',
      value: `${ut.range}m`,
      iconSvg: vx('target'),
      className: 'stat-pill range',
      title: '攻撃射程距離',
    });
  }

  if (ut.cooldown > 0) {
    pills.push({
      label: '間隔',
      value: `${ut.cooldown}s`,
      iconSvg: vx('stopwatch'),
      className: 'stat-pill cooldown',
      title: '攻撃クールダウン間隔',
    });
  }

  if (ut.speed > 0) {
    pills.push({
      label: '速度',
      value: `${ut.speed}m/s`,
      iconSvg: vx('boot'),
      className: 'stat-pill speed',
      title: '移動速度',
    });
  }

  if (ut.id === 'hongon') {
    pills.push({
      label: '特効',
      value: `遠距離無効(累計1000)`,
      iconSvg: vx('shield'),
      className: 'stat-pill special',
      title: '特殊効果: 矢・銃弾・爆弾・砲撃・遠距離魔法などあらゆる遠距離攻撃のダメージを累計1000まで無効化',
    });
  }

  if (ut.id === 'yamamuron') {
    pills.push({
      label: '特効',
      value: `HP半分で強化`,
      iconSvg: vx('volcano'),
      className: 'stat-pill special',
      title: '強化モード: HP半分以下で変身し、移動速度20倍・射程5倍・攻撃頻度2倍・最大3体へ同時噴火・地震による周囲への範囲攻撃',
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
