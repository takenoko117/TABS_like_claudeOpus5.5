import type { Battle } from '../game/Battle';
import {
  getDeployCooldown,
  getDeployCost,
  levelForTotalXp,
  TD_DURATION_SECONDS,
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
import type { JackpotReward } from '../game/RogueJackpot';
import { UnitPreviews } from '../render/UnitPreviews';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { getFacilityIconSvg, getUnitIconSvg } from './UnitIcons';

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
}

const BLOCK_LABELS: Record<DeployBlock, string> = {
  cooldown: '待機中',
  money: 'お金不足',
  full: '満員',
  not_owned: '未所持',
  ended: '終了',
};

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

const GOLD_VOXEL = propVoxel('gold', '<span class="td-emoji">💰</span>');

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

  constructor(private readonly host: TDHudHost) {
    this.root = document.createElement('div');
    this.root.id = 'td-hud';
    this.root.className = 'td-hud hidden';
    this.root.innerHTML = `
      <div class="td-top"></div>
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
        <button type="button" class="td-btn" data-td="pause" title="一時停止 (P)">⏸</button>
        <button type="button" class="td-btn" data-td="settings" title="設定（開いている間は止まる）">⚙</button>
        <button type="button" class="td-btn" data-td="retire" title="リタイアしてタイトルへ">🏳</button>
      </div>
      <div class="td-announce hidden"></div>
      <div class="td-levelup hidden" aria-hidden="true"></div>
      <div class="td-choice hidden" role="dialog" aria-label="強化を選ぶ"></div>
      <div class="td-bar"></div>
      <div class="td-modal hidden"></div>
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
    this.renderTop();
    this.root.addEventListener('click', (e) => this.onClick(e));
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
    this.root.classList.toggle('td-running', this.host.getRun() !== null);
    this.bindPreviews();
  }

  // ---- 毎フレームの更新 ----

  update(realDt: number): void {
    const td = this.host.getRun();
    if (!td) return;
    this.consumeEvents(td);
    if (this.announceTimer > 0) {
      this.announceTimer -= realDt;
      if (this.announceTimer <= 0) this.elAnnounce.classList.add('hidden');
    }
    this.updateTop(td);
    this.updateXp(td, realDt);
    this.updateSide(td);
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
    if (events.length === 0) return;
    // 同じフレームに重なったら最も重要なものだけを出す
    const order = ['boss', 'counter', 'elite', 'wave'] as const;
    const top = [...events].sort(
      (a, b) => order.indexOf(a.kind as (typeof order)[number]) - order.indexOf(b.kind as (typeof order)[number]),
    )[0];
    switch (top.kind) {
      case 'boss':
        this.announce('👹 最終ボス出現', 'boss');
        break;
      case 'counter':
        this.announce(`🔥 敵基地の反撃！（${top.value * 10}%）`, 'counter');
        break;
      case 'elite':
        this.announce(`😈 WAVE ${top.value} エリート出現`, 'elite');
        break;
      case 'wave':
        this.announce(`WAVE ${top.value}`, 'wave');
        break;
    }
  }

  announce(text: string, kind: string): void {
    this.elAnnounce.textContent = text;
    this.elAnnounce.className = `td-announce ${kind}`;
    this.announceTimer = 2.2;
  }

  private renderTop(): void {
    this.elTop.innerHTML = `
      <div class="td-base ally"><span class="td-base-label">🏰 自軍の城</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
      <div class="td-clock">
        <div class="td-wave"></div>
        <div class="td-time"></div>
      </div>
      <div class="td-base enemy"><span class="td-base-label">敵軍の城 🏯</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
    `;
  }

  private updateTop(td: TDRun): void {
    const setBase = (sel: string, hp: number, max: number) => {
      const el = this.elTop.querySelector<HTMLElement>(sel)!;
      const ratio = max > 0 ? Math.max(0, hp) / max : 0;
      el.querySelector<HTMLElement>('.td-hp i')!.style.width = `${ratio * 100}%`;
      el.querySelector<HTMLElement>('.td-hp-num')!.textContent = `${Math.ceil(Math.max(0, hp)).toLocaleString()}`;
      el.classList.toggle('danger', ratio < 0.3);
    };
    if (td.playerBase) setBase('.td-base.ally', td.playerBase.hp, td.playerBase.maxHp);
    if (td.enemyBase) setBase('.td-base.enemy', td.enemyBase.hp, td.enemyBase.maxHp);
    const over = td.time >= TD_DURATION_SECONDS;
    this.elTop.querySelector('.td-wave')!.textContent = over ? '最終決戦' : `WAVE ${td.wave} / ${TD_WAVE_COUNT}`;
    const timeEl = this.elTop.querySelector<HTMLElement>('.td-time')!;
    timeEl.textContent = over ? `+${formatTime(td.time - TD_DURATION_SECONDS)}` : formatTime(TD_DURATION_SECONDS - td.time);
    timeEl.classList.toggle('over', over);
    const tools = this.root.querySelector('.td-tools')!;
    tools.querySelector('[data-td="auto"]')!.classList.toggle('active', td.autoDeploy);
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
      this.playLevelUpFx(level);
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
      <div class="td-lu-lv">Lv ${level - 1} ▶ <b>${level}</b></div>`;
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
    money.querySelector('b')!.textContent = td.money.toLocaleString();
    money.querySelector('small')!.textContent = `/${td.fundCap.toLocaleString()}  +${td.fundIncome}/秒`;
    money.classList.toggle('full', td.money >= td.fundCap);

    const can = (price: number | null) => price !== null && td.money >= price;
    const base = td.playerBase;
    const upsKey = [can(td.fundPrice), can(td.basePrice), td.fundLevel, td.baseLevel, !!base?.alive].join('/');
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
          `城強化 Lv${td.baseLevel}：最大HP ${Math.round(base?.maxHp ?? 0).toLocaleString()}・自動回復 ${td.baseRegen}/秒・砲台 ${td.playerCannons.length}基。上げると最大HPと自動回復が増え、城に砲台が1基増える`,
          can(td.basePrice) && !!base?.alive,
        );
      this.bindPreviews();
    }

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
          <span class="td-card-cost">${getDeployCost(c.id)}G<small> ×${getSquadSize(c.id)}</small></span>
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
      const cdEl = el.querySelector<HTMLElement>('.td-card-cd')!;
      cdEl.style.height = `${cd > 0 ? (cd / total) * 100 : 0}%`;
      const state = el.querySelector<HTMLElement>('.td-card-state')!;
      state.textContent = block === 'cooldown' ? `${cd.toFixed(1)}s` : block ? BLOCK_LABELS[block] : '';
    }
  }

  // ---- 強化の選択（画面中央。選んでいる間は時間が止まる） ----

  /** オーブが届いて見えている、まだ使っていない選択権の数 */
  private revealedChoices(td: TDRun): number {
    return td.choices - Math.max(0, td.level - this.shownLevel);
  }

  private updateChoice(td: TDRun): void {
    const revealed = td.ended ? 0 : this.revealedChoices(td);
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
    this.host.setHold(false);
    this.bindPreviews();
  }

  private renderChoice(td: TDRun): void {
    const options = td.currentOptions();
    if (!options) return;
    const revealed = this.revealedChoices(td);
    const price = td.rerollPrice;
    const key = [options.map((o) => o.title).join('|'), revealed, price, td.money >= price, td.run.rerollsLeft].join('/');
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
              : '<span class="td-emoji">➕</span>';
        return `<button type="button" class="td-choice-card ${o.rarity}" data-choose="${i}">
          <span class="td-choice-key">${i + 1}</span>
          <span class="td-choice-rarity">${RARITY_LABELS[o.rarity]}</span>
          <span class="td-choice-icon">${icon}</span>
          <b>${esc(o.title)}</b>
          <small>${esc(this.optionDescription(o))}</small>
        </button>`;
      })
      .join('');
    this.elChoice.innerHTML = `<div class="td-choice-inner">
        <h2>LEVEL UP! <small>強化を1つ選ぶ${revealed > 1 ? `（あと${revealed}回）` : ''}</small></h2>
        <div class="td-choice-cards">${cards}</div>
        <div class="td-choice-foot">
          <button type="button" class="td-btn" data-td="reroll" ${td.money < price ? 'disabled' : ''}>🔄 引き直す（${price === 0 ? `無料 残り${td.run.rerollsLeft}` : `${price}G`}）</button>
          <small>選んでいる間は時間が止まります</small>
        </div>
      </div>`;
    this.bindPreviews();
  }

  private optionDescription(o: RewardOption): string {
    if (o.unitId) {
      const t = UNIT_TYPES[o.unitId];
      return `出撃 ${getDeployCost(o.unitId)}G・×${getSquadSize(o.unitId)}人・待機 ${getDeployCooldown(o.unitId)}秒。${t.description ?? ''}`.trim();
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
    const option = td.choose(this.host.battle, index);
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
    if (d.td === 'title') return this.host.toTitle();
    if (d.td === 'retry') return this.host.retry();
    if (!td) return;
    if (d.deploy) {
      this.tryDeploy(d.deploy as UnitTypeId);
      return;
    }
    if (d.choose !== undefined) {
      this.applyChoice(td, Number(d.choose));
      return;
    }
    switch (d.td) {
      case 'auto':
        td.autoDeploy = !td.autoDeploy;
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
        if (td.reroll()) this.host.playClick();
        else this.host.playDenied();
        this.choiceKey = '';
        this.renderChoice(td);
        return;
    }
    let ok: boolean | undefined;
    if (d.buy === 'fund') ok = td.buyFund();
    else if (d.buy === 'base') ok = td.upgradeBase();
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
    if (!td) return;
    const spawned = td.deploy(this.host.battle, id);
    const el = this.cardEls.get(id);
    if (spawned.length > 0) {
      this.host.playDeploy();
      el?.classList.remove('pop');
      void el?.offsetWidth;
      el?.classList.add('pop');
    } else {
      this.host.playDenied();
      el?.classList.remove('shake');
      void el?.offsetWidth;
      el?.classList.add('shake');
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
    this.announce(`🎁 ${rewards.map((r) => `${r.icon}${r.name}`).join(' ')}`, 'chest');
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
      <h2>🏰 タワーディフェンス</h2>
      <p class="td-lead">城から部隊を出撃させ、10分間耐えながら敵軍の城を破壊せよ。敵の城を削るとお金が入るが、削るたびに強い反撃部隊が出てくる。</p>
      <h3>スターターを選ぶ</h3>
      <div class="td-starters">${cards}</div>
      <div class="td-modal-actions"><button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button></div>
    `);
  }

  showResult(td: TDRun, won: boolean): void {
    const time = formatTime(td.time);
    this.closeChoice();
    this.showModal(`
      <h2 class="${won ? 'win' : 'lose'}">${won ? '🏆 敵軍の城を破壊！' : '💥 城が陥落…'}</h2>
      <div class="td-result-grid">
        <div><small>経過時間</small><b>${time}</b></div>
        <div><small>到達 WAVE</small><b>${td.wave}</b></div>
        <div><small>撃破数</small><b>${td.kills}</b></div>
        <div><small>到達レベル</small><b>${td.level}</b></div>
        <div><small>敵の城へのダメージ</small><b>${Math.round(td.baseDamage).toLocaleString()}</b></div>
        <div><small>反撃を受けた回数</small><b>${td.counters}</b></div>
      </div>
      <div class="td-modal-actions">
        <button type="button" class="td-btn primary" data-td="retry">↺ もう一度</button>
        <button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button>
      </div>
    `);
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
