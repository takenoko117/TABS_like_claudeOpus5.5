import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { Team, UnitTypeId } from '../units/UnitTypes';
import type { PlacementZone } from './ArcadeStages';

export type PlayerCount = 2 | 3 | 4;

export interface VersusPlacedRecord {
  typeId?: UnitTypeId;
  facilityId?: FacilityTypeId;
  team: Team;
  x: number;
  z: number;
  facing?: number;
}

/** 対戦モードの最小・最大予算 (pt) */
export const MIN_VERSUS_BUDGET = 100;
export const MAX_VERSUS_BUDGET = 50000;

/** ランダム決定で選ばれる予算候補 (pt) */
export const RANDOM_BUDGET_POOL: readonly number[] = [
  300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2500, 3000,
];

/**
 * 初期予算をランダムに決定する。
 */
export function rollRandomVersusBudget(rng: () => number = Math.random): number {
  const idx = Math.min(
    RANDOM_BUDGET_POOL.length - 1,
    Math.max(0, Math.floor(rng() * RANDOM_BUDGET_POOL.length)),
  );
  return RANDOM_BUDGET_POOL[idx];
}

/**
 * 手動編集された予算を有効範囲内に丸める。
 */
export function clampVersusBudget(val: number): number {
  if (!Number.isFinite(val)) return 1000;
  return Math.max(MIN_VERSUS_BUDGET, Math.min(MAX_VERSUS_BUDGET, Math.round(val)));
}

/**
 * 対戦人数（2〜4人）に応じた各プレイヤー（Team 0〜3）の配置可能ゾーンを返す。
 */
export function getVersusZones(playerCount: PlayerCount): readonly PlacementZone[] {
  if (playerCount === 2) {
    return [
      { minX: -22, maxX: -1.5, minZ: -16, maxZ: 16, label: '1P 赤軍エリア (西)', facing: Math.PI / 2 },
      { minX: 1.5, maxX: 22, minZ: -16, maxZ: 16, label: '2P 青軍エリア (東)', facing: -Math.PI / 2 },
    ];
  }
  if (playerCount === 3) {
    return [
      {
        minX: -22,
        maxX: -2.0,
        minZ: -16,
        maxZ: -1.5,
        label: '1P 赤軍エリア (北西)',
        facing: Math.atan2(12, 8.75),
      },
      {
        minX: 2.0,
        maxX: 22,
        minZ: -16,
        maxZ: -1.5,
        label: '2P 青軍エリア (北東)',
        facing: Math.atan2(-12, 8.75),
      },
      {
        minX: -14,
        maxX: 14,
        minZ: 2.0,
        maxZ: 16,
        label: '3P 黄軍エリア (南)',
        facing: Math.PI,
      },
    ];
  }
  // 4人対戦: 北西・北東・南西・南東の4象限
  return [
    {
      minX: -22,
      maxX: -2.0,
      minZ: -16,
      maxZ: -1.5,
      label: '1P 赤軍エリア (北西)',
      facing: Math.atan2(12, 8.75),
    },
    {
      minX: 2.0,
      maxX: 22,
      minZ: -16,
      maxZ: -1.5,
      label: '2P 青軍エリア (北東)',
      facing: Math.atan2(-12, 8.75),
    },
    {
      minX: -22,
      maxX: -2.0,
      minZ: 1.5,
      maxZ: 16,
      label: '3P 黄軍エリア (南西)',
      facing: Math.atan2(12, -8.75),
    },
    {
      minX: 2.0,
      maxX: 22,
      minZ: 1.5,
      maxZ: 16,
      label: '4P 緑軍エリア (南東)',
      facing: Math.atan2(-12, -8.75),
    },
  ];
}

/**
 * 指定座標 (x, z) が現在の手番プレイヤーの配置可能エリア内かどうかを判定する。
 */
export function isInsideVersusZone(
  playerCount: PlayerCount,
  team: Team,
  x: number,
  z: number,
): boolean {
  const zones = getVersusZones(playerCount);
  const zone = zones[team];
  if (!zone) return false;
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

/**
 * 対戦モードで (x, z) に配置した際の初期向き（ラジアン）を計算する。
 * 2人対戦では正面（東／西）、3〜4人対戦では戦場中央 (0, 0) に向かう角度を返す。
 */
export function getVersusPlacementFacing(
  playerCount: PlayerCount,
  team: Team,
  x: number,
  z: number,
): number {
  if (playerCount === 2) {
    return team === 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  if (Math.hypot(x, z) > 0.5) {
    return Math.atan2(-x, -z);
  }
  const zones = getVersusZones(playerCount);
  return zones[team]?.facing ?? 0;
}

/**
 * オフライン友人対戦（2〜4人・ブラインド配置方式）の進行状態管理クラス。
 */
export class VersusSession {
  playerCount: PlayerCount = 2;
  budget: number;
  currentTurn: Team = 0;
  /** 各プレイヤーが配置完了OKを押してブラインドされたかどうか */
  completed: boolean[] = [false, false, false, false];
  /** 各プレイヤーの配置データ（ブラインド中もここに保持され、全員完了時に一斉展開される） */
  lineups: VersusPlacedRecord[][] = [[], [], [], []];

  constructor(initialPlayerCount: PlayerCount = 2, rng: () => number = Math.random) {
    this.playerCount = initialPlayerCount;
    this.budget = rollRandomVersusBudget(rng);
    this.resetPlacements();
  }

  /** 人数を変更して配置状態を初期化する（予算もランダム再抽選するか選択可能） */
  setPlayerCount(count: PlayerCount, rerollBudget = true, rng: () => number = Math.random): void {
    this.playerCount = count;
    if (rerollBudget) {
      this.budget = rollRandomVersusBudget(rng);
    }
    this.resetPlacements();
  }

  /** 予算をランダムに再決定する */
  randomizeBudget(rng: () => number = Math.random): number {
    this.budget = rollRandomVersusBudget(rng);
    return this.budget;
  }

  /** 予算を手動で設定する */
  setBudget(newBudget: number): number {
    this.budget = clampVersusBudget(newBudget);
    return this.budget;
  }

  /** 全プレイヤーの配置状況と手番を最初（1P）からにリセットする */
  resetPlacements(): void {
    this.currentTurn = 0;
    this.completed = [false, false, false, false];
    this.lineups = [[], [], [], []];
  }

  /** 戦闘終了後などに、各プレイヤーの編成データを保持したまま1Pの配置確認ターンへ戻す */
  reopenPlacementsKeepLineups(): void {
    this.currentTurn = 0;
    this.completed = [false, false, false, false];
  }

  /** 現在手番のプレイヤーの編成リストを取得する */
  getCurrentLineup(): VersusPlacedRecord[] {
    return this.lineups[this.currentTurn];
  }

  /** 指定プレイヤーの編成リストを取得する */
  getTeamLineup(team: Team): VersusPlacedRecord[] {
    return this.lineups[team];
  }

  /** 現在手番のプレイヤーの配置を全消去する */
  clearCurrentTurnLineup(): void {
    this.lineups[this.currentTurn] = [];
  }

  /** 全プレイヤーが配置完了OKを押した状態かどうか */
  get allReady(): boolean {
    for (let i = 0; i < this.playerCount; i++) {
      if (!this.completed[i]) return false;
    }
    return true;
  }

  /**
   * 現在の手番プレイヤーが「配置完了 OK」を押したときの処理。
   * - 次のプレイヤーがいる場合は手番を進め `{ allReady: false, nextTeam }` を返す。
   * - 全員が配置完了した場合は `{ allReady: true }` を返し、戦闘開始へ遷移する。
   */
  confirmCurrentTurn(): { allReady: boolean; nextTeam: Team } {
    this.completed[this.currentTurn] = true;
    const nextIdx = this.currentTurn + 1;
    if (nextIdx < this.playerCount) {
      this.currentTurn = nextIdx as Team;
      return { allReady: false, nextTeam: this.currentTurn };
    }
    return { allReady: true, nextTeam: this.currentTurn };
  }

  /** 全プレイヤー（0 .. playerCount - 1）の配置レコードを結合して返す */
  getAllActiveLineups(): VersusPlacedRecord[] {
    const all: VersusPlacedRecord[] = [];
    for (let t = 0; t < this.playerCount; t++) {
      for (const rec of this.lineups[t]) {
        all.push({ ...rec });
      }
    }
    return all;
  }
}
