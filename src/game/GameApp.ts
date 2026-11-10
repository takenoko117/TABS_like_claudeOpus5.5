import { Vector3 } from 'three';
import { MusicPlayer } from '../audio/MusicPlayer';
import { SoundManager } from '../audio/SoundManager';
import { JackpotRoulette } from '../ui/JackpotRoulette';
import { DroppedChests, type DroppedChest } from '../render/DroppedChests';
import { setVoxelText, type VoxelTextOptions } from '../ui/VoxelText';
import { UnitPreviews } from '../render/UnitPreviews';
import { WarRoomFx } from '../ui/WarRoomFx';
import {
  EMPTY_UNIT_FACE_SVG,
  RELIC_SLOT_ICON_SVG,
  SCOUT_ICON_SVG,
  SORTIE_ICON_SVG,
  UNIT_SLOT_ICON_SVG,
} from '../ui/WarRoomIcons';
import { TitleLogo3D } from '../render/TitleLogo3D';
import {
  JACKPOT_MAX_DROPS,
  JackpotDropTracker,
  applyJackpotReward,
  collectUnopenedChests,
  rollJackpot,
  type JackpotReward,
} from './RogueJackpot';
import type { Facility } from '../facilities/Facility';
import type { Unit } from '../units/Unit';
import {
  COMBAT_FACILITY_TYPE_LIST,
  FACILITY_TYPES,
  FACILITY_TYPE_LIST,
  TERRAIN_BLOCK_TYPE_LIST,
  isFacilityTypeId,
  type FacilityTypeId,
} from '../facilities/FacilityTypes';
import { SceneView } from '../render/SceneView';
import {
  TutorialGuide,
  buildTutorialSteps,
  isTutorialDone,
  markTutorialDone,
  type TutorialEvent,
  type TutorialStep,
} from '../ui/TutorialGuide';
import { isMountType, isRiderType } from '../units/Mounting';
import {
  DAMAGE_NUMBER_MODE_LABELS,
  DamageOverlay,
  formatDamage,
  type DamageNumberMode,
} from '../render/DamageOverlay';
import { DamageStats } from './DamageStats';
import {
  RARITY_LABELS,
  ROGUE_FINAL_ROUND,
  ROGUE_MID_BOSS_ROUND,
  ROGUE_HARD_START_ROUND,
  ROGUE_BOSS_ROUNDS,
  ROGUE_STARTERS,
  ROGUE_TIME_LIMIT_SECONDS,
  ROGUE_BOSS_HP_MUL,
  ROGUE_LOSS_GOLD_MUL,
  ROGUE_MAX_LIVES,
  RogueliteRules,
  RogueliteRun,
  ROGUE_SKIP_GOLD,
  generateRogueFormation,
  relicDescription,
  ROGUE_START_GOLD,
  getRogueWinBonus,
  isRogueHardMode,
  unitRarity,
  TAG_IDS,
  TAG_INFO,
  type TagId,
  UNIT_TAGS,
  countTags,
  generateRogueEnemyLineup,
  getTagTier,
  isStarterUnlocked,
  loadRogueMeta,
  loadRogueRun,
  mergeRogueMeta,
  relicDisplayName,
  saveRogueMeta,
  saveRogueRun,
  type RewardOption,
  type RogueEndReason,
  type RogueMeta,
  type RogueStarter,
  RogueGateSequence,
  getSquadSize,
  getUnitLevelMul,
  getUnitSlotCost,
  ROGUE_ELITE_ROUNDS,
  type RogueCard,
} from './RogueliteMode';
import { getPlaceableDetail } from '../ui/UnitDetailHelper';
import {
  CATEGORY_ICONS,
  CATEGORY_THEME_COLORS,
  COST_ICON_SVG,
  HP_ICON_SVG,
  getFacilityIconSvg,
  getUnitIconSvg,
  type PaletteCategory,
} from '../ui/UnitIcons';
import {
  CATEGORY_LABELS,
  TEAM_ICONS,
  TEAM_NAMES,
  UNIT_TYPES,
  UNIT_TYPE_LIST,
  type Team,
  type UnitTypeId,
} from '../units/UnitTypes';
import {
  ARCADE_STAGES,
  checkStageRuleViolation,
  computeStageStars,
  getAllUnitIds,
  getStageZoneFacing,
  isInsideStageRedZone,
  isUnitUnlocked,
  loadArcadeSave,
  recordStageClear,
  saveArcadeProgress,
  type ArcadeSaveData,
  type ArcadeStage,
} from './ArcadeStages';
import { Battle, type BattleResult } from './Battle';
import {
  AdaptiveQuality,
  loadSettings,
  PROGRESS_STORAGE_PREFIX,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  type GameSettings,
  type QualitySetting,
} from './Settings';
import { summarizeTeamStats } from './BattleStats';
import { loadStoredLineup, saveStoredLineup } from './LineupStore';
import {
  CHALLENGE_PLAYER_BUDGET,
  CHALLENGE_TIME_LIMIT_SECONDS,
  ChallengeRun,
  computeSurvivalRatio,
  createChallengeSeed,
  generateEnemyLineup,
  loadChallengeBest,
  mergeChallengeBest,
  saveChallengeBest,
  type ChallengeBest,
  type ChallengeEndReason,
} from './ChallengeMode';
import {
  VersusSession,
  getVersusPlacementFacing,
  getVersusZones,
  isInsideVersusZone,
  type PlayerCount,
} from './VersusMode';

/** 配置の可否と、置くときの陣営・向き */
interface PlacementCheck {
  team: Team;
  facing?: number;
  valid: boolean;
  /** 置けない理由（プレイヤーに見せる文言） */
  warning: string | null;
}

interface PlacedRecord {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  team: Team;
  x: number;
  z: number;
  facing?: number;
  /** かさね配置: このレコードが「同じ lineup 内の onTopOf 番目のレコードの上に乗る」ことを示す */
  onTopOf?: number;
  gateLevel?: number;
  level?: number;
  relicLevel?: number;
  boss?: boolean;
}

export interface PresetScenario {
  name: string;
  description: string;
  units: PlacedRecord[];
}

export const PRESETS: readonly PresetScenario[] = [
  {
    name: '標準合戦',
    description: '前衛の棍棒・剣士・槍兵と後衛の弓兵が激突する基本編成',
    units: [
      // 赤軍 (x < 0)
      { typeId: 'swordsman', team: 0, x: -4.5, z: -3.0 },
      { typeId: 'swordsman', team: 0, x: -4.5, z: 0.0 },
      { typeId: 'swordsman', team: 0, x: -4.5, z: 3.0 },
      { typeId: 'spearman', team: 0, x: -6.5, z: -2.0 },
      { typeId: 'spearman', team: 0, x: -6.5, z: 2.0 },
      { typeId: 'clubber', team: 0, x: -3.2, z: -4.8 },
      { typeId: 'clubber', team: 0, x: -3.2, z: 4.8 },
      { typeId: 'archer', team: 0, x: -11.0, z: -3.5 },
      { typeId: 'archer', team: 0, x: -11.0, z: 0.0 },
      { typeId: 'archer', team: 0, x: -11.0, z: 3.5 },
      // 青軍 (x > 0)
      { typeId: 'swordsman', team: 1, x: 4.5, z: -3.0 },
      { typeId: 'swordsman', team: 1, x: 4.5, z: 0.0 },
      { typeId: 'swordsman', team: 1, x: 4.5, z: 3.0 },
      { typeId: 'spearman', team: 1, x: 6.5, z: -2.0 },
      { typeId: 'spearman', team: 1, x: 6.5, z: 2.0 },
      { typeId: 'clubber', team: 1, x: 3.2, z: -4.8 },
      { typeId: 'clubber', team: 1, x: 3.2, z: 4.8 },
      { typeId: 'archer', team: 1, x: 11.0, z: -3.5 },
      { typeId: 'archer', team: 1, x: 11.0, z: 0.0 },
      { typeId: 'archer', team: 1, x: 11.0, z: 3.5 },
    ],
  },
  {
    name: '巨人 vs 大軍勢',
    description: '赤軍の巨人 2 体に、青軍の歩兵・槍兵・弓兵の大軍が挑む',
    units: [
      { typeId: 'giant', team: 0, x: -6.0, z: -2.8 },
      { typeId: 'giant', team: 0, x: -6.0, z: 2.8 },
      { typeId: 'archer', team: 0, x: -12.0, z: -2.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 2.0 },
      // 青軍
      { typeId: 'spearman', team: 1, x: 4.5, z: -5.0 },
      { typeId: 'spearman', team: 1, x: 4.5, z: -2.5 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 0.0 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 2.5 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 5.0 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: -3.6 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: -1.2 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: 1.2 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: 3.6 },
      { typeId: 'archer', team: 1, x: 12.5, z: -4.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: -1.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: 1.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: 4.5 },
    ],
  },
  {
    name: '全兵種総力戦',
    description: '巨人を含む全兵種が入り乱れる大乱闘',
    units: [
      { typeId: 'giant', team: 0, x: -6.5, z: 0.0 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: -3.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: -1.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: 1.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: 3.6 },
      { typeId: 'spearman', team: 0, x: -6.2, z: -4.5 },
      { typeId: 'spearman', team: 0, x: -6.2, z: 4.5 },
      { typeId: 'clubber', team: 0, x: -3.0, z: -5.5 },
      { typeId: 'clubber', team: 0, x: -3.0, z: 5.5 },
      { typeId: 'archer', team: 0, x: -12.0, z: -4.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 0.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 4.0 },

      { typeId: 'giant', team: 1, x: 6.5, z: 0.0 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -3.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 3.6 },
      { typeId: 'spearman', team: 1, x: 6.2, z: -4.5 },
      { typeId: 'spearman', team: 1, x: 6.2, z: 4.5 },
      { typeId: 'clubber', team: 1, x: 3.0, z: -5.5 },
      { typeId: 'clubber', team: 1, x: 3.0, z: 5.5 },
      { typeId: 'archer', team: 1, x: 12.0, z: -4.0 },
      { typeId: 'archer', team: 1, x: 12.0, z: 0.0 },
      { typeId: 'archer', team: 1, x: 12.0, z: 4.0 },
    ],
  },
  {
    name: '魔法＆神話モンスター決戦',
    description: '雷導師・重力術師・紅蓮ドラゴン・分裂スライム・大鷲・戦象が激突',
    units: [
      { typeId: 'dragon', team: 0, x: -7.5, z: 0.0 },
      { typeId: 'slime', team: 0, x: -4.5, z: -3.2 },
      { typeId: 'slime', team: 0, x: -4.5, z: 3.2 },
      { typeId: 'archmage', team: 0, x: -11.5, z: -2.8 },
      { typeId: 'gravimancer', team: 0, x: -11.5, z: 2.8 },

      { typeId: 'warelephant', team: 1, x: 6.8, z: 0.0 },
      { typeId: 'giant_eagle', team: 1, x: 5.5, z: -4.2 },
      { typeId: 'giant_eagle', team: 1, x: 5.5, z: 4.2 },
      { typeId: 'archmage', team: 1, x: 11.5, z: -2.8 },
      { typeId: 'gravimancer', team: 1, x: 11.5, z: 2.8 },
    ],
  },
  {
    name: '和風軍団 vs 現代兵器',
    description: '居合の剣豪とからくり忍者の急襲に、ガトリング重装兵と対物スナイパーが迎え撃つ',
    units: [
      { typeId: 'samurai', team: 0, x: -4.5, z: -3.6 },
      { typeId: 'samurai', team: 0, x: -4.5, z: 0.0 },
      { typeId: 'samurai', team: 0, x: -4.5, z: 3.6 },
      { typeId: 'ninja', team: 0, x: -6.5, z: -5.0 },
      { typeId: 'ninja', team: 0, x: -6.5, z: -1.8 },
      { typeId: 'ninja', team: 0, x: -6.5, z: 1.8 },
      { typeId: 'ninja', team: 0, x: -6.5, z: 5.0 },

      { typeId: 'minigunner', team: 1, x: 6.5, z: -2.6 },
      { typeId: 'minigunner', team: 1, x: 6.5, z: 2.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 1.6 },
      { typeId: 'sniper', team: 1, x: 15.0, z: -3.5 },
      { typeId: 'sniper', team: 1, x: 15.0, z: 0.0 },
      { typeId: 'sniper', team: 1, x: 15.0, z: 3.5 },
    ],
  },
  {
    name: '使徒神の降臨（エヴァ使徒ライク）',
    description: '幾何神ラミエル・使徒神サキエル・拒絶神ゼルエル・天落神サハクィエルが降臨！強大なATフィールドと神話的破壊力に現代・神話連合軍が挑む',
    units: [
      { typeId: 'giant_robot', team: 0, x: -9.0, z: 0.0 },
      { typeId: 'giant_tank', team: 0, x: -11.5, z: -3.5 },
      { typeId: 'dragon', team: 0, x: -7.0, z: -3.0 },
      { typeId: 'satellite_soldier', team: 0, x: -14.0, z: 2.5 },
      { typeId: 'sniper', team: 0, x: -14.5, z: -2.0 },
      { typeId: 'archmage', team: 0, x: -11.0, z: 3.0 },
      { typeId: 'warelephant', team: 0, x: -6.5, z: 3.5 },

      { typeId: 'angel_ramiel', team: 1, x: 13.0, z: 0.0 },
      { typeId: 'angel_sachiel', team: 1, x: 6.5, z: -3.0 },
      { typeId: 'angel_zeruel', team: 1, x: 6.0, z: 3.0 },
      { typeId: 'angel_sahaquiel', team: 1, x: 10.5, z: 3.5 },
    ],
  },
  {
    name: '全15兵種カオス大合戦',
    description: '魔法・現代兵器・和風・動物・架空生物の全15ユニットが一堂に会する頂上決戦',
    units: [
      { typeId: 'dragon', team: 0, x: -8.0, z: -2.8 },
      { typeId: 'warelephant', team: 0, x: -6.5, z: 2.8 },
      { typeId: 'samurai', team: 0, x: -4.2, z: -4.5 },
      { typeId: 'ninja', team: 0, x: -4.2, z: 4.5 },
      { typeId: 'slime', team: 0, x: -4.0, z: 0.0 },
      { typeId: 'giant_eagle', team: 0, x: -6.0, z: -6.2 },
      { typeId: 'minigunner', team: 0, x: -9.5, z: 0.0 },
      { typeId: 'archmage', team: 0, x: -12.0, z: -3.5 },
      { typeId: 'gravimancer', team: 0, x: -12.0, z: 3.5 },
      { typeId: 'sniper', team: 0, x: -16.5, z: 0.0 },

      { typeId: 'dragon', team: 1, x: 8.0, z: 2.8 },
      { typeId: 'warelephant', team: 1, x: 6.5, z: -2.8 },
      { typeId: 'samurai', team: 1, x: 4.2, z: 4.5 },
      { typeId: 'ninja', team: 1, x: 4.2, z: -4.5 },
      { typeId: 'slime', team: 1, x: 4.0, z: 0.0 },
      { typeId: 'giant_eagle', team: 1, x: 6.0, z: 6.2 },
      { typeId: 'minigunner', team: 1, x: 9.5, z: 0.0 },
      { typeId: 'archmage', team: 1, x: 12.0, z: 3.5 },
      { typeId: 'gravimancer', team: 1, x: 12.0, z: -3.5 },
      { typeId: 'sniper', team: 1, x: 16.5, z: 0.0 },
    ],
  },
  {
    name: '要塞拠点戦（ポータル＆防衛砲台）',
    description: '赤軍の召喚ポータルと加護トーテムによる無限増援に、青軍の防衛キャノン砲台と精鋭部隊が立ち向かう！',
    units: [
      { facilityId: 'barracks', team: 0, x: -11.0, z: 0.0 },
      { facilityId: 'buff_totem', team: 0, x: -7.5, z: 0.0 },
      { typeId: 'swordsman', team: 0, x: -5.0, z: -2.5 },
      { typeId: 'swordsman', team: 0, x: -5.0, z: 2.5 },
      { typeId: 'shielder', team: 0, x: -3.5, z: 0.0 },
      { typeId: 'archer', team: 0, x: -9.0, z: -3.5 },
      { typeId: 'archer', team: 0, x: -9.0, z: 3.5 },

      { facilityId: 'cannon_tower', team: 1, x: 9.5, z: -3.5 },
      { facilityId: 'cannon_tower', team: 1, x: 9.5, z: 3.5 },
      { typeId: 'shielder', team: 1, x: 4.5, z: -2.0 },
      { typeId: 'shielder', team: 1, x: 4.5, z: 2.0 },
      { typeId: 'spearman', team: 1, x: 6.5, z: -3.5 },
      { typeId: 'spearman', team: 1, x: 6.5, z: 3.5 },
      { typeId: 'archer', team: 1, x: 12.0, z: 0.0 },
    ],
  },
  {
    name: '増殖ゲート大突撃戦',
    description: '中央に設置された増殖ゲートをくぐり抜けた歩兵たちが2倍に増殖して激突するダイナミック合戦！',
    units: [
      { facilityId: 'multiplier_gate', team: 0, x: -3.5, z: 0.0 },
      { typeId: 'clubber', team: 0, x: -9.0, z: -3.0 },
      { typeId: 'clubber', team: 0, x: -9.0, z: -1.0 },
      { typeId: 'clubber', team: 0, x: -9.0, z: 1.0 },
      { typeId: 'clubber', team: 0, x: -9.0, z: 3.0 },
      { typeId: 'swordsman', team: 0, x: -11.0, z: -1.8 },
      { typeId: 'swordsman', team: 0, x: -11.0, z: 1.8 },

      { facilityId: 'multiplier_gate', team: 1, x: 3.5, z: 0.0 },
      { typeId: 'clubber', team: 1, x: 9.0, z: -3.0 },
      { typeId: 'clubber', team: 1, x: 9.0, z: -1.0 },
      { typeId: 'clubber', team: 1, x: 9.0, z: 1.0 },
      { typeId: 'clubber', team: 1, x: 9.0, z: 3.0 },
      { typeId: 'swordsman', team: 1, x: 11.0, z: -1.8 },
      { typeId: 'swordsman', team: 1, x: 11.0, z: 1.8 },
    ],
  },
];

/** 決着の瞬間のスロー演出（実時間の秒数と速度倍率） */
const FINISH_SLOWMO_SECONDS = 1.3;
const FINISH_SLOWMO_SCALE = 0.3;
/** 決着からリザルトを表示するまでの実時間の秒数 */
const FINISH_BANNER_DELAY_SECONDS = 1.5;
/** 勝者が喜んで跳ねる間隔（実時間の秒数） */
const CELEBRATE_INTERVAL_SECONDS = 0.8;
/** 画面を揺らす大きな衝撃エフェクトと揺れの強さ */
const SHAKE_BY_EFFECT: Readonly<Record<string, number>> = {
  bomb_explosion: 0.12,
  rocket_explosion: 0.16,
  tank_explosion: 0.24,
  eruption_explosion: 0.24,
  yamamuron_awaken: 0.5,
  yamamuron_quake: 0.4,
  robot_punch_impact: 0.26,
  satellite_beam: 0.2,
  ramiel_beam: 0.22,
  sachiel_cross: 0.28,
  sahaquiel_bomb: 0.3,
  gravity_blast: 0.16,
  facility_destroy: 0.16,
  stage_meteor_impact: 0.42,
};

/** ドット絵のハート（7×6 マス）。X が本体、o がハイライト */
const HEART_PIXELS = ['.XX.XX.', 'XoXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const HEART_SVG_BODY = HEART_PIXELS.map((row, y) =>
  [...row]
    .map((c, x) => (c === '.' ? '' : `<rect x="${x}" y="${y}" width="1.02" height="1.02"${c === 'o' ? ' class="shine"' : ''}/>`))
    .join(''),
).join('');

/** 作戦室の左上のロゴ（タイトルと同じドットの立体文字） */
const ROOM_LOGO_VOXEL: VoxelTextOptions = { height: 32, maxCell: 2, depth: 2, bold: true };

/** 速度ボタンの定義 */
const SPEED_OPTIONS: ReadonlyArray<{ label: string; scale: number; pause?: boolean }> = [
  { label: '⏸ 停止', scale: 0, pause: true },
  { label: '🐢 0.25x', scale: 0.25 },
  { label: '▶ 1x', scale: 1.0 },
  { label: '⏩ 2x', scale: 2.0 },
  { label: '⏭ 4x', scale: 4.0 },
];

export type GameMode = 'placement' | 'battle';
export type PlayStyle = 'arcade' | 'sandbox' | 'versus' | 'challenge' | 'roguelite';

const DAMAGE_MODE_STORAGE_KEY = 'tabs_voxel_damage_numbers_v1';

/** ローグライトの進軍門が開戦時に滑り始める X 座標（自軍の配置エリアの後端） */

/** 編成の個体が生きているか（巨大化・縮小の門で作り直された個体は後継の生死で見る） */
function isRosterAlive(entity: Unit | Facility): boolean {
  let current = entity;
  while ('replacedBy' in current && current.replacedBy) current = current.replacedBy;
  return current.alive;
}

/** 勝敗バナーの見出し（バナーの幅 min(92vw, 420px) から余白を除いた範囲に収める） */
const BANNER_VOXEL: VoxelTextOptions = {
  height: 48,
  maxCell: 3,
  depth: 2,
  maxWidth: () => Math.min(window.innerWidth * 0.92, 420) - 60,
};

/**
 * ゲーム全体の進行管理と UI バインディング。
 * - アーケードモード: 全40面、ステージ予算上限、地形ギミック、クリア評価（★1〜★3）と新ユニット解放
 * - 友人対戦モード: 2〜4人オフライン対戦、ランダム初期予算＋手動編集、ブラインド順番配置＆全員完了で戦闘開始
 * - サンドボックスモード: 地面クリックで両軍に自由配置（左半分=赤軍、右半分=青軍）
 * - チャレンジモード: 自軍2000pt固定で、増え続けるランダムな敵に1敗するまで挑み続ける
 */
export class GameApp {
  readonly battle = new Battle();
  readonly view: SceneView;
  readonly sound = new SoundManager();
  readonly music = new MusicPlayer();
  private settings: GameSettings = loadSettings();
  private readonly adaptiveQuality = new AdaptiveQuality();
  /** 現在の描画品質（2 が最高） */
  private qualityLevel: 0 | 1 | 2 = 2;

  playStyle: PlayStyle = 'arcade';
  currentStageIndex = 0;
  arcadeSave: ArcadeSaveData = loadArcadeSave();
  readonly versus = new VersusSession(2);
  /** 進行中（または直前）のチャレンジのラン */
  challenge = new ChallengeRun(0);
  private challengeBest: ChallengeBest = loadChallengeBest();
  /** NEW RECORD 判定に使う、ラン開始時点のベスト記録 */
  private challengeBestAtRunStart: ChallengeBest = this.challengeBest;
  /** 使用予算・生存率の集計対象（戦闘開始時の自軍。召喚や増殖で増えた分は含めない） */
  private playerRoster: Array<Unit | Facility> = [];

  /** タイトル画面の背景で自動対戦を流している間 true（音を鳴らさない） */
  private onTitleScreen = false;
  private titleLogo: TitleLogo3D | null = null;
  private tutorial: TutorialGuide | null = null;
  private tutorialHighlight: HTMLElement | null = null;

  /** 進行中（または直前）のローグライトのラン */
  rogue: RogueliteRun | null = null;
  private rogueMeta: RogueMeta = loadRogueMeta();
  /** 戦闘ごとの与ダメージ集計（戦闘後の内訳・成長曲線） */
  readonly battleStats = new DamageStats(0);
  readonly rogueRules = new RogueliteRules(this.battleStats);
  private rogueRoster: Array<Unit | Facility> = [];
  /** 敵の撃破で出るボーナスのルーレット */
  private readonly jackpot = new JackpotRoulette();
  private jackpotTracker = new JackpotDropTracker(0);
  /** 敵が戦場に落とした宝箱（SceneView の初回利用時に作る） */
  private droppedChestsField: DroppedChests | null = null;
  /** 開けずに戦闘が終わった宝箱の個数と、回収したゴールド */
  private jackpotCollected = { count: 0, gold: 0 };
  /** 戦闘開始時点の自軍ユニットの最大HP合計（宝箱ドロップ率のHP連動用） */
  private jackpotAllyMaxHpTotal = 0;
  private jackpotRewards: JackpotReward[] = [];
  private readonly elRoguePanel: HTMLElement | null;
  private readonly elRogueModal: HTMLElement | null;
  private elEnemyDetail: HTMLElement | null = null;
  private enemyDetailPinned: string | null = null;
  private rogueTagKey = '';
  /** カードの中で動くボクセルモデル（最初に開いたときに作る） */
  private unitPreviews: UnitPreviews | null = null;
  private readonly roomFx = new WarRoomFx();
  /** 作戦室で最後に操作したカード（枠を強調する） */
  private roomSelectedUnit: UnitTypeId | null = null;
  /** 開いているローグライトの画面の種類 */
  private rogueModalKind: 'starter' | 'rewards' | 'room' | null = null;
  private rogueHudKey = '';
  private rogueRankKey = '';
  private rogueRankAt = 0;
  /** 開戦時のゲート演出（スキップに使う） */
  private rogueGateSequence: RogueGateSequence | null = null;

  /** ダメージ数字・HPバーのオーバーレイ */
  readonly damageOverlay: DamageOverlay;

  mode: GameMode = 'placement';
  selectedId: UnitTypeId | FacilityTypeId = 'clubber';
  get selectedType(): UnitTypeId {
    return isFacilityTypeId(this.selectedId) ? 'clubber' : this.selectedId;
  }
  set selectedType(val: UnitTypeId) {
    this.selectedId = val;
  }
  selectedCategory: PaletteCategory | 'all' = 'all';
  timeScale = 1.0;
  paused = false;

  /** スマホや狭い画面で視界を塞がないための UI 表示状態 */
  sidePanelVisible = true;
  hudHidden = false;
  unitBarCollapsed = false;
  touchEraseMode = false;
  unitDetailVisible = false;

  /** 配置フェーズで置かれた編成（リトライ時に復元する） */
  private savedLineup: PlacedRecord[] = [];
  private announcedResult: BattleResult = null;
  private pointerDownPos = { x: 0, y: 0, button: -1 };
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** 決着スローの残り（実時間の秒数） */
  private finishSlowMoTimer = 0;
  /** リザルト表示までの残り（実時間の秒数。0 なら予約なし） */
  private bannerRevealTimer = 0;
  private celebrateTimer = 0;
  private titleDemoRestartTimer = 0;
  private finishSequenceActive = false;
  /** 最後に誰かが倒された位置（決着カメラの注視点） */
  private readonly lastKillPos = new Vector3();
  private hasLastKillPos = false;
  /** 配置レコードと戦場の実体の対応（物理で位置がずれても確実に同じ個体を消すため） */
  private placedEntities = new WeakMap<PlacedRecord, Unit | Facility>();
  /** マウスドラッグによる連続配置の状態 */
  private paintStroke: { lastX: number; lastZ: number } | null = null;
  /** 全消去の取り消し用に控えた編成 */
  private clearedBackup: PlacedRecord[] = [];

  // UI 要素
  private readonly elTopHud: HTMLElement | null;
  private readonly elSidePanel: HTMLElement | null;
  private readonly elBottomHud: HTMLElement | null;
  private readonly elTogglePanelBtn: HTMLButtonElement | null;
  private readonly elTouchEraseBtn: HTMLButtonElement | null;
  private readonly elRestoreHudBtn: HTMLButtonElement | null;
  private readonly elRedStats: HTMLElement;
  private readonly elBlueStats: HTMLElement;
  private readonly elYellowStats: HTMLElement | null;
  private readonly elGreenStats: HTMLElement | null;
  private readonly elVersusHudBar: HTMLElement | null;
  private readonly elVersusHudBudget: HTMLInputElement | null;
  private readonly elVersusBudgetInput: HTMLInputElement | null;
  private readonly elVersusTurnStatus: HTMLElement | null;
  private readonly elStartBtn: HTMLButtonElement;
  private readonly elPhaseBadge: HTMLElement;
  private readonly elBanner: HTMLElement;
  private readonly elBannerStars: HTMLElement | null;
  private readonly elBannerText: HTMLElement;
  private readonly elBannerSub: HTMLElement;
  private readonly elBannerUnlock: HTMLElement | null;
  private readonly elBannerChallenge: HTMLElement | null;
  private readonly elRetryBtn: HTMLButtonElement | null;
  private readonly elChallengeStatus: HTMLElement | null;
  private readonly elNextStageBtn: HTMLButtonElement | null;
  private readonly elCategoryTabs: HTMLElement | null;
  private readonly elUnitBar: HTMLElement;
  private readonly elSpeedButtons: HTMLButtonElement[] = [];

  // ユニット詳細オーバーレイ UI 要素
  private readonly elUnitDetailOverlay: HTMLElement | null;
  private readonly elDetailAvatar: HTMLElement | null;
  private readonly elDetailName: HTMLElement | null;
  private readonly elDetailCatBadge: HTMLElement | null;
  private readonly elDetailFeaturedTag: HTMLElement | null;
  private readonly elDetailCloseBtn: HTMLButtonElement | null;
  private readonly elDetailStatsRow: HTMLElement | null;
  private readonly elDetailDesc: HTMLElement | null;
  private readonly elDetailFeaturedNote: HTMLElement | null;
  private readonly elToggleDetailBtn: HTMLButtonElement | null;

  constructor(viewport: HTMLElement) {
    this.view = new SceneView(viewport);

    this.battle.onUnitAdded = (u) => this.view.addUnitVisual(u);
    this.battle.onUnitRemoved = (u) => this.view.removeUnitVisual(u);
    this.battle.onFacilityAdded = (f) => this.view.addFacilityVisual(f);
    this.battle.onFacilityRemoved = (f) => this.view.removeFacilityVisual(f);
    this.battle.onPlayFacilitySound = (k) => {
      if (!this.onTitleScreen) this.sound.playEffect({ kind: k } as any);
    };
    this.battle.combat.onShootArrow = () => {
      if (!this.onTitleScreen) this.sound.playBowShoot();
    };
    this.battle.combat.onEffect = (e) => {
      this.view.spawnCombatEffect(e);
      if (this.onTitleScreen) return;
      this.sound.playEffect(e);
      const shake = SHAKE_BY_EFFECT[e.kind];
      if (shake !== undefined) this.view.addCameraShake(shake);
    };
    this.damageOverlay = new DamageOverlay(viewport, this.view.camera);
    this.damageOverlay.mode = loadDamageMode();
    this.battle.combat.damageListeners.push((e) => {
      this.damageOverlay.onDamage(e);
      if (this.mode === 'battle') this.battleStats.record(e);
      if (this.playStyle === 'roguelite') {
        this.rogueRules.onDamage(e);
        if (e.killed && e.victim.team !== 0) this.onRogueEnemyKilled(e.victim, e.pos);
      }
    });
    this.battle.combat.onHit = (e) => {
      const partBroken = this.view.spawnHitEffect(e);
      if (this.onTitleScreen) return;
      const wKind = e.attacker.type.weapon?.kind;
      const heavy =
        e.attacker.type.id === 'giant' ||
        e.attacker.type.id === 'warelephant' ||
        e.attacker.type.id === 'dragon' ||
        e.damage >= 40;
      const metallic =
        wKind === 'sword' || wKind === 'spear' || wKind === 'katana' || wKind === 'axe' || e.kind === 'slash';
      this.sound.playHit(heavy, metallic, partBroken || e.killed);
      if (e.killed) {
        this.lastKillPos.copy(e.point);
        this.hasLastKillPos = true;
      }
      if (e.damage >= 45) this.view.addCameraShake(e.damage / 420);
    };

    this.elTopHud = document.getElementById('top-hud');
    this.elSidePanel = document.getElementById('side-panel');
    this.elBottomHud = document.getElementById('bottom-hud');
    this.elTogglePanelBtn = document.getElementById('btn-toggle-panel') as HTMLButtonElement | null;
    this.elTouchEraseBtn = document.getElementById('btn-touch-erase') as HTMLButtonElement | null;
    this.elRestoreHudBtn = document.getElementById('btn-restore-hud') as HTMLButtonElement | null;
    this.elRedStats = document.getElementById('red-stats')!;
    this.elBlueStats = document.getElementById('blue-stats')!;
    this.elYellowStats = document.getElementById('yellow-stats');
    this.elGreenStats = document.getElementById('green-stats');
    this.elVersusHudBar = document.getElementById('versus-hud-bar');
    this.elVersusHudBudget = document.getElementById('versus-hud-budget') as HTMLInputElement | null;
    this.elVersusBudgetInput = document.getElementById('versus-budget-input') as HTMLInputElement | null;
    this.elVersusTurnStatus = document.getElementById('versus-turn-status');
    this.elStartBtn = document.getElementById('btn-start') as HTMLButtonElement;
    this.elPhaseBadge = document.getElementById('phase-badge')!;
    this.elBanner = document.getElementById('result-banner')!;
    this.elBannerStars = document.getElementById('result-stars');
    this.elBannerText = document.getElementById('result-title')!;
    this.elBannerSub = document.getElementById('result-sub')!;
    this.elBannerUnlock = document.getElementById('result-unlock');
    this.elBannerChallenge = document.getElementById('result-challenge');
    this.elRetryBtn = document.getElementById('btn-retry') as HTMLButtonElement | null;
    this.elChallengeStatus = document.getElementById('challenge-status');
    this.elNextStageBtn = document.getElementById('btn-next-stage') as HTMLButtonElement | null;
    this.elCategoryTabs = document.getElementById('category-tabs');
    this.elUnitBar = document.getElementById('unit-bar')!;

    // ユニット詳細オーバーレイ要素の取得
    this.elUnitDetailOverlay = document.getElementById('unit-detail-overlay');
    this.elDetailAvatar = document.getElementById('detail-avatar');
    this.elDetailName = document.getElementById('detail-name');
    this.elDetailCatBadge = document.getElementById('detail-cat-badge');
    this.elDetailFeaturedTag = document.getElementById('detail-featured-tag');
    this.elDetailCloseBtn = document.getElementById('btn-close-detail') as HTMLButtonElement | null;
    this.elDetailStatsRow = document.getElementById('detail-stats-row');
    this.elDetailDesc = document.getElementById('detail-desc');
    this.elDetailFeaturedNote = document.getElementById('detail-featured-note');
    this.elToggleDetailBtn = document.getElementById('btn-toggle-detail') as HTMLButtonElement | null;
    this.elRoguePanel = document.getElementById('roguelite-status');
    this.elRogueModal = document.getElementById('rogue-modal');

    // スマホ等の狭い画面では初期状態でゲームモードパネルを非表示にして戦場を見やすくする
    this.buildUI();
    this.applySettings();
    this.syncSidePanelUI();
    this.bindCanvasInteraction();
    this.bindTitleScreen();
    this.showTitleScreen();
  }

  get currentStage(): ArcadeStage {
    return ARCADE_STAGES[this.currentStageIndex] ?? ARCADE_STAGES[0];
  }

  private getCurrentTeamCost(team: Team = 0): number {
    let cost = 0;
    for (const u of this.battle.units) {
      if (u.team === team && u.splitGen === 0) {
        cost += UNIT_TYPES[u.type.id].cost;
      }
    }
    for (const f of this.battle.facilities) {
      if (f.team === team) {
        cost += f.type.cost;
      }
    }
    return cost;
  }

  private getCurrentRedCost(): number {
    return this.getCurrentTeamCost(0);
  }

  private getCurrentRedPlacedCount(): number {
    let count = 0;
    for (const u of this.battle.units) {
      if (u.team === 0 && u.splitGen === 0) count++;
    }
    for (const f of this.battle.facilities) {
      if (f.team === 0 && !f.isTerrain) count++;
    }
    return count;
  }

  private getItemCost(id: UnitTypeId | FacilityTypeId): number {
    return isFacilityTypeId(id) ? FACILITY_TYPES[id].cost : UNIT_TYPES[id].cost;
  }

  /** ゲームモード・ステージ設定パネル（左パネル）の表示/非表示を同期 */
  private syncSidePanelUI(): void {
    this.elSidePanel?.classList.toggle('panel-hidden', !this.sidePanelVisible);
    if (this.elTogglePanelBtn) {
      this.elTogglePanelBtn.classList.toggle('active', this.sidePanelVisible);
      this.elTogglePanelBtn.textContent = '☰ メニュー';
    }
  }

  /** 全UI非表示モード（観戦・スマホ広域表示）の同期 */
  private syncHudVisibility(): void {
    this.elTopHud?.classList.toggle('hud-hidden', this.hudHidden);
    this.elSidePanel?.classList.toggle('hud-hidden', this.hudHidden);
    this.elBottomHud?.classList.toggle('hud-hidden', this.hudHidden);
    this.elRestoreHudBtn?.classList.toggle('hidden', !this.hudHidden);
    document.getElementById('rogue-hud')?.classList.toggle('hud-hidden', this.hudHidden);
    this.syncUnitDetailOverlay();
  }

  /** 選択中のゲームモードに合わせて、サイドパネル内のモード別セクションの表示を切り替える（モード選択はタイトル画面で行う） */
  private syncModePanels(): void {
    const modes: ReadonlyArray<[PlayStyle, string]> = [
      ['arcade', 'arcade-panel'],
      ['versus', 'versus-panel'],
      ['sandbox', 'sandbox-panel'],
      ['challenge', 'challenge-panel'],
      ['roguelite', 'roguelite-panel'],
    ];
    for (const [style, panelId] of modes) {
      document.getElementById(panelId)?.classList.toggle('hidden', this.playStyle !== style);
    }
    // ローグライトの戦闘ルールはローグライトのときだけ有効にする
    this.battle.rules = this.playStyle === 'roguelite' ? this.rogueRules : null;
    if (this.playStyle !== 'roguelite') this.hideRogueModal();
    // 残機ハートはローグライトモードのときだけ表示する
    this.view.setRogueHeartsVisible(this.playStyle === 'roguelite');
    document.body.classList.toggle('rogue-mode', this.playStyle === 'roguelite');
  }

  private buildUI(): void {
    // ユニット詳細説明オーバーレイの閉じるボタン
    this.elDetailCloseBtn?.addEventListener('click', () => {
      this.hideUnitDetailOverlay();
    });

    // ユニット詳細説明の表示/非表示トグルボタン
    this.elToggleDetailBtn?.addEventListener('click', () => {
      this.toggleUnitDetailOverlay();
    });

    // ゲームモードパネル（左サイドパネル）の表示/非表示トグル
    this.elTogglePanelBtn?.addEventListener('click', () => {
      this.sidePanelVisible = !this.sidePanelVisible;
      this.syncSidePanelUI();
    });

    document.getElementById('btn-close-panel')?.addEventListener('click', () => {
      this.sidePanelVisible = false;
      this.syncSidePanelUI();
    });

    // 全UI非表示／再表示ボタン
    document.getElementById('btn-toggle-hud')?.addEventListener('click', () => {
      this.hudHidden = true;
      this.syncHudVisibility();
    });

    this.elRestoreHudBtn?.addEventListener('click', () => {
      this.hudHidden = false;
      this.syncHudVisibility();
    });

    // 下部兵種バーの折りたたみトグル
    const btnToggleUnitBar = document.getElementById('btn-toggle-unitbar');
    if (btnToggleUnitBar) {
      btnToggleUnitBar.addEventListener('click', () => {
        this.unitBarCollapsed = !this.unitBarCollapsed;
        this.elUnitBar.classList.toggle('collapsed', this.unitBarCollapsed);
        btnToggleUnitBar.textContent = this.unitBarCollapsed ? '▲ 兵種バーを開く' : '▼ 兵種バー';
      });
    }

    // タップ削除モード切り替えボタン（スマホ操作補助）
    if (this.elTouchEraseBtn) {
      const syncEraseBtn = () => {
        if (!this.elTouchEraseBtn) return;
        this.elTouchEraseBtn.classList.toggle('danger', this.touchEraseMode);
        this.elTouchEraseBtn.classList.toggle('active', this.touchEraseMode);
        this.elTouchEraseBtn.textContent = this.touchEraseMode ? '🗑 削除: ON' : '🗑 削除';
      };
      syncEraseBtn();
      this.elTouchEraseBtn.addEventListener('click', () => {
        this.touchEraseMode = !this.touchEraseMode;
        syncEraseBtn();
      });
    }

    document.getElementById('btn-to-title')?.addEventListener('click', () => {
      if (this.blockLeavingChallenge()) return;
      this.showTitleScreen();
    });

    document.getElementById('btn-challenge-quit')?.addEventListener('click', () => {
      this.confirmQuitChallenge();
    });

    document.getElementById('btn-rogue-shop')?.addEventListener('click', () => this.showRogueWarRoom());
    document.getElementById('btn-rogue-quit')?.addEventListener('click', () => {
      this.confirmQuitRogue();
    });

    // 数値表示（ダメージ数字）の量の切り替え
    const dmgModeContainer = document.getElementById('damage-mode-buttons');
    if (dmgModeContainer) {
      const modes: DamageNumberMode[] = ['all', 'big', 'off'];
      const buttons: HTMLButtonElement[] = [];
      for (const m of modes) {
        const b = document.createElement('button');
        b.className = 'ctrl-btn' + (this.damageOverlay.mode === m ? ' active' : '');
        b.textContent = DAMAGE_NUMBER_MODE_LABELS[m];
        b.addEventListener('click', () => {
          this.damageOverlay.mode = m;
          saveDamageMode(m);
          buttons.forEach((x) => x.classList.toggle('active', x === b));
          if (m === 'off') this.damageOverlay.clear();
        });
        dmgModeContainer.appendChild(b);
        buttons.push(b);
      }
    }

    // 友人対戦モードの人数選択ボタン（サイドパネル＆上部HUD）
    const bindPlayerCountButtons = (selector: string) => {
      document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
        btn.addEventListener('click', () => {
          const cnt = Number(btn.dataset.pcount) as PlayerCount;
          if (cnt === 2 || cnt === 3 || cnt === 4) {
            this.enterVersusMode(cnt, true);
          }
        });
      });
    };
    bindPlayerCountButtons('#versus-player-buttons button[data-pcount]');
    bindPlayerCountButtons('#versus-hud-players button[data-pcount]');

    // 友人対戦モードの予算ランダム決定ボタン
    const handleRandomBudget = () => {
      if (this.playStyle !== 'versus' || this.mode !== 'placement') return;
      this.versus.randomizeBudget();
      this.syncVersusUI();
      this.syncPhaseUI();
      this.updateHUD();
      this.sound.playPlace();
    };
    document.getElementById('btn-versus-random-budget')?.addEventListener('click', handleRandomBudget);
    document.getElementById('btn-hud-random-budget')?.addEventListener('click', handleRandomBudget);

    // 友人対戦モードの予算手動編集インプット
    const applyManualBudget = (rawVal: string) => {
      const parsed = Number(rawVal);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      this.versus.setBudget(parsed);
      this.syncVersusUI();
      this.syncPhaseUI();
      this.updateHUD();
    };
    this.elVersusBudgetInput?.addEventListener('change', () => {
      if (this.elVersusBudgetInput) applyManualBudget(this.elVersusBudgetInput.value);
    });
    this.elVersusBudgetInput?.addEventListener('input', () => {
      if (this.elVersusBudgetInput) applyManualBudget(this.elVersusBudgetInput.value);
    });
    this.elVersusHudBudget?.addEventListener('change', () => {
      if (this.elVersusHudBudget) applyManualBudget(this.elVersusHudBudget.value);
    });
    this.elVersusHudBudget?.addEventListener('input', () => {
      if (this.elVersusHudBudget) applyManualBudget(this.elVersusHudBudget.value);
    });

    // 友人対戦モードの予算プリセットボタン
    document.querySelectorAll<HTMLButtonElement>('#versus-budget-presets button[data-budget]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.playStyle !== 'versus') return;
        const b = Number(btn.dataset.budget);
        if (Number.isFinite(b) && b > 0) {
          this.versus.setBudget(b);
          this.syncVersusUI();
          this.syncPhaseUI();
          this.updateHUD();
        }
      });
    });

    // 友人対戦モードの新規ラウンドリセットボタン
    document.getElementById('btn-versus-reset')?.addEventListener('click', () => {
      if (this.playStyle !== 'versus') return;
      this.enterVersusMode(this.versus.playerCount, true);
      this.sound.playRemove();
    });

    // 全解放トグルボタン
    const btnUnlockAll = document.getElementById('btn-unlock-all');
    if (btnUnlockAll) {
      const syncUnlockBtn = () => {
        btnUnlockAll.textContent = this.arcadeSave.unlockAllOverride ? '🔓 全解放: ON' : '🔒 全解放: OFF';
      };
      syncUnlockBtn();
      btnUnlockAll.addEventListener('click', () => {
        this.arcadeSave.unlockAllOverride = !this.arcadeSave.unlockAllOverride;
        saveArcadeProgress(this.arcadeSave);
        syncUnlockBtn();
        this.renderArcadeStageButtons();
        this.renderUnitCards();
      });
    }

    // カテゴリ切替タブを生成（アイコン付き）
    if (this.elCategoryTabs) {
      this.elCategoryTabs.innerHTML = '';
      const cats: ReadonlyArray<{ id: PaletteCategory | 'all'; label: string }> = [
        { id: 'all', label: `${CATEGORY_ICONS.all} すべて (${UNIT_TYPE_LIST.length + FACILITY_TYPE_LIST.length})` },
        { id: 'standard', label: `${CATEGORY_ICONS.standard} ${CATEGORY_LABELS.standard}` },
        { id: 'magic', label: `${CATEGORY_ICONS.magic} ${CATEGORY_LABELS.magic}` },
        { id: 'modern', label: `${CATEGORY_ICONS.modern} ${CATEGORY_LABELS.modern}` },
        { id: 'japanese', label: `${CATEGORY_ICONS.japanese} ${CATEGORY_LABELS.japanese}` },
        { id: 'animal', label: `${CATEGORY_ICONS.animal} ${CATEGORY_LABELS.animal}` },
        { id: 'mythical', label: `${CATEGORY_ICONS.mythical} ${CATEGORY_LABELS.mythical}` },
        { id: 'divine', label: `${CATEGORY_ICONS.divine} ${CATEGORY_LABELS.divine}` },
        { id: 'facility', label: `${CATEGORY_ICONS.facility} 施設 (${COMBAT_FACILITY_TYPE_LIST.length})` },
        { id: 'terrain', label: `${CATEGORY_ICONS.terrain} 地形 (${TERRAIN_BLOCK_TYPE_LIST.length})` },
      ];
      cats.forEach((c) => {
        const b = document.createElement('button');
        b.className = 'cat-tab' + (c.id === this.selectedCategory ? ' active' : '');
        b.dataset.cat = c.id;
        b.textContent = c.label;
        b.addEventListener('click', () => {
          this.selectedCategory = c.id;
          this.elCategoryTabs?.querySelectorAll('.cat-tab').forEach((el) => {
            el.classList.toggle('active', (el as HTMLElement).dataset.cat === c.id);
          });
          if (this.unitBarCollapsed) {
            this.unitBarCollapsed = false;
            this.elUnitBar.classList.remove('collapsed');
            const toggleBtn = document.getElementById('btn-toggle-unitbar');
            if (toggleBtn) toggleBtn.textContent = '▼ 兵種バー';
          }
          this.renderUnitCards();
        });
        this.elCategoryTabs!.appendChild(b);
      });
    }

    this.renderArcadeStageButtons();
    this.renderUnitCards();

    // プリセット選択ボタン
    const presetContainer = document.getElementById('preset-buttons')!;
    presetContainer.innerHTML = '';
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn';
      b.textContent = p.name;
      b.title = p.description;
      b.addEventListener('click', () => {
        this.loadPreset(p);
        if (window.innerWidth <= 820) {
          this.sidePanelVisible = false;
          this.syncSidePanelUI();
        }
      });
      presetContainer.appendChild(b);
    });

    // 戦闘開始／配置完了OK／配置に戻るボタン
    this.elStartBtn.addEventListener('click', () => {
      if (this.mode === 'placement') {
        if (this.playStyle === 'versus') {
          this.confirmVersusTurn();
        } else {
          this.startBattle();
        }
      } else if (this.playStyle === 'challenge') {
        this.handleChallengeBattleAction(false);
      } else if (this.playStyle === 'roguelite') {
        this.handleRogueBattleAction(false);
      } else {
        this.returnToPlacement();
      }
    });

    document.getElementById('btn-retry')!.addEventListener('click', () => {
      if (this.playStyle === 'challenge' || this.playStyle === 'roguelite') {
        this.exitChallengeToTitle();
      } else {
        this.returnToPlacement();
      }
    });

    this.elNextStageBtn?.addEventListener('click', () => {
      if (this.playStyle === 'roguelite') {
        this.handleRogueNext();
        return;
      }
      if (this.playStyle === 'challenge') {
        if (this.challenge.ended) this.enterChallengeMode();
        else this.advanceChallengeRound();
        return;
      }
      if (this.playStyle === 'versus') {
        this.enterVersusMode(this.versus.playerCount, true);
        return;
      }
      if (this.currentStageIndex < ARCADE_STAGES.length - 1) {
        this.loadArcadeStage(this.currentStageIndex + 1);
      }
    });

    // 全消去ボタン（アーケードでは自軍のみ、友人対戦では現在手番プレイヤーの配置のみリセット）
    document.getElementById('btn-clear')!.addEventListener('click', () => {
      // チャレンジはリトライ不可のため、戦闘中・決着後は編成を変更できない
      if ((this.playStyle === 'challenge' || this.playStyle === 'roguelite') && this.mode !== 'placement') return;
      if (this.mode !== 'placement') this.returnToPlacement();
      const lineup = this.getActiveLineup();
      const removed = lineup.filter((r) => this.isEditableRecord(r));
      if (removed.length === 0) return;
      // removeRecord が onTopOf を書き換えるので、復元用には消す前の複製を控える
      const backup = removed.map((r) => ({ ...r }));
      for (const record of removed) this.removeRecord(record);
      this.clearedBackup = backup;
      this.showToast('🗑 全消去しました（↶ 戻す / Ctrl+Z で元に戻せます）');
      this.view.clearDebris();
      this.sound.playRemove();
      this.afterLineupEdited();
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => this.undoLastPlacement());

    // メニューを開かずに前後の面へ移動する
    document.getElementById('btn-stage-prev')?.addEventListener('click', () => this.changeStageBy(-1));
    document.getElementById('btn-stage-next')?.addEventListener('click', () => this.changeStageBy(1));

    this.bindSettingsPanel();
    document.getElementById('btn-coach-close')?.addEventListener('click', () => this.tutorial?.finish());

    // ブラウザの制限で、音は最初の操作の後からしか鳴らせない
    const unlockAudio = () => this.music.unlock();
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    // カメラリセット
    document.getElementById('btn-cam-reset')!.addEventListener('click', () => {
      this.view.resetCamera();
    });

    // 速度変更ボタン（サイドパネルと、戦闘中の上部 HUD の 2 か所）
    for (const containerId of ['speed-buttons', 'battle-speed-bar']) {
      const container = document.getElementById(containerId);
      if (!container) continue;
      SPEED_OPTIONS.forEach((option, index) => {
        const b = document.createElement('button');
        b.className = 'ctrl-btn';
        b.textContent = option.label;
        b.addEventListener('click', () => this.applySpeedOption(index));
        container.appendChild(b);
        this.elSpeedButtons.push(b);
        b.dataset.speedIndex = String(index);
      });
    }
    // ローグライトの戦闘 HUD: 速度は右下のセグメント1か所で切り替える（状態は他の速度ボタンと共通）
    const seg = document.getElementById('rg-speed-seg');
    if (seg) {
      SPEED_OPTIONS.forEach((option, index) => {
        if (option.pause || option.scale < 1) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${option.scale}x`;
        b.dataset.speedIndex = String(index);
        b.addEventListener('click', () => this.applySpeedOption(index));
        seg.appendChild(b);
        this.elSpeedButtons.push(b);
      });
    }
    document.getElementById('rg-pause')?.addEventListener('click', () => this.setPaused(!this.paused));
    document.querySelector('.rg-rail')?.addEventListener('click', (ev) => {
      const action = (ev.target as HTMLElement).closest<HTMLElement>('[data-rail]')?.dataset.rail;
      if (action === 'menu') {
        this.setRogueMenuOpen(document.getElementById('rg-menu')?.classList.contains('hidden') ?? false);
        return;
      }
      if (action) this.setRogueMenuOpen(false);
      if (action === 'settings') {
        document.getElementById('btn-settings')?.click();
      } else if (action === 'quit') {
        this.confirmQuitRogue();
      } else if (action === 'title') {
        this.showTitleScreen();
      }
    });
    document.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest?.('.rg-rail')) this.setRogueMenuOpen(false);
    });
    this.bindEnemyDetailPopup();
    this.syncSpeedButtons();

    // キーボードショートカット（Space: 戦闘開始/配置完了OK/戻る、R: 配置に戻る、1〜9: 兵種選択、Tab: メニュー開閉、H: 全UI開閉、Esc: 詳細閉じる）
    window.addEventListener('keydown', (e) => {
      // ボーナス演出中は戦闘の操作を受け付けず、決定キーでスキップだけできる
      if (this.jackpot.active) {
        e.preventDefault();
        if (e.code === 'Space' || e.code === 'Enter') this.jackpot.skip();
        return;
      }
      // 確認ダイアログの表示中は、ダイアログのボタン操作だけを通す
      if (this.isConfirmOpen()) {
        if (e.code === 'Escape') document.getElementById('confirm-dialog')?.classList.add('hidden');
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        this.onTitleScreen
      ) {
        return;
      }
      if (e.code === 'Escape') {
        if (this.view.isFollowingUnit) {
          this.view.setFollowedUnit(null);
        } else if (this.unitDetailVisible) {
          this.hideUnitDetailOverlay();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (this.skipRogueGateSequence()) return;
        if (this.mode === 'placement') {
          if (this.playStyle === 'versus') this.confirmVersusTurn();
          else this.startBattle();
        } else if (this.playStyle === 'challenge') {
          this.handleChallengeBattleAction(true);
        } else if (this.playStyle === 'roguelite') {
          this.handleRogueBattleAction(true);
        } else {
          this.returnToPlacement();
        }
      } else if (e.code === 'Enter') {
        // リザルトの「次へ」をキーボードでも押せるようにする
        if (!this.elBanner.classList.contains('hidden') && !this.elNextStageBtn?.classList.contains('hidden')) {
          e.preventDefault();
          this.elNextStageBtn?.click();
        }
      } else if (e.code === 'KeyP') {
        this.setPaused(!this.paused);
      } else if (e.code === 'KeyF') {
        this.cycleFastForward();
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.undoLastPlacement();
      } else if (e.code === 'KeyR') {
        if (this.mode !== 'placement') this.returnToPlacement();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        this.sidePanelVisible = !this.sidePanelVisible;
        this.syncSidePanelUI();
      } else if (e.code === 'KeyH') {
        this.hudHidden = !this.hudHidden;
        this.syncHudVisibility();
      } else if (e.code.startsWith('Digit')) {
        // カードのクリックと同じ経路にして、施設タブや未解放時の警告も同じ扱いにする
        const n = Number(e.code.replace('Digit', '')) - 1;
        if (this.playStyle === 'roguelite' && this.isRogueModalOpen()) {
          // 報酬の3択は 1〜3 キーでも選べる
          const option = this.rogueModalKind === 'rewards' ? this.rogue?.pendingRewards?.[n] : undefined;
          if (option) this.chooseRogueReward(option);
          return;
        }
        this.elUnitBar.querySelectorAll<HTMLElement>('.unit-card')[n]?.click();
      }
    });
  }

  /** 指定のゲームモードを開始する */
  private enterPlayStyle(style: PlayStyle): void {
    this.playStyle = style;
    this.syncModePanels();
    if (style === 'arcade') this.loadArcadeStage(this.currentStageIndex);
    else if (style === 'versus') this.enterVersusMode(this.versus.playerCount, true);
    else if (style === 'sandbox') this.loadPreset(PRESETS[0]);
    else if (style === 'roguelite') this.enterRogueliteMode();
    else this.enterChallengeMode();
  }

  private bindTitleScreen(): void {
    document.querySelectorAll<HTMLButtonElement>('#title-screen [data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.leaveTitleScreen(button.dataset.mode as PlayStyle));
    });
  }

  /** タイトル画面を開き、背景で自動対戦を流す */
  showTitleScreen(): void {
    this.onTitleScreen = true;
    this.paused = false;
    this.timeScale = 1;
    this.syncSpeedButtons();
    this.setTutorialStep(null);
    this.tutorial = null;
    document.body.classList.add('on-title');
    document.getElementById('title-screen')?.classList.remove('hidden');
    this.titleLogo ??= new TitleLogo3D(document.querySelector<HTMLElement>('.title-logo')!);
    this.renderTitleProgress();
    this.view.setRogueHeartsVisible(false);
    this.view.resetCamera();
    this.view.autoOrbit = true;
    this.startTitleDemo();
    this.music.setTrack('placement');
  }

  /** 背景デモの対戦を始める（決着したら別の編成で繰り返す） */
  private startTitleDemo(): void {
    const demos = [PRESETS[0], PRESETS[2], PRESETS[4], PRESETS[6]];
    this.playStyle = 'sandbox';
    this.loadPreset(demos[Math.floor(Math.random() * demos.length)]);
    this.view.setPlacementGuidesVisible(false);
    this.titleDemoRestartTimer = 0;
    this.battle.beginCombat();
  }

  private updateTitleDemo(realDt: number): void {
    if (this.battle.result() === null) return;
    this.titleDemoRestartTimer += realDt;
    if (this.titleDemoRestartTimer > 3) this.startTitleDemo();
  }

  private renderTitleProgress(): void {
    const arcade = document.getElementById('title-arcade-progress');
    if (arcade) {
      const stars = Object.values(this.arcadeSave.clearedStars).reduce((sum, n) => sum + n, 0);
      const cleared = Object.keys(this.arcadeSave.clearedStars).length;
      arcade.textContent =
        cleared > 0 ? `${cleared} / ${ARCADE_STAGES.length} 面クリア ・ ★${stars}` : `全${ARCADE_STAGES.length}面に挑戦`;
    }
    const rogue = document.getElementById('title-roguelite-progress');
    if (rogue) {
      const meta = this.rogueMeta;
      rogue.textContent =
        meta.bestRound > 0 ? `最高 ROUND ${meta.bestRound} ・ クリア ${meta.clears} 回` : `軍を育てて全${ROGUE_FINAL_ROUND}ラウンド突破`;
    }
    const challenge = document.getElementById('title-challenge-progress');
    if (challenge) {
      const best = this.challengeBest;
      challenge.textContent = best.bestScore > 0 ? `ベスト ${best.bestScore.toLocaleString()} 点` : '1 敗で終了のサバイバル';
    }
  }

  private leaveTitleScreen(style: PlayStyle): void {
    this.onTitleScreen = false;
    document.body.classList.remove('on-title');
    document.getElementById('title-screen')?.classList.add('hidden');
    this.view.autoOrbit = false;
    this.view.resetCamera();
    this.currentStageIndex = this.findNextStageIndex();

    const firstRun = style === 'arcade' && !isTutorialDone();
    // 初回は戦場に集中できるようパネルを閉じ、2 回目以降は十分広い画面なら開く
    this.sidePanelVisible = !firstRun && window.innerWidth > 1100;
    this.syncSidePanelUI();
    this.enterPlayStyle(style);
    if (firstRun) this.startTutorial();
    this.sound.playPlace();
  }

  /** 未クリアで最も若い面（全クリア済みなら最終面） */
  private findNextStageIndex(): number {
    const idx = ARCADE_STAGES.findIndex((st) => !this.arcadeSave.clearedStars[st.stageNumber]);
    return idx >= 0 ? idx : ARCADE_STAGES.length - 1;
  }

  private startTutorial(): void {
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.tutorial = new TutorialGuide(
      buildTutorialSteps(isTouch),
      (step) => this.setTutorialStep(step),
      markTutorialDone,
    );
    this.tutorial.start();
  }

  private notifyTutorial(event: TutorialEvent): void {
    this.tutorial?.notify(event);
  }

  /** 案内の吹き出しと、操作する場所の強調表示を更新する */
  private setTutorialStep(step: TutorialStep | null): void {
    const coach = document.getElementById('coach');
    const text = document.getElementById('coach-text');
    coach?.classList.toggle('hidden', step === null);
    if (text && step) text.textContent = step.text;
    this.tutorialHighlight?.classList.remove('coach-highlight');
    this.tutorialHighlight = step?.highlightId ? document.getElementById(step.highlightId) : null;
    this.tutorialHighlight?.classList.add('coach-highlight');
  }

  private changeStageBy(delta: number): void {
    if (this.playStyle !== 'arcade' || this.mode !== 'placement') return;
    const next = this.currentStageIndex + delta;
    if (next >= 0 && next < ARCADE_STAGES.length) this.loadArcadeStage(next);
  }

  private applySettings(): void {
    this.sound.setVolume(this.settings.sfxVolume);
    this.music.setVolume(this.settings.musicVolume);
    this.applyQualitySetting(this.settings.quality);
    this.view.showHpBars = this.settings.showHpBars;
  }

  private applyQualitySetting(quality: QualitySetting): void {
    this.qualityLevel = quality === 'low' ? 0 : 2;
    this.view.setQualityLevel(this.qualityLevel);
    this.adaptiveQuality.reset();
  }

  private bindSettingsPanel(): void {
    const panel = document.getElementById('settings-panel');
    const toggle = document.getElementById('btn-settings');
    const music = document.getElementById('setting-music') as HTMLInputElement | null;
    const sfx = document.getElementById('setting-sfx') as HTMLInputElement | null;
    const quality = document.getElementById('setting-quality') as HTMLSelectElement | null;
    const hpBars = document.getElementById('setting-hpbars') as HTMLInputElement | null;
    if (!panel || !toggle || !music || !sfx || !quality || !hpBars) return;

    music.value = String(Math.round(this.settings.musicVolume * 100));
    sfx.value = String(Math.round(this.settings.sfxVolume * 100));
    quality.value = this.settings.quality;
    hpBars.checked = this.settings.showHpBars;

    toggle.addEventListener('click', () => panel.classList.toggle('hidden'));
    document.getElementById('btn-settings-close')?.addEventListener('click', () => panel.classList.add('hidden'));

    music.addEventListener('input', () => {
      this.settings.musicVolume = Number(music.value) / 100;
      this.music.setVolume(this.settings.musicVolume);
      saveSettings(this.settings);
    });
    sfx.addEventListener('input', () => {
      this.settings.sfxVolume = Number(sfx.value) / 100;
      this.sound.setVolume(this.settings.sfxVolume);
      saveSettings(this.settings);
    });
    sfx.addEventListener('change', () => this.sound.playPlace());
    quality.addEventListener('change', () => {
      this.settings.quality = quality.value as QualitySetting;
      this.applyQualitySetting(this.settings.quality);
      saveSettings(this.settings);
    });
    hpBars.addEventListener('change', () => {
      this.settings.showHpBars = hpBars.checked;
      this.view.showHpBars = hpBars.checked;
      saveSettings(this.settings);
    });
    document.getElementById('btn-reset-progress')?.addEventListener('click', () => this.confirmResetProgress());
  }

  /** ステージ進行・編成・チャレンジ記録を消す（音量などの設定は残す） */
  private confirmResetProgress(): void {
    if (!window.confirm('進行状況・保存した編成・チャレンジの記録をすべて消去します。\nこの操作は元に戻せません。よろしいですか？')) {
      return;
    }
    try {
      const keys = Object.keys(window.localStorage).filter(
        (key) => key.startsWith(PROGRESS_STORAGE_PREFIX) && key !== SETTINGS_STORAGE_KEY,
      );
      for (const key of keys) window.localStorage.removeItem(key);
    } catch {
      // localStorage が使えない環境では再読み込みだけ行う
    }
    window.location.reload();
  }

  /** 現在の場面に合う BGM へ切り替える（決着後は勝敗の音を聞かせるため止める） */
  private syncMusic(): void {
    if (this.onTitleScreen) return;
    if (this.mode === 'placement') this.music.setTrack('placement');
    else this.music.setTrack(this.announcedResult === null ? 'battle' : null);
  }

  private applySpeedOption(index: number): void {
    const option = SPEED_OPTIONS[index];
    if (!option) return;
    this.paused = Boolean(option.pause);
    if (!option.pause) this.timeScale = option.scale;
    this.syncSpeedButtons();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncSpeedButtons();
  }

  /** 1x → 2x → 4x → 1x の順に早送りを切り替える */
  private cycleFastForward(): void {
    this.paused = false;
    this.timeScale = this.timeScale >= 4 ? 1 : this.timeScale >= 2 ? 4 : this.timeScale >= 1 ? 2 : 1;
    this.syncSpeedButtons();
  }

  private syncSpeedButtons(): void {
    for (const button of this.elSpeedButtons) {
      const option = SPEED_OPTIONS[Number(button.dataset.speedIndex)];
      button.classList.toggle('active', option.pause ? this.paused : !this.paused && option.scale === this.timeScale);
    }
    document.getElementById('pause-indicator')?.classList.toggle('hidden', !this.paused);
    const pauseBtn = document.getElementById('rg-pause');
    pauseBtn?.classList.toggle('active', this.paused);
    pauseBtn?.setAttribute('aria-pressed', String(this.paused));
  }

  private renderArcadeStageButtons(): void {
    const container = document.getElementById('stage-buttons');
    if (!container) return;
    container.innerHTML = '';
    ARCADE_STAGES.forEach((st, idx) => {
      const stars = this.arcadeSave.clearedStars[st.stageNumber] ?? 0;
      const btn = document.createElement('button');
      const isHazard = Boolean(st.hazard);
      btn.className =
        'stage-btn' +
        (isHazard ? ' hazard-stage' : '') +
        (idx === this.currentStageIndex ? ' active' : '') +
        (stars > 0 ? ' cleared' : '');
      const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      const hazardIcon = isHazard ? `<span class="stage-hazard-icon" title="状態異常: ${st.hazard!.name}">⚠️</span>` : '';
      btn.innerHTML = `
        <span>${hazardIcon}${st.stageNumber}面</span>
        <span class="stage-stars">${starStr}</span>
      `;
      btn.title = `${st.name} (予算 ${st.budget} pt)${isHazard ? ` 【${st.hazard!.name}】` : ''}`;
      btn.addEventListener('click', () => {
        this.loadArcadeStage(idx);
      });
      container.appendChild(btn);
    });
  }

  /** 敵軍の構成をカウントしてキャラアイコン付きのチップにする */
  private renderEnemyChips(
    enemies: ReadonlyArray<{ typeId?: UnitTypeId; facilityId?: FacilityTypeId }>,
  ): string {
    const enemyCounts = new Map<UnitTypeId, number>();
    const facilityCounts = new Map<FacilityTypeId, number>();
    for (const e of enemies) {
      if (e.facilityId) {
        facilityCounts.set(e.facilityId, (facilityCounts.get(e.facilityId) ?? 0) + 1);
      } else if (e.typeId) {
        enemyCounts.set(e.typeId, (enemyCounts.get(e.typeId) ?? 0) + 1);
      }
    }
    const enemyUnitsHtml = [...enemyCounts.entries()]
      .map(([id, count]) => {
        const u = UNIT_TYPES[id];
        return `<span class="enemy-unit-chip" title="${u.name} (${u.cost} pt)">
          <span class="mini-unit-icon">${getUnitIconSvg(id)}</span>
          <span>${u.name} ×${count}</span>
        </span>`;
      })
      .join('');
    const enemyFacilitiesHtml = [...facilityCounts.entries()]
      .map(([id, count]) => {
        const f = FACILITY_TYPES[id];
        return `<span class="enemy-unit-chip enemy-facility-chip" title="【防衛施設】${f.name} (${f.cost} pt)">
          <span class="mini-unit-icon">${getFacilityIconSvg(id)}</span>
          <span>${f.name} ×${count}</span>
        </span>`;
      })
      .join('');
    return enemyUnitsHtml + enemyFacilitiesHtml;
  }

  private renderStageBriefing(): void {
    const el = document.getElementById('stage-briefing');
    if (!el) return;
    const st = this.currentStage;

    const enemyHtml = this.renderEnemyChips(st.enemies);

    const featuredHtml = st.featuredUnits
      .map((id) => {
        const u = UNIT_TYPES[id];
        return `<button class="featured-chip" data-unit="${id}" title="クリックでこの兵種を選択">
          <span class="mini-unit-icon">${getUnitIconSvg(id)}</span>
          <span>★ ${u.name}</span>
          <span class="chip-cost">${COST_ICON_SVG}${u.cost}</span>
        </button>`;
      })
      .join('');
    const rewardHtml =
      st.unlockUnits.length > 0
        ? st.unlockUnits
            .map(
              (id) => `<span class="reward-chip">
                <span class="mini-unit-icon">${getUnitIconSvg(id)}</span>
                <span>🎁 報酬: ${UNIT_TYPES[id].name}</span>
              </span>`,
            )
            .join('')
        : `<span class="reward-chip">🏆 最終決戦ステージ</span>`;

    const hazardHtml = st.hazard
      ? `<div class="brief-hazard-card">
          <div class="hazard-card-header">
            <span class="hazard-pulse-icon">⚠️</span>
            <span class="hazard-card-title">【ステージ状態異常】${st.hazard.name}</span>
            <span class="hazard-badge-pill">${st.hazard.badge}</span>
          </div>
          <div class="hazard-card-desc">${st.hazard.description}</div>
          <div class="hazard-card-summary">💡 <b>要警戒</b>: ${st.hazard.effectSummary}</div>
        </div>`
      : '';

    const specialRuleHtml = st.specialRules
      ? `<div class="brief-special-rule">
          <div class="special-rule-title">⚡ 限定ルール: ${st.specialRules.title}</div>
          <div class="special-rule-desc">${st.specialRules.description}</div>
        </div>`
      : '';

    el.innerHTML = `
      <div class="brief-title">${st.name}</div>
      <div class="brief-sub">${st.subtitle}</div>
      ${hazardHtml}
      ${specialRuleHtml}
      <div class="brief-desc">${st.description}</div>
      <div class="brief-hint">${st.hint}</div>
      <div class="brief-badges">
        <span class="brief-badge-label">評価目標:</span>
        <span class="reward-chip" title="このコスト以下で勝利すると★3獲得">★★★ ≤ ${st.star3Budget} pt</span>
        <span class="enemy-unit-chip" title="このコスト以下（または生存率45%以上）で★2獲得">★★☆ ≤ ${st.star2Budget} pt</span>
      </div>
      <div class="brief-badges" style="margin-top:5px;">
        <span class="brief-badge-label">敵軍編成:</span>
        ${enemyHtml}
      </div>
      <div class="brief-badges" style="margin-top:5px;">
        <span class="brief-badge-label">活躍兵種:</span>
        ${featuredHtml}
      </div>
      <div class="brief-badges" style="margin-top:5px;">
        ${rewardHtml}
      </div>
    `;

    el.querySelectorAll<HTMLButtonElement>('.featured-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const uid = chip.dataset.unit as UnitTypeId;
        if (uid) this.selectUnitType(uid);
      });
    });
  }

  private renderUnitCards(): void {
    this.elUnitBar.innerHTML = '';
    const isArc = this.playStyle === 'arcade';
    const featuredSet = new Set<UnitTypeId>(isArc ? this.currentStage.featuredUnits : []);

    // 兵種カードの表示（施設・地形以外のカテゴリ、またはすべて）
    if (this.selectedCategory !== 'facility' && this.selectedCategory !== 'terrain') {
      const filtered = UNIT_TYPE_LIST.filter(
        (ut) => this.selectedCategory === 'all' || ut.category === this.selectedCategory,
      );
      filtered.forEach((ut, idx) => {
        const unlocked = this.isUnitAvailable(ut.id);
        // ローグライトでは手に入れていない兵種は兵種バーに出さない
        if (this.playStyle === 'roguelite' && !unlocked) return;
        const ruleViolation = isArc ? checkStageRuleViolation(this.currentStage, ut.id, 0) : null;
        const isFeatured = featuredSet.has(ut.id);
        const btn = document.createElement('button');
        btn.className =
          'unit-card' +
          (ut.id === this.selectedId ? ' active' : '') +
          (isFeatured ? ' featured' : '') +
          (!unlocked || ruleViolation ? ' locked' : '');
        btn.dataset.type = ut.id;
        btn.title = `${ut.name} - ${ut.description}（クリックで詳細表示）`;
        const keyLabel = idx < 9 ? `${idx + 1}` : '';
        const featBadge = isFeatured ? `<span class="unit-featured-tag">★特効</span>` : '';
        const lockOverlay = !unlocked
          ? `<div class="unit-lock-badge">🔒</div>`
          : ruleViolation
            ? `<div class="unit-lock-badge" title="${ruleViolation}">🚫</div>`
            : '';
        const theme = CATEGORY_THEME_COLORS[ut.category];

        btn.innerHTML = `
          <div class="unit-card-top">
            <div class="unit-avatar" style="background:${theme.bg}; border-color:${theme.border};">
              ${getUnitIconSvg(ut.id)}
              ${lockOverlay}
            </div>
            <div class="unit-head-info">
              <div class="unit-badges-line">
                <span class="unit-cat-badge">${CATEGORY_ICONS[ut.category]} ${CATEGORY_LABELS[ut.category]}</span>
                ${featBadge}
                <span class="unit-key">${keyLabel}</span>
              </div>
              <div class="unit-name">${ut.name}</div>
              <div class="unit-stats-row">
                ${
                  this.playStyle === 'roguelite'
                    ? `<span class="stat-pill owned" title="ユニットレベルとデッキの状態">Lv${this.rogue?.card(ut.id)?.level ?? 1}${this.rogue?.card(ut.id)?.inDeck ? '' : ' 控え'}</span>`
                    : `<span class="stat-pill cost" title="配置コスト">${COST_ICON_SVG}<span>${ut.cost}</span></span>`
                }
                ${this.playStyle === 'roguelite' ? '' : `<span class="stat-pill hp" title="最大HP">${HP_ICON_SVG}<span>${ut.hp}</span></span>`}
              </div>
            </div>
          </div>
          ${
            this.playStyle === 'roguelite'
              ? `<div class="unit-tags">${UNIT_TAGS[ut.id].map((t) => `<span class="tag-chip">${TAG_INFO[t].icon}${TAG_INFO[t].name}</span>`).join('')}</div>`
              : `<div class="unit-desc" title="${ut.description}">${ut.description}</div>`
          }
        `;
        btn.addEventListener('click', () => {
          if (!unlocked) {
            this.flashPhaseWarning(`🔒 「${ut.name}」はステージクリア報酬（または「☰ メニュー」内の「🔓全解放」）で使用可能になります`);
            return;
          }
          if (ruleViolation) {
            this.flashPhaseWarning(ruleViolation);
            return;
          }
          if (this.touchEraseMode) {
            this.touchEraseMode = false;
            this.elTouchEraseBtn?.classList.remove('danger', 'active');
            if (this.elTouchEraseBtn) this.elTouchEraseBtn.textContent = '🗑 削除';
          }
          this.selectPlaceable(ut.id);
        });
        this.elUnitBar.appendChild(btn);
      });
    }

    // 施設・地形ブロックカードの表示（施設・地形カテゴリ、またはすべて）
    if (
      this.selectedCategory === 'all' ||
      this.selectedCategory === 'facility' ||
      this.selectedCategory === 'terrain'
    ) {
      const baseFacilities =
        this.selectedCategory === 'facility'
          ? COMBAT_FACILITY_TYPE_LIST
          : this.selectedCategory === 'terrain'
            ? TERRAIN_BLOCK_TYPE_LIST
            : FACILITY_TYPE_LIST;
      // ローグライトは手に入れた陣地レリックだけ、アーケード・チャレンジはレリック専用の門を除く
      const rogue = this.playStyle === 'roguelite' ? this.rogue : null;
      const targetFacilities = rogue
        ? baseFacilities.filter((f) => rogue.ownsRelic(f.id))
        : this.isSoloPlayStyle()
          ? baseFacilities.filter((f) => !f.relicOnly)
          : baseFacilities;

      targetFacilities.forEach((fac, fIdx) => {
        const isTerrain = Boolean(fac.isTerrain);
        const ruleViolation = isArc ? checkStageRuleViolation(this.currentStage, fac.id, 0) : null;
        const btn = document.createElement('button');
        btn.className = 'unit-card' + (fac.id === this.selectedId ? ' active' : '') + (ruleViolation ? ' locked' : '');
        btn.dataset.type = fac.id;
        btn.title = `${fac.name} - ${fac.description}（クリックで詳細表示）`;
        const theme = isTerrain ? CATEGORY_THEME_COLORS.terrain : CATEGORY_THEME_COLORS.facility;
        const keyLabel =
          (this.selectedCategory === 'facility' || this.selectedCategory === 'terrain') && fIdx < 9
            ? `${fIdx + 1}`
            : '';
        const lockOverlay = ruleViolation ? `<div class="unit-lock-badge" title="${ruleViolation}">🚫</div>` : '';
        const catBadge = isTerrain
          ? `<span class="unit-cat-badge">${CATEGORY_ICONS.terrain} 地形</span>`
          : `<span class="unit-cat-badge">${CATEGORY_ICONS.facility} 施設</span>`;
        const relic = rogue?.relics.find((r) => r.id === fac.id);
        const facDescription = relic ? relicDescription(relic) : fac.description;
        const statsHtml = rogue
          ? `
            ${relic ? `<span class="stat-pill owned">Lv${relic.level + 1}</span>` : ''}
            <span class="stat-pill ${relic?.active ? 'placed' : 'hp'}">${relic?.active ? '✓発動中' : 'OFF'}</span>
          `
          : isTerrain
          ? `
            <span class="stat-pill cost" title="配置コスト（無料）">${COST_ICON_SVG}<span>0 (無料)</span></span>
            <span class="stat-pill hp" title="破壊不可"><span>♾️ 不壊</span></span>
          `
          : `
            <span class="stat-pill cost" title="配置コスト">${COST_ICON_SVG}<span>${fac.cost}</span></span>
            <span class="stat-pill hp" title="最大耐久力">${HP_ICON_SVG}<span>${fac.hp}</span></span>
          `;

        btn.innerHTML = `
          <div class="unit-card-top">
            <div class="unit-avatar" style="background:${theme.bg}; border-color:${theme.border};">
              ${getFacilityIconSvg(fac.id)}
              ${lockOverlay}
            </div>
            <div class="unit-head-info">
              <div class="unit-badges-line">
                ${catBadge}
                <span class="unit-key">${keyLabel}</span>
              </div>
              <div class="unit-name">${fac.name}</div>
              <div class="unit-stats-row">
                ${statsHtml}
              </div>
            </div>
          </div>
          <div class="unit-desc" title="${facDescription}">${facDescription}</div>
        `;
        btn.addEventListener('click', () => {
          if (ruleViolation) {
            this.flashPhaseWarning(ruleViolation);
            return;
          }
          if (rogue) {
            this.showToast(`${fac.name}: ${facDescription}`);
            return;
          }
          if (this.touchEraseMode) {
            this.touchEraseMode = false;
            this.elTouchEraseBtn?.classList.remove('danger', 'active');
            if (this.elTouchEraseBtn) this.elTouchEraseBtn.textContent = '🗑 削除';
          }
          this.selectPlaceable(fac.id);
        });
        this.elUnitBar.appendChild(btn);
      });
    }
  }

  /** 現在のモードでこの兵種を配置できるか（解放状況・ローグライトの所持兵種） */
  private isUnitAvailable(id: UnitTypeId): boolean {
    if (this.playStyle === 'roguelite') return this.rogue?.ownsUnit(id) ?? false;
    if (this.playStyle === 'arcade' || this.playStyle === 'challenge') return isUnitUnlocked(this.arcadeSave, id);
    return true;
  }

  selectPlaceable(id: UnitTypeId | FacilityTypeId): void {
    if (!isFacilityTypeId(id) && !this.isUnitAvailable(id)) {
      return;
    }
    this.selectedId = id;
    const cards = this.elUnitBar.querySelectorAll<HTMLElement>('.unit-card');
    cards.forEach((c) => {
      c.classList.toggle('active', c.dataset.type === id);
    });
    this.updateUnitDetailOverlay(id);
    this.showUnitDetailOverlay();
  }

  /** 選択中ユニット・施設の詳細説明オーバーレイの内容を最新に更新 */
  private updateUnitDetailOverlay(id: UnitTypeId | FacilityTypeId): void {
    const isArc = this.playStyle === 'arcade';
    const isFeatured = isArc && !isFacilityTypeId(id) && this.currentStage.featuredUnits.includes(id);
    const detail = getPlaceableDetail(id, isFeatured, '★このステージの特効ユニット！');

    if (this.elDetailAvatar) {
      this.elDetailAvatar.innerHTML = detail.iconSvg;
      this.elDetailAvatar.style.background = detail.theme.bg;
      this.elDetailAvatar.style.borderColor = detail.theme.border;
    }

    if (this.elDetailName) {
      this.elDetailName.textContent = detail.name;
    }

    if (this.elDetailCatBadge) {
      this.elDetailCatBadge.textContent = `${detail.categoryIcon} ${detail.categoryLabel}`;
    }

    if (this.elDetailFeaturedTag) {
      this.elDetailFeaturedTag.classList.toggle('hidden', !detail.isFeatured);
    }

    if (this.elDetailStatsRow) {
      this.elDetailStatsRow.innerHTML = '';
      detail.statPills.forEach((pill) => {
        const span = document.createElement('span');
        span.className = pill.className;
        span.title = pill.title;
        if (pill.iconSvg) {
          span.innerHTML = `${pill.iconSvg}<span>${pill.value}</span>`;
        } else {
          span.textContent = `${pill.value}`;
        }
        this.elDetailStatsRow!.appendChild(span);
      });
    }

    if (this.elDetailDesc) {
      this.elDetailDesc.textContent = detail.description;
    }

    if (this.elDetailFeaturedNote) {
      if (detail.featuredNote) {
        this.elDetailFeaturedNote.textContent = detail.featuredNote;
        this.elDetailFeaturedNote.classList.remove('hidden');
      } else {
        this.elDetailFeaturedNote.classList.add('hidden');
      }
    }
  }

  showUnitDetailOverlay(): void {
    this.unitDetailVisible = true;
    this.syncUnitDetailOverlay();
  }

  hideUnitDetailOverlay(): void {
    this.unitDetailVisible = false;
    this.syncUnitDetailOverlay();
  }

  toggleUnitDetailOverlay(): void {
    this.unitDetailVisible = !this.unitDetailVisible;
    this.syncUnitDetailOverlay();
  }

  private syncUnitDetailOverlay(): void {
    const shouldHide = !this.unitDetailVisible || this.hudHidden || this.mode === 'battle';
    this.elUnitDetailOverlay?.classList.toggle('hidden', shouldHide);
    this.elToggleDetailBtn?.classList.toggle('active', this.unitDetailVisible);
  }

  private selectUnitType(id: UnitTypeId): void {
    this.selectPlaceable(id);
  }

  private flashPhaseWarning(msg: string): void {
    this.elPhaseBadge.textContent = msg;
    this.elPhaseBadge.classList.add('budget-over');
    // 連続で警告が出ても、最後の警告が短く消されないようにする
    if (this.warningTimer !== null) clearTimeout(this.warningTimer);
    this.warningTimer = setTimeout(() => {
      this.warningTimer = null;
      this.elPhaseBadge.classList.remove('budget-over');
      if (this.mode === 'placement') this.syncPhaseUI();
    }, 1800);
  }

  private bindCanvasInteraction(): void {
    const dom = this.view.renderer.domElement;
    const groundHit = new Vector3();

    dom.addEventListener('pointermove', (e) => {
      if (this.droppedChestsField) {
        const onChest = e.pointerType !== 'touch' && this.mode === 'battle' && this.droppedChestsField.pick(e.clientX, e.clientY) !== null;
        dom.style.cursor = onChest ? 'pointer' : '';
      }
      if (this.mode !== 'placement' || this.touchEraseMode || e.pointerType === 'touch' || this.playStyle === 'roguelite') {
        this.view.updatePlacementGhost(null, 0, null, false);
        return;
      }
      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (this.paintStroke && p) this.continuePaintStroke(p.x, p.z);
      if (!p || !this.isInsideArena(p.x, p.z)) {
        this.view.updatePlacementGhost(this.selectedId, 0, null, false);
        return;
      }
      const check = this.checkPlacement(this.selectedId, p.x, p.z);
      this.view.updatePlacementGhost(this.selectedId, check.team, p, check.valid, check.facing);
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 2) {
        // 右ドラッグでカメラ回転もできるようにする
        this.view.startOrbitDrag(e.clientX, e.clientY);
        return;
      }
      // マウスは押した瞬間に配置し、そのままドラッグで連続配置する（タッチの1本指はカメラ回転なので離したときに配置）
      if (e.button === 0 && e.pointerType !== 'touch' && !e.altKey && this.mode === 'placement' && !this.touchEraseMode) {
        const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
        if (p && this.placeAt(this.selectedId, p.x, p.z)) {
          this.paintStroke = { lastX: p.x, lastZ: p.z };
        }
      }
    });

    window.addEventListener('pointerup', () => {
      this.paintStroke = null;
    });

    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && this.view.isMultiTouchInvolved()) return;
      const moved = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (moved <= 8 && e.button === 0 && this.skipRogueGateSequence()) return;
      if (moved <= 8 && this.mode === 'battle' && e.button === 0) {
        const chest = this.droppedChestsField?.pick(e.clientX, e.clientY);
        if (chest) {
          this.openDroppedChest(chest);
          return;
        }
        const hit = this.view.screenToGround(e.clientX, e.clientY, groundHit);
        if (hit) this.toggleFollowNearestUnit(hit.x, hit.z);
        return;
      }
      if (moved > 8 || this.mode !== 'placement') return;

      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (!p) return;

      if (e.button === 2 || (e.button === 0 && this.touchEraseMode)) {
        // 右クリック、またはスマホ用削除モードON時のタップ: 最も近いユニットまたは施設を削除
        this.removeNearestUnitAt(p.x, p.z);
        return;
      }

      if (e.button === 0 && e.pointerType === 'touch') {
        this.placeAt(this.selectedId, p.x, p.z);
      }
    });
  }

  /** 戦闘中にクリックした位置の近くのユニットをカメラで追う。何もない場所なら追跡をやめる */
  private toggleFollowNearestUnit(x: number, z: number): void {
    let best: Unit | null = null;
    let bestDist = 3.0;
    for (const u of this.battle.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.pelvis.pos.x - x, u.pelvis.pos.z - z) - u.scale * 0.5;
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    if (best) {
      this.view.setFollowedUnit(best);
      this.showToast(`🎥 ${best.type.name} を追跡中（何もない場所をクリックで解除）`);
    } else if (this.view.isFollowingUnit) {
      this.view.setFollowedUnit(null);
      this.showToast('🎥 追跡を解除しました');
    }
  }

  /** ドラッグ中、前回の配置から十分離れたら次の 1 体を置く */
  private continuePaintStroke(x: number, z: number): void {
    const stroke = this.paintStroke;
    if (!stroke) return;
    if (Math.hypot(x - stroke.lastX, z - stroke.lastZ) < this.getPlacementSpacing(this.selectedId)) return;
    // 予算切れなどで置けない間は警告を連発せず、置ける位置まで黙って待つ
    if (this.placeAt(this.selectedId, x, z, true)) {
      stroke.lastX = x;
      stroke.lastZ = z;
    }
  }

  /** ドラッグ連続配置の間隔（体格や施設の大きさに合わせて重ならない程度に空ける） */
  private getPlacementSpacing(id: UnitTypeId | FacilityTypeId): number {
    if (isFacilityTypeId(id)) return FACILITY_TYPES[id].radius * 2 + 0.4;
    return Math.max(1.0, UNIT_TYPES[id].scale * 1.1);
  }

  private isInsideArena(x: number, z: number): boolean {
    return Math.abs(x) <= 22 && Math.abs(z) <= 16;
  }

  /** 現在のモードで (x, z) に id を置けるかを判定する。ゴースト表示と実配置で共通 */
  private checkPlacement(id: UnitTypeId | FacilityTypeId, x: number, z: number): PlacementCheck {
    const unlocked = isFacilityTypeId(id) || isUnitUnlocked(this.arcadeSave, id);
    const cost = this.getItemCost(id);
    const fail = (team: Team, warning: string | null, facing?: number): PlacementCheck => ({
      team,
      facing,
      valid: false,
      warning,
    });
    const overBudgetMessage = (used: number, budget: number) =>
      `⚠ 予算オーバー！ (残り ${Math.max(0, budget - used)} pt / 必要 ${cost} pt)`;

    if (this.playStyle === 'arcade') {
      const st = this.currentStage;
      const facing = getStageZoneFacing(st, x, z);
      if (!isInsideStageRedZone(st, x, z)) {
        return fail(0, '⚠ 赤枠の配置可能エリア内をタップ／クリックしてください', facing);
      }
      if (!unlocked) return fail(0, '🔒 この兵種はまだ解放されていません', facing);
      const ruleViolation = checkStageRuleViolation(st, id, this.getCurrentRedPlacedCount());
      if (ruleViolation) return fail(0, ruleViolation, facing);
      const used = this.getCurrentRedCost();
      if (used + cost > st.budget) return fail(0, overBudgetMessage(used, st.budget), facing);
      return { team: 0, facing, valid: true, warning: null };
    }

    if (this.playStyle === 'challenge') {
      const facing = Math.PI / 2;
      if (!isInsideVersusZone(2, 0, x, z)) {
        return fail(0, '⚠ 赤枠の配置可能エリア内をタップ／クリックしてください', facing);
      }
      if (!unlocked) return fail(0, '🔒 この兵種はまだ解放されていません', facing);
      const used = this.getCurrentRedCost();
      if (used + cost > CHALLENGE_PLAYER_BUDGET) {
        return fail(0, overBudgetMessage(used, CHALLENGE_PLAYER_BUDGET), facing);
      }
      return { team: 0, facing, valid: true, warning: null };
    }

    if (this.playStyle === 'versus') {
      const team = this.versus.currentTurn;
      const facing = getVersusPlacementFacing(this.versus.playerCount, team, x, z);
      if (!isInsideVersusZone(this.versus.playerCount, team, x, z)) {
        return fail(team, `⚠ ${team + 1}P ${TEAM_NAMES[team]}の配置枠内をタップ／クリックしてください`, facing);
      }
      const used = this.getCurrentTeamCost(team);
      if (used + cost > this.versus.budget) return fail(team, overBudgetMessage(used, this.versus.budget), facing);
      return { team, facing, valid: true, warning: null };
    }

    // サンドボックス: x < 0 なら赤軍、x > 0 なら青軍
    const team: Team = x < 0 ? 0 : 1;
    const facing = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return { team, facing, valid: this.isInsideArena(x, z) && Math.abs(x) > 1.2, warning: null };
  }

  /** 配置を試みて、成功したかを返す（quiet なら失敗しても警告を出さない） */
  private placeAt(id: UnitTypeId | FacilityTypeId, x: number, z: number, quiet = false): boolean {
    // ローグライトは所持している全員が自動で並ぶ
    if (this.playStyle === 'roguelite') return false;
    const check = this.checkPlacement(id, x, z);
    if (!check.valid) {
      if (!quiet && check.warning) this.flashPhaseWarning(check.warning);
      return false;
    }
    // かさね配置（試作・サンドボックスのみ）: 乗り手対象の兵種で味方の土台の近くなら、地面ではなく上に乗せる
    if (this.playStyle === 'sandbox' && !isFacilityTypeId(id) && isRiderType(id)) {
      const mount = this.findSandboxMountAt(x, z, check.team);
      if (mount && this.tryPlaceStackedRider(mount, id, check.team, check.facing)) return true;
    }
    const record: PlacedRecord = isFacilityTypeId(id)
      ? { facilityId: id, team: check.team, x, z, facing: check.facing }
      : { typeId: id, team: check.team, x, z, facing: check.facing };
    this.getActiveLineup().push(record);
    this.spawnRecord(record);
    this.clearedBackup = [];
    this.sound.playPlace();
    // 説明を読み終えて置き始めたら、戦場を隠さないように閉じる
    if (this.unitDetailVisible) this.hideUnitDetailOverlay();
    this.afterLineupEdited();
    this.notifyTutorial('placed');
    return true;
  }

  /** 配置レコードから実体を生成し、削除や取り消しのために対応付けを残す（mount があればその上に乗せる） */
  private spawnRecord(record: PlacedRecord, mount: Unit | null = null): Unit | Facility | null {
    let entity: Unit | Facility | null = null;
    if (record.facilityId) {
      entity = this.battle.spawnFacility(record.facilityId, record.team, record.x, record.z, record.facing, {
        gateLevel: record.gateLevel,
        relicLevel: record.relicLevel,
      });
    } else if (record.typeId) {
      const unit =
        (mount && this.battle.spawnMountedUnit(mount, record.typeId, record.team, record.facing)) ||
        this.battle.spawnUnit(record.typeId, record.team, record.x, record.z, record.facing);
      // ローグライトの最終ラウンドのボスは HP を強化する
      if (record.level && record.level > 1) {
        const mul = getUnitLevelMul(record.level);
        unit.maxHp *= mul;
        unit.hp = unit.maxHp;
        unit.levelHpMul = mul;
        unit.permDamageMul *= mul;
      }
      if (record.boss) {
        unit.isBoss = true;
        unit.maxHp *= ROGUE_BOSS_HP_MUL;
        unit.hp = unit.maxHp;
      }
      entity = unit;
    }
    if (entity) this.placedEntities.set(record, entity);
    return entity;
  }

  private spawnRecords(records: readonly PlacedRecord[]): void {
    // かさね配置: onTopOf を持つレコードは、土台レコードから生成したユニットの上に乗せ直す
    const spawnedUnits: Array<Unit | null> = [];
    for (const record of records) {
      const mount =
        this.playStyle === 'sandbox' && record.onTopOf !== undefined ? (spawnedUnits[record.onTopOf] ?? null) : null;
      const entity = this.spawnRecord(record, mount);
      spawnedUnits.push(record.typeId ? (entity as Unit | null) : null);
    }
  }

  /**
   * かさね配置（試作）: 地面ヒット点から半径 1.2m 以内にある、同チームの
   * 土台候補ユニット（ホワイトリスト内・騎乗中でない・乗り手がいない）を探す。
   */
  private findSandboxMountAt(x: number, z: number, team: Team): Unit | null {
    let best: Unit | null = null;
    let bestDist = 1.2;
    for (const u of this.battle.units) {
      if (!u.alive || u.team !== team) continue;
      if (!isMountType(u.type.id) || u.mountedOn) continue;
      if (this.battle.units.some((r) => r.alive && r.mountedOn === u)) continue;
      const d = Math.hypot(u.pelvis.pos.x - x, u.pelvis.pos.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    return best;
  }

  /** かさね配置（試作）: 土台の上に乗り手を配置し、編成レコードにも onTopOf を残す */
  private tryPlaceStackedRider(mount: Unit, id: UnitTypeId, team: Team, facing: number | undefined): boolean {
    const lineup = this.getActiveLineup();
    const mountIdx = lineup.findIndex((rec) => this.placedEntities.get(rec) === mount);
    const record: PlacedRecord = {
      typeId: id,
      team,
      x: mount.pelvis.pos.x,
      z: mount.pelvis.pos.z,
      facing,
      onTopOf: mountIdx >= 0 ? mountIdx : undefined,
    };
    const rider = this.battle.spawnMountedUnit(mount, id, team, facing);
    if (!rider) return false;
    lineup.push(record);
    this.placedEntities.set(record, rider);
    this.clearedBackup = [];
    this.sound.playPlace();
    this.flashPhaseWarning(`🪜 かさね配置: ${mount.type.name}の上に${rider.type.name}を乗せた`);
    this.afterLineupEdited();
    return true;
  }

  /** いま編集している編成（友人対戦は手番プレイヤーのもの） */
  private getActiveLineup(): PlacedRecord[] {
    return this.playStyle === 'versus' ? this.versus.getCurrentLineup() : this.savedLineup;
  }

  /** 編成を変更した後の共通処理（表示更新と自動保存） */
  private afterLineupEdited(): void {
    if (this.playStyle === 'versus') this.syncVersusUI();
    // ローグライトは陣地レリックの「配置済み」表示を更新する
    if (this.playStyle === 'roguelite') this.renderUnitCards();
    this.persistPlayerLineup();
    this.updateHUD();
  }

  /** 自動保存の保存先（保存しないモードは null） */
  private getLineupStorageKey(): string | null {
    if (this.playStyle === 'arcade') return `arcade:${this.currentStage.id}`;
    if (this.playStyle === 'challenge') return 'challenge';
    return null;
  }

  private persistPlayerLineup(): void {
    const key = this.getLineupStorageKey();
    if (key) saveStoredLineup(key, this.savedLineup.filter((r) => r.team === 0));
  }

  /** 保存済みの編成を、今のルールで置けるものだけ復元する */
  private restorePlayerLineup(): void {
    const key = this.getLineupStorageKey();
    if (!key) return;
    const stored = loadStoredLineup(key);
    let restored = 0;
    for (const p of stored) {
      const id = p.facilityId ?? p.typeId;
      if (!id || !this.checkPlacement(id, p.x, p.z).valid) continue;
      const record: PlacedRecord = { ...p, team: 0 };
      this.savedLineup.push(record);
      this.spawnRecord(record);
      restored++;
    }
    if (restored > 0) this.showToast(`💾 前回の編成を復元しました（${restored} 体）`);
  }

  /** 実体を戦場と編成の両方から取り除く */
  private removeRecord(record: PlacedRecord): void {
    const lineup = this.getActiveLineup();
    const idx = lineup.indexOf(record);
    if (idx >= 0) {
      lineup.splice(idx, 1);
      // かさね配置: 削除でずれた onTopOf 参照を直す（土台を消したら乗り手は地面配置に戻す）
      for (const rec of lineup) {
        if (rec.onTopOf === idx) rec.onTopOf = undefined;
        else if (rec.onTopOf !== undefined && rec.onTopOf > idx) rec.onTopOf -= 1;
      }
    }
    const entity = this.placedEntities.get(record);
    if (entity) {
      // かさね配置: 土台を消したら、乗っていたユニットの結合をその場で解く
      for (const u of this.battle.units) {
        if (u.mountedOn === entity) u.mountedOn = null;
      }
      this.removeEntity(entity);
    }
  }

  private removeEntity(entity: Unit | Facility): void {
    if (this.battle.units.includes(entity as Unit)) this.battle.removeUnit(entity as Unit);
    else this.battle.removeFacility(entity as Facility);
  }

  /** 直前の配置を取り消す。全消去の直後なら消した編成を元に戻す */
  private undoLastPlacement(): void {
    if (this.mode !== 'placement') return;
    if (this.clearedBackup.length > 0) {
      const backup = this.clearedBackup;
      this.clearedBackup = [];
      this.getActiveLineup().push(...backup);
      this.spawnRecords(backup);
      this.sound.playPlace();
      this.afterLineupEdited();
      this.showToast('↶ 全消去を取り消しました');
      return;
    }
    const lineup = this.getActiveLineup();
    // アーケード等の編成には敵の固定配置も入っているので、自分で置いたものだけを遡る
    const record = [...lineup].reverse().find((r) => this.isEditableRecord(r));
    if (!record) return;
    this.removeRecord(record);
    this.sound.playRemove();
    this.afterLineupEdited();
  }

  /** プレイヤーが消したり取り消したりできる配置か */
  private isEditableRecord(record: PlacedRecord): boolean {
    if (this.playStyle === 'roguelite') return false;
    if (this.isSoloPlayStyle()) return record.team === 0;
    if (this.playStyle === 'versus') return record.team === this.versus.currentTurn;
    return true;
  }

  private removeNearestUnitAt(x: number, z: number): void {
    const records = this.getActiveLineup().filter((r) => this.isEditableRecord(r));
    const nearest = (
      radius: number,
      accept: (entity: Unit | Facility) => boolean,
      posOf: (entity: Unit | Facility) => { x: number; z: number },
    ): PlacedRecord | null => {
      let best: PlacedRecord | null = null;
      let bestDist = radius;
      for (const record of records) {
        const entity = this.placedEntities.get(record);
        if (!entity || !accept(entity)) continue;
        const pos = posOf(entity);
        const d = Math.hypot(pos.x - x, pos.z - z);
        if (d < bestDist) {
          bestDist = d;
          best = record;
        }
      }
      return best;
    };

    // 施設を優先し、無ければユニットを探す
    const isFacility = (e: Unit | Facility) => this.battle.facilities.includes(e as Facility);
    const target =
      nearest(2.0, isFacility, (e) => (e as Facility).pos) ??
      nearest(1.8, (e) => !isFacility(e), (e) => (e as Unit).pelvis.pos);
    if (!target) return;
    this.removeRecord(target);
    this.clearedBackup = [];
    this.sound.playRemove();
    this.afterLineupEdited();
  }

  /** 画面上部に短い通知を出す */
  private showToast(message: string): void {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      el.classList.remove('show');
    }, 2200);
  }

  /** プレイヤーが赤軍だけを操作し、解放済みの兵種だけを使うモードか */
  private isSoloPlayStyle(): boolean {
    return this.playStyle === 'arcade' || this.playStyle === 'challenge' || this.playStyle === 'roguelite';
  }

  /** チャレンジの新しいランを開始する */
  enterChallengeMode(): void {
    this.playStyle = 'challenge';
    this.challenge = new ChallengeRun(createChallengeSeed());
    this.challengeBestAtRunStart = this.challengeBest;
    if (!isUnitUnlocked(this.arcadeSave, this.selectedType)) {
      this.selectedType = 'clubber';
    }
    this.syncModePanels();
    this.loadChallengeRound();
  }

  /** 現在ラウンドの敵を生成し、前ラウンドの自軍編成を復元して配置フェーズに入る */
  private loadChallengeRound(): void {
    this.battle.rules = null;
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(true);
    // 地形は標準固定（特殊地形・状態異常なし）
    this.battle.configureStage({ timeLimitSeconds: CHALLENGE_TIME_LIMIT_SECONDS });
    this.view.clearDebris();
    this.view.setStageTheme(undefined);
    this.view.setVersusZones(getVersusZones(2), 0);

    const run = this.challenge;
    const unlocked = getAllUnitIds().filter((id) => isUnitUnlocked(this.arcadeSave, id));
    const enemies = generateEnemyLineup(run.round, run.seed, unlocked);
    this.savedLineup = [...enemies, ...run.playerLineup.map((r) => ({ ...r }))];
    this.spawnRecords(this.savedLineup);
    this.clearedBackup = [];
    // ランの最初だけ前回の編成を呼び出す（以降のラウンドは引き継ぎ編成を使う）
    if (run.round === 1 && run.playerLineup.length === 0) this.restorePlayerLineup();

    this.renderChallengePanel();
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  private advanceChallengeRound(): void {
    this.challenge.advanceRound();
    this.loadChallengeRound();
  }

  /** 戦闘中・決着後の主ボタン。勝利後は次へ進み、戦闘中はボタン操作のときだけ中断を確認する */
  private handleChallengeBattleAction(viaKeyboard: boolean): void {
    if (this.challenge.ended) return;
    if (this.announcedResult !== null) {
      this.advanceChallengeRound();
    } else if (!viaKeyboard) {
      this.confirmQuitChallenge();
    }
  }

  private confirmQuitChallenge(): void {
    if (this.playStyle !== 'challenge' || this.challenge.ended) return;
    if (window.confirm('チャレンジを中断しますか？\nゲームオーバーとなり、ここまでのスコアで確定します。')) {
      this.finishChallengeRun('quit');
    }
  }

  /** 進行中のランがあれば他モードへの移動を止める（中断を選ぶとスコア画面を表示する） */
  private blockLeavingChallenge(): boolean {
    if (this.playStyle !== 'challenge' || this.challenge.ended) return false;
    this.confirmQuitChallenge();
    return true;
  }

  private exitChallengeToTitle(): void {
    this.showTitleScreen();
  }

  private handleChallengeBattleEnd(res: Exclude<BattleResult, null>): void {
    if (res !== 0) {
      const isTimeout =
        this.battle.timeLimitSeconds !== null && this.battle.time >= this.battle.timeLimitSeconds;
      this.finishChallengeRun(res === 'draw' ? 'draw' : isTimeout ? 'timeout' : 'defeat');
      return;
    }

    const run = this.challenge;
    const ratio = this.computePlayerSurvivalRatio();
    const score = run.recordWin(ratio);

    // タブを閉じてもここまでの結果が残るよう、勝利のたびにベストを保存する
    this.challengeBest = mergeChallengeBest(this.challengeBest, run.totalScore, run.reachedRound).best;
    saveChallengeBest(this.challengeBest);

    setVoxelText(this.elBannerText, `ROUND ${score.round} クリア！`, BANNER_VOXEL);
    this.elBannerSub.textContent = `獲得 +${score.total.toLocaleString()} ｜ 累計スコア ${run.totalScore.toLocaleString()}`;
    this.showChallengeBannerDetail(`
      <div class="challenge-score-row"><span>基本点</span><b>${score.base.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>資金差ボーナス</span><b>${score.budgetBonus.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>生存ボーナス（${Math.round(ratio * 100)}%）</span><b>${score.survivalBonus.toLocaleString()}</b></div>
    `);
    this.elRetryBtn?.classList.add('hidden');
    if (this.elNextStageBtn) {
      this.elNextStageBtn.textContent = `▶ ROUND ${score.round + 1} へ進む`;
      this.elNextStageBtn.classList.remove('hidden');
    }
    this.scheduleResultBanner();
    this.renderChallengePanel();
    this.syncPhaseUI();
  }

  /** ランを終了し、スコア画面を表示する */
  private finishChallengeRun(reason: ChallengeEndReason): void {
    const run = this.challenge;
    run.finish(reason);
    // 配置フェーズ中の中断でも以後の操作を受け付けず、勝敗判定も再度走らせない
    this.mode = 'battle';
    this.announcedResult ??= 1;
    this.view.setPlacementGuidesVisible(false);

    const reasonText: Readonly<Record<ChallengeEndReason, string>> = {
      defeat: '自軍が全滅しました',
      draw: '同時全滅（引き分けは敗北扱い）',
      timeout: '⏱ 制限時間切れ',
      quit: '🏳 中断によりスコアを確定しました',
    };
    const isNewRecord =
      run.clearedRounds > 0 &&
      mergeChallengeBest(this.challengeBestAtRunStart, run.totalScore, run.reachedRound).isNewRecord;
    const best = this.challengeBest;

    if (reason === 'quit') document.getElementById('result-stats')?.classList.add('hidden');
    setVoxelText(this.elBannerText, 'GAME OVER', BANNER_VOXEL);
    this.elBannerSub.textContent = reasonText[reason];
    this.showChallengeBannerDetail(`
      ${isNewRecord ? '<div class="challenge-new-record">🏆 NEW RECORD</div>' : ''}
      <div class="challenge-score-row total"><span>到達ラウンド</span><b>ROUND ${run.reachedRound}</b></div>
      <div class="challenge-score-row total"><span>総合スコア</span><b>${run.totalScore.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>基本点</span><b>${run.baseScore.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>資金差ボーナス</span><b>${run.budgetBonus.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>生存ボーナス</span><b>${run.survivalBonus.toLocaleString()}</b></div>
      <div class="challenge-score-divider"></div>
      <div class="challenge-score-row"><span>ベストスコア</span><b>${best.bestScore.toLocaleString()}</b></div>
      <div class="challenge-score-row"><span>ベストラウンド</span><b>${best.bestRound > 0 ? `ROUND ${best.bestRound}` : '—'}</b></div>
      <div class="challenge-score-row"><span>最後の資金差</span><b>自軍 ${CHALLENGE_PLAYER_BUDGET.toLocaleString()} vs 敵 ${run.enemyBudget.toLocaleString()}</b></div>
    `);
    if (this.elRetryBtn) {
      this.elRetryBtn.textContent = '🏠 タイトルへ';
      this.elRetryBtn.classList.remove('hidden');
    }
    if (this.elNextStageBtn) {
      this.elNextStageBtn.textContent = '↻ もう一度';
      this.elNextStageBtn.classList.remove('hidden');
    }
    this.scheduleResultBanner();
    this.renderChallengePanel();
    this.syncPhaseUI();
    this.syncUnitDetailOverlay();
  }

  private showChallengeBannerDetail(html: string): void {
    if (!this.elBannerChallenge) return;
    this.elBannerChallenge.innerHTML = html;
    this.elBannerChallenge.classList.remove('hidden');
  }

  /** サイドパネルのチャレンジ状況を更新する */
  private renderChallengePanel(): void {
    if (!this.elChallengeStatus) return;
    const run = this.challenge;
    const best = this.challengeBest;
    const enemies = this.savedLineup.filter((r) => r.team === 1);
    this.elChallengeStatus.innerHTML = `
      <div class="brief-title">ROUND ${run.round}</div>
      <div class="brief-sub">自軍 ${CHALLENGE_PLAYER_BUDGET.toLocaleString()} pt vs 敵 ${run.enemyBudget.toLocaleString()} pt（×${run.budgetRatio.toFixed(1)}）</div>
      <div class="brief-desc">現在スコア: <b>${run.totalScore.toLocaleString()}</b> ｜ クリア: ${run.clearedRounds} ラウンド</div>
      <div class="brief-hint">1敗で終了。引き分けと${CHALLENGE_TIME_LIMIT_SECONDS}秒の時間切れも負けになります。勝つと編成は全員復活して次のラウンドへ引き継がれます。</div>
      <div class="brief-badges">
        <span class="brief-badge-label">敵軍編成:</span>
        ${this.renderEnemyChips(enemies)}
      </div>
      <div class="brief-badges" style="margin-top:5px;">
        <span class="reward-chip">🏆 ベスト ${best.bestScore.toLocaleString()} / ${best.bestRound > 0 ? `ROUND ${best.bestRound}` : '記録なし'}</span>
        <span class="enemy-unit-chip" title="同じシードなら同じ敵が出現します">シード ${run.seed}</span>
      </div>
    `;
    document.getElementById('btn-challenge-quit')?.classList.toggle('hidden', run.ended);
  }

  private formatChallengeBadge(): string {
    const run = this.challenge;
    const head = `🔥 <b>ROUND ${run.round}</b>`;
    const score = `スコア <b>${run.totalScore.toLocaleString()}</b>`;
    if (this.mode === 'placement') {
      return `${head} ｜ 自軍 ${CHALLENGE_PLAYER_BUDGET.toLocaleString()} pt vs 敵 ${run.enemyBudget.toLocaleString()} pt（×${run.budgetRatio.toFixed(1)}） ｜ ${score}`;
    }
    const remain = Math.max(0, (this.battle.timeLimitSeconds ?? 0) - this.battle.time);
    return `⚔ ${head} ｜ ⏱ 残り <b>${remain.toFixed(1)}s</b> ｜ ${score}`;
  }

  // ---------------------------------------------------------------
  // ローグライトモード
  // ---------------------------------------------------------------

  /** ローグライトに入る。途中のランがあれば続きから、なければスターター選択を出す */
  enterRogueliteMode(): void {
    this.playStyle = 'roguelite';
    this.syncModePanels();
    const saved = this.rogue && !this.rogue.ended ? this.rogue : loadRogueRun();
    if (saved) {
      this.rogue = saved;
      // 再開時はアニメーションなしで残機ハートを即時同期する
      this.view.syncRogueHearts(saved.lives, ROGUE_MAX_LIVES, true);
      this.loadRogueRound();
    } else {
      this.rogue = null;
      this.prepareEmptyRogueField();
      this.showRogueStarterSelect();
    }
  }

  /** スターター選択中の空の戦場 */
  private prepareEmptyRogueField(): void {
    this.mode = 'placement';
    this.announcedResult = null;
    this.hideResultBanner();
    this.battle.configureStage({ timeLimitSeconds: ROGUE_TIME_LIMIT_SECONDS });
    this.view.clearDebris();
    this.damageOverlay.clear();
    this.savedLineup = [];
    this.clearedBackup = [];
    this.view.setStageTheme(undefined);
    this.view.setVersusZones(getVersusZones(2), 0);
    this.renderRoguePanel();
    this.renderUnitCards();
    this.syncPhaseUI();
    this.updateHUD();
  }

  private showRogueStarterSelect(): void {
    const meta = this.rogueMeta;
    const cards = ROGUE_STARTERS.map((st, i) => {
      const unlocked = isStarterUnlocked(st, meta);
      const units = st.units
        .map((id) => `<span class="rogue-unit-chip">${this.unitVoxelHtml(id)}<span>${UNIT_TYPES[id].name} ×${getSquadSize(id)}</span></span>`)
        .join('');
      return `
        <button type="button" class="rogue-card starter-card${unlocked ? '' : ' locked'}" data-action="starter" data-index="${i}" ${unlocked ? '' : 'disabled'}>
          <div class="rogue-card-title">${st.name}</div>
          <div class="rogue-card-units">${units}</div>
          <div class="rogue-card-desc">陣地レリック: <b>${FACILITY_TYPES[st.relic].name}</b></div>
          <div class="rogue-card-foot">${unlocked ? 'この部隊で出撃' : `🔒 ${st.unlockText}`}</div>
        </button>`;
    }).join('');
    this.showRogueModal(
      `
      <div class="rogue-modal-title">スターター部隊を選んでください</div>
      <div class="rogue-modal-sub">ゴールド${ROGUE_START_GOLD}G・ライフ3で出撃。通算3敗で終了します。ユニットは報酬で集め、ゴールドで枠とレベルを強化します。ROUND ${ROGUE_MID_BOSS_ROUND}のボス戦からハードモードへ突入し、全${ROGUE_FINAL_ROUND}ラウンドの突破を目指します。</div>
      <div class="rogue-card-row">${cards}</div>
      <div class="rogue-modal-foot">ベスト: ${meta.bestScore.toLocaleString()}点 ／ 最高 ROUND ${meta.bestRound || '—'} ／ クリア ${meta.clears}回</div>
    `,
      'rogue-starter',
    );
  }

  private startRogueRun(starter: RogueStarter): void {
    this.rogue = new RogueliteRun(createChallengeSeed(), starter);
    this.selectedId = starter.units[0];
    this.hideRogueModal();
    saveRogueRun(this.rogue);
    // 新規ランは残機ハートを満タンで即時表示する
    this.view.syncRogueHearts(this.rogue.lives, ROGUE_MAX_LIVES, true);
    this.loadRogueRound(true);
  }

  /** 現在ラウンドの敵と所持している全員を並べる（openShop なら続けてショップを開く） */
  private loadRogueRound(openShop = false): void {
    const run = this.rogue;
    if (!run) return;
    this.mode = 'placement';
    this.announcedResult = null;
    this.hideResultBanner();
    this.hideRogueModal();
    this.view.setPlacementGuidesVisible(false);
    // 地形は標準固定（特殊地形・状態異常なし）
    this.battle.configureStage({ timeLimitSeconds: ROGUE_TIME_LIMIT_SECONDS });
    this.battle.rules = this.rogueRules;
    this.view.clearDebris();
    this.damageOverlay.clear();
    this.view.setStageTheme(undefined);
    this.view.setVersusZones(getVersusZones(2), 0);

    const enemies = generateRogueEnemyLineup(run.round, run.seed);
    this.savedLineup = [...enemies, ...generateRogueFormation(run.deckRoster, run.relics, run.deckLevels)];
    this.spawnRecords(this.savedLineup);
    this.clearedBackup = [];

    if (!this.isUnitAvailable(this.selectedType) && !isFacilityTypeId(this.selectedId)) {
      this.selectedId = run.cards[0]?.id ?? 'clubber';
    }
    saveRogueRun(run);
    this.renderRoguePanel();
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
    if (openShop) this.showRogueWarRoom();
  }

  /** デッキやレリックの変化に合わせて自軍を並べ直す */
  private syncRogueFormation(): void {
    const run = this.rogue;
    if (!run) return;
    for (const record of this.savedLineup.filter((r) => r.team === 0)) this.removeRecord(record);
    const records = generateRogueFormation(run.deckRoster, run.relics, run.deckLevels);
    this.savedLineup.push(...records);
    this.spawnRecords(records);
  }

  /** 戦闘中・決着後の主ボタン */
  private handleRogueBattleAction(viaKeyboard: boolean): void {
    const run = this.rogue;
    if (!run) return;
    if (this.announcedResult !== null) {
      if (!this.elRogueModal || this.elRogueModal.classList.contains('hidden')) this.handleRogueNext();
    } else if (!viaKeyboard) {
      this.confirmQuitRogue();
    }
  }

  /** 決着後の「次へ」: 報酬の選択、次のラウンド、または新しいラン */
  private handleRogueNext(): void {
    const run = this.rogue;
    if (!run || run.ended) {
      this.rogue = null;
      this.prepareEmptyRogueField();
      this.showRogueStarterSelect();
      return;
    }
    if (run.pendingRewards) {
      this.showRogueRewards();
      return;
    }
    if (this.announcedResult !== null) {
      run.advanceRound();
      this.loadRogueRound(true);
    }
  }

  /** 戦闘の勝敗を判定する。時間切れは生き残ったユニットの合計コストが多い側の勝ち（同値は負け） */
  private resolveRogueWin(res: Exclude<BattleResult, null>): boolean {
    const isTimeout =
      this.battle.timeLimitSeconds !== null && this.battle.time >= this.battle.timeLimitSeconds;
    if (res === 0) return true;
    if (!isTimeout || res === 'draw') return false;
    const aliveCost = (team: Team) =>
      this.battle.units
        .filter((u) => u.alive && u.team === team && !u.isClone && u.splitGen === 0)
        .reduce((sum, u) => sum + UNIT_TYPES[u.type.id].cost, 0);
    return aliveCost(0) > aliveCost(1);
  }

  private get droppedChests(): DroppedChests {
    this.droppedChestsField ??= new DroppedChests(this.view.scene, this.view.camera, this.view.renderer.domElement, () =>
      this.sound.playJackpotReelStop(0),
    );
    return this.droppedChestsField;
  }

  private resetJackpot(): void {
    this.droppedChests.clear();
    this.jackpotCollected = { count: 0, gold: 0 };
    this.jackpotRewards = [];
    this.jackpot.clearChips();
  }

  /** 自軍の残りHP割合（現在HP合計 ÷ 戦闘開始時の最大HP合計、0〜1） */
  private currentAllyHpRatio(): number {
    if (this.jackpotAllyMaxHpTotal <= 0) return 1;
    const current = this.battle.units.reduce(
      (sum, u) => sum + (u.alive && u.team === 0 ? Math.max(0, u.hp) : 0),
      0,
    );
    return Math.max(0, Math.min(1, current / this.jackpotAllyMaxHpTotal));
  }

  /** 敵の撃破で宝箱が出るかを決め、出たら倒した敵の位置に落とす */
  private onRogueEnemyKilled(victim: Unit, pos: Vector3): void {
    if (this.mode !== 'battle' || this.onTitleScreen || !this.rogue) return;
    const tier = this.jackpotTracker.onKill(
      this.battle.time,
      { cost: victim.type.cost, isBoss: victim.isBoss },
      this.rogue.enemyBudget,
      this.currentAllyHpRatio(),
    );
    if (tier === null) return;
    this.droppedChests.spawn(pos, tier);
    this.sound.playJackpotCoin();
  }

  /** 戦場の宝箱を開ける。戦闘を止めてボーナス演出へ進む */
  private openDroppedChest(chest: DroppedChest): void {
    if (!this.rogue || this.jackpot.active || this.battle.result() !== null) return;
    const ndc = chest.position.clone().project(this.view.camera);
    const origin = { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight };
    this.droppedChests.remove(chest);
    const rewards = rollJackpot(chest.tier, { rng: Math.random, battleActive: true });
    this.view.addCameraShake(0.3);
    this.jackpot.play({
      tier: chest.tier,
      rewards,
      origin,
      sound: this.sound,
      onFinished: () => this.applyJackpotRewards(rewards),
    });
  }

  /** 戦場の宝箱を動かす。ローグライトの戦闘から離れたら片付ける */
  private updateDroppedChests(realDt: number): void {
    if (!this.droppedChestsField) return;
    if (this.mode !== 'battle' || this.onTitleScreen || this.playStyle !== 'roguelite') this.droppedChestsField.clear();
    else this.droppedChestsField.update(realDt);
  }

  private applyJackpotRewards(rewards: readonly JackpotReward[]): void {
    const run = this.rogue;
    if (!run) return;
    for (const reward of rewards) {
      applyJackpotReward(reward, this.battle, run);
      this.jackpotRewards.push(reward);
      this.jackpot.addChip(reward);
    }
    this.view.addCameraShake(0.25);
    this.renderRoguePanel();
  }

  private handleRogueBattleEnd(res: Exclude<BattleResult, null>): void {
    const run = this.rogue;
    if (!run) return;
    const won = this.resolveRogueWin(res);
    const stats = this.battleStats;
    const unopened = this.droppedChests.collectAll();
    this.jackpotCollected = { count: unopened, gold: collectUnopenedChests(run, unopened) };
    if (unopened > 0) this.sound.playJackpotCoin();
    const report = this.renderBattleReport() + this.renderJackpotReport();
    this.jackpot.clearChips();

    if (won) {
      const ratio = computeSurvivalRatio(this.rogueRoster.map((e) => ({ cost: e.type.cost, alive: isRosterAlive(e) })));
      const round = run.round;
      const gained = run.recordWin(ratio, stats.total, stats.maxHit);
      saveRogueRun(run);
      if (run.ended) {
        this.finishRogueRun('clear');
        return;
      }
      const isMidBoss = round === ROGUE_MID_BOSS_ROUND;
      setVoxelText(this.elBannerText, isMidBoss ? `ROUND ${round} ボス撃破！` : `ROUND ${round} 突破！`, BANNER_VOXEL);
      const hardNotice = isMidBoss ? `🔥 ROUND ${ROGUE_HARD_START_ROUND} からハードモード突入！ ｜ ` : '';
      this.elBannerSub.textContent = `${hardNotice}獲得 +${gained.toLocaleString()} ｜ スコア ${run.score.toLocaleString()} ｜ 💰 +${getRogueWinBonus(round)}G`;
      this.showChallengeBannerDetail(report);
      this.elRetryBtn?.classList.add('hidden');
      if (this.elNextStageBtn) {
        this.elNextStageBtn.textContent = run.eliteRewardPicks > 1 ? `🎁 報酬を${run.eliteRewardPicks}回選ぶ (Space)` : '🎁 報酬を選ぶ (Space)';
        this.elNextStageBtn.classList.remove('hidden');
      }
    } else {
      const round = run.round;
      const lossGold = run.recordLoss(stats.total, stats.maxHit);
      saveRogueRun(run);
      // ラン終了（ライフ消尽）時も、最後のハートが割れるアニメーションを見せるためここで同期する
      this.view.syncRogueHearts(run.lives, ROGUE_MAX_LIVES);
      if (run.ended) {
        this.finishRogueRun('defeat');
        return;
      }
      setVoxelText(this.elBannerText, `ROUND ${round} 敗北…`, BANNER_VOXEL);
      this.elBannerSub.textContent = `ライフ -1（残り ${'❤'.repeat(run.lives)}）｜ 💰 +${lossGold}G（勝利の${ROGUE_LOSS_GOLD_MUL}倍）｜ 🛟 報酬${run.lossRewardPicks}回`;
      this.showChallengeBannerDetail(report);
      this.elRetryBtn?.classList.add('hidden');
      if (this.elNextStageBtn) {
        this.elNextStageBtn.textContent = '🛟 逆転の報酬を選ぶ (Space)';
        this.elNextStageBtn.classList.remove('hidden');
      }
    }
    this.scheduleResultBanner();
    this.renderRoguePanel();
    this.syncPhaseUI();
  }

  /** 戦闘後の内訳（与ダメージ合計・最大の一撃・シナジーごとの合計。兵種ごとの内訳は共通の戦績欄に出る） */
  private renderBattleReport(): string {
    const st = this.battleStats;
    const sources = st
      .topSources(4)
      .map(([name, dmg]) => `<div class="challenge-score-row"><span>✨ ${name}</span><b>${formatDamage(dmg)}</b></div>`)
      .join('');
    return `
      <div class="challenge-score-row total"><span>与ダメージ合計</span><b>${formatDamage(st.total)}</b></div>
      <div class="challenge-score-row"><span>最大の一撃</span><b>${st.maxHit > 0 ? `${formatDamage(st.maxHit)}（${st.maxHitBy ? UNIT_TYPES[st.maxHitBy].name : '—'}）` : '—'}</b></div>
      <div class="challenge-score-row"><span>撃破数</span><b>${st.kills}</b></div>
      ${sources}
    `;
  }

  /** この戦闘で宝箱から得た報酬の一覧 */
  private renderJackpotReport(): string {
    const { count, gold } = this.jackpotCollected;
    const collected = count > 0 ? `<div class="challenge-score-row"><span>📦 未開封の宝箱 ${count}個</span><b>+${gold.toLocaleString()}G</b></div>` : '';
    if (this.jackpotRewards.length === 0) return collected;
    const items = this.jackpotRewards.map((r) => `${r.icon} ${r.detail}`).join('<br>');
    return `<div class="challenge-score-row"><span>🎰 ボーナス ${this.jackpotRewards.length}個</span><b>${items}</b></div>${collected}`;
  }

  /** ラウンドごとの与ダメージの成長曲線（SVG） */
  private renderGrowthChart(): string {
    const run = this.rogue;
    if (!run || run.history.length === 0) return '';
    const w = 260;
    const h = 90;
    const pad = 8;
    const maxDmg = Math.max(1, ...run.history.map((r) => r.damage));
    const n = run.history.length;
    const x = (i: number) => pad + (n <= 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
    const y = (v: number) => h - pad - (v / maxDmg) * (h - pad * 2);
    const pts = run.history.map((r, i) => `${x(i).toFixed(1)},${y(r.damage).toFixed(1)}`).join(' ');
    const dots = run.history
      .map(
        (r, i) =>
          `<circle cx="${x(i).toFixed(1)}" cy="${y(r.damage).toFixed(1)}" r="3" class="${r.won ? 'won' : 'lost'}"><title>ROUND ${r.round}: ${formatDamage(r.damage)}</title></circle>`,
      )
      .join('');
    return `
      <div class="growth-title">ラウンドごとの与ダメージ（最大 ${formatDamage(maxDmg)}）</div>
      <svg class="growth-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="ラウンドごとの与ダメージ">
        <polyline points="${pts}" />
        ${dots}
      </svg>`;
  }

  /** カードに載せる動くボクセルモデル（用意できるまでは下のアイコンが見える） */
  private unitVoxelHtml(id: UnitTypeId, count = 1): string {
    const badge = count > 1 ? `<span class="squad-count">×${count}</span>` : '';
    return `<span class="unit-voxel${count > 1 ? ' squad' : ''}" data-unit-preview="${id}" data-unit-count="${count}">${getUnitIconSvg(id)}<canvas aria-hidden="true"></canvas>${badge}</span>`;
  }

  /** ゴールドやレリックのボクセルモデル（用意できるまでは fallback が見える） */
  private propVoxelHtml(key: string, fallback: string): string {
    return `<span class="unit-voxel prop-voxel" data-prop-preview="${key}">${fallback}<canvas aria-hidden="true"></canvas></span>`;
  }

  private relicVoxelHtml(id: FacilityTypeId): string {
    return this.propVoxelHtml(`relic:${id}`, getFacilityIconSvg(id));
  }

  /** 「枠アイコン：×2」の表示 */
  private rogueSlotCostHtml(id: UnitTypeId): string {
    return `<span class="slot-cost">枠<span class="slot-cost-icon">${getUnitIconSvg(id)}</span>：×${getUnitSlotCost(id)}</span>`;
  }

  private rogueTagChips(id: UnitTypeId): string {
    return UNIT_TAGS[id].map((t) => `<span class="tag-chip">${TAG_INFO[t].icon}${TAG_INFO[t].name}</span>`).join('');
  }

  /** 報酬カードに添える、今の状況に合わせた一言 */
  private rogueRewardHint(run: RogueliteRun, o: RewardOption): string {
    if (o.kind === 'gold') {
      const price = run.unitSlotPrice;
      if (price === null) return '';
      const after = run.gold + (o.amount ?? 0);
      return after >= price ? `ユニット枠 +1（${price}G）を買えるようになります` : `あと${price - after}Gでユニット枠 +1 に届きます`;
    }
    if (o.unitId) {
      if (!run.fitsInDeck(o.unitId)) return '枠が足りないので、まず控えに入ります';
      const counts = countTags(run.deck.map((c) => c.id));
      const tag = UNIT_TAGS[o.unitId].find((t) => [2, 4].includes((counts.get(t) ?? 0) + 1));
      if (!tag) return '';
      return `デッキに入れると「${TAG_INFO[tag].name}」シナジーが${(counts.get(tag) ?? 0) + 1 === 4 ? '最大まで強化' : '発動'}します`;
    }
    return '';
  }

  private showRogueRewards(): void {
    const run = this.rogue;
    if (!run?.pendingRewards) return;
    const cards = run.pendingRewards
      .map((o, i) => {
        const tags = o.unitId ? `<div class="unit-tags">${this.rogueTagChips(o.unitId)}</div>` : '';
        const art = o.unitId
          ? this.unitVoxelHtml(o.unitId, getSquadSize(o.unitId))
          : o.relicId
            ? this.relicVoxelHtml(o.relicId)
            : o.kind === 'gold'
              ? this.propVoxelHtml('gold', '<span class="unit-portrait-svg prop-fallback">💰</span>')
              : `<span class="reward-slot-art" aria-hidden="true">${UNIT_SLOT_ICON_SVG}</span>`;
        const hint = this.rogueRewardHint(run, o);
        return `
        <button type="button" class="rogue-card reward-card rarity-${o.rarity}" data-action="reward" data-index="${i}">
          <span class="reward-rarity">${RARITY_LABELS[o.rarity]}</span>
          <div class="reward-art">${art}${o.unitId ? `<span class="wr-art-info">${this.rogueSlotCostHtml(o.unitId)}</span>` : ''}</div>
          <div class="rogue-card-title">${o.title}</div>
          ${tags}
          <div class="rogue-card-desc">${o.description}</div>
          ${hint ? `<div class="reward-hint">${hint}</div>` : ''}
          <span class="reward-key" aria-hidden="true">${i + 1}</span>
        </button>`;
      })
      .join('');
    const lost = run.lossRewardPicks > 0;
    const isMidBoss = !lost && run.round === ROGUE_MID_BOSS_ROUND && run.eliteRewardPicks > 0;
    const elite = !lost && !isMidBoss && run.eliteRewardPicks > 0;
    const title = lost
      ? '逆転の報酬を選んでください'
      : isMidBoss
        ? 'ボス撃破！ ハードモード突入前の報酬を選んでください'
        : elite
          ? 'エリート撃破！ 報酬を選んでください'
          : '勝利！ 報酬を選んでください';
    const lead = lost
      ? `あと${run.lossRewardPicks}回選べます（レア以上のユニットが出やすい）`
      : isMidBoss
        ? `ROUND ${run.round} ボス突破（次から🔥ハードモード） ・ あと${run.eliteRewardPicks}回選べます`
        : elite
          ? `ROUND ${run.round} 突破 ・ あと${run.eliteRewardPicks}回選べます`
          : `ROUND ${run.round} 突破`;
    this.showRogueModal(
      `
      <div class="rogue-modal-title">${title}</div>
      <div class="rogue-modal-sub reward-status">
        <span>${lead}</span>
        ${this.rogueHeartsHtml(run.lives)}
        <span class="rg-chip gold"><span class="rg-coin" aria-hidden="true">G</span>${run.gold.toLocaleString()} G</span>
        <span class="rg-chip">ユニット枠 ${run.usedUnitSlots}/${run.unitSlots}</span>
        <span class="rg-chip">レリック枠 ${run.activeRelics.length}/${run.relicSlots}</span>
      </div>
      <div class="rogue-card-row">${cards}</div>
      <div class="rogue-modal-actions">
        <button type="button" class="wr-ghost" data-action="reroll" ${run.rerollsLeft > 0 ? '' : 'disabled'}>引き直す（残り${run.rerollsLeft}回）</button>
        <button type="button" class="wr-ghost" data-action="skip">スキップして +${ROGUE_SKIP_GOLD}G</button>
      </div>
      <div class="reward-keys-note"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> キーでも選べます</div>
    `,
      'rogue-rewards',
    );
  }

  private chooseRogueReward(option: RewardOption | null): void {
    const run = this.rogue;
    if (!run?.pendingRewards) return;
    run.chooseReward(option);
    if (option?.unitId && run.card(option.unitId)?.inDeck) this.selectedId = option.unitId;
    if (run.pendingRewards) {
      saveRogueRun(run);
      this.sound.playPlace();
      this.showRogueRewards();
      return;
    }
    run.advanceRound();
    saveRogueRun(run);
    this.sound.playPlace();
    this.loadRogueRound(true);
  }

  /** ライフのハート（ドット絵。残っている分は鼓動し、失った分は暗くする） */
  private rogueHeartsHtml(lives: number): string {
    const hearts = Array.from(
      { length: ROGUE_MAX_LIVES },
      (_, i) => `<svg viewBox="0 0 7 6" class="rg-heart${i < lives ? '' : ' off'}" shape-rendering="crispEdges" aria-hidden="true">${HEART_SVG_BODY}</svg>`,
    ).join('');
    return `<span class="rg-hearts" role="img" aria-label="ライフ ${lives}/${ROGUE_MAX_LIVES}">${hearts}</span>`;
  }

  /** ボクセルのハートを重ねて表示する HUD 上の場所 */
  private rogueHeartSlotHtml(lives: number): string {
    return `<span class="rg-heart-slot" role="img" aria-label="ライフ ${lives}/${ROGUE_MAX_LIVES}"></span>`;
  }

  /** ヘッダーのラウンド進行（到達済み・現在・エリート・ボス・ハードモードを2段で描き分ける） */
  private renderRogueRoundNodes(run: RogueliteRun): string {
    const renderNode = (n: number) => {
      const state = n < run.round ? ' done' : n === run.round ? ' current' : '';
      const isBoss = ROGUE_BOSS_ROUNDS.includes(n);
      const isElite = ROGUE_ELITE_ROUNDS.includes(n);
      const isHard = isRogueHardMode(n);
      const kind = (isBoss ? ' boss' : isElite ? ' elite' : '') + (isHard ? ' hard' : '');
      // エリートは悪魔、ボスは鬼のマークで示す
      const mark = isBoss ? '👹' : isElite ? '😈' : String(n);
      const modeTag = isHard ? 'ハード・' : '';
      const kindLabel = isBoss ? 'ボス' : isElite ? 'エリート' : isHard ? 'ハード' : '';
      const label = kindLabel ? `ROUND ${n}（${isBoss || isElite ? modeTag : ''}${kindLabel}）` : `ROUND ${n}`;
      return `<span class="wr-node${state}${kind}" title="${label}"${n === run.round ? ' aria-current="step"' : ''}>${mark}</span>`;
    };
    const normalRow = Array.from({ length: ROGUE_MID_BOSS_ROUND }, (_, i) => renderNode(i + 1)).join('');
    const hardCount = Math.max(0, ROGUE_FINAL_ROUND - ROGUE_MID_BOSS_ROUND);
    const hardRow = Array.from({ length: hardCount }, (_, i) => renderNode(ROGUE_MID_BOSS_ROUND + 1 + i)).join('');
    return `
      <div class="wr-nodes-row">${normalRow}</div>
      <div class="wr-nodes-row is-hard"><span class="wr-hard-tag" title="ROUND ${ROGUE_HARD_START_ROUND}〜${ROGUE_FINAL_ROUND}: ハードモード（高額強力な敵が増加）">🔥HARD</span>${hardRow}</div>`;
  }

  /** 「次はエリート戦」などの、この先の山場の案内 */
  private rogueContextBadge(run: RogueliteRun): { text: string; kind: 'elite' | 'boss' } | null {
    const hardPrefix = run.isHardMode ? '🔥 ハード ・ ' : '';
    if (run.roundKind === 'boss') {
      return { text: `${hardPrefix}${run.round >= ROGUE_FINAL_ROUND ? '最終ボス戦' : 'ボス戦'}`, kind: 'boss' };
    }
    if (run.roundKind === 'elite') return { text: `${hardPrefix}エリート戦`, kind: 'elite' };
    const nextElite = ROGUE_ELITE_ROUNDS.find((r) => r > run.round);
    const nextBoss = ROGUE_BOSS_ROUNDS.find((r) => r > run.round) ?? ROGUE_FINAL_ROUND;
    const isEliteNext = nextElite !== undefined && nextElite < nextBoss;
    const target = isEliteNext ? nextElite : nextBoss;
    const kind = isEliteNext ? 'elite' : 'boss';
    const label = isEliteNext ? 'エリート戦' : target >= ROGUE_FINAL_ROUND ? '最終ボス戦' : 'ボス戦';
    const left = target - run.round;
    if (left <= 0) return null;
    return { text: `${hardPrefix}${left === 1 ? `次は${label}` : `${label}まで あと${left}`}`, kind };
  }

  /** 作戦室の左カラム。敵の兵種を1枚ずつのカードで並べる */
  private renderRogueEnemyCards(enemies: ReadonlyArray<{ typeId?: UnitTypeId; facilityId?: FacilityTypeId }>): string {
    const units = new Map<UnitTypeId, number>();
    const facilities = new Map<FacilityTypeId, number>();
    for (const e of enemies) {
      if (e.facilityId) facilities.set(e.facilityId, (facilities.get(e.facilityId) ?? 0) + 1);
      else if (e.typeId) units.set(e.typeId, (units.get(e.typeId) ?? 0) + 1);
    }
    const card = (detailId: string, icon: string, theme: { bg: string; border: string }, name: string, desc: string, count: number) => `
      <button type="button" class="wr-enemy" data-enemy-detail="${detailId}" data-enemy-count="${count}" aria-label="${name}の詳細">
        <span class="wr-enemy-tile" style="background:${theme.bg};border-color:${theme.border}">${icon}</span>
        <span class="wr-enemy-text"><b>${name}</b><small>${desc}</small></span>
        <span class="wr-enemy-count">×${count}</span>
      </button>`;
    const unitCards = [...units.entries()]
      .sort((a, b) => UNIT_TYPES[b[0]].cost - UNIT_TYPES[a[0]].cost)
      .map(([id, count]) => {
        const u = UNIT_TYPES[id];
        return card(id, getUnitIconSvg(id), CATEGORY_THEME_COLORS[u.category], u.name, u.description, count);
      });
    const facilityCards = [...facilities.entries()].map(([id, count]) => {
      const f = FACILITY_TYPES[id];
      return card(id, getFacilityIconSvg(id), CATEGORY_THEME_COLORS.facility, f.name, f.description, count);
    });
    return [...unitCards, ...facilityCards].join('');
  }

  private setRogueMenuOpen(open: boolean): void {
    document.getElementById('rg-menu')?.classList.toggle('hidden', !open);
    document.getElementById('rg-menu-btn')?.setAttribute('aria-expanded', String(open));
  }

  /** 次の敵の行にホバーで詳細を出し、クリックで固定／解除する */
  private bindEnemyDetailPopup(): void {
    const rowOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-enemy-detail]') ?? null;
    this.elRogueModal?.addEventListener('pointerover', (ev) => {
      const row = rowOf(ev.target);
      if (row && ev.pointerType !== 'touch' && !this.enemyDetailPinned) this.showEnemyDetail(row);
    });
    this.elRogueModal?.addEventListener('pointerout', (ev) => {
      const row = rowOf(ev.target);
      if (row && !row.contains(ev.relatedTarget as Node | null) && !this.enemyDetailPinned) this.hideEnemyDetail();
    });
    document.addEventListener('click', (ev) => {
      const row = rowOf(ev.target);
      const id = row?.dataset.enemyDetail ?? null;
      if (!row || id === this.enemyDetailPinned) {
        this.hideEnemyDetail();
        return;
      }
      this.showEnemyDetail(row);
      this.enemyDetailPinned = id;
    });
  }

  private showEnemyDetail(row: HTMLElement): void {
    const id = row.dataset.enemyDetail as UnitTypeId | FacilityTypeId;
    const d = getPlaceableDetail(id);
    this.enemyDetailPinned = null;
    if (!this.elEnemyDetail) {
      this.elEnemyDetail = document.createElement('div');
      this.elEnemyDetail.className = 'wr-enemy-detail';
      this.elEnemyDetail.setAttribute('role', 'tooltip');
      document.body.appendChild(this.elEnemyDetail);
    }
    const el = this.elEnemyDetail;
    const pills = d.statPills
      .map((p) => `<span class="${p.className}" title="${p.title}">${p.iconSvg ?? ''}<span>${p.value}</span></span>`)
      .join('');
    const tags = isFacilityTypeId(id) ? '' : `<div class="unit-tags">${this.rogueTagChips(id)}</div>`;
    el.innerHTML = `
      <div class="wed-head">
        <span class="wed-icon" style="background:${d.theme.bg};border-color:${d.theme.border}">${d.iconSvg}</span>
        <span class="wed-name"><b>${d.name}</b><small>${d.categoryIcon} ${d.categoryLabel}</small></span>
        <span class="wr-enemy-count">×${row.dataset.enemyCount}</span>
      </div>
      <div class="wed-stats">${pills}</div>
      ${tags}
      <p class="wed-desc">${d.description}</p>`;
    el.classList.remove('hidden');
    const rect = row.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const margin = 10;
    const left = rect.right + margin + box.width <= window.innerWidth ? rect.right + margin : Math.max(margin, rect.left - margin - box.width);
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(margin, Math.min(rect.top, window.innerHeight - box.height - margin))}px`;
  }

  private hideEnemyDetail(): void {
    this.enemyDetailPinned = null;
    this.elEnemyDetail?.classList.add('hidden');
  }

  /** 作戦室のカード1枚。カードを押すとデッキと控えを行き来し、下のボタンで強化する */
  private renderRogueDeckCard(run: RogueliteRun, card: RogueCard): string {
    const id = card.id;
    const canMove = card.inDeck || run.fitsInDeck(id);
    const name = UNIT_TYPES[id].name;
    const squad = getSquadSize(id);
    const price = run.cardLevelPrice(id);
    const mul = getUnitLevelMul(card.level);
    const moveLabel = card.inDeck ? `${name}を控えへ移す` : canMove ? `${name}をデッキへ入れる` : `${name}はユニット枠が足りません`;
    const moveHint = card.inDeck ? '▼ 控えへ' : canMove ? '▲ デッキへ' : '枠不足';
    const classes = [
      'wr-card',
      `rarity-${unitRarity(id)}`,
      card.inDeck ? 'in-deck' : 'benched',
      canMove ? '' : 'no-room',
      this.roomSelectedUnit === id ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const upgrade =
      price === null
        ? `<span class="wr-card-up is-max">強化MAX<small>ステータス：×${mul.toFixed(1)}</small></span>`
        : `<button type="button" class="wr-card-up${run.gold >= price ? ' can-buy' : ''}" data-action="card-up" data-unit="${id}" ${run.gold >= price ? '' : 'disabled'}>強化 ${price.toLocaleString()}G<small>ステータス：×${mul.toFixed(1)} → ×${getUnitLevelMul(card.level + 1).toFixed(1)}</small></button>`;
    return `
      <div class="${classes}" data-flip="card:${id}">
        <button type="button" class="wr-card-main" data-action="deck-toggle" data-unit="${id}" aria-label="${moveLabel}" title="${moveLabel}">
          <span class="wr-card-art">
            ${this.unitVoxelHtml(id, squad)}
            <span class="wr-lv">Lv${card.level}</span>
            <span class="wr-art-info">
              ${this.rogueSlotCostHtml(id)}
              <span class="slot-cost">ステータス：<b>×${mul.toFixed(1)}</b></span>
              <span class="slot-cost">人数：×${squad}</span>
            </span>
            <span class="wr-move">${moveHint}</span>
          </span>
          <span class="wr-card-name">${name}</span>
        </button>
        ${upgrade}
      </div>`;
  }

  /** ユニット枠のゲージ。現在の枠数で等分し、デッキのユニットのアイコンを横に積む */
  private renderRogueDeckGauge(run: RogueliteRun): string {
    const units = run.deck
      .map((c) => {
        const cost = getUnitSlotCost(c.id);
        return `<span class="gauge-unit" style="grid-column: span ${cost}; --span: ${cost}" data-flip="gauge:${c.id}" title="${UNIT_TYPES[c.id].name}">${`<i>${getUnitIconSvg(c.id)}</i>`.repeat(cost)}</span>`;
      })
      .join('');
    const free = Array.from(
      { length: Math.max(0, run.unitSlots - run.usedUnitSlots) },
      (_, i) => `<span class="gauge-free" data-flip="free:${i}">${EMPTY_UNIT_FACE_SVG}</span>`,
    ).join('');
    return units + free;
  }

  /** デッキの総戦力（兵種コスト × 人数 × レベル倍率の合計） */
  private rogueDeckPower(run: RogueliteRun): number {
    return Math.round(
      run.deck.reduce((sum, c) => sum + UNIT_TYPES[c.id].cost * getSquadSize(c.id) * getUnitLevelMul(c.level), 0),
    );
  }

  /** タグのシナジーの効果の説明 */
  private rogueSynergyDetail(tag: TagId, count: number): string {
    const tier = getTagTier(count);
    const info = TAG_INFO[tag];
    const head = `<b>${info.icon} ${info.name} ${count}/${tier >= 2 ? 4 : 2}</b>`;
    if (tier === 4) return `${head}${info.tier2} ／ ${info.tier4}`;
    if (tier === 2) return `${head}${info.tier2}<i>あと${4 - count}種で: ${info.tier4}</i>`;
    return `${head}<i>あと${2 - count}種で: ${info.tier2}</i>`;
  }

  /** デッキに含まれるタグ。数の多い順 */
  private rogueSynergyTags(counts: Map<string, number>): TagId[] {
    return TAG_IDS.filter((t) => (counts.get(t) ?? 0) > 0).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  }

  /** 作戦室の右カラム。枠の購入と陣地レリックを並べる */
  private renderRogueUpgrades(run: RogueliteRun): string {
    const buyBtn = (action: string, icon: string, label: string, price: number | null) =>
      price === null
        ? `<span class="room-buy is-max">${icon}<span class="room-buy-label">${label}<small>上限</small></span></span>`
        : `<button type="button" class="room-buy" data-action="${action}" ${run.gold >= price ? '' : 'disabled'}>${icon}<span class="room-buy-label">${label} +1<small>${COST_ICON_SVG}${price.toLocaleString()}G</small></span></button>`;
    const relicsFull = run.activeRelics.length >= run.relicSlots;
    const relicCards = run.relics
      .map((r, i) => {
        const canToggle = r.active || !relicsFull;
        const price = run.relicLevelPrice(i);
        const name = relicDisplayName(r);
        const toggleTitle = canToggle ? '押すと ON/OFF' : 'レリック枠が一杯です';
        const upgrade =
          price === null
            ? '<span class="relic-up is-max">強化MAX</span>'
            : `<button type="button" class="relic-up${run.gold >= price ? ' can-buy' : ''}" data-action="relic-up" data-index="${i}" ${run.gold >= price ? '' : 'disabled'}>
                <b>強化 ${price.toLocaleString()}G</b>
                <small>${relicDescription({ id: r.id, level: r.level + 1 })}</small>
              </button>`;
        return `
        <div class="wr-relic ${r.active ? 'on' : 'off'}" data-flip="relic:${i}">
          <div class="wr-relic-top">
            <button type="button" class="wr-relic-icon${canToggle ? '' : ' no-room'}" data-action="relic-toggle" data-index="${i}" aria-pressed="${r.active}" aria-label="${name}を${r.active ? 'OFF' : 'ON'}にする" title="${toggleTitle}">
              ${this.relicVoxelHtml(r.id)}
              <span class="wr-switch">${r.active ? 'ON' : canToggle ? 'OFF' : '枠不足'}</span>
            </button>
            <div class="wr-up-text">
              <b>${name}</b>
              <small>${relicDescription(r)}</small>
            </div>
          </div>
          ${upgrade}
        </div>`;
      })
      .join('');
    return `
      <div class="wr-sub">枠の拡張</div>
      <div class="room-buy-row">
        ${buyBtn('unit-slot', UNIT_SLOT_ICON_SVG, 'ユニット枠', run.unitSlotPrice)}
        ${buyBtn('relic-slot', RELIC_SLOT_ICON_SVG, 'レリック枠', run.relicSlotPrice)}
      </div>
      <div class="wr-sub">陣地レリック <span class="wr-relic-count">発動 ${run.activeRelics.length}/${run.relicSlots} ・ アイコンを押すと ON/OFF</span></div>
      ${relicCards || '<div class="wr-empty">レリックを持っていません</div>'}`;
  }

  /** 作戦室（強化とデッキ編成）を開く。開いているときは内容を更新する */
  private showRogueWarRoom(): void {
    const run = this.rogue;
    if (!run || run.ended || this.mode !== 'placement') return;
    const openRoom = this.isRogueModalOpen() ? this.elRogueModal?.querySelector<HTMLElement>('.rogue-war-room') : null;
    const before = openRoom ? this.roomFx.capture(openRoom) : new Map<string, DOMRect>();
    const scrollTops = openRoom ? [openRoom, ...openRoom.querySelectorAll<HTMLElement>('.wr-col')].map((el) => el.scrollTop) : [];
    const deck = run.deck.map((c) => this.renderRogueDeckCard(run, c)).join('');
    const bench = run.bench.map((c) => this.renderRogueDeckCard(run, c)).join('');
    const counts = this.currentRogueTagCounts();
    const synergy = this.rogueSynergyTags(counts)
      .map((t) => {
        const c = counts.get(t) ?? 0;
        return `<div class="wr-syn-line tier-${getTagTier(c)}">${this.rogueSynergyDetail(t, c)}</div>`;
      })
      .join('');
    const badge = this.rogueContextBadge(run);
    const bodies = this.battle.aliveCount(0);
    this.showRogueModal(
      `
      <header class="wr-head">
        <div class="wr-mode"><span class="wr-logo" aria-label="EXBLOCKS"></span><span>ローグライト</span></div>
        <div class="wr-nodes" role="img" aria-label="ROUND ${run.round} / ${ROGUE_FINAL_ROUND}">${this.renderRogueRoundNodes(run)}</div>
        <div class="wr-status">
          ${this.rogueHeartsHtml(run.lives)}
          <div class="room-gold" aria-label="所持ゴールド">
            ${this.propVoxelHtml('gold', '<span class="unit-portrait-svg prop-fallback">💰</span>')}
            <b class="room-gold-value">${run.gold.toLocaleString()}</b><span class="room-gold-unit">G</span>
          </div>
        </div>
      </header>
      <div class="wr-panel">
        <section class="wr-col wr-col-enemy" aria-label="次の敵">
          <h2 class="wr-title">次の敵 <span>ROUND ${run.round}${run.isHardMode ? ' 🔥 HARD' : ''}</span></h2>
          <div class="wr-enemy-list">${this.renderRogueEnemyCards(this.savedLineup.filter((r) => r.team === 1))}</div>
          <div class="wr-enemy-foot">
            <span>敵予算 <b>${run.enemyBudget.toLocaleString()}</b> pt</span>
            ${badge ? `<span class="wr-badge ${badge.kind}">${badge.text}</span>` : ''}
          </div>
        </section>
        <section class="wr-col wr-col-deck" aria-label="あなたのデッキ">
          <h2 class="wr-title">あなたのデッキ <span>カードを押すとデッキと控えを入れ替え</span></h2>
          <div class="wr-zone zone-deck">
            <div class="wr-zone-head">
              <span class="wr-zone-name">デッキ</span>
              <span class="wr-zone-count">ユニット枠 <b>${run.usedUnitSlots}</b> / ${run.unitSlots}</span>
              ${run.usedUnitSlots >= run.unitSlots ? '<b class="deck-full-badge">満杯</b>' : ''}
              <span class="wr-zone-power">総戦力 <b>${this.rogueDeckPower(run).toLocaleString()}</b></span>
            </div>
            <div class="deck-gauge${run.usedUnitSlots >= run.unitSlots ? ' is-full' : ''}" style="--slots: ${run.unitSlots}" aria-hidden="true">${this.renderRogueDeckGauge(run)}</div>
            ${deck ? `<div class="wr-deck-grid">${deck}</div>` : '<div class="wr-empty">デッキが空です。控えのカードを押して入れてください</div>'}
          </div>
          <div class="wr-zone zone-bench">
            <div class="wr-zone-head">
              <span class="wr-zone-name">控え</span>
              <span class="wr-zone-count">カードを押すとデッキへ</span>
            </div>
            ${bench ? `<div class="wr-deck-grid">${bench}</div>` : '<div class="wr-empty">控えのユニットはいません</div>'}
          </div>
          ${synergy ? `<div class="wr-synergy"><div class="wr-synergy-title">シナジー</div>${synergy}</div>` : ''}
        </section>
        <section class="wr-col wr-col-up" aria-label="強化">
          <h2 class="wr-title">強化</h2>
          ${this.renderRogueUpgrades(run)}
        </section>
      </div>
      <footer class="wr-foot">
        <button type="button" class="room-action scout" data-action="room-close">${SCOUT_ICON_SVG}<span>戦場を見る</span></button>
        <button type="button" class="wr-link" data-action="room-quit">ランを終了</button>
        <span class="wr-foot-info">出撃 <b>${bodies}</b> 体 ／ スコア <b>${run.score.toLocaleString()}</b></span>
        <button type="button" class="room-action sortie" data-action="room-fight" ${run.deck.length > 0 ? '' : 'disabled'}>${SORTIE_ICON_SVG}<span>出撃</span></button>
      </footer>
    `,
      'rogue-war-room',
    );
    const room = this.elRogueModal?.querySelector<HTMLElement>('.rogue-war-room');
    if (!room) return;
    [room, ...room.querySelectorAll<HTMLElement>('.wr-col')].forEach((el, i) => {
      el.scrollTop = scrollTops[i] ?? 0;
    });
    const logo = room.querySelector<HTMLElement>('.wr-logo');
    if (logo) setVoxelText(logo, 'EXBLOCKS', ROOM_LOGO_VOXEL);
    this.roomFx.flip(room, before);
  }

  /** ゴールドを払う操作。効果音と金貨の演出を付ける。買えたら true */
  private buyInWarRoom(button: HTMLElement, buy: () => boolean | undefined, flipKey?: string): boolean {
    const run = this.rogue;
    if (!run) return false;
    const goldBefore = run.gold;
    if (!buy()) return false;
    const targetRect = button.getBoundingClientRect();
    const goldRect = this.elRogueModal?.querySelector('.room-gold')?.getBoundingClientRect();
    this.sound.playPurchase();
    this.afterRogueWarRoomChanged();
    this.roomFx.spend(goldRect, targetRect, goldBefore, run.gold);
    this.unitPreviews?.kick('gold');
    if (flipKey) this.elRogueModal?.querySelector(`[data-flip="${flipKey}"]`)?.classList.add('fx-upgraded');
    return true;
  }

  /** 作戦室の操作後の共通処理（保存と表示更新） */
  private afterRogueWarRoomChanged(): void {
    const run = this.rogue;
    saveRogueRun(run);
    this.syncRogueFormation();
    if (run && !isFacilityTypeId(this.selectedId) && !this.isUnitAvailable(this.selectedType)) {
      this.selectedId = run.cards[0]?.id ?? 'clubber';
    }
    this.renderRoguePanel();
    this.afterLineupEdited();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.showRogueWarRoom();
  }

  /** 画面内の確認ダイアログ（ブラウザ標準の確認は環境によって出ないことがある） */
  private showConfirm(message: string, okLabel: string, onOk: () => void): void {
    const el = document.getElementById('confirm-dialog');
    if (!el) {
      if (window.confirm(message)) onOk();
      return;
    }
    el.innerHTML = `
      <div class="confirm-box">
        <p>${message.replace(/\n/g, '<br>')}</p>
        <div class="confirm-actions">
          <button type="button" class="wr-ghost" data-confirm="cancel">キャンセル</button>
          <button type="button" class="confirm-ok" data-confirm="ok">${okLabel}</button>
        </div>
      </div>`;
    el.classList.remove('hidden');
    el.onclick = (ev) => {
      const button = (ev.target as HTMLElement).closest<HTMLElement>('[data-confirm]');
      if (!button && ev.target !== el) return;
      el.classList.add('hidden');
      if (button?.dataset.confirm === 'ok') onOk();
    };
    el.querySelector<HTMLElement>('[data-confirm="cancel"]')?.focus();
  }

  private isConfirmOpen(): boolean {
    const el = document.getElementById('confirm-dialog');
    return Boolean(el && !el.classList.contains('hidden'));
  }

  private confirmQuitRogue(): void {
    const run = this.rogue;
    if (this.playStyle !== 'roguelite' || !run || run.ended) return;
    this.showConfirm('ローグライトのランを終了しますか？\nここまでのスコアで確定します。', 'ランを終了', () => {
      if (this.rogue === run && !run.ended) this.finishRogueRun('quit');
    });
  }

  /** ランを終了し、結果画面を表示する */
  private finishRogueRun(reason: RogueEndReason): void {
    const run = this.rogue;
    if (!run) return;
    if (!run.ended) run.finish(reason);
    this.mode = 'battle';
    this.announcedResult ??= 1;
    this.view.setPlacementGuidesVisible(false);
    this.hideRogueModal();

    const before = this.rogueMeta;
    this.rogueMeta = mergeRogueMeta(before, run);
    saveRogueMeta(this.rogueMeta);
    saveRogueRun(null);
    const isNewRecord = run.score > before.bestScore;
    const newlyUnlocked = ROGUE_STARTERS.filter(
      (st) => !isStarterUnlocked(st, before) && isStarterUnlocked(st, this.rogueMeta),
    );

    const reasonText: Readonly<Record<RogueEndReason, string>> = {
      clear: `🏆 全${ROGUE_FINAL_ROUND}ラウンド突破！`,
      defeat: 'ライフが尽きました',
      quit: '🏳 ランを終了しました',
    };
    setVoxelText(this.elBannerText, reason === 'clear' ? 'RUN CLEAR!' : 'GAME OVER', BANNER_VOXEL);
    this.elBannerSub.textContent = reasonText[reason];
    const relics = run.relics.map((r) => relicDisplayName(r)).join('・');
    const units = run.cards.map((c) => `${UNIT_TYPES[c.id].name} Lv${c.level}`).join('・');
    this.showChallengeBannerDetail(`
      ${isNewRecord ? '<div class="challenge-new-record">🏆 NEW RECORD</div>' : ''}
      <div class="challenge-score-row total"><span>到達</span><b>ROUND ${run.endReason === 'clear' ? ROGUE_FINAL_ROUND : run.round}</b></div>
      <div class="challenge-score-row total"><span>スコア</span><b>${run.score.toLocaleString()}</b></div>
      ${this.renderGrowthChart()}
      <div class="challenge-score-row"><span>最終編成</span><b>${units}</b></div>
      <div class="challenge-score-row"><span>陣地レリック</span><b>${relics}</b></div>
      ${newlyUnlocked.map((st) => `<div class="result-unlock">🎉 新スターター解放: ${st.name}</div>`).join('')}
      <div class="challenge-score-divider"></div>
      <div class="challenge-score-row"><span>ベスト</span><b>${this.rogueMeta.bestScore.toLocaleString()} ／ ROUND ${this.rogueMeta.bestRound}</b></div>
    `);
    if (this.elRetryBtn) {
      this.elRetryBtn.textContent = '🏠 タイトルへ';
      this.elRetryBtn.classList.remove('hidden');
    }
    if (this.elNextStageBtn) {
      this.elNextStageBtn.textContent = '↻ 新しいラン';
      this.elNextStageBtn.classList.remove('hidden');
    }
    this.scheduleResultBanner();
    this.renderRoguePanel();
    this.syncPhaseUI();
    this.syncUnitDetailOverlay();
  }

  private showRogueModal(html: string, innerClass = ''): void {
    if (!this.elRogueModal) return;
    this.hideEnemyDetail();
    this.elRogueModal.innerHTML = `<div class="rogue-modal-inner ${innerClass}">${html}</div>`;
    this.elRogueModal.classList.remove('hidden');
    this.rogueModalKind = innerClass === 'rogue-war-room' ? 'room' : innerClass === 'rogue-rewards' ? 'rewards' : 'starter';
    // 作戦室は全画面を使うので、背後のパネル類を隠す（閉じると元に戻る）
    document.body.classList.toggle('war-room-open', this.rogueModalKind === 'room');
    this.unitPreviews ??= new UnitPreviews();
    this.unitPreviews.bind(this.elRogueModal);
    this.elRogueModal.onclick = (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target || (target as HTMLButtonElement).disabled) return;
      const index = Number(target.dataset.index);
      const run = this.rogue;
      switch (target.dataset.action) {
        case 'starter':
          this.startRogueRun(ROGUE_STARTERS[index]);
          break;
        case 'reward': {
          const opt = this.rogue?.pendingRewards?.[index];
          if (opt) this.chooseRogueReward(opt);
          break;
        }
        case 'deck-toggle': {
          const id = target.dataset.unit as UnitTypeId;
          const wasInDeck = run?.card(id)?.inDeck ?? false;
          this.roomSelectedUnit = id;
          if (run?.toggleDeck(id)) {
            if (wasInDeck) this.sound.playRemove();
            else this.sound.playPlace();
            this.afterRogueWarRoomChanged();
          } else {
            this.sound.playDenied();
            this.roomFx.deny(target.closest('.wr-card'), this.elRogueModal?.querySelector('.deck-gauge'));
          }
          break;
        }
        case 'card-up': {
          const id = target.dataset.unit as UnitTypeId;
          this.roomSelectedUnit = id;
          if (this.buyInWarRoom(target, () => run?.buyCardLevel(id), `card:${id}`)) this.unitPreviews?.kick(id);
          break;
        }
        case 'unit-slot':
          this.buyInWarRoom(target, () => run?.buyUnitSlot());
          break;
        case 'relic-slot':
          this.buyInWarRoom(target, () => run?.buyRelicSlot());
          break;
        case 'relic-up':
          this.buyInWarRoom(target, () => run?.buyRelicLevel(index), `relic:${index}`);
          break;
        case 'relic-toggle': {
          const relic = run?.relics[index];
          if (run?.toggleRelic(index)) {
            const on = relic?.active ?? false;
            if (on) this.sound.playPlace();
            else this.sound.playRemove();
            this.afterRogueWarRoomChanged();
            this.elRogueModal?.querySelector(`[data-flip="relic:${index}"]`)?.classList.add(on ? 'fx-on' : 'fx-off');
            if (on && relic) this.unitPreviews?.kick(`relic:${relic.id}`);
          } else {
            this.sound.playDenied();
            this.roomFx.deny(target.closest('.wr-relic'), this.elRogueModal?.querySelector('.wr-relic-count'));
          }
          break;
        }
        case 'room-quit':
          this.confirmQuitRogue();
          break;
        case 'room-close':
          this.hideRogueModal();
          break;
        case 'room-fight':
          this.hideRogueModal();
          this.startBattle();
          break;
        case 'reroll':
          if (this.rogue?.reroll()) {
            saveRogueRun(this.rogue);
            this.showRogueRewards();
          }
          break;
        case 'skip':
          this.chooseRogueReward(null);
          break;
      }
    };
  }

  private hideRogueModal(): void {
    this.elRogueModal?.classList.add('hidden');
    this.rogueModalKind = null;
    document.body.classList.remove('war-room-open');
    this.unitPreviews?.unbind();
  }

  private isRogueModalOpen(): boolean {
    return Boolean(this.elRogueModal && !this.elRogueModal.classList.contains('hidden'));
  }

  /** 配置中の自軍のタグの数 */
  private currentRogueTagCounts(): Map<string, number> {
    const ids = this.battle.units.filter((u) => u.team === 0).map((u) => u.type.id);
    return countTags(ids);
  }

  /** 発動中・発動間近のタグのシナジーの一覧 */
  private renderRogueTagRows(): string {
    const counts = this.currentRogueTagCounts();
    return TAG_IDS.filter((t) => (counts.get(t) ?? 0) > 0)
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .map((t) => {
        const c = counts.get(t) ?? 0;
        const tier = getTagTier(c);
        const info = TAG_INFO[t];
        const next = tier === 4 ? '' : tier === 2 ? `あと${4 - c}種で: ${info.tier4}` : `あと${2 - c}種で: ${info.tier2}`;
        const active = tier === 4 ? `${info.tier2} ／ ${info.tier4}` : tier === 2 ? info.tier2 : '';
        return `<div class="tag-row tier-${tier}" title="${next}">
          <span class="tag-name">${info.icon} ${info.name} <b>${c}</b></span>
          <span class="tag-effect">${active || `<i>${next}</i>`}</span>
        </div>`;
      })
      .join('');
  }

  /** サイドパネルのローグライト状況（ラウンド・ライフ・予算・レリック・タグのシナジー） */
  private renderRoguePanel(): void {
    if (!this.elRoguePanel) return;
    const run = this.rogue;
    document.getElementById('btn-rogue-quit')?.classList.toggle('hidden', !run || run.ended);
    // 残機ハートをライフに同期する（減少時は破砕・増加時は復活アニメーションが再生される）
    // 決着前の戦闘中は上部のピルにライフを出すので、画面上の大きなハートは決着まで隠しておく
    const fighting = this.mode === 'battle' && this.announcedResult === null;
    if (this.playStyle === 'roguelite' && !fighting) {
      if (run) this.view.syncRogueHearts(run.lives, ROGUE_MAX_LIVES);
      else this.view.syncRogueHearts(ROGUE_MAX_LIVES, ROGUE_MAX_LIVES, true);
    }
    if (!run) {
      const meta = this.rogueMeta;
      this.elRoguePanel.innerHTML = `
        <div class="brief-title">スターター部隊を選んでください</div>
        <div class="brief-desc">ベスト ${meta.bestScore.toLocaleString()}点 ／ 最高 ROUND ${meta.bestRound || '—'} ／ クリア ${meta.clears}回</div>`;
      return;
    }
    const tagRows = this.renderRogueTagRows();
    const enemies = this.savedLineup.filter((r) => r.team === 1);
    const relics = run.relics
      .map((r) => `<span class="reward-chip">${relicDisplayName(r)}${r.active ? '' : '（OFF）'}</span>`)
      .join('');
    const kind = run.roundKind === 'boss' ? '👑 ボス' : run.roundKind === 'elite' ? '⚔ エリート' : '';
    const hard = run.isHardMode ? '🔥 ハード' : '';
    this.elRoguePanel.innerHTML = `
      <div class="brief-title">ROUND ${run.round} / ${ROGUE_FINAL_ROUND} ${hard} ${kind}</div>
      <div class="brief-sub">❤ ${'❤'.repeat(run.lives)}${'♡'.repeat(Math.max(0, ROGUE_MAX_LIVES - run.lives))} ｜ 💰 ${run.gold}G ｜ 敵 ${run.enemyBudget.toLocaleString()}pt ｜ スコア ${run.score.toLocaleString()}</div>
      <div class="brief-badges"><span class="brief-badge-label">レリック枠 ${run.activeRelics.length}/${run.relicSlots} ｜ ユニット枠 ${run.usedUnitSlots}/${run.unitSlots}:</span>${relics}</div>
      <div class="tag-panel">${tagRows || '<div class="brief-hint">デッキにユニットを入れるとタグのシナジーが表示されます</div>'}</div>
      <div class="brief-badges">
        <span class="brief-badge-label">敵軍編成:</span>
        ${this.renderEnemyChips(enemies)}
      </div>
      <div class="brief-hint">デッキのカードが部隊で自動出撃します。倒れてもカードは失われません。ゲートは開戦時に全員に効きます。通算3敗でラン終了。負けると勝利の2倍のゴールドと、レアユニットが出やすい報酬の3択を2回受け取れます。時間切れは生き残った合計コストで判定します。ラウンド5・10・20・25はエリート、${ROGUE_MID_BOSS_ROUND}は中ボス、${ROGUE_FINAL_ROUND}は最終ボスです。ラウンド${ROGUE_HARD_START_ROUND}からはハードモードに突入し、敵に高額強力なユニットが増加します。</div>
    `;
    this.rogueTagKey = this.computeRogueTagKey();
  }

  private computeRogueTagKey(): string {
    return this.savedLineup
      .filter((r) => r.team === 0)
      .map((r) => r.typeId ?? r.facilityId)
      .sort()
      .join(',');
  }

  private formatRogueBadge(): string {
    const run = this.rogue;
    if (!run) return '🎲 ローグライト ｜ スターター部隊を選んでください';
    const hard = run.isHardMode ? ' 🔥HARD' : '';
    const head = `🎲 <b>ROUND ${run.round}/${ROGUE_FINAL_ROUND}${hard}</b> ${this.rogueHeartSlotHtml(run.lives)}`;
    if (this.mode === 'placement') {
      return `${head} ｜ ゴールド ${COST_ICON_SVG} <b>${run.gold}</b> G ｜ 全軍 <b>${this.battle.aliveCount(0)}</b> 体 ｜ 敵 ${run.enemyBudget.toLocaleString()} pt`;
    }
    const remain = Math.max(0, (this.battle.timeLimitSeconds ?? 0) - this.battle.time);
    return `⚔ ${head} ｜ ⏱ 残り <b>${remain.toFixed(1)}s</b> ｜ 与ダメージ <b>${formatDamage(this.battleStats.total)}</b>`;
  }

  /** 友人対戦モード（2〜4人・ブラインド順番配置）を開始・リセットする */
  enterVersusMode(playerCount: PlayerCount = this.versus.playerCount, randomizeBudget = true): void {
    this.battle.rules = null;
    this.playStyle = 'versus';
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(true);
    // ワールドの地形・特殊ルールを標準状態にリセット
    this.battle.configureStage();
    this.view.clearDebris();
    this.view.setStageTheme(undefined);

    this.versus.setPlayerCount(playerCount, randomizeBudget);
    this.savedLineup = [];
    this.clearedBackup = [];
    this.view.setVersusZones(getVersusZones(this.versus.playerCount), this.versus.currentTurn);

    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncVersusUI();
    this.syncPhaseUI();
    this.updateHUD();
  }

  /** 友人対戦モードのサイドパネルおよび上部HUDバーの表示を同期する */
  private syncVersusUI(): void {
    const budgetStr = String(this.versus.budget);
    if (this.elVersusBudgetInput && document.activeElement !== this.elVersusBudgetInput) {
      this.elVersusBudgetInput.value = budgetStr;
    }
    if (this.elVersusHudBudget && document.activeElement !== this.elVersusHudBudget) {
      this.elVersusHudBudget.value = budgetStr;
    }

    const syncButtons = (selector: string) => {
      document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
        const cnt = Number(btn.dataset.pcount);
        btn.classList.toggle('active', cnt === this.versus.playerCount);
      });
    };
    syncButtons('#versus-player-buttons button[data-pcount]');
    syncButtons('#versus-hud-players button[data-pcount]');

    if (this.elVersusTurnStatus) {
      const rows: string[] = [];
      for (let i = 0; i < this.versus.playerCount; i++) {
        const t = i as Team;
        const isCurrent = this.mode === 'placement' && this.versus.currentTurn === t && !this.versus.allReady;
        const isDone = this.versus.completed[t];
        const statusText =
          this.mode === 'battle'
            ? '⚔ 交戦中'
            : isDone
              ? '🙈 配置完了 (ブラインド中)'
              : isCurrent
                ? `👉 配置中 (残り ${Math.max(0, this.versus.budget - this.getCurrentTeamCost(t))} pt)`
                : '⏳ 待機中';
        const rowClass = isCurrent ? 'versus-turn-row active' : isDone ? 'versus-turn-row done' : 'versus-turn-row';
        rows.push(`
          <div class="${rowClass}">
            <span>${TEAM_ICONS[t]} ${i + 1}P ${TEAM_NAMES[t]}</span>
            <span class="turn-state">${statusText}</span>
          </div>
        `);
      }
      this.elVersusTurnStatus.innerHTML = rows.join('');
    }
  }

  /** 友人対戦モードで現在手番プレイヤーの配置完了OKを確定し、ブラインドして次プレイヤーへ進める（全員完了で戦闘開始） */
  confirmVersusTurn(): void {
    if (this.playStyle !== 'versus' || this.mode !== 'placement') return;
    const team = this.versus.currentTurn;
    const forceCount = this.battle.aliveCount(team) + this.battle.aliveFacilityCount(team);
    if (forceCount === 0) {
      this.flashPhaseWarning(`⚠ ${team + 1}P ${TEAM_NAMES[team]}のユニットまたは防衛施設を1つ以上配置してください`);
      return;
    }

    const { allReady, nextTeam } = this.versus.confirmCurrentTurn();
    this.clearedBackup = [];
    if (!allReady) {
      // 今のプレイヤーの配置をブラインド（戦場から非表示化）し、次のプレイヤーの手番へ切り替え
      this.battle.clear();
      this.view.clearDebris();
      const nextLineup = this.versus.getTeamLineup(nextTeam);
      this.spawnRecords(nextLineup);
      this.view.setVersusZones(getVersusZones(this.versus.playerCount), nextTeam);
      this.sound.playPlace();
      this.syncVersusUI();
      this.syncPhaseUI();
      this.updateHUD();
    } else {
      // 全員の配置が完了！全プレイヤーのブラインドを解除して一斉スポーン＆戦闘スタート
      this.battle.clear();
      this.view.clearDebris();
      this.savedLineup = this.versus.getAllActiveLineups();
      this.spawnRecords(this.savedLineup);
      this.syncVersusUI();
      this.startBattle();
    }
  }

  /** アーケードモードの指定ステージを読み込む */
  loadArcadeStage(stageIndex: number): void {
    this.battle.rules = null;
    this.playStyle = 'arcade';
    this.currentStageIndex = Math.max(0, Math.min(ARCADE_STAGES.length - 1, stageIndex));
    const st = this.currentStage;

    // 選択中の兵種が未解放なら初期兵種に戻す
    if (!isUnitUnlocked(this.arcadeSave, this.selectedType)) {
      this.selectedType = st.featuredUnits.find((id) => isUnitUnlocked(this.arcadeSave, id)) ?? 'clubber';
    }

    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(true);
    // ステージ固有地形・限定ルールを物理ワールドと描画ビューへ反映
    const rules = st.specialRules;
    this.battle.configureStage({
      obstacles: st.terrain.obstacles,
      chasm: st.terrain.chasm,
      pits: st.terrain.pits,
      arenaBounds: st.terrain.arenaBounds,
      gravityScale: rules?.gravityScale,
      timeLimitSeconds: rules?.timeLimitSeconds,
      damageMultiplier: rules?.damageMultiplier,
      speedMultiplier: rules?.speedMultiplier,
      hazard: st.hazard,
    });
    this.view.clearDebris();

    this.view.setStageTerrain(st.terrain, true);
    this.view.setStageTheme(st.visualTheme);

    // 敵（青軍）の固定配置を生成
    this.savedLineup = st.enemies.map((e) => ({
      typeId: e.typeId,
      facilityId: e.facilityId,
      team: 1 as Team,
      x: e.x,
      z: e.z,
      facing: e.facing,
    }));
    this.spawnRecords(this.savedLineup);
    this.clearedBackup = [];
    this.restorePlayerLineup();

    this.renderArcadeStageButtons();
    this.renderStageBriefing();
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  loadPreset(preset: PresetScenario): void {
    this.battle.rules = null;
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(true);
    this.battle.configureStage();
    this.view.clearDebris();
    this.view.setStageTerrain(null, false);
    this.view.setStageTheme(undefined);
    this.savedLineup = preset.units.map((u) => ({ ...u }));
    this.clearedBackup = [];
    this.spawnRecords(this.savedLineup);
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  startBattle(): void {
    // ショップなどの画面を開いている間は開戦しない（Space の誤爆防止）
    if (this.playStyle === 'roguelite' && this.isRogueModalOpen()) return;
    if (this.playStyle === 'versus') {
      let activeTeams = 0;
      for (let i = 0; i < this.versus.playerCount; i++) {
        const t = i as Team;
        if (this.battle.aliveCount(t) + this.battle.aliveFacilityCount(t) > 0) {
          activeTeams++;
        }
      }
      if (activeTeams < 2) {
        this.flashPhaseWarning('⚠ 2チーム以上のユニットまたは施設が配置されている必要があります');
        return;
      }
    } else {
      const redForce = this.battle.aliveCount(0) + this.battle.aliveFacilityCount(0);
      const blueForce = this.battle.aliveCount(1) + this.battle.aliveFacilityCount(1);
      if (redForce === 0) {
        this.flashPhaseWarning('⚠ 赤軍ユニットまたは施設を配置してから戦闘開始してください');
        return;
      }
      if (blueForce === 0) {
        return;
      }
    }
    if (this.playStyle === 'roguelite') {
      if (!this.rogue || this.rogue.ended) return;
      if (this.rogue.deck.length === 0) {
        this.flashPhaseWarning('⚠ デッキにユニットを1枚以上入れてください');
        return;
      }
      this.hideRogueModal();
      this.battle.time = 0;
      saveRogueRun(this.rogue);
      this.rogueRoster = [
        ...this.battle.units.filter((u) => u.team === 0),
        ...this.battle.facilities.filter((f) => f.team === 0 && !f.isTerrain),
      ];
      this.battle.rules = this.rogueRules;
      this.rogueRules.start(this.battle);
      const gates = this.rogue.activeGates;
      this.rogueGateSequence =
        gates.length > 0
          ? new RogueGateSequence(this.battle, this.rogueRules, gates, Math.random, () => this.onRogueGatesApplied())
          : null;
      this.jackpotAllyMaxHpTotal = this.rogueAllyMaxHpTotal();
      this.resetJackpot();
      this.jackpotTracker = new JackpotDropTracker(JACKPOT_MAX_DROPS[this.rogue.roundKind]);
    }
    this.battleStats.reset();
    this.damageOverlay.clear();
    if (this.playStyle === 'challenge') {
      this.challenge.commitLineup(this.savedLineup);
    }
    this.playerRoster = [
      ...this.battle.units.filter((u) => u.team === 0),
      ...this.battle.facilities.filter((f) => f.team === 0),
    ];
    this.mode = 'battle';
    this.battle.beginCombat(this.playStyle === 'roguelite' ? this.rogueGateSequence : null);
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(false);
    // ノートPC以下の画面幅では戦闘開始時に自動でモードパネルを閉じて戦場を見やすくする
    if ((window.innerWidth <= 1500 || this.playStyle === 'roguelite') && this.sidePanelVisible) {
      this.sidePanelVisible = false;
      this.syncSidePanelUI();
    }
    if (!this.onTitleScreen) this.sound.playBattleStart();
    this.notifyTutorial('battle_started');
    if (this.playStyle === 'versus') this.syncVersusUI();
    this.syncPhaseUI();
    this.syncUnitDetailOverlay();
  }

  private rogueAllyMaxHpTotal(): number {
    return this.battle.units.filter((u) => u.team === 0).reduce((sum, u) => sum + u.maxHp, 0);
  }

  /** ゲートの強化がすべて終わったら、複製や体格の変化を集計に反映する */
  private onRogueGatesApplied(): void {
    this.rogueGateSequence = null;
    this.jackpotAllyMaxHpTotal = this.rogueAllyMaxHpTotal();
    this.playerRoster = [
      ...this.battle.units.filter((u) => u.team === 0),
      ...this.battle.facilities.filter((f) => f.team === 0),
    ];
  }

  /** 開戦時のゲート演出が流れていればスキップする（スキップしたら true） */
  private skipRogueGateSequence(): boolean {
    if (!this.rogueGateSequence || this.battle.opening !== this.rogueGateSequence) return false;
    this.rogueGateSequence.skip();
    return true;
  }

  returnToPlacement(): void {
    // チャレンジ・ローグライトにリトライはない（Space / R キーもここで止まる）
    if (this.playStyle === 'challenge' || this.playStyle === 'roguelite') return;
    this.damageOverlay.clear();
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.hideResultBanner();
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();

    if (this.playStyle === 'versus') {
      // 友人対戦では配置された編成を保持しつつ1Pの手番に戻し、他プレイヤーの編成は再びブラインドする
      this.versus.reopenPlacementsKeepLineups();
      const firstLineup = this.versus.getTeamLineup(0);
      this.spawnRecords(firstLineup);
      this.view.setVersusZones(getVersusZones(this.versus.playerCount), 0);
      this.syncVersusUI();
    } else {
      this.spawnRecords(this.savedLineup);
    }
    this.syncPhaseUI();
    this.syncUnitDetailOverlay();
    this.updateHUD();
  }

  private formatArcadeBudgetBadge(st: ArcadeStage, used: number): string {
    const starPreview =
      used === 0
        ? `★3目安 ≤${st.star3Budget}`
        : used <= st.star3Budget
          ? '★★★圏内'
          : used <= st.star2Budget
            ? '★★☆圏内'
            : '★☆☆圏内';
    const maxUnitsStr =
      st.specialRules?.maxUnits !== undefined
        ? ` ｜ 配置数: <b>${this.getCurrentRedPlacedCount()}</b>/${st.specialRules.maxUnits}体`
        : '';
    const remain = Math.max(0, st.budget - used);
    return `${st.name} ｜ 予算: ${COST_ICON_SVG} 残り <b>${remain}</b> / ${st.budget} pt (${starPreview})${maxUnitsStr}`;
  }

  private formatVersusBudgetBadge(): string {
    const t = this.versus.currentTurn;
    const used = this.getCurrentTeamCost(t);
    const budget = this.versus.budget;
    const remain = Math.max(0, budget - used);
    return `👥 ${this.versus.playerCount}人対戦 ｜ ${TEAM_ICONS[t]} <b>${t + 1}P ${TEAM_NAMES[t]}の配置番</b> ｜ 予算: ${COST_ICON_SVG} 残り <b>${remain}</b> / ${budget} pt ｜ 完了OKでブラインドして次へ`;
  }

  private syncPhaseUI(): void {
    this.syncMusic();
    const isVersusPlacement = this.playStyle === 'versus' && this.mode === 'placement';
    this.elVersusHudBar?.classList.toggle('hidden', !isVersusPlacement);
    this.elStartBtn.disabled = false;
    // 配置を変更するボタンは配置フェーズだけ出す
    for (const id of ['btn-undo', 'btn-touch-erase', 'btn-clear']) {
      document.getElementById(id)?.classList.toggle('hidden', this.mode !== 'placement');
    }
    document.getElementById('battle-speed-bar')?.classList.toggle('hidden', this.mode !== 'battle');
    // ローグライトの戦闘中は専用の HUD に切り替える
    const rogueBattle = this.playStyle === 'roguelite' && this.mode === 'battle';
    document.body.classList.toggle('rogue-battle', rogueBattle);
    document.getElementById('rogue-hud')?.classList.toggle('hidden', !rogueBattle);
    this.rogueHudKey = '';
    this.rogueRankKey = '';
    // 戦闘中は配置できないので、兵種バーを畳んで戦場を広く見せる
    this.elBottomHud?.classList.toggle('in-battle', this.mode === 'battle');
    document
      .getElementById('btn-rogue-shop')
      ?.classList.toggle('hidden', !(this.playStyle === 'roguelite' && this.mode === 'placement' && this.rogue));
    // ローグライトは自動配置なので、配置を編集するボタンを出さない
    for (const id of ['btn-touch-erase', 'btn-undo', 'btn-clear']) {
      document.getElementById(id)?.classList.toggle('rogue-hidden', this.playStyle === 'roguelite');
    }
    const showStageNav = this.playStyle === 'arcade' && this.mode === 'placement';
    document.getElementById('btn-stage-prev')?.classList.toggle('hidden', !showStageNav);
    document.getElementById('btn-stage-next')?.classList.toggle('hidden', !showStageNav);

    if (this.mode === 'placement') {
      if (this.playStyle === 'roguelite') {
        this.elPhaseBadge.innerHTML = this.formatRogueBadge();
        this.elStartBtn.textContent = '⚔ 戦闘開始';
        this.elStartBtn.className = 'start-btn';
        this.elStartBtn.disabled = !this.rogue;
      } else if (this.playStyle === 'challenge') {
        this.elPhaseBadge.innerHTML = this.formatChallengeBadge();
        this.elStartBtn.textContent = '⚔ 戦闘開始';
        this.elStartBtn.className = 'start-btn';
      } else if (this.playStyle === 'arcade') {
        const st = this.currentStage;
        const used = this.getCurrentRedCost();
        this.elPhaseBadge.innerHTML = this.formatArcadeBudgetBadge(st, used);
        this.elStartBtn.textContent = '⚔ 戦闘開始';
        this.elStartBtn.className = 'start-btn';
      } else if (this.playStyle === 'versus') {
        const t = this.versus.currentTurn;
        const isLastTurn = t + 1 >= this.versus.playerCount;
        this.elPhaseBadge.innerHTML = this.formatVersusBudgetBadge();
        this.elStartBtn.textContent = isLastTurn
          ? `✅ ${t + 1}P 配置完了OK（全員完了→⚔戦闘開始！）`
          : `✅ ${t + 1}P (${TEAM_NAMES[t]}) 配置完了OK → 🙈ブラインドして${t + 2}Pへ`;
        this.elStartBtn.className = isLastTurn ? 'start-btn' : 'start-btn confirm-turn';
      } else {
        this.elPhaseBadge.textContent = '配置フェーズ（左半分：赤軍 ／ 右半分：青軍）';
        this.elStartBtn.textContent = '⚔ 戦闘開始';
        this.elStartBtn.className = 'start-btn';
      }
      this.elPhaseBadge.className = 'phase-badge placement';
      this.elUnitBar.classList.remove('disabled');
    } else {
      const hazardStr =
        this.playStyle === 'arcade' && this.currentStage.hazard
          ? ` ｜ <span class="hud-hazard-badge">${this.currentStage.hazard.badge} 発動中</span>`
          : '';
      this.elPhaseBadge.innerHTML =
        this.playStyle === 'arcade'
          ? `戦闘中 - ${this.currentStage.name}${hazardStr}`
          : this.playStyle === 'versus'
            ? `⚔ 友人対戦 (${this.versus.playerCount}人バトル) - 戦闘中！`
            : '戦闘中';
      this.elPhaseBadge.className = 'phase-badge battle';
      this.elStartBtn.textContent = '↺ 配置に戻る';
      this.elStartBtn.className = 'start-btn stop';
      this.elUnitBar.classList.add('disabled');
      if (this.playStyle === 'roguelite') {
        this.elPhaseBadge.innerHTML = this.formatRogueBadge();
        if (!this.rogue || this.rogue.ended) {
          this.elStartBtn.textContent = this.rogue?.endReason === 'clear' ? 'RUN CLEAR' : 'GAME OVER';
          this.elStartBtn.disabled = true;
        } else if (this.announcedResult !== null) {
          this.elStartBtn.textContent = this.rogue.lossRewardPicks > 0
            ? '🛟 逆転の報酬を選ぶ (Space)'
            : this.rogue.pendingRewards
              ? '🎁 報酬を選ぶ (Space)'
              : '▶ 次のラウンドへ (Space)';
          this.elStartBtn.className = 'start-btn';
        } else {
          this.elStartBtn.textContent = '🏳 ランを終了';
        }
      }
      if (this.playStyle === 'challenge') {
        this.elPhaseBadge.innerHTML = this.formatChallengeBadge();
        if (this.challenge.ended) {
          this.elStartBtn.textContent = 'GAME OVER';
          this.elStartBtn.disabled = true;
        } else if (this.announcedResult !== null) {
          this.elStartBtn.textContent = '▶ 次のラウンドへ (Space)';
          this.elStartBtn.className = 'start-btn';
        } else {
          this.elStartBtn.textContent = '🏳 ギブアップ';
        }
      }
    }
  }

  private updateHUD(): void {
    const statsFor = (team: Team) => {
      let alive = 0;
      let total = 0;
      let cost = 0;
      let hp = 0;
      let maxHp = 0;
      for (const u of this.battle.units) {
        if (u.team !== team) continue;
        total++;
        if (u.splitGen === 0) cost += UNIT_TYPES[u.type.id].cost;
        maxHp += u.maxHp;
        if (u.alive) {
          alive++;
          hp += Math.max(0, u.hp);
        }
      }
      for (const f of this.battle.facilities) {
        if (f.team !== team || f.isTerrain) continue;
        total++;
        cost += f.type.cost;
        maxHp += f.maxHp;
        if (f.alive) {
          alive++;
          hp += Math.max(0, f.hp);
        }
      }
      const ratio = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
      return { alive, total, cost, ratio };
    };

    const showYellow = this.playStyle === 'versus' && this.versus.playerCount >= 3;
    const showGreen = this.playStyle === 'versus' && this.versus.playerCount >= 4;
    this.elYellowStats?.classList.toggle('hidden', !showYellow);
    this.elGreenStats?.classList.toggle('hidden', !showGreen);

    const panels: Array<{ el: HTMLElement | null; fillClass: string }> = [
      { el: this.elRedStats, fillClass: 'red' },
      { el: this.elBlueStats, fillClass: 'blue' },
      { el: this.elYellowStats, fillClass: 'yellow' },
      { el: this.elGreenStats, fillClass: 'green' },
    ];
    for (const p of panels) {
      p.el?.classList.remove('active-turn');
    }

    if (this.playStyle === 'versus') {
      const budget = this.versus.budget;
      for (let i = 0; i < this.versus.playerCount; i++) {
        const team = i as Team;
        const panel = panels[i];
        if (!panel.el) continue;

        if (this.mode === 'placement') {
          const isCurrent = this.versus.currentTurn === team && !this.versus.allReady;
          const isDone = this.versus.completed[team];
          panel.el.classList.toggle('active-turn', isCurrent);

          if (isDone) {
            panel.el.innerHTML = `
              <div class="team-title">${TEAM_ICONS[team]} ${i + 1}P ${TEAM_NAMES[team]} <span class="blind-tag">🙈 配置完了</span></div>
              <div class="hp-bar"><div class="hp-fill ${panel.fillClass}" style="width:100%"></div></div>
            `;
          } else if (isCurrent) {
            const s = statsFor(team);
            panel.el.innerHTML = `
              <div class="team-title">${TEAM_ICONS[team]} ${i + 1}P ${TEAM_NAMES[team]}: ${s.alive}体 <span class="cost-tag">${COST_ICON_SVG}${s.cost}/${budget}</span></div>
              <div class="hp-bar"><div class="hp-fill ${panel.fillClass}" style="width:${s.ratio}%"></div></div>
            `;
          } else {
            panel.el.innerHTML = `
              <div class="team-title">${TEAM_ICONS[team]} ${i + 1}P ${TEAM_NAMES[team]} <span class="cost-tag">待機中 (予算${budget})</span></div>
              <div class="hp-bar"><div class="hp-fill ${panel.fillClass}" style="width:0%"></div></div>
            `;
          }
        } else {
          const s = statsFor(team);
          panel.el.innerHTML = `
            <div class="team-title">${TEAM_ICONS[team]} ${i + 1}P ${TEAM_NAMES[team]}: ${s.alive}/${s.total} <span class="cost-tag">${COST_ICON_SVG}${s.cost}</span></div>
            <div class="hp-bar"><div class="hp-fill ${panel.fillClass}" style="width:${s.ratio}%"></div></div>
          `;
        }
      }

      if (this.mode === 'placement' && !this.elPhaseBadge.classList.contains('budget-over')) {
        this.elPhaseBadge.innerHTML = this.formatVersusBudgetBadge();
      }
      return;
    }

    const r = statsFor(0);
    const b = statsFor(1);
    if (this.playStyle === 'roguelite') {
      // 人数はどの表示も battle.aliveCount（生きているユニットの数）から描く
      const gold = this.rogue?.gold ?? 0;
      this.elRedStats.innerHTML = `
        <div class="rg-count"><span>自軍</span><b>${this.battle.aliveCount(0)}</b><small>${gold.toLocaleString()} G</small></div>
        <div class="hp-bar"><div class="hp-fill red" style="width:${r.ratio}%"></div></div>
      `;
      this.elBlueStats.innerHTML = `
        <div class="rg-count"><span>敵軍</span><b>${this.battle.aliveCount(1)}</b></div>
        <div class="hp-bar"><div class="hp-fill blue" style="width:${b.ratio}%"></div></div>
      `;
      if (this.mode === 'battle') this.updateRogueBattleHud();
      if (!this.elPhaseBadge.classList.contains('budget-over')) {
        this.elPhaseBadge.innerHTML = this.formatRogueBadge();
      }
      // 配置が変わったらタグのシナジー表示を更新する
      if (this.mode === 'placement' && this.computeRogueTagKey() !== this.rogueTagKey) this.renderRoguePanel();
    } else if (this.playStyle === 'challenge') {
      this.elRedStats.innerHTML = `
        <div class="team-title">🔴 自軍: ${r.alive}/${r.total} <span class="cost-tag">${COST_ICON_SVG}${r.cost}/${CHALLENGE_PLAYER_BUDGET}</span></div>
        <div class="hp-bar"><div class="hp-fill red" style="width:${r.ratio}%"></div></div>
      `;
      this.elBlueStats.innerHTML = `
        <div class="team-title">🔵 敵軍: ${b.alive}/${b.total} <span class="cost-tag">${COST_ICON_SVG}${b.cost}</span></div>
        <div class="hp-bar"><div class="hp-fill blue" style="width:${b.ratio}%"></div></div>
      `;
      if (!this.elPhaseBadge.classList.contains('budget-over')) {
        this.elPhaseBadge.innerHTML = this.formatChallengeBadge();
      }
    } else if (this.playStyle === 'arcade') {
      const budget = this.currentStage.budget;
      this.elRedStats.innerHTML = `
        <div class="team-title">🔴 自軍: ${r.alive}/${r.total} <span class="cost-tag">${COST_ICON_SVG}${r.cost}/${budget}</span></div>
        <div class="hp-bar"><div class="hp-fill red" style="width:${r.ratio}%"></div></div>
      `;
      this.elBlueStats.innerHTML = `
        <div class="team-title">🔵 敵軍: ${b.alive}/${b.total} <span class="cost-tag">${COST_ICON_SVG}${b.cost}</span></div>
        <div class="hp-bar"><div class="hp-fill blue" style="width:${b.ratio}%"></div></div>
      `;
      if (this.mode === 'placement' && !this.elPhaseBadge.classList.contains('budget-over')) {
        this.elPhaseBadge.innerHTML = this.formatArcadeBudgetBadge(this.currentStage, r.cost);
      } else if (this.mode === 'battle') {
        const hazardStr = this.currentStage.hazard
          ? ` ｜ <span class="hud-hazard-badge">${this.currentStage.hazard.badge} 発動中</span>`
          : '';
        if (this.battle.timeLimitSeconds !== null) {
          const remain = Math.max(0, this.battle.timeLimitSeconds - this.battle.time);
          this.elPhaseBadge.innerHTML = `戦闘中 - ${this.currentStage.name} ｜ ⏱ 残り時間: <b>${remain.toFixed(1)}s</b>${hazardStr}`;
        } else {
          this.elPhaseBadge.innerHTML = `戦闘中 - ${this.currentStage.name}${hazardStr}`;
        }
      }
    } else {
      this.elRedStats.innerHTML = `
        <div class="team-title">🔴 赤軍: ${r.alive}/${r.total} <span class="cost-tag">${COST_ICON_SVG}${r.cost}</span></div>
        <div class="hp-bar"><div class="hp-fill red" style="width:${r.ratio}%"></div></div>
      `;
      this.elBlueStats.innerHTML = `
        <div class="team-title">🔵 青軍: ${b.alive}/${b.total} <span class="cost-tag">${COST_ICON_SVG}${b.cost}</span></div>
        <div class="hp-bar"><div class="hp-fill blue" style="width:${b.ratio}%"></div></div>
      `;
    }
  }

  /** ローグライトの戦闘 HUD（上部のピル・文脈バッジ・ヒント・ダメージランキング）を更新する */
  private updateRogueBattleHud(): void {
    const run = this.rogue;
    if (!run) return;
    const decided = this.announcedResult !== null || run.ended;
    const remain = Math.max(0, (this.battle.timeLimitSeconds ?? 0) - this.battle.time);
    const opening = this.rogueGateSequence !== null && this.battle.opening === this.rogueGateSequence;
    const badge = this.rogueContextBadge(run);
    const key = `${run.round}|${run.lives}|${decided ? 'end' : Math.ceil(remain)}|${opening}`;
    if (key !== this.rogueHudKey) {
      this.rogueHudKey = key;
      const pill = document.getElementById('rg-pill');
      if (pill) {
        pill.innerHTML = `
          <span class="rg-round">ROUND <b>${run.round}</b> / ${ROGUE_FINAL_ROUND}${run.isHardMode ? ' 🔥' : ''}</span>
          ${this.rogueHeartSlotHtml(run.lives)}
          <span class="rg-time${!decided && remain <= 10 ? ' low' : ''}">${decided ? '決着' : `残り <b>${Math.ceil(remain)}</b> 秒`}</span>`;
      }
      const context = document.getElementById('rg-context');
      if (context) {
        context.className = `rg-context${badge ? ` ${badge.kind}` : ' hidden'}`;
        context.textContent = badge?.text ?? '';
      }
      const hint = document.getElementById('rg-hint');
      if (hint) {
        hint.classList.toggle('hidden', decided);
        hint.innerHTML = opening
          ? '<kbd>Space</kbd> でゲートの演出をスキップ'
          : 'ユニットをクリックで追跡 ・ <kbd>P</kbd> 一時停止 ・ <kbd>F</kbd> 早送り';
      }
    }
    // ランキングは毎フレーム作り直さず、少し間隔を空けて更新する
    const now = performance.now();
    if (now - this.rogueRankAt < 250) return;
    this.rogueRankAt = now;
    const rows = this.battleStats.topUnitTypes(3);
    const rankKey = rows.map(([id, dmg]) => `${id}:${Math.round(dmg)}`).join(',');
    if (rankKey === this.rogueRankKey) return;
    this.rogueRankKey = rankKey;
    const rank = document.getElementById('rg-rank');
    if (!rank) return;
    rank.classList.toggle('hidden', rows.length === 0);
    const top = Math.max(1, rows[0]?.[1] ?? 1);
    rank.innerHTML = `
      <div class="rg-rank-title">ダメージランキング<span>合計 ${formatDamage(this.battleStats.total)}</span></div>
      ${rows
        .map(
          ([id, dmg], i) => `
        <div class="rg-rank-row">
          <span class="rg-rank-no">${i + 1}</span>
          <span class="mini-unit-icon">${getUnitIconSvg(id)}</span>
          <span class="rg-rank-name">${UNIT_TYPES[id].name}</span>
          <span class="rg-rank-bar"><i style="width:${Math.round((dmg / top) * 100)}%"></i></span>
          <span class="rg-rank-num">${formatDamage(dmg)}</span>
        </div>`,
        )
        .join('')}`;
  }

  /** 毎フレームの更新ループ */
  tick(realDt: number): void {
    this.updateAdaptiveQuality(realDt);
    if (this.finishSlowMoTimer > 0) this.finishSlowMoTimer -= realDt;
    if (this.jackpot.active) this.jackpot.update(realDt);
    this.updateDroppedChests(realDt);
    if (!this.paused && !this.jackpot.active) {
      // 決着のスロー中は早送りを無視して見せ場をゆっくり見せる
      const scale = this.finishSlowMoTimer > 0 ? FINISH_SLOWMO_SCALE : this.timeScale;
      this.battle.advance(realDt * scale);
    }

    if (this.isRogueModalOpen()) this.unitPreviews?.update(realDt);

    if (this.onTitleScreen) {
      this.updateTitleDemo(realDt);
      this.view.renderFrame(this.battle, realDt);
      this.titleLogo?.update(realDt);
      return;
    }

    if (this.mode === 'battle') {
      const res = this.battle.result();
      // 開封の演出中に決着したら、演出が終わってから結果へ進む
      if (res !== null && this.announcedResult === null && !this.jackpot.active) {
        this.announcedResult = res;
        // 友人対戦・サンドボックスは誰かの勝利なので、1 人用モードの負けだけ敗北音にする
        if (this.isSoloPlayStyle() && res !== 0) this.sound.playDefeat();
        else this.sound.playVictory();
        this.startFinishSequence();
        this.handleBattleEnd(res);
        this.notifyTutorial('battle_ended');
      }
      this.updateFinishSequence(realDt);
    }

    this.updateHUD();
    this.view.renderFrame(this.battle, realDt);
    // スロー観戦中は数字の経過も遅くし、連鎖を読めるようにする
    const labelDt = this.paused ? 0 : realDt * Math.min(1.5, Math.max(0.35, this.timeScale));
    this.damageOverlay.update(
      this.battle.units,
      labelDt,
      this.mode === 'battle' && this.view.showHpBars,
    );
  }

  /** 戦闘中のフレームレートが足りなければ描画品質を一段下げる */
  private updateAdaptiveQuality(realDt: number): void {
    if (this.settings.quality !== 'auto' || this.qualityLevel === 0 || this.mode !== 'battle' || document.hidden) return;
    if (this.adaptiveQuality.recordFrame(realDt)) {
      this.qualityLevel = this.qualityLevel === 2 ? 1 : 0;
      this.view.setQualityLevel(this.qualityLevel);
    }
  }

  /** 決着のスローモーションとカメラの寄りを始める */
  private startFinishSequence(): void {
    this.finishSequenceActive = true;
    this.music.setTrack(null);
    this.finishSlowMoTimer = FINISH_SLOWMO_SECONDS;
    this.celebrateTimer = 0.25;
    const focus = this.hasLastKillPos ? this.lastKillPos : this.getWinnerCenter();
    if (focus) this.view.playFinisherCamera(focus);
  }

  private getWinnerCenter(): Vector3 | null {
    const alive = this.battle.units.filter((u) => u.alive);
    if (alive.length === 0) return null;
    const center = new Vector3();
    for (const u of alive) center.add(u.pelvis.pos);
    return center.divideScalar(alive.length);
  }

  /** 決着後の毎フレーム処理（勝者の歓声とリザルトの遅延表示） */
  private updateFinishSequence(realDt: number): void {
    if (this.announcedResult === null || !this.finishSequenceActive) return;

    if (this.bannerRevealTimer > 0) {
      this.bannerRevealTimer -= realDt;
      if (this.bannerRevealTimer <= 0) {
        this.bannerRevealTimer = 0;
        this.elBanner.classList.remove('hidden');
      }
    }

    if (typeof this.announcedResult === 'number') {
      this.celebrateTimer -= realDt;
      if (this.celebrateTimer <= 0) {
        this.celebrateTimer = CELEBRATE_INTERVAL_SECONDS;
        this.battle.celebrate(this.announcedResult);
      }
    }
  }

  private hideResultBanner(): void {
    this.bannerRevealTimer = 0;
    this.finishSlowMoTimer = 0;
    this.finishSequenceActive = false;
    this.hasLastKillPos = false;
    this.elBanner.classList.add('hidden');
    this.view.restoreCameraAfterFinisher();
  }

  /** 決着演出の最中ならその後に、そうでなければすぐにリザルトを表示する */
  private scheduleResultBanner(): void {
    if (this.finishSlowMoTimer > 0) {
      this.bannerRevealTimer = FINISH_BANNER_DELAY_SECONDS;
    } else {
      this.elBanner.classList.remove('hidden');
    }
  }

  /** リザルトに載せる戦績（MVP と兵種ごとの与ダメージ）を描画する */
  private renderBattleStats(res: Exclude<BattleResult, null>): void {
    const el = document.getElementById('result-stats');
    if (!el) return;
    // 1 人用モードは自軍、それ以外は勝者の戦績を見せる（引き分けは 1P／赤軍）
    const team: Team = this.isSoloPlayStyle() || res === 'draw' ? 0 : res;
    const stats = summarizeTeamStats(this.battle.units, team);
    if (!stats.mvp) {
      el.classList.add('hidden');
      return;
    }
    const maxDamage = Math.max(1, stats.byType[0]?.damage ?? 1);
    const rows = stats.byType
      .slice(0, 4)
      .map((row) => {
        const unitType = UNIT_TYPES[row.typeId];
        const width = Math.round((row.damage / maxDamage) * 100);
        return `<div class="stats-row">
          <span class="mini-unit-icon">${getUnitIconSvg(row.typeId)}</span>
          <span class="stats-name">${unitType.name} ×${row.count}</span>
          <span class="stats-bar"><span style="width:${width}%"></span></span>
          <span class="stats-num">${Math.round(row.damage).toLocaleString()}</span>
        </div>`;
      })
      .join('');
    const mvp = stats.mvp;
    el.innerHTML = `
      <div class="stats-mvp">
        <span class="stats-mvp-label">MVP</span>
        <span class="mini-unit-icon">${getUnitIconSvg(mvp.type.id)}</span>
        <b>${mvp.type.name}</b>
        <span>与ダメージ ${Math.round(mvp.damageDealt).toLocaleString()} ／ 撃破 ${mvp.kills}</span>
      </div>
      ${rows}
    `;
    el.classList.remove('hidden');
  }

  private computePlayerSurvivalRatio(): number {
    return computeSurvivalRatio(this.playerRoster.map((e) => ({ cost: e.type.cost, alive: isRosterAlive(e) })));
  }

  private handleBattleEnd(res: Exclude<BattleResult, null>): void {
    this.elBannerStars?.classList.add('hidden');
    this.elBannerUnlock?.classList.add('hidden');
    this.elBannerChallenge?.classList.add('hidden');
    this.elNextStageBtn?.classList.add('hidden');
    if (this.elRetryBtn) {
      this.elRetryBtn.textContent = '↺ 配置に戻る';
      this.elRetryBtn.classList.remove('hidden');
    }

    this.renderBattleStats(res);

    if (this.playStyle === 'challenge') {
      this.handleChallengeBattleEnd(res);
      return;
    }

    if (this.playStyle === 'roguelite') {
      this.handleRogueBattleEnd(res);
      return;
    }

    if (this.playStyle === 'arcade') {
      const st = this.currentStage;
      if (res === 0) {
        // プレイヤー（赤軍）の勝利！
        const usedCost = this.playerRoster.reduce((sum, e) => sum + e.type.cost, 0);
        const survivingRatio = this.computePlayerSurvivalRatio();
        const stars = computeStageStars(st, usedCost, survivingRatio);
        const newlyUnlocked = recordStageClear(this.arcadeSave, st, stars);

        if (this.elBannerStars) {
          this.elBannerStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
          this.elBannerStars.classList.remove('hidden');
        }
        setVoxelText(this.elBannerText, `ステージ ${st.stageNumber} クリア！`, BANNER_VOXEL);
        this.elBannerSub.textContent = `使用予算: ${usedCost} / ${st.budget} pt ｜ 生存ユニット: ${this.battle.aliveCount(0)} 体`;

        if (newlyUnlocked.length > 0 && this.elBannerUnlock) {
          const names = newlyUnlocked.map((id) => UNIT_TYPES[id].name).join('・');
          this.elBannerUnlock.textContent = `🎉 新ユニット解放: ${names}！`;
          this.elBannerUnlock.classList.remove('hidden');
        }

        if (this.currentStageIndex < ARCADE_STAGES.length - 1 && this.elNextStageBtn) {
          this.elNextStageBtn.textContent = `▶ 第${st.stageNumber + 1}面へ進む`;
          this.elNextStageBtn.classList.remove('hidden');
        }

        this.renderArcadeStageButtons();
        this.renderUnitCards();
      } else {
        const isTimeout =
          this.battle.timeLimitSeconds !== null && this.battle.time >= this.battle.timeLimitSeconds;
        setVoxelText(
          this.elBannerText,
          res === 'draw'
            ? '引き分け！'
            : isTimeout
              ? '⏱ タイムアップ！ 作戦失敗'
              : '敗北… 作戦失敗',
          BANNER_VOXEL,
        );
        this.elBannerSub.textContent = st.hint;
      }
    } else if (this.playStyle === 'versus') {
      if (res === 'draw') {
        setVoxelText(this.elBannerText, '引き分け！', BANNER_VOXEL);
        this.elBannerSub.textContent = '全軍ともに全滅しました';
      } else {
        setVoxelText(this.elBannerText, `${TEAM_ICONS[res]} ${res + 1}P（${TEAM_NAMES[res]}）の勝利！`, BANNER_VOXEL);
        this.elBannerSub.textContent = `生存ユニット: ${this.battle.aliveCount(res)} 体 ｜ 設定予算: ${this.versus.budget} pt`;
      }
      if (this.elNextStageBtn) {
        this.elNextStageBtn.textContent = '🎲 新しいランダム予算で次の対戦へ';
        this.elNextStageBtn.classList.remove('hidden');
      }
    } else {
      if (res === 'draw') {
        setVoxelText(this.elBannerText, '引き分け！', BANNER_VOXEL);
        this.elBannerSub.textContent = '両軍ともに全滅しました';
      } else {
        setVoxelText(this.elBannerText, `${TEAM_NAMES[res]}の勝利！`, BANNER_VOXEL);
        this.elBannerSub.textContent = `生存ユニット: ${this.battle.aliveCount(res)} 体`;
      }
    }

    this.scheduleResultBanner();
  }
}

function loadDamageMode(): DamageNumberMode {
  try {
    const v = window.localStorage?.getItem(DAMAGE_MODE_STORAGE_KEY);
    if (v === 'all' || v === 'big' || v === 'off') return v;
  } catch {
    // 読めない環境では初期値
  }
  return 'big';
}

function saveDamageMode(mode: DamageNumberMode): void {
  try {
    window.localStorage?.setItem(DAMAGE_MODE_STORAGE_KEY, mode);
  } catch {
    // 保存できない環境では何もしない
  }
}
