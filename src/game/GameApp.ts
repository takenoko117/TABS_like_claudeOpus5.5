import { Vector3 } from 'three';
import { SoundManager } from '../audio/SoundManager';
import type { Facility } from '../facilities/Facility';
import {
  FACILITY_TYPES,
  FACILITY_TYPE_LIST,
  isFacilityTypeId,
  type FacilityTypeId,
} from '../facilities/FacilityTypes';
import { SceneView } from '../render/SceneView';
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
  TEAM_NAMES,
  UNIT_TYPES,
  UNIT_TYPE_LIST,
  type Team,
  type UnitTypeId,
} from '../units/UnitTypes';
import {
  ARCADE_STAGES,
  computeStageStars,
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

interface PlacedRecord {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  team: Team;
  x: number;
  z: number;
  facing?: number;
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
export type PlayStyle = 'arcade' | 'sandbox';

/**
 * ゲーム全体の進行管理と UI バインディング。
 * - アーケードモード: 全10面、ステージ予算上限、地形ギミック、クリア評価（★1〜★3）と新ユニット解放
 * - サンドボックスモード: 地面クリックで両軍に自由配置（左半分=赤軍、右半分=青軍）
 */
export class GameApp {
  readonly battle = new Battle();
  readonly view: SceneView;
  readonly sound = new SoundManager();

  playStyle: PlayStyle = 'arcade';
  currentStageIndex = 0;
  arcadeSave: ArcadeSaveData = loadArcadeSave();

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
  private readonly elStartBtn: HTMLButtonElement;
  private readonly elPhaseBadge: HTMLElement;
  private readonly elBanner: HTMLElement;
  private readonly elBannerStars: HTMLElement | null;
  private readonly elBannerText: HTMLElement;
  private readonly elBannerSub: HTMLElement;
  private readonly elBannerUnlock: HTMLElement | null;
  private readonly elNextStageBtn: HTMLButtonElement | null;
  private readonly elCategoryTabs: HTMLElement | null;
  private readonly elUnitBar: HTMLElement;
  private readonly elSpeedButtons: HTMLButtonElement[] = [];

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
    this.elStartBtn = document.getElementById('btn-start') as HTMLButtonElement;
    this.elPhaseBadge = document.getElementById('phase-badge')!;
    this.elBanner = document.getElementById('result-banner')!;
    this.elBannerStars = document.getElementById('result-stars');
    this.elBannerText = document.getElementById('result-title')!;
    this.elBannerSub = document.getElementById('result-sub')!;
    this.elBannerUnlock = document.getElementById('result-unlock');
    this.elNextStageBtn = document.getElementById('btn-next-stage') as HTMLButtonElement | null;
    this.elCategoryTabs = document.getElementById('category-tabs');
    this.elUnitBar = document.getElementById('unit-bar')!;

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

  private getCurrentRedCost(): number {
    let cost = 0;
    for (const u of this.battle.units) {
      if (u.team === 0 && u.splitGen === 0) {
        cost += UNIT_TYPES[u.type.id].cost;
      }
    }
    for (const f of this.battle.facilities) {
      if (f.team === 0) {
        cost += f.type.cost;
      }
    }
    return cost;
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
  }

  private buildUI(): void {
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

    // モード切替ボタン（アーケード / サンドボックス）
    const btnArcade = document.getElementById('btn-mode-arcade');
    const btnSandbox = document.getElementById('btn-mode-sandbox');
    const arcadePanel = document.getElementById('arcade-panel');
    const sandboxPanel = document.getElementById('sandbox-panel');

    const syncModePanels = () => {
      const isArc = this.playStyle === 'arcade';
      btnArcade?.classList.toggle('active', isArc);
      btnSandbox?.classList.toggle('active', !isArc);
      arcadePanel?.classList.toggle('hidden', !isArc);
      sandboxPanel?.classList.toggle('hidden', isArc);
    };

    btnArcade?.addEventListener('click', () => {
      if (this.playStyle === 'arcade') return;
      this.playStyle = 'arcade';
      syncModePanels();
      this.loadArcadeStage(this.currentStageIndex);
    });

    btnSandbox?.addEventListener('click', () => {
      if (this.playStyle === 'sandbox') return;
      this.playStyle = 'sandbox';
      syncModePanels();
      this.loadPreset(PRESETS[0]);
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
        { id: 'facility', label: `${CATEGORY_ICONS.facility} 施設 (${FACILITY_TYPE_LIST.length})` },
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

    // 戦闘開始／配置に戻るボタン
    this.elStartBtn.addEventListener('click', () => {
      if (this.mode === 'placement') this.startBattle();
      else this.returnToPlacement();
    });

    document.getElementById('btn-retry')!.addEventListener('click', () => {
      this.returnToPlacement();
    });

    this.elNextStageBtn?.addEventListener('click', () => {
      if (this.currentStageIndex < ARCADE_STAGES.length - 1) {
        this.loadArcadeStage(this.currentStageIndex + 1);
      }
    });

    // 全消去ボタン（アーケードモードでは自軍の赤ユニット・施設のみリセット）
    document.getElementById('btn-clear')!.addEventListener('click', () => {
      if (this.mode !== 'placement') this.returnToPlacement();
      if (this.playStyle === 'arcade') {
        this.savedLineup = this.savedLineup.filter((u) => u.team === 1);
        for (const u of [...this.battle.units]) {
          if (u.team === 0) this.battle.removeUnit(u);
        }
        for (const f of [...this.battle.facilities]) {
          if (f.team === 0) this.battle.removeFacility(f);
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

    // キーボードショートカット（Space: 戦闘開始/戻る、R: 配置に戻る、1〜9: 兵種選択、Tab: モードUI開閉、H: 全UI開閉）
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.mode === 'placement') this.startBattle();
        else this.returnToPlacement();
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
      btn.className =
        'stage-btn' +
        (idx === this.currentStageIndex ? ' active' : '') +
        (stars > 0 ? ' cleared' : '');
      const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      btn.innerHTML = `
        <span>${st.stageNumber}面</span>
        <span class="stage-stars">${starStr}</span>
      `;
      btn.title = `${st.name} (予算 ${st.budget} pt)`;
      btn.addEventListener('click', () => {
        this.loadArcadeStage(idx);
      });
      container.appendChild(btn);
    });
  }

  private renderStageBriefing(): void {
    const el = document.getElementById('stage-briefing');
    if (!el) return;
    const st = this.currentStage;

    // 敵軍の構成をカウントしてキャラアイコン付きで表示
    const enemyCounts = new Map<UnitTypeId, number>();
    for (const e of st.enemies) {
      enemyCounts.set(e.typeId, (enemyCounts.get(e.typeId) ?? 0) + 1);
    }
    const enemyHtml = [...enemyCounts.entries()]
      .map(([id, count]) => {
        const u = UNIT_TYPES[id];
        return `<span class="enemy-unit-chip" title="${u.name} (${u.cost} pt)">
          <span class="mini-unit-icon">${getUnitIconSvg(id)}</span>
          <span>${u.name} ×${count}</span>
        </span>`;
      })
      .join('');

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

    el.innerHTML = `
      <div class="brief-title">${st.name}</div>
      <div class="brief-sub">${st.subtitle}</div>
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

    // 兵種カードの表示（施設以外のカテゴリ、またはすべて）
    if (this.selectedCategory !== 'facility') {
      const filtered = UNIT_TYPE_LIST.filter(
        (ut) => this.selectedCategory === 'all' || ut.category === this.selectedCategory,
      );
      filtered.forEach((ut, idx) => {
        const unlocked = !isArc || isUnitUnlocked(this.arcadeSave, ut.id);
        const isFeatured = featuredSet.has(ut.id);
        const btn = document.createElement('button');
        btn.className =
          'unit-card' +
          (ut.id === this.selectedId ? ' active' : '') +
          (isFeatured ? ' featured' : '') +
          (!unlocked ? ' locked' : '');
        btn.dataset.type = ut.id;
        const keyLabel = idx < 9 ? `${idx + 1}` : '';
        const featBadge = isFeatured ? `<span class="unit-featured-tag">★特効</span>` : '';
        const lockOverlay = !unlocked ? `<div class="unit-lock-badge">🔒</div>` : '';
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
          <div class="unit-desc">${ut.description}</div>
        `;
        btn.addEventListener('click', () => {
          if (!unlocked) {
            this.flashPhaseWarning(`🔒 「${ut.name}」はステージクリア報酬（または「☰ モードUI」内の「🔓全解放」）で使用可能になります`);
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

    // 施設カードの表示（施設カテゴリ、またはすべて）
    if (this.selectedCategory === 'all' || this.selectedCategory === 'facility') {
      FACILITY_TYPE_LIST.forEach((fac, fIdx) => {
        const btn = document.createElement('button');
        btn.className = 'unit-card' + (fac.id === this.selectedId ? ' active' : '');
        btn.dataset.type = fac.id;
        const theme = CATEGORY_THEME_COLORS.facility;
        const keyLabel = this.selectedCategory === 'facility' && fIdx < 9 ? `${fIdx + 1}` : '';

        btn.innerHTML = `
          <div class="unit-card-top">
            <div class="unit-avatar" style="background:${theme.bg}; border-color:${theme.border};">
              ${getFacilityIconSvg(fac.id)}
            </div>
            <div class="unit-head-info">
              <div class="unit-badges-line">
                <span class="unit-cat-badge">${CATEGORY_ICONS.facility} 施設</span>
                <span class="unit-key">${keyLabel}</span>
              </div>
              <div class="unit-name">${fac.name}</div>
              <div class="unit-stats-row">
                <span class="stat-pill cost" title="配置コスト">${COST_ICON_SVG}<span>${fac.cost}</span></span>
                <span class="stat-pill hp" title="最大耐久力">${HP_ICON_SVG}<span>${fac.hp}</span></span>
              </div>
            </div>
          </div>
          <div class="unit-desc">${fac.description}</div>
        `;
        btn.addEventListener('click', () => {
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
    if (this.playStyle === 'arcade' && !isFacilityTypeId(id) && !isUnitUnlocked(this.arcadeSave, id)) {
      return;
    }
    this.selectedId = id;
    const cards = this.elUnitBar.querySelectorAll<HTMLElement>('.unit-card');
    cards.forEach((c) => {
      c.classList.toggle('active', c.dataset.type === id);
    });
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
        this.view.updatePlacementGhost(this.selectedId, 0, p, validZone && canAfford && unlocked);
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
        } else {
          // サンドボックス: x < 0 なら赤軍、x > 0 なら青軍
          if (!this.isInsideArena(p.x, p.z) || Math.abs(p.x) <= 1.2) return;
          const team: Team = p.x < 0 ? 0 : 1;
          const facing = team === 0 ? Math.PI / 2 : -Math.PI / 2;
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

  private removeNearestUnitAt(x: number, z: number): void {
    // 1. 施設を優先探索（クリック判定半径 2.0m）
    let bestFac: Facility | null = null;
    let bestFacDist = 2.0;
    for (const f of this.battle.facilities) {
      if (this.playStyle === 'arcade' && f.team !== 0) continue;
      const d = Math.hypot(f.pos.x - x, f.pos.z - z);
      if (d < bestFacDist) {
        bestFacDist = d;
        bestFac = f;
      }
    }
    if (bestFac) {
      const targetFac = bestFac;
      const idx = this.savedLineup.findIndex(
        (rec) =>
          rec.facilityId === targetFac.type.id &&
          rec.team === targetFac.team &&
          Math.hypot(rec.x - targetFac.pos.x, rec.z - targetFac.pos.z) < 0.6,
      );
      if (idx >= 0) this.savedLineup.splice(idx, 1);
      this.battle.removeFacility(targetFac);
      this.sound.playRemove();
      this.updateHUD();
      return;
    }

    // 2. ユニットの探索
    let bestIdx = -1;
    let bestDist = 1.8;
    for (let i = 0; i < this.battle.units.length; i++) {
      const u = this.battle.units[i];
      // アーケードモードでは敵軍（青軍）は削除不可
      if (this.playStyle === 'arcade' && u.team !== 0) continue;
      const d = Math.hypot(u.pelvis.pos.x - x, u.pelvis.pos.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const target = this.battle.units[bestIdx];
      const lineupIdx = this.savedLineup.findIndex(
        (rec) =>
          rec.typeId === target.type.id &&
          rec.team === target.team &&
          Math.hypot(rec.x - target.pelvis.pos.x, rec.z - target.pelvis.pos.z) < 0.6,
      );
      if (lineupIdx >= 0) this.savedLineup.splice(lineupIdx, 1);
      this.battle.removeUnit(target);
      this.sound.playRemove();
      this.updateHUD();
    }
  }

  /** アーケードモードの指定ステージ（0〜9）を読み込む */
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

    // ステージ固有地形を物理ワールドと描画ビューへ反映
    this.battle.world.obstacles = st.terrain.obstacles ? [...st.terrain.obstacles] : [];
    this.battle.world.chasm = st.terrain.chasm ? { ...st.terrain.chasm } : null;
    this.view.setStageTerrain(st.terrain, true);

    // 敵（青軍）の固定配置を生成
    this.savedLineup = st.enemies.map((e) => ({
      typeId: e.typeId,
      team: 1 as Team,
      x: e.x,
      z: e.z,
      facing: e.facing,
    }));
    for (const u of this.savedLineup) {
      if (u.typeId) {
        this.battle.spawnUnit(u.typeId, u.team, u.x, u.z, u.facing);
      }
    }

    this.renderArcadeStageButtons();
    this.renderStageBriefing();
    this.renderUnitCards();
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
    this.view.setStageTerrain(null, false);
    this.savedLineup = preset.units.map((u) => ({ ...u }));
    for (const item of this.savedLineup) {
      if (item.facilityId) {
        this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
      } else if (item.typeId) {
        this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
      }
    }
    this.renderUnitCards();
    this.syncPhaseUI();
    this.updateHUD();
  }

  startBattle(): void {
    const redForce = this.battle.aliveCount(0) + this.battle.aliveFacilityCount(0);
    const blueForce = this.battle.aliveCount(1) + this.battle.aliveFacilityCount(1);
    if (redForce === 0) {
      this.flashPhaseWarning('⚠ 赤軍ユニットまたは施設を配置してから戦闘開始してください');
      return;
    }
    if (blueForce === 0) {
      return;
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
    this.syncPhaseUI();
  }

  returnToPlacement(): void {
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();
    for (const item of this.savedLineup) {
      if (item.facilityId) {
        this.battle.spawnFacility(item.facilityId, item.team, item.x, item.z, item.facing);
      } else if (item.typeId) {
        this.battle.spawnUnit(item.typeId, item.team, item.x, item.z, item.facing);
      }
    }
    this.syncPhaseUI();
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
    return `${st.name} ｜ 予算: ${COST_ICON_SVG} <b>${used}</b> / ${st.budget} (残り ${st.budget - used} ｜ ${starPreview})`;
  }

  private syncPhaseUI(): void {
    if (this.mode === 'placement') {
      if (this.playStyle === 'arcade') {
        const st = this.currentStage;
        const used = this.getCurrentRedCost();
        this.elPhaseBadge.innerHTML = this.formatArcadeBudgetBadge(st, used);
      } else {
        this.elPhaseBadge.textContent = '配置フェーズ（左半分：赤軍 ／ 右半分：青軍）';
      }
      this.elPhaseBadge.className = 'phase-badge placement';
      this.elStartBtn.textContent = '⚔ 戦闘開始';
      this.elStartBtn.className = 'start-btn';
      this.elUnitBar.classList.remove('disabled');
    } else {
      this.elPhaseBadge.textContent =
        this.playStyle === 'arcade' ? `戦闘中 - ${this.currentStage.name}` : '戦闘中';
      this.elPhaseBadge.className = 'phase-badge battle';
      this.elStartBtn.textContent = '↺ 配置に戻る';
      this.elStartBtn.className = 'start-btn stop';
      this.elUnitBar.classList.add('disabled');
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
        if (f.team !== team) continue;
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

    const r = statsFor(0);
    const b = statsFor(1);
    if (this.playStyle === 'arcade') {
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
    this.elNextStageBtn?.classList.add('hidden');

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
        this.elBannerText.textContent = res === 'draw' ? '引き分け！' : '敗北… 作戦失敗';
        this.elBannerSub.textContent = st.hint;
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
