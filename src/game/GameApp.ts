import { Vector3 } from 'three';
import { SoundManager } from '../audio/SoundManager';
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
import { isMountType, isRiderType } from '../units/Mounting';
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

interface PlacedRecord {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  team: Team;
  x: number;
  z: number;
  facing?: number;
  /** かさね配置: このレコードが「同じ lineup 内の onTopOf 番目のレコードの上に乗る」ことを示す */
  onTopOf?: number;
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

export type GameMode = 'placement' | 'battle';
export type PlayStyle = 'arcade' | 'sandbox' | 'versus' | 'challenge';

/**
 * ゲーム全体の進行管理と UI バインディング。
 * - アーケードモード: 全30面、ステージ予算上限、地形ギミック、クリア評価（★1〜★3）と新ユニット解放
 * - 友人対戦モード: 2〜4人オフライン対戦、ランダム初期予算＋手動編集、ブラインド順番配置＆全員完了で戦闘開始
 * - サンドボックスモード: 地面クリックで両軍に自由配置（左半分=赤軍、右半分=青軍）
 * - チャレンジモード: 自軍2000pt固定で、増え続けるランダムな敵に1敗するまで挑み続ける
 */
export class GameApp {
  readonly battle = new Battle();
  readonly view: SceneView;
  readonly sound = new SoundManager();

  playStyle: PlayStyle = 'arcade';
  currentStageIndex = 0;
  arcadeSave: ArcadeSaveData = loadArcadeSave();
  readonly versus = new VersusSession(2);
  /** 進行中（または直前）のチャレンジのラン */
  challenge = new ChallengeRun(0);
  private challengeBest: ChallengeBest = loadChallengeBest();
  /** NEW RECORD 判定に使う、ラン開始時点のベスト記録 */
  private challengeBestAtRunStart: ChallengeBest = this.challengeBest;
  /** 生存ボーナスの集計対象（戦闘開始時の自軍。召喚や分裂で増えた分は含めない） */
  private challengeRoster: Array<Unit | Facility> = [];

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
  unitDetailVisible = true;

  /** 配置フェーズで置かれた編成（リトライ時に復元する） */
  private savedLineup: PlacedRecord[] = [];
  private announcedResult: BattleResult = null;
  private pointerDownPos = { x: 0, y: 0, button: -1 };

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
      this.sound.playEffect({ kind: k } as any);
    };
    this.battle.combat.onShootArrow = () => this.sound.playBowShoot();
    this.battle.combat.onEffect = (e) => {
      this.view.spawnCombatEffect(e);
      this.sound.playEffect(e);
    };
    this.battle.combat.onHit = (e) => {
      const partBroken = this.view.spawnHitEffect(e);
      const wKind = e.attacker.type.weapon?.kind;
      const heavy =
        e.attacker.type.id === 'giant' ||
        e.attacker.type.id === 'warelephant' ||
        e.attacker.type.id === 'dragon' ||
        e.damage >= 40;
      const metallic =
        wKind === 'sword' || wKind === 'spear' || wKind === 'katana' || wKind === 'axe' || e.kind === 'slash';
      this.sound.playHit(heavy, metallic, partBroken || e.killed);
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

    // スマホ等の狭い画面では初期状態でゲームモードパネルを非表示にして戦場を見やすくする
    if (window.innerWidth <= 820) {
      this.sidePanelVisible = false;
    }

    this.buildUI();
    this.syncSidePanelUI();
    this.bindCanvasInteraction();
    this.loadArcadeStage(0);
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
      this.elTogglePanelBtn.textContent = this.sidePanelVisible ? '☰ モードUI: ON' : '☰ モードUI: OFF';
    }
  }

  /** 全UI非表示モード（観戦・スマホ広域表示）の同期 */
  private syncHudVisibility(): void {
    this.elTopHud?.classList.toggle('hud-hidden', this.hudHidden);
    this.elSidePanel?.classList.toggle('hud-hidden', this.hudHidden);
    this.elBottomHud?.classList.toggle('hud-hidden', this.hudHidden);
    this.elRestoreHudBtn?.classList.toggle('hidden', !this.hudHidden);
    this.syncUnitDetailOverlay();
  }

  /** 選択中のゲームモードに合わせて、モードボタンとサイドパネルの表示を切り替える */
  private syncModePanels(): void {
    const modes: ReadonlyArray<[PlayStyle, string, string]> = [
      ['arcade', 'btn-mode-arcade', 'arcade-panel'],
      ['versus', 'btn-mode-versus', 'versus-panel'],
      ['sandbox', 'btn-mode-sandbox', 'sandbox-panel'],
      ['challenge', 'btn-mode-challenge', 'challenge-panel'],
    ];
    for (const [style, buttonId, panelId] of modes) {
      const isActive = this.playStyle === style;
      document.getElementById(buttonId)?.classList.toggle('active', isActive);
      document.getElementById(panelId)?.classList.toggle('hidden', !isActive);
    }
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

    // モード切替ボタン（アーケード / 友人対戦 / サンドボックス / チャレンジ）
    document.getElementById('btn-mode-arcade')?.addEventListener('click', () => {
      if (this.playStyle === 'arcade' || this.blockLeavingChallenge()) return;
      this.playStyle = 'arcade';
      this.syncModePanels();
      this.loadArcadeStage(this.currentStageIndex);
    });

    document.getElementById('btn-mode-versus')?.addEventListener('click', () => {
      if (this.playStyle === 'versus' || this.blockLeavingChallenge()) return;
      this.playStyle = 'versus';
      this.syncModePanels();
      this.enterVersusMode(this.versus.playerCount, true);
    });

    document.getElementById('btn-mode-sandbox')?.addEventListener('click', () => {
      if (this.playStyle === 'sandbox' || this.blockLeavingChallenge()) return;
      this.playStyle = 'sandbox';
      this.syncModePanels();
      this.loadPreset(PRESETS[0]);
    });

    document.getElementById('btn-mode-challenge')?.addEventListener('click', () => {
      if (this.playStyle === 'challenge') return;
      this.enterChallengeMode();
    });

    document.getElementById('btn-challenge-quit')?.addEventListener('click', () => {
      this.confirmQuitChallenge();
    });

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
      } else {
        this.returnToPlacement();
      }
    });

    document.getElementById('btn-retry')!.addEventListener('click', () => {
      if (this.playStyle === 'challenge') {
        this.exitChallengeToTitle();
      } else {
        this.returnToPlacement();
      }
    });

    this.elNextStageBtn?.addEventListener('click', () => {
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
      if (this.playStyle === 'challenge' && this.mode !== 'placement') return;
      if (this.mode !== 'placement') this.returnToPlacement();
      if (this.isSoloPlayStyle()) {
        this.savedLineup = this.savedLineup.filter((u) => u.team === 1);
        for (const u of [...this.battle.units]) {
          if (u.team === 0) this.battle.removeUnit(u);
        }
        for (const f of [...this.battle.facilities]) {
          if (f.team === 0) this.battle.removeFacility(f);
        }
      } else if (this.playStyle === 'versus') {
        const curTeam = this.versus.currentTurn;
        this.versus.clearCurrentTurnLineup();
        for (const u of [...this.battle.units]) {
          if (u.team === curTeam) this.battle.removeUnit(u);
        }
        for (const f of [...this.battle.facilities]) {
          if (f.team === curTeam) this.battle.removeFacility(f);
        }
      } else {
        this.savedLineup = [];
        this.battle.clear();
      }
      this.view.clearDebris();
      this.sound.playRemove();
      this.updateHUD();
    });

    // SE ミュート切り替えボタン
    const muteBtn = document.getElementById('btn-mute') as HTMLButtonElement | null;
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const muted = this.sound.toggleMute();
        muteBtn.textContent = muted ? '🔇 SE: OFF' : '🔊 SE';
      });
    }

    // カメラリセット
    document.getElementById('btn-cam-reset')!.addEventListener('click', () => {
      this.view.resetCamera();
    });

    // 速度変更ボタン
    const speedContainer = document.getElementById('speed-buttons')!;
    const speeds: ReadonlyArray<{ label: string; scale: number; pause?: boolean }> = [
      { label: '⏸ 停止', scale: 0, pause: true },
      { label: '🐢 0.25x', scale: 0.25 },
      { label: '▶ 1x', scale: 1.0 },
      { label: '⏩ 2x', scale: 2.0 },
    ];
    speeds.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn' + (!s.pause && s.scale === 1.0 ? ' active' : '');
      b.textContent = s.label;
      b.addEventListener('click', () => {
        this.paused = Boolean(s.pause);
        if (!s.pause) this.timeScale = s.scale;
        this.elSpeedButtons.forEach((btn) => btn.classList.remove('active'));
        b.classList.add('active');
      });
      speedContainer.appendChild(b);
      this.elSpeedButtons.push(b);
    });

    // キーボードショートカット（Space: 戦闘開始/配置完了OK/戻る、R: 配置に戻る、1〜9: 兵種選択、Tab: モードUI開閉、H: 全UI開閉、Esc: 詳細閉じる）
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Escape') {
        if (this.unitDetailVisible) {
          this.hideUnitDetailOverlay();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (this.mode === 'placement') {
          if (this.playStyle === 'versus') this.confirmVersusTurn();
          else this.startBattle();
        } else if (this.playStyle === 'challenge') {
          this.handleChallengeBattleAction(true);
        } else {
          this.returnToPlacement();
        }
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
        const n = Number(e.code.replace('Digit', '')) - 1;
        const filtered = UNIT_TYPE_LIST.filter(
          (ut) => this.selectedCategory === 'all' || ut.category === this.selectedCategory,
        );
        if (n >= 0 && n < filtered.length) {
          this.selectUnitType(filtered[n].id);
        }
      }
    });
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
        const unlocked = !this.isSoloPlayStyle() || isUnitUnlocked(this.arcadeSave, ut.id);
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
                <span class="stat-pill cost" title="配置コスト">${COST_ICON_SVG}<span>${ut.cost}</span></span>
                <span class="stat-pill hp" title="最大HP">${HP_ICON_SVG}<span>${ut.hp}</span></span>
              </div>
            </div>
          </div>
          <div class="unit-desc" title="${ut.description}">${ut.description}</div>
        `;
        btn.addEventListener('click', () => {
          if (!unlocked) {
            this.flashPhaseWarning(`🔒 「${ut.name}」はステージクリア報酬（または「☰ モードUI」内の「🔓全解放」）で使用可能になります`);
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
      const targetFacilities =
        this.selectedCategory === 'facility'
          ? COMBAT_FACILITY_TYPE_LIST
          : this.selectedCategory === 'terrain'
            ? TERRAIN_BLOCK_TYPE_LIST
            : FACILITY_TYPE_LIST;

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
        const statsHtml = isTerrain
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
          <div class="unit-desc" title="${fac.description}">${fac.description}</div>
        `;
        btn.addEventListener('click', () => {
          if (ruleViolation) {
            this.flashPhaseWarning(ruleViolation);
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

  selectPlaceable(id: UnitTypeId | FacilityTypeId): void {
    if (this.isSoloPlayStyle() && !isFacilityTypeId(id) && !isUnitUnlocked(this.arcadeSave, id)) {
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
    setTimeout(() => {
      this.elPhaseBadge.classList.remove('budget-over');
      if (this.mode === 'placement') this.syncPhaseUI();
    }, 1800);
  }

  private bindCanvasInteraction(): void {
    const dom = this.view.renderer.domElement;
    const groundHit = new Vector3();

    dom.addEventListener('pointermove', (e) => {
      if (this.mode !== 'placement' || this.touchEraseMode || e.pointerType === 'touch') {
        this.view.updatePlacementGhost(null, 0, null, false);
        return;
      }
      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (!p || !this.isInsideArena(p.x, p.z)) {
        this.view.updatePlacementGhost(this.selectedId, 0, null, false);
        return;
      }
      if (this.playStyle === 'arcade') {
        const validZone = isInsideStageRedZone(this.currentStage, p.x, p.z);
        const itemCost = this.getItemCost(this.selectedId);
        const canAfford = this.getCurrentRedCost() + itemCost <= this.currentStage.budget;
        const unlocked = isFacilityTypeId(this.selectedId) || isUnitUnlocked(this.arcadeSave, this.selectedId);
        const ruleViolation = checkStageRuleViolation(
          this.currentStage,
          this.selectedId,
          this.getCurrentRedPlacedCount(),
        );
        const facing = getStageZoneFacing(this.currentStage, p.x, p.z);
        this.view.updatePlacementGhost(
          this.selectedId,
          0,
          p,
          validZone && canAfford && unlocked && !ruleViolation,
          facing,
        );
      } else if (this.playStyle === 'challenge') {
        const canAfford = this.getCurrentRedCost() + this.getItemCost(this.selectedId) <= CHALLENGE_PLAYER_BUDGET;
        const valid = isInsideVersusZone(2, 0, p.x, p.z) && canAfford;
        this.view.updatePlacementGhost(this.selectedId, 0, p, valid, Math.PI / 2);
      } else if (this.playStyle === 'versus') {
        const team = this.versus.currentTurn;
        const validZone = isInsideVersusZone(this.versus.playerCount, team, p.x, p.z);
        const itemCost = this.getItemCost(this.selectedId);
        const canAfford = this.getCurrentTeamCost(team) + itemCost <= this.versus.budget;
        const facing = getVersusPlacementFacing(this.versus.playerCount, team, p.x, p.z);
        this.view.updatePlacementGhost(this.selectedId, team, p, validZone && canAfford, facing);
      } else {
        const team: Team = p.x < 0 ? 0 : 1;
        this.view.updatePlacementGhost(this.selectedId, team, p, Math.abs(p.x) > 1.2);
      }
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 2) {
        // 右ドラッグでカメラ回転もできるようにする
        this.view.startOrbitDrag(e.clientX, e.clientY);
      }
    });

    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && this.view.isMultiTouchInvolved()) return;
      const moved = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (moved > 8 || this.mode !== 'placement') return;

      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (!p) return;

      if (e.button === 2 || (e.button === 0 && this.touchEraseMode)) {
        // 右クリック、またはスマホ用削除モードON時のタップ: 最も近いユニットまたは施設を削除
        this.removeNearestUnitAt(p.x, p.z);
        return;
      }

      if (e.button === 0 && !e.altKey) {
        if (this.playStyle === 'arcade') {
          const st = this.currentStage;
          if (!isInsideStageRedZone(st, p.x, p.z)) {
            this.flashPhaseWarning('⚠ 赤枠の配置可能エリア内をタップ／クリックしてください');
            return;
          }
          if (!isFacilityTypeId(this.selectedId) && !isUnitUnlocked(this.arcadeSave, this.selectedId)) {
            this.flashPhaseWarning('🔒 この兵種はまだ解放されていません');
            return;
          }
          const ruleViolation = checkStageRuleViolation(
            st,
            this.selectedId,
            this.getCurrentRedPlacedCount(),
          );
          if (ruleViolation) {
            this.flashPhaseWarning(ruleViolation);
            return;
          }
          const itemCost = this.getItemCost(this.selectedId);
          const used = this.getCurrentRedCost();
          if (used + itemCost > st.budget) {
            this.flashPhaseWarning(`⚠ 予算オーバー！ (残り ${st.budget - used} pt / 必要 ${itemCost} pt)`);
            return;
          }
          const facing = getStageZoneFacing(st, p.x, p.z);
          if (isFacilityTypeId(this.selectedId)) {
            this.battle.spawnFacility(this.selectedId, 0, p.x, p.z, facing);
            this.savedLineup.push({ facilityId: this.selectedId, team: 0, x: p.x, z: p.z, facing });
          } else {
            this.battle.spawnUnit(this.selectedId, 0, p.x, p.z, facing);
            this.savedLineup.push({ typeId: this.selectedId, team: 0, x: p.x, z: p.z, facing });
          }
          this.sound.playPlace();
          this.updateHUD();
        } else if (this.playStyle === 'challenge') {
          this.placeChallengeItem(p.x, p.z);
        } else if (this.playStyle === 'versus') {
          const team = this.versus.currentTurn;
          const pLabel = `${team + 1}P ${TEAM_NAMES[team]}`;
          if (!isInsideVersusZone(this.versus.playerCount, team, p.x, p.z)) {
            this.flashPhaseWarning(`⚠ ${pLabel}の配置枠内をタップ／クリックしてください`);
            return;
          }
          const itemCost = this.getItemCost(this.selectedId);
          const used = this.getCurrentTeamCost(team);
          if (used + itemCost > this.versus.budget) {
            this.flashPhaseWarning(
              `⚠ 予算オーバー！ (残り ${Math.max(0, this.versus.budget - used)} pt / 必要 ${itemCost} pt)`,
            );
            return;
          }
          const facing = getVersusPlacementFacing(this.versus.playerCount, team, p.x, p.z);
          const curLineup = this.versus.getCurrentLineup();
          if (isFacilityTypeId(this.selectedId)) {
            this.battle.spawnFacility(this.selectedId, team, p.x, p.z, facing);
            curLineup.push({ facilityId: this.selectedId, team, x: p.x, z: p.z, facing });
          } else {
            this.battle.spawnUnit(this.selectedId, team, p.x, p.z, facing);
            curLineup.push({ typeId: this.selectedId, team, x: p.x, z: p.z, facing });
          }
          this.sound.playPlace();
          this.syncVersusUI();
          this.updateHUD();
        } else {
          // サンドボックス: x < 0 なら赤軍、x > 0 なら青軍
          if (!this.isInsideArena(p.x, p.z) || Math.abs(p.x) <= 1.2) return;
          const team: Team = p.x < 0 ? 0 : 1;
          const facing = team === 0 ? Math.PI / 2 : -Math.PI / 2;
          // かさね配置（試作・サンドボックスのみ）: 乗り手対象の兵種で味方の土台の近くを
          // クリックしたら、地面ではなく土台の上に乗せる
          if (!isFacilityTypeId(this.selectedId) && isRiderType(this.selectedId)) {
            const mount = this.findSandboxMountAt(p.x, p.z, team);
            if (mount && this.tryPlaceStackedRider(mount, team, facing)) {
              return;
            }
          }
          if (isFacilityTypeId(this.selectedId)) {
            this.battle.spawnFacility(this.selectedId, team, p.x, p.z, facing);
            this.savedLineup.push({ facilityId: this.selectedId, team, x: p.x, z: p.z, facing });
          } else {
            this.battle.spawnUnit(this.selectedId, team, p.x, p.z, facing);
            this.savedLineup.push({ typeId: this.selectedId, team, x: p.x, z: p.z, facing });
          }
          this.sound.playPlace();
          this.updateHUD();
        }
      }
    });
  }

  private isInsideArena(x: number, z: number): boolean {
    return Math.abs(x) <= 22 && Math.abs(z) <= 16;
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

  /** かさね配置（試作）: 土台の上に選択中の乗り手を配置し、編成レコードにも onTopOf を残す */
  private tryPlaceStackedRider(mount: Unit, team: Team, facing: number): boolean {
    if (isFacilityTypeId(this.selectedId)) return false;
    const rider = this.battle.spawnMountedUnit(mount, this.selectedId, team, facing);
    if (!rider) return false;
    const mountIdx = this.savedLineup.findIndex(
      (rec) =>
        rec.typeId === mount.type.id &&
        rec.team === team &&
        Math.hypot(rec.x - mount.pelvis.pos.x, rec.z - mount.pelvis.pos.z) < 0.6,
    );
    this.savedLineup.push({
      typeId: this.selectedId,
      team,
      x: mount.pelvis.pos.x,
      z: mount.pelvis.pos.z,
      facing,
      onTopOf: mountIdx >= 0 ? mountIdx : undefined,
    });
    this.sound.playPlace();
    this.flashPhaseWarning(
      `🪜 かさね配置: ${mount.type.name}の上に${rider.type.name}を乗せた`,
    );
    this.updateHUD();
    return true;
  }

  private removeNearestUnitAt(x: number, z: number): void {
    const activeTurnTeam = this.playStyle === 'versus' ? this.versus.currentTurn : 0;
    const targetLineup =
      this.playStyle === 'versus' ? this.versus.getCurrentLineup() : this.savedLineup;

    // 1. 施設を優先探索（クリック判定半径 2.0m）
    let bestFac: Facility | null = null;
    let bestFacDist = 2.0;
    for (const f of this.battle.facilities) {
      if (this.isSoloPlayStyle() && f.team !== 0) continue;
      if (this.playStyle === 'versus' && f.team !== activeTurnTeam) continue;
      const d = Math.hypot(f.pos.x - x, f.pos.z - z);
      if (d < bestFacDist) {
        bestFacDist = d;
        bestFac = f;
      }
    }
    if (bestFac) {
      const targetFac = bestFac;
      const idx = targetLineup.findIndex(
        (rec) =>
          rec.facilityId === targetFac.type.id &&
          rec.team === targetFac.team &&
          Math.hypot(rec.x - targetFac.pos.x, rec.z - targetFac.pos.z) < 0.6,
      );
      if (idx >= 0) targetLineup.splice(idx, 1);
      this.battle.removeFacility(targetFac);
      this.sound.playRemove();
      if (this.playStyle === 'versus') this.syncVersusUI();
      this.updateHUD();
      return;
    }

    // 2. ユニットの探索
    let bestIdx = -1;
    let bestDist = 1.8;
    for (let i = 0; i < this.battle.units.length; i++) {
      const u = this.battle.units[i];
      // アーケード・チャレンジでは敵軍（青軍）は削除不可、友人対戦では自分の手番チームのみ削除可
      if (this.isSoloPlayStyle() && u.team !== 0) continue;
      if (this.playStyle === 'versus' && u.team !== activeTurnTeam) continue;
      const d = Math.hypot(u.pelvis.pos.x - x, u.pelvis.pos.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const target = this.battle.units[bestIdx];
      const lineupIdx = targetLineup.findIndex(
        (rec) =>
          rec.typeId === target.type.id &&
          rec.team === target.team &&
          Math.hypot(rec.x - target.pelvis.pos.x, rec.z - target.pelvis.pos.z) < 0.6,
      );
      if (lineupIdx >= 0) {
        targetLineup.splice(lineupIdx, 1);
        // かさね配置: 削除でずれた onTopOf 参照を直す（土台を消したら乗り手は地面配置に戻す）
        for (const rec of targetLineup) {
          if (rec.onTopOf === lineupIdx) rec.onTopOf = undefined;
          else if (rec.onTopOf !== undefined && rec.onTopOf > lineupIdx) rec.onTopOf -= 1;
        }
      }
      // かさね配置: 土台を消したら、乗っていたユニットの結合をその場で解く
      for (const u of this.battle.units) {
        if (u.mountedOn === target) u.mountedOn = null;
      }
      this.battle.removeUnit(target);
      this.sound.playRemove();
      if (this.playStyle === 'versus') this.syncVersusUI();
      this.updateHUD();
    }
  }

  /** プレイヤーが赤軍だけを操作し、解放済みの兵種だけを使うモードか */
  private isSoloPlayStyle(): boolean {
    return this.playStyle === 'arcade' || this.playStyle === 'challenge';
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
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();

    // 地形は標準固定（特殊地形・状態異常なし）
    this.battle.world.obstacles = [];
    this.battle.world.chasm = null;
    this.battle.world.pits = [];
    this.battle.world.slopes = [];
    this.battle.world.arenaBounds = null;
    this.battle.world.gravity.set(0, -9.81, 0);
    this.battle.timeLimitSeconds = CHALLENGE_TIME_LIMIT_SECONDS;
    this.battle.baseDamageMul = 1.0;
    this.battle.baseSpeedMul = 1.0;
    this.view.setStageTheme(undefined);
    this.view.setVersusZones(getVersusZones(2), 0);

    const run = this.challenge;
    const unlocked = getAllUnitIds().filter((id) => isUnitUnlocked(this.arcadeSave, id));
    const enemies = generateEnemyLineup(run.round, run.seed, unlocked);
    this.savedLineup = [...enemies, ...run.playerLineup.map((r) => ({ ...r }))];
    for (const item of this.savedLineup) {
      if (item.facilityId) {
        this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
      } else if (item.typeId) {
        this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
      }
    }

    this.renderChallengePanel();
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  private placeChallengeItem(x: number, z: number): void {
    if (!isInsideVersusZone(2, 0, x, z)) {
      this.flashPhaseWarning('⚠ 赤枠の配置可能エリア内をタップ／クリックしてください');
      return;
    }
    const id = this.selectedId;
    if (!isFacilityTypeId(id) && !isUnitUnlocked(this.arcadeSave, id)) {
      this.flashPhaseWarning('🔒 この兵種はまだ解放されていません');
      return;
    }
    const itemCost = this.getItemCost(id);
    const used = this.getCurrentRedCost();
    if (used + itemCost > CHALLENGE_PLAYER_BUDGET) {
      this.flashPhaseWarning(`⚠ 予算オーバー！ (残り ${CHALLENGE_PLAYER_BUDGET - used} pt / 必要 ${itemCost} pt)`);
      return;
    }
    const facing = Math.PI / 2;
    if (isFacilityTypeId(id)) {
      this.battle.spawnFacility(id, 0, x, z, facing);
      this.savedLineup.push({ facilityId: id, team: 0, x, z, facing });
    } else {
      this.battle.spawnUnit(id, 0, x, z, facing);
      this.savedLineup.push({ typeId: id, team: 0, x, z, facing });
    }
    this.sound.playPlace();
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
    this.loadArcadeStage(this.currentStageIndex);
    this.syncModePanels();
    this.sidePanelVisible = true;
    this.syncSidePanelUI();
  }

  private handleChallengeBattleEnd(res: Exclude<BattleResult, null>): void {
    if (res !== 0) {
      const isTimeout =
        this.battle.timeLimitSeconds !== null && this.battle.time >= this.battle.timeLimitSeconds;
      this.finishChallengeRun(res === 'draw' ? 'draw' : isTimeout ? 'timeout' : 'defeat');
      return;
    }

    const run = this.challenge;
    const ratio = computeSurvivalRatio(this.challengeRoster.map((e) => ({ cost: e.type.cost, alive: e.alive })));
    const score = run.recordWin(ratio);

    // タブを閉じてもここまでの結果が残るよう、勝利のたびにベストを保存する
    this.challengeBest = mergeChallengeBest(this.challengeBest, run.totalScore, run.reachedRound).best;
    saveChallengeBest(this.challengeBest);

    this.elBannerText.textContent = `ROUND ${score.round} クリア！`;
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
    this.elBanner.classList.remove('hidden');
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

    this.elBannerText.textContent = 'GAME OVER';
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
    this.elBanner.classList.remove('hidden');
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

  /** 友人対戦モード（2〜4人・ブラインド順番配置）を開始・リセットする */
  enterVersusMode(playerCount: PlayerCount = this.versus.playerCount, randomizeBudget = true): void {
    this.playStyle = 'versus';
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();

    // ワールドの地形・特殊ルールを標準状態にリセット
    this.battle.world.obstacles = [];
    this.battle.world.chasm = null;
    this.battle.world.pits = [];
    this.battle.world.slopes = [];
    this.battle.world.arenaBounds = null;
    this.battle.world.gravity.set(0, -9.81, 0);
    this.battle.timeLimitSeconds = null;
    this.battle.baseDamageMul = 1.0;
    this.battle.baseSpeedMul = 1.0;

    this.versus.setPlayerCount(playerCount, randomizeBudget);
    this.savedLineup = [];
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
                ? `👉 配置中 (${this.getCurrentTeamCost(t)} / ${this.versus.budget} pt)`
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
    if (!allReady) {
      // 今のプレイヤーの配置をブラインド（戦場から非表示化）し、次のプレイヤーの手番へ切り替え
      this.battle.clear();
      this.view.clearDebris();
      const nextLineup = this.versus.getTeamLineup(nextTeam);
      for (const item of nextLineup) {
        if (item.facilityId) {
          this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
        } else if (item.typeId) {
          this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
        }
      }
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
      for (const item of this.savedLineup) {
        if (item.facilityId) {
          this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
        } else if (item.typeId) {
          this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
        }
      }
      this.syncVersusUI();
      this.startBattle();
    }
  }

  /** アーケードモードの指定ステージを読み込む */
  loadArcadeStage(stageIndex: number): void {
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
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();

    // ステージ固有地形・限定ルールを物理ワールドと描画ビューへ反映
    this.battle.world.obstacles = st.terrain.obstacles ? [...st.terrain.obstacles] : [];
    this.battle.world.chasm = st.terrain.chasm ? { ...st.terrain.chasm } : null;
    this.battle.world.pits = st.terrain.pits ? [...st.terrain.pits] : [];
    this.battle.world.slopes = [];
    this.battle.world.arenaBounds = st.terrain.arenaBounds ? { ...st.terrain.arenaBounds } : null;

    const rules = st.specialRules;
    const gScale = rules?.gravityScale ?? 1.0;
    this.battle.world.gravity.set(0, -9.81 * gScale, 0);
    this.battle.timeLimitSeconds = rules?.timeLimitSeconds ?? null;
    this.battle.baseDamageMul = rules?.damageMultiplier ?? 1.0;
    this.battle.baseSpeedMul = rules?.speedMultiplier ?? 1.0;
    this.battle.hazardConfig = st.hazard ?? null;

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
    for (const u of this.savedLineup) {
      if (u.facilityId) {
        this.battle.spawnFacility(u.facilityId, u.team, u.x, u.z, u.facing);
      } else if (u.typeId) {
        this.battle.spawnUnit(u.typeId, u.team, u.x, u.z, u.facing);
      }
    }

    this.renderArcadeStageButtons();
    this.renderStageBriefing();
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  loadPreset(preset: PresetScenario): void {
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();
    this.battle.world.obstacles = [];
    this.battle.world.chasm = null;
    this.battle.world.pits = [];
    this.battle.world.slopes = [];
    this.battle.world.arenaBounds = null;
    this.battle.world.gravity.set(0, -9.81, 0);
    this.battle.timeLimitSeconds = null;
    this.battle.baseDamageMul = 1.0;
    this.battle.baseSpeedMul = 1.0;
    this.battle.hazardConfig = null;
    this.view.setStageTerrain(null, false);
    this.view.setStageTheme(undefined);
    this.savedLineup = preset.units.map((u) => ({ ...u }));
    for (const item of this.savedLineup) {
      if (item.facilityId) {
        this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
      } else if (item.typeId) {
        this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
      }
    }
    this.renderUnitCards();
    this.updateUnitDetailOverlay(this.selectedId);
    this.syncUnitDetailOverlay();
    this.syncPhaseUI();
    this.updateHUD();
  }

  startBattle(): void {
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
    if (this.playStyle === 'challenge') {
      // 配置中も経過時間は進むため、制限時間は戦闘開始から数え直す
      this.battle.time = 0;
      this.challenge.commitLineup(this.savedLineup);
      this.challengeRoster = [
        ...this.battle.units.filter((u) => u.team === 0),
        ...this.battle.facilities.filter((f) => f.team === 0),
      ];
    }
    this.mode = 'battle';
    this.battle.aiEnabled = true;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(false);
    // スマホ等の狭い画面では戦闘開始時に自動でモードパネルを閉じて戦場を見やすくする
    if (window.innerWidth <= 820 && this.sidePanelVisible) {
      this.sidePanelVisible = false;
      this.syncSidePanelUI();
    }
    this.sound.playBattleStart();
    if (this.playStyle === 'versus') this.syncVersusUI();
    this.syncPhaseUI();
    this.syncUnitDetailOverlay();
  }

  returnToPlacement(): void {
    // チャレンジにリトライはない（Space / R キーもここで止まる）
    if (this.playStyle === 'challenge') return;
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();

    if (this.playStyle === 'versus') {
      // 友人対戦では配置された編成を保持しつつ1Pの手番に戻し、他プレイヤーの編成は再びブラインドする
      this.versus.reopenPlacementsKeepLineups();
      const firstLineup = this.versus.getTeamLineup(0);
      for (const item of firstLineup) {
        if (item.facilityId) {
          this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
        } else if (item.typeId) {
          this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
        }
      }
      this.view.setVersusZones(getVersusZones(this.versus.playerCount), 0);
      this.syncVersusUI();
    } else {
      // かさね配置: onTopOf を持つレコードは、土台レコードから生成したユニットの上に乗せ直す
      const spawned: (Unit | null)[] = [];
      for (const item of this.savedLineup) {
        if (item.facilityId) {
          this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
          spawned.push(null);
        } else if (item.typeId) {
          const base = item.onTopOf !== undefined ? spawned[item.onTopOf] : null;
          const stacked =
            base && this.playStyle === 'sandbox'
              ? this.battle.spawnMountedUnit(base, item.typeId, item.team, item.facing)
              : null;
          spawned.push(
            stacked ?? this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing),
          );
        } else {
          spawned.push(null);
        }
      }
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
    return `${st.name} ｜ 予算: ${COST_ICON_SVG} <b>${used}</b> / ${st.budget} (残り ${st.budget - used} ｜ ${starPreview})${maxUnitsStr}`;
  }

  private formatVersusBudgetBadge(): string {
    const t = this.versus.currentTurn;
    const used = this.getCurrentTeamCost(t);
    const budget = this.versus.budget;
    const remain = Math.max(0, budget - used);
    return `👥 ${this.versus.playerCount}人対戦 ｜ ${TEAM_ICONS[t]} <b>${t + 1}P ${TEAM_NAMES[t]}の配置番</b> ｜ 予算: ${COST_ICON_SVG} <b>${used}</b> / ${budget} (残り ${remain}) ｜ 完了OKでブラインドして次へ`;
  }

  private syncPhaseUI(): void {
    const isVersusPlacement = this.playStyle === 'versus' && this.mode === 'placement';
    this.elVersusHudBar?.classList.toggle('hidden', !isVersusPlacement);
    this.elStartBtn.disabled = false;

    if (this.mode === 'placement') {
      if (this.playStyle === 'challenge') {
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
    if (this.playStyle === 'challenge') {
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

  /** 毎フレームの更新ループ */
  tick(realDt: number): void {
    if (!this.paused) {
      this.battle.advance(realDt * this.timeScale);
    }

    if (this.mode === 'battle') {
      const res = this.battle.result();
      if (res !== null && this.announcedResult === null) {
        this.announcedResult = res;
        this.sound.playVictory();
        this.handleBattleEnd(res);
      }
    }

    this.updateHUD();
    this.view.renderFrame(this.battle, realDt);
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

    if (this.playStyle === 'challenge') {
      this.handleChallengeBattleEnd(res);
      return;
    }

    if (this.playStyle === 'arcade') {
      const st = this.currentStage;
      if (res === 0) {
        // プレイヤー（赤軍）の勝利！
        let usedCost = 0;
        let survivingCost = 0;
        for (const u of this.battle.units) {
          if (u.team === 0 && u.splitGen === 0) {
            const c = UNIT_TYPES[u.type.id].cost;
            usedCost += c;
            if (u.alive) survivingCost += c;
          }
        }
        const survivingRatio = usedCost > 0 ? survivingCost / usedCost : 0;
        const stars = computeStageStars(st, usedCost, survivingRatio);
        const newlyUnlocked = recordStageClear(this.arcadeSave, st, stars);

        if (this.elBannerStars) {
          this.elBannerStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
          this.elBannerStars.classList.remove('hidden');
        }
        this.elBannerText.textContent = `ステージ ${st.stageNumber} クリア！`;
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
        this.elBannerText.textContent =
          res === 'draw'
            ? '引き分け！'
            : isTimeout
              ? '⏱ タイムアップ！ 作戦失敗'
              : '敗北… 作戦失敗';
        this.elBannerSub.textContent = st.hint;
      }
    } else if (this.playStyle === 'versus') {
      if (res === 'draw') {
        this.elBannerText.textContent = '引き分け！';
        this.elBannerSub.textContent = '全軍ともに全滅しました';
      } else {
        this.elBannerText.textContent = `${TEAM_ICONS[res]} ${res + 1}P（${TEAM_NAMES[res]}）の勝利！`;
        this.elBannerSub.textContent = `生存ユニット: ${this.battle.aliveCount(res)} 体 ｜ 設定予算: ${this.versus.budget} pt`;
      }
      if (this.elNextStageBtn) {
        this.elNextStageBtn.textContent = '🎲 新しいランダム予算で次の対戦へ';
        this.elNextStageBtn.classList.remove('hidden');
      }
    } else {
      if (res === 'draw') {
        this.elBannerText.textContent = '引き分け！';
        this.elBannerSub.textContent = '両軍ともに全滅しました';
      } else {
        this.elBannerText.textContent = `${TEAM_NAMES[res]}の勝利！`;
        this.elBannerSub.textContent = `生存ユニット: ${this.battle.aliveCount(res)} 体`;
      }
    }

    this.elBanner.classList.remove('hidden');
  }
}
