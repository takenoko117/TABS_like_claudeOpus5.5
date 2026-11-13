import { vx } from './VoxelIcons';
import type { Battle } from '../game/Battle';
import {
  getDeployCooldown,
  getDeployCost,
  levelForTotalXp,
  TD_BASE_PRICE_START,
  TD_DUEL_TIME_LIMIT,
  TD_DURATION_SECONDS,
  TD_START_PLAYER_CANNONS,
  TD_WAVE_COUNT,
  xpForLevel,
  type DeployBlock,
  type TDRun,
} from '../game/RealtimeTDMode';
import {
  RARITY_LABELS,
  ROGUE_STARTERS,
  getSquadSize,
  getUnitSlotCost,
  relicDescription,
  relicDisplayName,
  type RewardOption,
  type RogueStarter,
} from '../game/RogueliteMode';
import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { TDLockstep } from '../game/TDDuel';
import type { TDVersusSession, TDVersusVerdict } from '../game/TDVersusSession';
import type { TDVersusEndReason, TDVersusJoinIntent, TDVersusRoomListing } from '../net/tdVersusProtocol';
import {
  renderVersusLobby,
  renderVersusPanel,
  renderVersusResult,
  renderVersusRoomList,
  renderVersusWatchResult,
  updateVersusPanel,
} from './TDVersusUi';
import { pixelArt } from './PixelArt';
import { BIOMES, TRAITS } from '../field/BiomeDefs';
import { TD_TERRAIN_SECONDS } from '../game/TDTerrain';
import type { JackpotReward } from '../game/RogueJackpot';
import { UnitPreviews } from '../render/UnitPreviews';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { getFacilityIconSvg, getUnitIconSvg } from './UnitIcons';
import { setVoxelText, type VoxelTextOptions } from './VoxelText';
import type { Facility } from '../facilities/Facility';
import type { FxComboState } from '../fx/FxDirector';
import { FX_COMBO_SHOW_FROM, FX_COMBO_WINDOW, type FxCueId, type FxLevel, type FxTier } from '../fx/FxCues';
import { BannerFx } from '../fx/ui/BannerFx';
import { FloatText } from '../fx/ui/FloatText';
import { LagBar } from '../fx/ui/LagBar';
import { TweenNumber } from '../fx/ui/TweenNumber';
import { retrigger, setHtml, stagger } from '../fx/ui/dom';

/**
 * 要素の中の数字を 0 からカウントアップする（「12 / 8」「3:05」「75%」のような文字も、数字の部分だけ数える）。
 * 戻り値を呼ぶとすぐに最終の値にする
 */
function countUpText(el: HTMLElement, seconds: number, delay: number): () => void {
  const final = el.textContent ?? '';
  const parts = final.split(/(\d+)/);
  if (parts.length < 2) return () => undefined;
  // 時刻（3:05）の秒の 0 埋めを保つ
  const widths = parts.map((p) => (/^\d+$/.test(p) ? p.length : 0));
  let raf = 0;
  let done = false;
  const start = performance.now() + delay * 1000;
  const frame = (now: number) => {
    if (done) return;
    const k = Math.max(0, Math.min(1, (now - start) / (seconds * 1000)));
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = parts
      .map((p, i) => (widths[i] ? String(Math.round(Number(p) * e)).padStart(p.startsWith('0') ? widths[i] : 1, '0') : p))
      .join('');
    if (k < 1) raf = requestAnimationFrame(frame);
    else done = true;
  };
  raf = requestAnimationFrame(frame);
  return () => {
    done = true;
    cancelAnimationFrame(raf);
    el.textContent = final;
  };
}

/** HUD から GameApp に頼む操作 */
export interface TDHudHost {
  readonly battle: Battle;
  getRun(): TDRun | null;
  /** 経験値オーブとして飛んでいる途中の経験値 */
  getPendingXp(): number;
  /** 強化を選んでいる間、戦闘を止める */
  setHold(hold: boolean): void;
  isPaused(): boolean;
  togglePause(): void;
  openSettings(): void;
  /** 戦闘中の操作の効果音 */
  playClick(): void;
  playDeploy(): void;
  playDenied(): void;
  playLevelUp(): void;
  startRun(starter: RogueStarter): void;
  retire(): void;
  toTitle(): void;
  retry(): void;
  /** 演出を起こす（pos を渡すと衝撃の向きにカメラを押す） */
  emitFx(cue: FxCueId, tier: FxTier, pos?: { x: number; z: number } | null): void;
  /** 城が大きく削られたときの破片 */
  castleImpact(base: Facility, tier: FxTier): void;
  /** 演出の効果音 */
  playFxSound(name: string, tier: FxTier, pitch?: number): void;
  /** BGM のテンポの倍率 */
  setMusicTempo(scale: number): void;
  /** 重要な告知の瞬間に BGM を一瞬下げる */
  duckMusic(seconds?: number): void;
  getFxLevel(): FxLevel;
  /** 撃破を数える（連鎖の数と音程） */
  registerKill(): FxComboState;
  /** 対戦で、まだ開けていない自分の宝箱の数（1 人用・観戦は 0） */
  getChestCount(): number;
  /** 対戦で、いちばん古い宝箱を開ける（宝箱ボタン）。開けられたら true */
  openNextChest(): boolean;
  /** オンライン対戦（対戦していなければ null） */
  getVersus(): TDVersusSession | null;
  /** 対戦の試合のロックステップ（試合中でなければ null） */
  getLockstep(): TDLockstep | null;
  /** 部屋に入る（create: 部屋を作る / join: 一覧の部屋に入る） */
  vsJoin(room: string, intent: TDVersusJoinIntent): void;
  /** 募集中の部屋の一覧を取り直す */
  vsRefreshRooms(): void;
  /** 対戦中の部屋を観戦する */
  vsWatch(room: string): void;
  vsReady(starterId: string): void;
  vsUnready(): void;
  /** 部屋を出てロビーの入力画面へ戻る */
  vsLeave(): void;
  /** 決着後、同じ部屋のロビーへ戻る */
  vsLobby(): void;
  /** オンライン対戦をやめて友人対戦の選択（タイトル）へ */
  vsBack(): void;
}

const BLOCK_LABELS: Record<DeployBlock, string> = {
  cooldown: '待機中',
  money: 'お金不足',
  full: '満員',
  not_owned: '未所持',
  ended: '終了',
};

/** 城が「大きく削られた」とみなす 1 フレームの減り（最大 HP に対する割合） */
const CASTLE_BIG_HIT_RATIO = 0.035;
/** 危険域（城の HP がこの割合未満）と、自分の城の心音の間隔（秒） */
const CASTLE_DANGER_RATIO = 0.3;
const CASTLE_HEARTBEAT_INTERVAL = 1.1;
/** 対戦の残り時間の告知（秒）と、1 秒ごとに数字を出し始める残り秒数 */
const DUEL_LAST_MINUTE = 60;
const DUEL_FINAL_COUNT = 10;
/** 残り 60 秒からの BGM のテンポ */
const DUEL_LAST_MINUTE_TEMPO = 1.15;
/** 地形変化の何秒前からカウントダウンするか */
const TERRAIN_COUNTDOWN = 3;
/** 連続出撃で音程を上げる間隔（秒）と 1 回ごとの上がり幅・上限の回数 */
const DEPLOY_STREAK_WINDOW = 1.2;
const DEPLOY_STREAK_PITCH = 0.06;
const DEPLOY_STREAK_MAX = 6;
/** リザルトの誤タップ防止（秒） */
const RESULT_GUARD_SECONDS = 0.9;

/** 城 1 つぶんの表示の状態（遅延ゲージ・数字・段階） */
interface CastleFx {
  bar: LagBar;
  num: TweenNumber;
  stage2: boolean;
  danger: boolean;
  /** 直前のフレームの HP（城強化で最大 HP が増えたときに被弾と間違えないよう、実際の HP の減りで判定する） */
  lastHp: number;
}

/** レベルアップ演出の長さと、強化の選択を出すまでの時間（秒） */
const LEVELUP_FX_TIME = 1.5;
const CHOICE_DELAY = 0.75;
/** 演出で飛び散るキューブの数 */
const LEVELUP_CUBES = 18;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 動くボクセルモデル（用意できるまでは下のアイコンが見える） */
function unitVoxel(id: UnitTypeId): string {
  return `<span class="unit-voxel td-voxel" data-unit-preview="${id}">${getUnitIconSvg(id)}<canvas aria-hidden="true"></canvas></span>`;
}

function propVoxel(key: string, fallback: string): string {
  return `<span class="unit-voxel prop-voxel td-voxel" data-prop-preview="${key}">${fallback}<canvas aria-hidden="true"></canvas></span>`;
}

function relicVoxel(id: FacilityTypeId): string {
  return propVoxel(`relic:${id}`, getFacilityIconSvg(id));
}

const GOLD_VOXEL = propVoxel('gold', `<span class="td-emoji">${vx('coin')}</span>`);

/** 簡易チュートリアルの1ページ */
export interface TDTutorialPage {
  /** ボクセル文字で出す見出し */
  title: string;
  /** 見出しの上に出す小さなラベル */
  tag: string;
  /** 動くボクセルモデル（data-prop-preview のキー: 'gold' か 'relic:施設ID'） */
  model: string;
  /** ページの色（ポップな色分け） */
  color: string;
  lines: string[];
}

export const TD_TUTORIAL_PAGES: readonly TDTutorialPage[] = [
  {
    tag: 'ゲームの目標',
    title: '10分以内に敵の城を破壊せよ！',
    model: 'relic:hq',
    color: '#ffb52e',
    lines: [
      '右の端にあるのが敵の城、左の端が自分の城。',
      '下のカードをタップすると、城から部隊が出撃するぞ。',
      '自分の城を壊されたら負け！',
    ],
  },
  {
    tag: 'つよくなる',
    title: '敵を倒して経験値をためよう！',
    model: 'gold',
    color: '#46d17a',
    lines: [
      '倒した敵から経験値のオーブが飛んでくる。',
      'レベルアップしたら3つの強化から1つを選んで、自軍をパワーアップ！',
    ],
  },
  {
    tag: 'ちゅうい',
    title: '城を攻撃すると反撃を食らうぞ！',
    model: 'relic:cannon_tower',
    color: '#ff5a6e',
    lines: [
      '敵の城を削るたびに、強い反撃部隊が飛び出してくる。',
      '自軍が育つまではガマン。攻めるタイミングに注意しよう！',
    ],
  },
  {
    tag: 'エリアコントロール',
    title: '戦闘エリアをおさえて有利に戦おう！',
    model: 'relic:buff_totem',
    color: '#4aa8ff',
    lines: [
      `自分の城の近くには、加護のトーテムと砲台${TD_START_PLAYER_CANNONS}基が最初から置いてある。`,
      'まずは城の近くで迎え撃って、経験値をためるのがおすすめ。',
      `城強化（最初は${TD_BASE_PRICE_START}G）で砲台がどんどん増えるぞ！`,
    ],
  },
];

const TUTORIAL_STORAGE_KEY = 'exblocks_td_tutorial_done_v1';

/** あそびかたを一度見た（またはスキップした）か */
export function isTDTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTDTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
  } catch {
    // 保存できない環境では次回も表示する
  }
}

const TUTORIAL_TITLE_VOXEL: VoxelTextOptions = {
  height: 32,
  maxCell: 3,
  depth: 3,
  bold: true,
  wrap: true,
  maxWidth: () => Math.min(560, window.innerWidth - 72),
};

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** タワーディフェンスモードの画面（状況バー、経験値と強化、出撃バー、強化の選択、スターター選択、リザルト） */
export class RealtimeTDHud {
  private readonly root: HTMLElement;
  private readonly elTop: HTMLElement;
  private readonly elSide: HTMLElement;
  private readonly elUps: HTMLElement;
  private readonly elRelics: HTMLElement;
  private readonly elBar: HTMLElement;
  private readonly elAnnounce: HTMLElement;
  private readonly elLevelUp: HTMLElement;
  private readonly elChoice: HTMLElement;
  private readonly elModal: HTMLElement;
  private deckKey = '';
  private upsKey = '';
  private relicsKey = '';
  private choiceKey = '';
  private announceTimer = 0;
  private readonly cardEls = new Map<UnitTypeId, HTMLElement>();
  private readonly previews = new UnitPreviews();
  /** 経験値バーに表示しているレベルと経験値の合計（オーブが届いたぶんだけ進む） */
  private shownLevel = 1;
  private shownTotal = 0;
  private gainTimer = 0;
  private levelUpTimer = 0;
  private choiceOpen = false;
  private readonly elTutorial: HTMLElement;
  private tutorialPage = -1;
  private tutorialOnClose: (() => void) | null = null;
  /** 対戦相手の戦況 */
  private readonly elVs: HTMLElement;
  /** ロビーで入力中の部屋名 */
  private vsRoomDraft = '';
  // ---- 演出（FX_SPEC.md §5） ----
  private readonly banner: BannerFx;
  private readonly floatText: FloatText;
  private readonly elCombo: HTMLElement;
  private readonly elCount: HTMLElement;
  private comboTimer = 0;
  private moneyNum: TweenNumber | null = null;
  private readonly castles = new Map<string, CastleFx>();
  private heartbeatTimer = 0;
  /** 直前のフレームで出せなかったカード（出せるようになった瞬間を光らせる） */
  private readonly blockedCards = new Set<UnitTypeId>();
  private deployStreak = 0;
  private deployStreakTimer = 0;
  private shownChests = 0;
  /** 対戦の残り時間の告知を出したか・最後に数字を出した秒 */
  private lastMinuteAnnounced = false;
  private lastCountSecond = -1;
  private lastTerrainCount = -1;
  private readonly countOpts: VoxelTextOptions = { height: 64, maxCell: 5, depth: 3, bold: true };
  private readonly countSmallOpts: VoxelTextOptions = { height: 28, maxCell: 2, depth: 2, bold: true };

  constructor(private readonly host: TDHudHost) {
    this.root = document.createElement('div');
    this.root.id = 'td-hud';
    this.root.className = 'td-hud hidden';
    this.root.innerHTML = `
      <div class="td-top"></div>
      <div class="td-vs hidden"></div>
      <div class="td-side">
        <div class="td-xp">
          <span class="td-lv"><small>Lv</small><b>1</b></span>
          <div class="td-xp-bar"><i></i><span class="td-xp-num"></span></div>
        </div>
        <div class="td-money"><span class="td-money-icon">${GOLD_VOXEL}</span><b></b><small></small></div>
        <div class="td-ups"></div>
        <div class="td-relics"></div>
      </div>
      <div class="td-tools">
        <button type="button" class="td-btn td-auto" data-td="auto" title="クールタイムが明けたカードを自動で出撃させる">AUTO</button>
        <button type="button" class="td-btn" data-td="pause" title="一時停止 (P)">${vx('pause')}</button>
        <button type="button" class="td-btn" data-td="howto" title="あそびかた（見ている間は止まる）">？</button>
        <button type="button" class="td-btn" data-td="settings" title="設定（開いている間は止まる）">${vx('gear')}</button>
        <button type="button" class="td-btn" data-td="retire" title="リタイアしてタイトルへ">${vx('flag')}</button>
      </div>
      <div class="td-stance hidden">
        <button type="button" class="td-btn td-stance-btn" data-td="stance-castle" title="全軍が敵の城だけを狙う（兵や魔物は無視）">${vx('castle')}<b>城を狙え！</b><span class="td-stance-lock"></span></button>
        <button type="button" class="td-btn td-stance-btn" data-td="stance-enemy" title="全軍が一番近い敵を狙う">${vx('swords')}<b>敵を倒せ！</b><span class="td-stance-lock"></span></button>
      </div>
      <div class="td-announce hidden"></div>
      <div class="td-levelup hidden" aria-hidden="true"></div>
      <div class="td-choice hidden" role="dialog" aria-label="強化を選ぶ"></div>
      <div class="td-bar"></div>
      <div class="td-modal hidden"></div>
      <div class="td-tutorial hidden" role="dialog" aria-label="あそびかた"></div>
      <div class="fx-combo hidden" aria-hidden="true"><b></b><small>連撃破!</small></div>
      <div class="fx-count hidden" aria-hidden="true"></div>
    `;
    document.body.appendChild(this.root);
    this.elTop = this.root.querySelector('.td-top')!;
    this.elSide = this.root.querySelector('.td-side')!;
    this.elUps = this.root.querySelector('.td-ups')!;
    this.elRelics = this.root.querySelector('.td-relics')!;
    this.elBar = this.root.querySelector('.td-bar')!;
    this.elAnnounce = this.root.querySelector('.td-announce')!;
    this.elLevelUp = this.root.querySelector('.td-levelup')!;
    this.elChoice = this.root.querySelector('.td-choice')!;
    this.elModal = this.root.querySelector('.td-modal')!;
    this.elTutorial = this.root.querySelector('.td-tutorial')!;
    this.elVs = this.root.querySelector('.td-vs')!;
    this.elVs.innerHTML = renderVersusPanel();
    this.elCombo = this.root.querySelector('.fx-combo')!;
    this.elCount = this.root.querySelector('.fx-count')!;
    this.banner = new BannerFx(this.root);
    this.banner.onShow = (item) => {
      this.host.playFxSound('banner', item.tier);
      if (item.tier >= 2) this.host.duckMusic(0.7);
    };
    this.floatText = new FloatText(this.root);
    this.moneyNum = new TweenNumber(this.elSide.querySelector<HTMLElement>('.td-money b')!, undefined, 0.08, 25);
    this.renderTop();
    this.root.addEventListener('click', (e) => this.onClick(e));
    // 部屋名の入力: 打った内容を覚え、Enter で入室する
    this.root.addEventListener('input', (e) => {
      const input = e.target as HTMLElement;
      if (input.classList.contains('td-vs-room')) this.vsRoomDraft = (input as HTMLInputElement).value;
    });
    this.root.addEventListener('keydown', (e) => {
      const input = e.target as HTMLElement;
      if (!input.classList.contains('td-vs-room')) return;
      e.stopPropagation();
      if (e.key === 'Enter') this.host.vsJoin(this.vsRoomDraft, 'create');
    });
  }

  /** モデルの表示先を取り直す（描き直したとき） */
  private bindPreviews(): void {
    this.previews.bind(this.root);
  }

  // ---- 表示の切り替え ----

  show(): void {
    this.root.classList.remove('hidden');
    document.body.classList.add('td-mode');
    this.bindPreviews();
  }

  hide(): void {
    this.previews.unbind();
    this.root.classList.add('hidden');
    document.body.classList.remove('td-mode');
    this.closeChoice();
    this.hideModal();
    this.closeTutorial(false);
  }

  /** 観戦中か */
  get spectating(): boolean {
    return this.host.getLockstep()?.spectator ?? false;
  }

  get isChoiceOpen(): boolean {
    return this.choiceOpen;
  }

  /** 経験値オーブが目指す位置（経験値バーの右端寄り。client 座標） */
  get xpTarget(): { x: number; y: number } | null {
    if (this.root.classList.contains('hidden')) return null;
    const bar = this.elSide.querySelector<HTMLElement>('.td-xp-bar');
    const r = bar?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const fill = this.shownTotalRatio();
    return { x: r.left + Math.max(12, r.width * fill), y: r.top + r.height / 2 };
  }

  private shownTotalRatio(): number {
    const { xp, level } = levelForTotalXp(this.shownTotal);
    return Math.min(1, xp / xpForLevel(level));
  }

  /** 新しいランを始めたときに表示をリセットする */
  reset(): void {
    this.deckKey = '';
    this.upsKey = '';
    this.relicsKey = '';
    this.choiceKey = '';
    this.cardEls.clear();
    this.elBar.innerHTML = '';
    this.elUps.innerHTML = '';
    this.elRelics.innerHTML = '';
    this.shownLevel = 1;
    this.shownTotal = 0;
    this.gainTimer = 0;
    this.levelUpTimer = 0;
    this.elLevelUp.classList.add('hidden');
    this.elLevelUp.innerHTML = '';
    this.closeChoice();
    this.hideModal();
    this.elAnnounce.classList.add('hidden');
    this.banner.clear();
    this.resetFx();
    this.root.classList.toggle('td-running', this.host.getRun() !== null);
    const versus = this.host.getRun()?.duel ?? false;
    this.root.classList.toggle('td-versus', versus);
    this.elVs.classList.toggle('hidden', !versus);
    // 観戦では操作の UI を隠し、旗のボタンは「観戦をやめる」にする
    const watching = this.spectating;
    this.root.classList.toggle('td-spectate', watching);
    const retire = this.root.querySelector<HTMLElement>('[data-td="retire"]')!;
    retire.innerHTML = watching ? `${vx('close')}` : `${vx('flag')}`;
    retire.title = watching ? '観戦をやめて部屋の一覧へ戻る' : 'リタイアしてタイトルへ';
    // 対戦のゲスト（赤）は、カードのモデルや城の HP バーを赤の配色にする
    const team = this.host.getRun()?.team ?? 0;
    this.root.classList.toggle('td-red-side', team === 1);
    this.previews.setTeam(team);
    this.bindPreviews();
  }

  // ---- 毎フレームの更新 ----

  update(realDt: number): void {
    const td = this.host.getRun();
    if (!td) {
      // スターター選択中にあそびかたを開いたときもモデルを動かす
      if (this.isTutorialOpen) this.previews.update(realDt);
      return;
    }
    this.consumeEvents(td);
    if (this.announceTimer > 0) {
      this.announceTimer -= realDt;
      if (this.announceTimer <= 0) this.elAnnounce.classList.add('hidden');
    }
    this.banner.update(realDt);
    this.updateTop(td);
    this.updateCastleFx(td, realDt);
    this.updateClockFx(td);
    if (this.comboTimer > 0) {
      this.comboTimer -= realDt;
      if (this.comboTimer <= 0) this.elCombo.classList.add('hidden');
    }
    if (td.duel) updateVersusPanel(this.elVs, this.host.getLockstep());
    this.updateXp(td, realDt);
    this.updateSide(td);
    this.moneyNum?.update(td.money, realDt);
    if (this.deployStreakTimer > 0) {
      this.deployStreakTimer -= realDt;
      if (this.deployStreakTimer <= 0) this.deployStreak = 0;
    }
    const key = td.run.cards.map((c) => c.id).join(',');
    if (key !== this.deckKey) {
      this.deckKey = key;
      this.renderBar(td);
    }
    this.updateBar(td);
    this.updateChoice(td);
    this.previews.update(realDt);
  }

  private consumeEvents(td: TDRun): void {
    if (td.events.length === 0) return;
    // レベルアップは経験値バーにオーブが届いたときに演出するので、ここでは知らせない
    const events = td.events.splice(0).filter((e) => e.kind !== 'levelup');
    // 重なった告知は捨てずに優先度つきのキューへ（重要なものは割り込み、軽いものは短く順番に流す）
    const watching = this.spectating;
    for (const ev of events) {
      switch (ev.kind) {
        case 'stance': {
          const team = ev.value >> 1;
          const castle = (ev.value & 1) === 1;
          const who = watching ? (team === 0 ? '青' : '赤') : team === td.team ? '自軍' : '相手';
          this.announce(
            castle ? `${who}：城を狙え!!` : `${who}：敵を倒せ!!`,
            'stance',
            1,
            castle ? `${vx('castle')} 敵の城だけを攻撃` : `${vx('swords')} 一番近い敵を攻撃`,
          );
          break;
        }
        case 'terrain': {
          const b = td.terrainBiome ? BIOMES[td.terrainBiome] : null;
          const t = td.terrainTrait ? TRAITS[td.terrainTrait] : null;
          this.announce('地形変化!!', 'terrain', 1, `${vx('volcano')} ${b ? `${vx(b.icon)}${b.name}` : ''}${t ? `（${t.name}: ${t.effect}）` : ''}`);
          this.host.emitFx('terrain_shift', 1);
          break;
        }
        case 'boss':
          this.announce('最終ボス出現!!', 'boss', 2, `${vx('oni')} 倒せば勝利が近い`);
          this.host.emitFx('boss_spawn', 2);
          break;
        case 'wild_boss':
          this.announce('ヌシ出現!!', 'wild', 2, `${vx('crown')} 金角のヌシを倒すと宝箱`);
          this.host.emitFx('boss_spawn', 2);
          break;
        case 'wild_boss_down':
          if (watching) {
            this.announce(ev.value < 0 ? 'ヌシが倒れた' : `${ev.value === 0 ? '青' : '赤'}がヌシを討ち取った!!`, 'wild', 1);
          } else if (ev.value === td.team) {
            this.announce('討ち取った!!', 'wild', 2, `${vx('crown')} ヌシの宝箱を獲得`);
            this.host.emitFx('boss_down', 2);
          } else if (ev.value < 0) {
            this.announce('ヌシが倒れた', 'wild', 1);
          } else {
            // 相手の手柄は控えめに（悔しさは出すが邪魔しない）
            this.announce('ヌシを奪われた…', 'wild lose', 1);
          }
          break;
        case 'counter':
          this.announce('敵基地の反撃!!', 'counter', 1, `${vx('fire')} 反撃 ${ev.value * 10}%`);
          break;
        case 'elite':
          this.announce(`WAVE ${ev.value} エリート`, 'elite', 1, `${vx('demon')} 強敵が混ざっている`);
          break;
        case 'wave':
          this.announce(`WAVE ${ev.value}`, 'wave', 0);
          break;
      }
    }
  }

  /** 立体文字の告知（tier が高いほど大きく、tier 3 は虹色） */
  announce(text: string, kind: string, tier: FxTier = 1, sub = ''): void {
    this.banner.push({ text, kind, tier, sub });
  }

  // ---- 演出（城・時間・撃破） ----

  private resetFx(): void {
    for (const c of this.castles.values()) {
      c.bar.reset();
      c.num.reset();
    }
    this.moneyNum?.reset();
    this.heartbeatTimer = 0;
    this.blockedCards.clear();
    this.deployStreak = 0;
    this.deployStreakTimer = 0;
    this.shownChests = 0;
    this.lastMinuteAnnounced = false;
    this.lastCountSecond = -1;
    this.lastTerrainCount = -1;
    this.comboTimer = 0;
    this.elCombo.classList.add('hidden');
    this.elCount.classList.add('hidden');
    this.host.setMusicTempo(1);
  }

  /** 城の HP バーの遅延ゲージ・数字・被弾・第二段階・危険域 */
  private updateCastleFx(td: TDRun, realDt: number): void {
    const watching = this.spectating;
    const handle = (sel: string, base: Facility | null | undefined, mine: boolean) => {
      if (!base) return;
      const el = this.elTop.querySelector<HTMLElement>(sel)!;
      let c = this.castles.get(sel);
      if (!c || !c.bar.isConnected) {
        c = {
          bar: new LagBar(el.querySelector<HTMLElement>('.td-hp')!, el.querySelector<HTMLElement>('.td-hp i')!),
          num: new TweenNumber(el.querySelector<HTMLElement>('.td-hp-num')!, (n) => Math.ceil(Math.max(0, n)).toLocaleString(), 0.06),
          stage2: base.inLowHpStage,
          danger: false,
          lastHp: base.hp,
        };
        this.castles.set(sel, c);
      }
      const ratio = base.maxHp > 0 ? Math.max(0, base.hp) / base.maxHp : 0;
      c.bar.update(ratio, realDt);
      c.num.update(Math.max(0, base.hp), realDt);
      const drop = base.maxHp > 0 ? (c.lastHp - base.hp) / base.maxHp : 0;
      c.lastHp = base.hp;
      if (drop > 0 && !td.ended) {
        const big = drop >= CASTLE_BIG_HIT_RATIO;
        const tier: FxTier = big ? 2 : 1;
        // 自分の城なら画面の縁が赤く光る。相手の城・観戦では赤い縁を出さない
        this.host.emitFx(mine && !watching ? 'castle_hit' : 'castle_strike', tier, base.pos);
        if (big) this.host.castleImpact(base, tier);
      }
      if (base.inLowHpStage && !c.stage2 && !td.ended) {
        // 第二段階への移行: 遠距離が 1/10 しか効かなくなる大事なルール変化
        const who = watching ? (mine ? '青の城' : '赤の城') : mine ? 'あなたの城' : '相手の城';
        this.announce(`${who} 第二段階!!`, mine && !watching ? 'stage2 lose' : 'stage2', 2, '遠距離攻撃は 1/10 しか効かない。近接で攻めよう');
        this.host.emitFx('castle_stage2', 2, base.pos);
        this.host.castleImpact(base, 3);
      }
      c.stage2 = base.inLowHpStage;
      c.danger = ratio > 0 && ratio < CASTLE_DANGER_RATIO;
    };
    handle('.td-base.ally', td.playerBase, true);
    handle('.td-base.enemy', td.enemyBase, false);
    // 自分の城が危ないときは心音を鳴らす（ルーレットのリーチの心音を流用）
    const ally = this.castles.get('.td-base.ally');
    if (ally?.danger && !watching && !td.ended) {
      this.heartbeatTimer -= realDt;
      if (this.heartbeatTimer <= 0) {
        this.heartbeatTimer = CASTLE_HEARTBEAT_INTERVAL;
        this.host.playFxSound('heartbeat', 1);
      }
    } else this.heartbeatTimer = 0;
  }

  /** 対戦の残り時間（残り 60 秒の告知・残り 10 秒の数字）と地形変化のカウントダウン */
  private updateClockFx(td: TDRun): void {
    if (td.ended) {
      this.elCount.classList.add('hidden');
      return;
    }
    let count = -1;
    let kind = '';
    if (td.duel) {
      const left = Math.max(0, TD_DUEL_TIME_LIMIT - td.time);
      if (!this.lastMinuteAnnounced && left <= DUEL_LAST_MINUTE) {
        this.lastMinuteAnnounced = true;
        // 途中から観戦に入ったときなど、とっくに過ぎていたら告知しない
        if (left > DUEL_LAST_MINUTE - 2) this.announce('残り 60 秒!!', 'time', 2, '時間切れは城の残り HP で判定');
        this.host.setMusicTempo(DUEL_LAST_MINUTE_TEMPO);
      }
      if (left > 0 && left <= DUEL_FINAL_COUNT) {
        count = Math.ceil(left);
        kind = 'final';
      }
    }
    // 地形変化の 3 秒前から数える（対戦の最後の 10 秒と重なったらそちらを優先）
    const next = (td.terrainIndex + 1) * TD_TERRAIN_SECONDS - td.time;
    const over = !td.duel && td.time >= TD_DURATION_SECONDS;
    if (count < 0 && td.terrainBiome && !over && next > 0 && next <= TERRAIN_COUNTDOWN) {
      count = Math.ceil(next);
      kind = 'terrain';
      if (count !== this.lastTerrainCount) {
        this.lastTerrainCount = count;
        this.host.playFxSound('countdown', 1);
      }
    } else this.lastTerrainCount = -1;
    if (count < 0) {
      this.elCount.classList.add('hidden');
      this.elCount.dataset.label = '';
      this.lastCountSecond = -1;
      return;
    }
    if (kind === 'final' && count !== this.lastCountSecond) {
      this.lastCountSecond = count;
      this.host.emitFx('countdown', 2);
    }
    const label = kind === 'terrain' ? `地形変化まで ${count}` : String(count);
    if (this.elCount.dataset.label !== label) {
      this.elCount.dataset.label = label;
      this.elCount.className = `fx-count ${kind}`;
      setVoxelText(this.elCount, label, kind === 'terrain' ? this.countSmallOpts : this.countOpts);
      retrigger(this.elCount, 'slam');
    }
  }

  /** 自分の陣営が敵を倒したとき（GameApp から）。短い時間に続けて倒すと連鎖の数が増え、音程が上がる */
  onKill(): void {
    if (this.spectating) return;
    const combo = this.host.registerKill();
    if (combo.count < FX_COMBO_SHOW_FROM) return;
    this.comboTimer = FX_COMBO_WINDOW;
    this.elCombo.querySelector('b')!.textContent = String(combo.count);
    this.elCombo.classList.remove('hidden');
    retrigger(this.elCombo, 'bump');
    this.host.playFxSound('combo', 0, combo.pitch);
  }

  /** 決着の立体文字（GameApp から）。勝ちは虹色 */
  announceFinish(text: string, win: boolean, sub = ''): void {
    this.banner.clear();
    this.banner.push({ text, kind: win ? 'finish win' : 'finish lose', tier: win ? 3 : 2, sub });
    this.comboTimer = 0;
    this.elCombo.classList.add('hidden');
    this.elCount.classList.add('hidden');
    this.host.setMusicTempo(1);
  }

  private renderTop(): void {
    this.elTop.innerHTML = `
      <div class="td-base ally"><span class="td-base-label">${vx('castle')} 自軍の城</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
      <div class="td-clock">
        <div class="td-wave"></div>
        <div class="td-time"></div>
        <div class="td-terrain"></div>
      </div>
      <div class="td-base enemy"><span class="td-base-label">敵軍の城 ${vx('castleRed')}</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
    `;
  }

  private updateTop(td: TDRun): void {
    const setBase = (sel: string, hp: number, max: number, stage2: boolean) => {
      const el = this.elTop.querySelector<HTMLElement>(sel)!;
      el.classList.toggle('stage2', stage2);
      el.querySelector<HTMLElement>('.td-hp')!.title = stage2
        ? '第二段階：遠距離攻撃は1/10しか効かない（近接で攻めよう）'
        : '第一段階：遠距離攻撃は半減。HPが半分を切ると第二段階';
      // バーの幅と数字は updateCastleFx（遅延ゲージ・なめらかな数字）が描く
      const ratio = max > 0 ? Math.max(0, hp) / max : 0;
      el.classList.toggle('danger', ratio < CASTLE_DANGER_RATIO);
    };
    if (td.playerBase) setBase('.td-base.ally', td.playerBase.hp, td.playerBase.maxHp, td.playerBase.inLowHpStage);
    if (td.enemyBase) setBase('.td-base.enemy', td.enemyBase.hp, td.enemyBase.maxHp, td.enemyBase.inLowHpStage);
    const timeEl = this.elTop.querySelector<HTMLElement>('.td-time')!;
    const over = !td.duel && td.time >= TD_DURATION_SECONDS;
    // 城の名前・時間・地形は毎フレーム呼ばれるので、setHtml で中身が変わったときだけ書き換える
    const allyLabel = this.elTop.querySelector('.td-base.ally .td-base-label')!;
    const enemyLabel = this.elTop.querySelector('.td-base.enemy .td-base-label')!;
    const waveEl = this.elTop.querySelector('.td-wave')!;
    if (td.duel) {
      // 対戦: 城の名前を「あなた／相手」にし、制限時間の残りを出す（観戦は「青／赤」）。城の旗は陣営の色
      const watching = this.spectating;
      const allyCastle = vx(watching || td.team === 0 ? 'castle' : 'castleRed');
      const enemyCastle = vx(watching || td.team === 0 ? 'castleRed' : 'castle');
      setHtml(allyLabel, watching ? `${allyCastle} 青の城（ホスト）` : `${allyCastle} あなたの城（${td.team === 0 ? '青' : '赤'}）`);
      setHtml(enemyLabel, watching ? `赤の城（ゲスト） ${enemyCastle}` : `相手の城（${td.team === 0 ? '赤' : '青'}） ${enemyCastle}`);
      setHtml(waveEl, watching ? `${vx('eye')} 観戦中` : `${vx('swords')} 対戦`);
      const left = Math.max(0, TD_DUEL_TIME_LIMIT - td.time);
      timeEl.textContent = formatTime(left);
      timeEl.classList.toggle('over', left <= 60);
    } else {
      setHtml(allyLabel, `${vx('castle')} 自軍の城`);
      setHtml(enemyLabel, `敵軍の城 ${vx('castleRed')}`);
      setHtml(waveEl, over ? '最終決戦' : `WAVE ${td.wave} / ${TD_WAVE_COUNT}`);
      timeEl.textContent = over ? `+${formatTime(td.time - TD_DURATION_SECONDS)}` : formatTime(TD_DURATION_SECONDS - td.time);
      timeEl.classList.toggle('over', over);
    }
    const terrainEl = this.elTop.querySelector<HTMLElement>('.td-terrain')!;
    const biome = td.terrainBiome ? BIOMES[td.terrainBiome] : null;
    if (biome) {
      const trait = td.terrainTrait ? TRAITS[td.terrainTrait] : null;
      const next = Math.max(0, (td.terrainIndex + 1) * TD_TERRAIN_SECONDS - td.time);
      const label = `${vx(biome.icon)}${biome.name}${trait ? `・${trait.name}` : ''}`;
      setHtml(terrainEl, over ? label : `${label} ｜ 変化まで ${formatTime(next)}`);
      terrainEl.title = `${biome.rule}${trait ? `／${trait.effect}` : ''}`;
      terrainEl.classList.toggle('soon', !over && next <= 10);
    } else setHtml(terrainEl, '');
    const tools = this.root.querySelector('.td-tools')!;
    tools.querySelector('[data-td="auto"]')!.classList.toggle('active', td.autoDeploy);
    const stanceEl = this.root.querySelector<HTMLElement>('.td-stance')!;
    stanceEl.classList.toggle('hidden', !td.duel || this.spectating);
    if (td.duel) {
      const left = Math.ceil(td.stanceLockLeft);
      for (const mode of ['castle', 'enemy'] as const) {
        const btn = stanceEl.querySelector<HTMLButtonElement>(`[data-td="stance-${mode}"]`)!;
        const current = td.stance === mode;
        btn.classList.toggle('active', current);
        // 切り替え先のボタンにだけ、ロックの残り秒数を大きく出す
        btn.disabled = current || left > 0;
        btn.querySelector('.td-stance-lock')!.textContent = !current && left > 0 ? String(left) : '';
      }
    }
    tools.querySelector('[data-td="pause"]')!.classList.toggle('active', this.host.isPaused());
  }

  // ---- 経験値バーとレベルアップ ----

  private updateXp(td: TDRun, realDt: number): void {
    // 実際の経験値は倒した瞬間に入っている。飛んでいる途中のオーブのぶんを引いて表示する
    const total = Math.max(0, td.totalXp - this.host.getPendingXp());
    if (total > this.shownTotal + 1e-6) {
      this.gainTimer = 0.18;
      this.elSide.querySelector('.td-xp')!.classList.add('gain');
    }
    this.shownTotal = total;
    if (this.gainTimer > 0) {
      this.gainTimer -= realDt;
      if (this.gainTimer <= 0) this.elSide.querySelector('.td-xp')!.classList.remove('gain');
    }
    const { level, xp } = levelForTotalXp(total);
    if (level > this.shownLevel) {
      this.shownLevel = level;
      if (!this.spectating) this.playLevelUpFx(level);
    }
    this.elSide.querySelector('.td-lv b')!.textContent = String(level);
    const need = xpForLevel(level);
    this.elSide.querySelector<HTMLElement>('.td-xp-bar i')!.style.width = `${Math.min(1, xp / need) * 100}%`;
    this.elSide.querySelector('.td-xp-num')!.textContent = `${Math.floor(xp)} / ${need}`;
    if (this.levelUpTimer > 0) {
      this.levelUpTimer -= realDt;
      if (this.levelUpTimer <= 0) {
        this.elLevelUp.classList.add('hidden');
        this.elLevelUp.innerHTML = '';
      }
    }
  }

  /** ボクセル調のレベルアップ演出 */
  private playLevelUpFx(level: number): void {
    this.host.playLevelUp();
    const letters = [...'LEVEL UP!']
      .map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`)
      .join('');
    const cubes = Array.from({ length: LEVELUP_CUBES }, (_, i) => {
      const a = (i / LEVELUP_CUBES) * Math.PI * 2 + Math.random() * 0.3;
      const d = 140 + Math.random() * 120;
      const size = 10 + Math.floor(Math.random() * 3) * 6;
      const hue = ['#9dff6a', '#f5c451', '#7db4ff', '#ffffff'][i % 4];
      return `<i style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d * 0.7)}px;--s:${size}px;--c:${hue};--r:${Math.round(Math.random() * 540 - 270)}deg"></i>`;
    }).join('');
    this.elLevelUp.innerHTML = `
      <div class="td-lu-burst">${cubes}</div>
      <div class="td-lu-text">${letters}</div>
      <div class="td-lu-lv">Lv ${level - 1} ${vx('arrowR')} <b>${level}</b></div>`;
    // 続けてレベルが上がったときも演出を最初から流す
    this.elLevelUp.classList.add('hidden');
    void this.elLevelUp.offsetWidth;
    this.elLevelUp.classList.remove('hidden');
    this.levelUpTimer = LEVELUP_FX_TIME;
    const xpEl = this.elSide.querySelector<HTMLElement>('.td-xp')!;
    xpEl.classList.remove('lvup');
    void xpEl.offsetWidth;
    xpEl.classList.add('lvup');
  }

  // ---- 左上の強化（収入強化・城強化）とレリック ----

  private updateSide(td: TDRun): void {
    const money = this.elSide.querySelector<HTMLElement>('.td-money')!;
    money.querySelector('small')!.textContent = `/${td.fundCap.toLocaleString()}  +${td.fundIncome}/秒`;
    money.classList.toggle('full', td.money >= td.fundCap);

    const can = (price: number | null) => price !== null && td.money >= price;
    const base = td.playerBase;
    const chests = td.ended ? 0 : this.host.getChestCount();
    const upsKey = [can(td.fundPrice), can(td.basePrice), td.fundLevel, td.baseLevel, !!base?.alive, chests].join('/');
    if (upsKey !== this.upsKey) {
      this.upsKey = upsKey;
      const tile = (
        buy: string,
        icon: string,
        name: string,
        lv: number,
        price: number | null,
        info: string,
        enabled: boolean,
      ) => `<button type="button" class="td-up" data-buy="${buy}" title="${esc(info)}" ${enabled ? '' : 'disabled'}>
          <span class="td-up-icon">${icon}</span>
          <span class="td-up-lv">Lv${lv}</span>
          <span class="td-up-name">${name}</span>
          <span class="td-up-price">${price === null ? 'MAX' : `${price.toLocaleString()}G`}</span>
        </button>`;
      this.elUps.innerHTML =
        tile(
          'fund',
          GOLD_VOXEL,
          '収入強化',
          td.fundLevel,
          td.fundPrice,
          `収入強化 Lv${td.fundLevel}：毎秒 +${td.fundIncome}G・上限 ${td.fundCap.toLocaleString()}G。上げると収入と上限が増える`,
          can(td.fundPrice),
        ) +
        tile(
          'base',
          relicVoxel('hq'),
          '城強化',
          td.baseLevel,
          td.basePrice,
          `城強化 Lv${td.baseLevel}：最大HP ${Math.round(base?.maxHp ?? 0).toLocaleString()}・自動回復 ${td.baseRegen}/秒${td.duel ? '' : `・砲台 ${td.playerCannons.length}基`}。上げると最大HPと自動回復が増え${td.duel ? '' : '、城に砲台が1基増える'}`,
          can(td.basePrice) && !!base?.alive,
        ) +
        // 対戦で開けられる宝箱があれば、城強化の横に宝箱ボタンを出す（戦場の宝箱を押さなくても開けられる）
        (chests > 0
          ? `<button type="button" class="td-up td-chest-btn fx-wobble" data-buy="chest" title="宝箱を開ける（古い順。戦場の宝箱を押しても開けられる）">
              <span class="td-up-icon">${pixelArt('chest', 'td-px')}</span>
              <span class="td-up-lv">×${chests}</span>
              <span class="td-up-name">宝箱</span>
              <span class="td-up-price">OPEN!</span>
            </button>`
          : '');
      this.bindPreviews();
    }
    if (chests > this.shownChests) {
      retrigger(this.elUps.querySelector<HTMLElement>('.td-chest-btn'), 'fx-pop');
      this.host.emitFx('reward', 2);
    }
    this.shownChests = chests;

    const relicsKey = td.run.relics.map((r) => `${r.id}${r.level}`).join(',');
    if (relicsKey !== this.relicsKey) {
      this.relicsKey = relicsKey;
      this.elRelics.innerHTML = td.run.relics
        .map((r) => {
          const info = `${relicDisplayName(r)}：${relicDescription(r)}`;
          return `<span class="td-relic" title="${esc(info)}">${relicVoxel(r.id)}<b>${r.level + 1}</b></span>`;
        })
        .join('');
      this.bindPreviews();
    }
  }

  // ---- 出撃バー ----

  private renderBar(td: TDRun): void {
    this.cardEls.clear();
    this.elBar.innerHTML = td.run.cards
      .map((c, i) => {
        const t = UNIT_TYPES[c.id];
        const key = i < 10 ? `<span class="td-card-key">${(i + 1) % 10}</span>` : '';
        return `<button type="button" class="td-card slot${getUnitSlotCost(c.id)}" data-deploy="${c.id}" title="${esc(t.name)}${i < 10 ? `（${(i + 1) % 10} キー）` : ''}">
          <span class="td-card-icon">${unitVoxel(c.id)}</span>
          <span class="td-card-name">${esc(t.name)}</span>
          <span class="td-card-cost">${getDeployCost(c.id, td.duel)}G<small> ×${getSquadSize(c.id)}</small></span>
          ${key}
          <span class="td-card-cd"></span>
          <span class="td-card-state"></span>
        </button>`;
      })
      .join('');
    if (td.run.cards.length === 0) {
      this.elBar.innerHTML = '<div class="td-bar-empty">出撃できるユニットがいません</div>';
    }
    this.elBar.querySelectorAll<HTMLElement>('[data-deploy]').forEach((el) => {
      this.cardEls.set(el.dataset.deploy as UnitTypeId, el);
    });
    this.bindPreviews();
  }

  private updateBar(td: TDRun): void {
    for (const [id, el] of this.cardEls) {
      const block = td.deployBlock(this.host.battle, id);
      const cd = td.cooldowns.get(id) ?? 0;
      const total = getDeployCooldown(id);
      el.classList.toggle('ready', block === null);
      el.classList.toggle('blocked', block !== null);
      // 資金不足: たまるまでの円形ゲージ
      const saving = block === 'money';
      el.classList.toggle('fx-saving', saving);
      if (saving) el.style.setProperty('--fx-fill', String(Math.min(1, td.money / Math.max(1, getDeployCost(id, td.duel)))));
      // 出せるようになった瞬間に光って小さく跳ねる（「今出せる」が分かる）
      if (block === null && this.blockedCards.has(id)) {
        this.blockedCards.delete(id);
        retrigger(el, 'fx-ready');
        if (!this.spectating && !td.ended) this.host.playFxSound('ready', 0);
      } else if (block === 'money' || block === 'cooldown') this.blockedCards.add(id);
      else if (block !== null) this.blockedCards.delete(id);
      const cdEl = el.querySelector<HTMLElement>('.td-card-cd')!;
      cdEl.style.height = `${cd > 0 ? (cd / total) * 100 : 0}%`;
      const state = el.querySelector<HTMLElement>('.td-card-state')!;
      state.textContent = block === 'cooldown' ? `${cd.toFixed(1)}s` : block ? BLOCK_LABELS[block] : '';
    }
  }

  // ---- 強化の選択（画面中央。選んでいる間は時間が止まる） ----

  /** オーブが届いて見えている、まだ使っていない選択権の数 */
  private revealedChoices(td: TDRun): number {
    // 対戦で送ったがまだ反映されていない選択は、使ったものとして数える
    return td.choices - td.pendingChoices - Math.max(0, td.level - this.shownLevel);
  }

  private updateChoice(td: TDRun): void {
    const revealed = td.ended || this.spectating ? 0 : this.revealedChoices(td);
    if (!this.choiceOpen) {
      // レベルアップ演出を少し見せてから出す
      if (revealed > 0 && this.levelUpTimer <= LEVELUP_FX_TIME - CHOICE_DELAY && this.elModal.classList.contains('hidden')) {
        this.openChoice();
      }
      return;
    }
    if (revealed <= 0) {
      this.closeChoice();
      return;
    }
    this.renderChoice(td);
  }

  private openChoice(): void {
    this.choiceOpen = true;
    this.choiceKey = '';
    this.elChoice.classList.remove('hidden');
    this.host.setHold(true);
    const td = this.host.getRun();
    if (td) this.renderChoice(td);
  }

  closeChoice(): void {
    if (!this.choiceOpen) return;
    this.choiceOpen = false;
    this.elChoice.classList.add('hidden');
    this.elChoice.innerHTML = '';
    this.host.setHold(this.isTutorialOpen);
    this.bindPreviews();
  }

  private renderChoice(td: TDRun): void {
    const options = td.currentOptions();
    if (!options) return;
    const revealed = this.revealedChoices(td);
    const price = td.rerollPrice;
    const waiting = td.pendingChoices + td.pendingRerolls > 0;
    const key = [options.map((o) => o.title).join('|'), revealed, price, td.money >= price, td.run.rerollsLeft, waiting].join('/');
    if (key === this.choiceKey) return;
    this.choiceKey = key;
    const cards = options
      .map((o, i) => {
        const icon = o.unitId
          ? unitVoxel(o.unitId)
          : o.relicId
            ? relicVoxel(o.relicId)
            : o.kind === 'gold'
              ? GOLD_VOXEL
              : `<span class="td-emoji">${vx('plus')}</span>`;
        return `<button type="button" class="td-choice-card ${o.rarity}" data-choose="${i}" ${waiting ? 'disabled' : ''}>
          <span class="td-choice-key">${i + 1}</span>
          <span class="td-choice-rarity">${RARITY_LABELS[o.rarity]}</span>
          <span class="td-choice-icon">${icon}</span>
          <b>${esc(o.title)}</b>
          <small>${esc(this.optionDescription(o, td.duel))}</small>
        </button>`;
      })
      .join('');
    this.elChoice.innerHTML = `<div class="td-choice-inner">
        <h2>LEVEL UP! <small>強化を1つ選ぶ${revealed > 1 ? `（あと${revealed}回）` : ''}</small></h2>
        <div class="td-choice-cards">${cards}</div>
        <div class="td-choice-foot">
          <button type="button" class="td-btn" data-td="reroll" ${td.money < price || waiting ? 'disabled' : ''}>${vx('refresh')} 引き直す（${price === 0 ? `無料 残り${td.run.rerollsLeft}` : `${price}G`}）</button>
          <small>${td.duel ? '対戦中は選んでいる間も時間が進みます' : '選んでいる間は時間が止まります'}</small>
        </div>
      </div>`;
    this.bindPreviews();
  }

  private optionDescription(o: RewardOption, duel: boolean): string {
    if (o.unitId) {
      const t = UNIT_TYPES[o.unitId];
      const only = o.rarity === 'super_legend' ? '（スーパーレジェンドの兵種は1種類まで）' : '';
      return `出撃 ${getDeployCost(o.unitId, duel)}G${only}・×${getSquadSize(o.unitId)}人・待機 ${getDeployCooldown(o.unitId)}秒。${t.description ?? ''}`.trim();
    }
    return o.description;
  }

  /** 強化の n 番目（0始まり）を選ぶ（数字キー） */
  chooseIndex(n: number): void {
    const td = this.host.getRun();
    if (!td || !this.choiceOpen) return;
    this.applyChoice(td, n);
  }

  private applyChoice(td: TDRun, index: number): void {
    const option = td.requestChoose(this.host.battle, index);
    if (!option) {
      this.host.playDenied();
      return;
    }
    this.host.playClick();
    this.choiceKey = '';
    if (this.revealedChoices(td) <= 0) this.closeChoice();
    else this.renderChoice(td);
  }

  // ---- 操作 ----

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('button');
    if (!el || el.hasAttribute('disabled')) return;
    const td = this.host.getRun();
    const d = el.dataset;
    if (d.starter !== undefined) {
      const starter = ROGUE_STARTERS.find((s) => s.id === d.starter);
      if (starter) this.host.startRun(starter);
      return;
    }
    if (d.td === 'tut-next') return this.stepTutorial(1);
    if (d.td === 'tut-prev') return this.stepTutorial(-1);
    if (d.td === 'tut-skip') return this.closeTutorial(true);
    if (d.td === 'howto') {
      this.host.playClick();
      this.showTutorial();
      return;
    }
    if (d.tutPage !== undefined) {
      this.tutorialPage = Number(d.tutPage);
      this.renderTutorial();
      return;
    }
    if (d.td === 'title') return this.host.toTitle();
    if (d.td === 'retry') return this.host.retry();
    // オンライン対戦のロビー
    if (d.vsStarter !== undefined) {
      this.host.playClick();
      this.host.vsReady(d.vsStarter);
      return;
    }
    if (d.vsRoom !== undefined) {
      this.host.playClick();
      this.host.vsJoin(d.vsRoom, 'join');
      return;
    }
    if (d.vsWatch !== undefined) {
      this.host.playClick();
      this.host.vsWatch(d.vsWatch);
      return;
    }
    switch (d.td) {
      case 'vs-create': {
        const input = this.elModal.querySelector<HTMLInputElement>('.td-vs-room');
        if (input) this.vsRoomDraft = input.value;
        this.host.playClick();
        return this.host.vsJoin(this.vsRoomDraft, 'create');
      }
      case 'vs-refresh':
        this.host.playClick();
        return this.host.vsRefreshRooms();
      case 'vs-unready':
        return this.host.vsUnready();
      case 'vs-leave':
        return this.host.vsLeave();
      case 'vs-lobby':
        return this.host.vsLobby();
      case 'vs-back':
        return this.host.vsBack();
    }
    if (!td) return;
    // 観戦では、やめるボタンとカメラ以外は操作できない
    if (this.spectating && d.td !== 'retire' && d.td !== 'settings') return;
    if (d.deploy) {
      this.tryDeploy(d.deploy as UnitTypeId);
      return;
    }
    if (d.choose !== undefined) {
      this.applyChoice(td, Number(d.choose));
      return;
    }
    switch (d.td) {
      case 'stance-castle':
      case 'stance-enemy':
        if (td.requestStance(d.td === 'stance-castle' ? 'castle' : 'enemy')) this.host.playClick();
        return;
      case 'auto':
        td.requestAuto(!td.autoDeploy);
        this.host.playClick();
        return;
      case 'pause':
        this.host.togglePause();
        return;
      case 'settings':
        this.host.openSettings();
        return;
      case 'retire':
        this.host.retire();
        return;
      case 'reroll':
        if (td.requestReroll()) this.host.playClick();
        else this.host.playDenied();
        this.choiceKey = '';
        this.renderChoice(td);
        return;
    }
    if (d.buy === 'chest') {
      if (!this.host.openNextChest()) this.host.playDenied();
      this.upsKey = '';
      return;
    }
    let ok: boolean | undefined;
    if (d.buy === 'fund') ok = td.requestFund();
    else if (d.buy === 'base') ok = td.requestBase();
    if (ok === undefined) return;
    if (ok) {
      this.host.playClick();
      if (d.buy === 'fund') this.previews.kick('gold');
      else this.previews.kick('relic:hq');
    } else this.host.playDenied();
    this.upsKey = '';
  }

  /** 出撃（カードのクリックと数字キー） */
  tryDeploy(id: UnitTypeId): void {
    const td = this.host.getRun();
    if (!td || this.spectating) return;
    const ok = td.requestDeploy(this.host.battle, id);
    const el = this.cardEls.get(id);
    if (ok) {
      // 連続出撃では演出を軽くし、音程を少しずつ変えて単調にしない
      this.deployStreak = Math.min(DEPLOY_STREAK_MAX, this.deployStreak + 1);
      this.deployStreakTimer = DEPLOY_STREAK_WINDOW;
      const pitch = 1 + (this.deployStreak - 1) * DEPLOY_STREAK_PITCH;
      this.host.playFxSound('deploy', 0, pitch);
      if (this.deployStreak <= 2) this.host.emitFx('deploy', 0);
      retrigger(el, 'pop');
      // カードから資金表示へ「-120G」が飛ぶ
      const from = FloatText.centerOf(el);
      const to = FloatText.centerOf(this.elSide.querySelector('.td-money b'));
      if (from && to) this.floatText.spawn(`-${getDeployCost(id, td.duel).toLocaleString()}G`, from, 'loss', to);
    } else {
      this.host.playDenied();
      retrigger(el, 'shake');
      // 資金不足なら、何が足りないかを資金表示で示す
      if (td.deployBlock(this.host.battle, id) === 'money') retrigger(this.elSide.querySelector<HTMLElement>('.td-money'), 'fx-deny');
    }
  }

  /** 出撃バーの n 番目（0始まり）を出撃させる */
  deployIndex(n: number): void {
    const td = this.host.getRun();
    const card = td?.run.cards[n];
    if (card) this.tryDeploy(card.id);
  }

  /** 宝箱の中身を短く知らせる */
  showChestRewards(rewards: readonly JackpotReward[]): void {
    if (rewards.length === 0) return;
    this.announce('宝箱ゲット!!', 'chest', 1, `${vx('gift')} ${rewards.map((r) => `${vx(r.icon)}${r.name}`).join(' ')}`);
  }

  // ---- モーダル（スターター選択・リザルト） ----

  showStarterSelect(): void {
    const cards = ROGUE_STARTERS.map(
      (st) => `<button type="button" class="td-starter" data-starter="${st.id}">
        <b>${esc(st.name)}</b>
        <span class="td-starter-units">${st.units.map((id) => `<span class="td-mini">${getUnitIconSvg(id)}</span>`).join('')}</span>
        <small>${st.units.map((id) => UNIT_TYPES[id].name).join('・')}</small>
      </button>`,
    ).join('');
    this.showModal(`
      <h2>${vx('castle')} タワーディフェンス</h2>
      <p class="td-lead">10分以内に敵の城を破壊せよ！ 敵を倒して経験値をため、自軍を強化しよう。敵の城を攻撃すると反撃を食らうので、攻めるタイミングに注意。</p>
      <h3>スターターを選ぶ</h3>
      <div class="td-starters">${cards}</div>
      <div class="td-modal-actions">
        <button type="button" class="td-btn" data-td="howto">${vx('question')} あそびかた</button>
        <button type="button" class="td-btn" data-td="title">${vx('home')} タイトルへ</button>
      </div>
    `);
  }

  /** オンライン対戦のロビー（部屋名の入力・部屋での待機）。部屋の状態が変わるたびに呼ぶ */
  showVersusLobby(vs: TDVersusSession): void {
    const focused = document.activeElement?.classList.contains('td-vs-room') ?? false;
    this.showModal(renderVersusLobby(vs, this.vsRoomDraft));
    this.bindPreviews();
    const input = this.elModal.querySelector<HTMLInputElement>('.td-vs-room');
    if (input && (focused || vs.phase === 'idle')) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  /** 募集中の部屋の一覧だけを描き直す（入力中の部屋名は消さない） */
  updateVersusRooms(rooms: readonly TDVersusRoomListing[] | null, error: string | null): void {
    const el = this.elModal.querySelector<HTMLElement>('.td-vs-rooms');
    if (el) el.innerHTML = renderVersusRoomList(rooms, error);
  }

  /** 観戦した対戦のリザルト */
  showVersusWatchResult(blue: TDRun, red: TDRun, winner: number | null, reason: TDVersusEndReason): void {
    this.closeChoice();
    this.showModal(renderVersusWatchResult(blue, red, winner, reason));
    this.playResultFx();
  }

  /** オンライン対戦のリザルト */
  showVersusResult(mine: TDRun, opponent: TDRun, verdict: TDVersusVerdict, reason: TDVersusEndReason, vs: TDVersusSession): void {
    this.closeChoice();
    this.showModal(renderVersusResult(mine, opponent, verdict, reason, vs));
    this.playResultFx();
  }

  /**
   * リザルトの演出: 戦績を 1 行ずつ出し、数字をカウントアップし、見出しを slam で出す。
   * クリックで演出を飛ばせる。出た直後は誤タップ防止でボタンを押せない
   */
  private playResultFx(): void {
    const m = this.elModal;
    m.classList.remove('fx-skip');
    const rows = [...m.querySelectorAll<HTMLElement>('.td-result-grid > div')];
    stagger(rows, 0.12, 0.35);
    const stops = rows.map((row, i) => {
      const b = row.querySelector<HTMLElement>('b');
      return b ? countUpText(b, 0.7, 0.35 + i * 0.12) : () => undefined;
    });
    retrigger(m.querySelector<HTMLElement>('h2'), 'fx-slam');
    const lead = m.querySelector<HTMLElement>('.td-lead');
    if (lead) stagger([lead], 0, 0.35 + rows.length * 0.12);
    m.classList.add('fx-guard');
    window.setTimeout(() => m.classList.remove('fx-guard'), RESULT_GUARD_SECONDS * 1000);
    const skip = () => {
      m.classList.add('fx-skip');
      for (const stop of stops) stop();
    };
    m.addEventListener('pointerdown', skip, { once: true });
  }

  showResult(td: TDRun, won: boolean): void {
    const time = formatTime(td.time);
    this.closeChoice();
    this.showModal(`
      <h2 class="${won ? 'win' : 'lose'}">${won ? `${vx('trophy')} 敵軍の城を破壊！` : `${vx('boom')} 城が陥落…`}</h2>
      <div class="td-result-grid">
        <div><small>経過時間</small><b>${time}</b></div>
        <div><small>到達 WAVE</small><b>${td.wave}</b></div>
        <div><small>撃破数</small><b>${td.kills}</b></div>
        <div><small>到達レベル</small><b>${td.level}</b></div>
        <div><small>敵の城へのダメージ</small><b>${Math.round(td.baseDamage).toLocaleString()}</b></div>
        <div><small>反撃を受けた回数</small><b>${td.counters}</b></div>
      </div>
      <div class="td-modal-actions">
        <button type="button" class="td-btn primary" data-td="retry">${vx('refresh')} もう一度</button>
        <button type="button" class="td-btn" data-td="title">${vx('home')} タイトルへ</button>
      </div>
    `);
  }

  // ---- あそびかた（簡易チュートリアル） ----

  get isTutorialOpen(): boolean {
    return this.tutorialPage >= 0;
  }

  /** あそびかたを最初のページから見せる。戦闘中は見ている間止める。onClose は閉じたとき（スキップ含む）に呼ぶ */
  showTutorial(onClose?: () => void): void {
    this.tutorialOnClose = onClose ?? null;
    this.tutorialPage = 0;
    this.host.setHold(true);
    this.elTutorial.classList.remove('hidden');
    this.renderTutorial();
  }

  /** あそびかたを開いている間のキー操作。扱ったら true */
  handleTutorialKey(code: string): boolean {
    if (!this.isTutorialOpen) return false;
    if (code === 'Enter' || code === 'Space' || code === 'ArrowRight') this.stepTutorial(1);
    else if (code === 'ArrowLeft') this.stepTutorial(-1);
    else if (code === 'Escape') this.closeTutorial(true);
    return true;
  }

  private stepTutorial(delta: number): void {
    const next = this.tutorialPage + delta;
    if (next >= TD_TUTORIAL_PAGES.length) {
      this.closeTutorial(true);
      return;
    }
    this.tutorialPage = Math.max(0, next);
    this.host.playClick();
    this.renderTutorial();
  }

  private renderTutorial(): void {
    const index = this.tutorialPage;
    const page = TD_TUTORIAL_PAGES[index];
    if (!page) return;
    const last = index === TD_TUTORIAL_PAGES.length - 1;
    const model = page.model === 'gold' ? GOLD_VOXEL : relicVoxel(page.model.slice('relic:'.length) as FacilityTypeId);
    const dots = TD_TUTORIAL_PAGES.map(
      (_, i) =>
        `<button type="button" class="td-tut-dot${i === index ? ' on' : ''}" data-tut-page="${i}" aria-label="${i + 1}ページ目"></button>`,
    ).join('');
    const prev = index > 0 ? `<button type="button" class="td-btn" data-td="tut-prev">${vx('arrowL')} もどる</button>` : '';
    this.elTutorial.innerHTML = `
      <div class="td-tut-card" style="--tut-color: ${page.color}">
        <div class="td-tut-cubes" aria-hidden="true">${'<i></i>'.repeat(6)}</div>
        <div class="td-tut-head">
          <span class="td-tut-tag">${esc(page.tag)}</span>
          <span class="td-tut-count">${index + 1} / ${TD_TUTORIAL_PAGES.length}</span>
        </div>
        <div class="td-tut-model">${model}</div>
        <h2 class="td-tut-title"></h2>
        <ul class="td-tut-lines">${page.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="td-tut-dots">${dots}</div>
        <div class="td-tut-actions">
          <button type="button" class="td-btn td-tut-skip" data-td="tut-skip">スキップ ${vx('ffwd2')}</button>
          <span class="td-tut-spacer"></span>
          ${prev}
          <button type="button" class="td-btn primary td-tut-next" data-td="tut-next">${last ? `たたかう！ ${vx('swords')}` : `つぎへ ${vx('arrowR')}`}</button>
        </div>
      </div>
    `;
    const title = this.elTutorial.querySelector<HTMLElement>('.td-tut-title')!;
    setVoxelText(title, page.title, TUTORIAL_TITLE_VOXEL);
    this.bindPreviews();
    this.previews.kick(page.model);
  }

  /** あそびかたを閉じる。notify なら閉じたことを知らせる（スキップも含む） */
  closeTutorial(notify: boolean): void {
    if (!this.isTutorialOpen) return;
    this.tutorialPage = -1;
    this.elTutorial.classList.add('hidden');
    this.elTutorial.innerHTML = '';
    this.host.setHold(this.choiceOpen);
    this.bindPreviews();
    const done = this.tutorialOnClose;
    this.tutorialOnClose = null;
    if (notify) {
      this.host.playClick();
      done?.();
    }
  }

  private showModal(html: string): void {
    this.elModal.innerHTML = `<div class="td-modal-inner">${html}</div>`;
    this.elModal.classList.remove('hidden');
  }

  hideModal(): void {
    this.elModal.classList.add('hidden');
    this.elModal.innerHTML = '';
  }
}
