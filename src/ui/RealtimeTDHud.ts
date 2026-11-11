import type { Battle } from '../game/Battle';
import {
  getDeployCooldown,
  getDeployCost,
  TD_DURATION_SECONDS,
  TD_WAVE_COUNT,
  type DeployBlock,
  type TDRun,
} from '../game/RealtimeTDMode';
import {
  RARITY_LABELS,
  ROGUE_MAX_UNIT_LEVEL,
  ROGUE_STARTERS,
  getSquadSize,
  getUnitSlotCost,
  relicDescription,
  relicDisplayName,
  type RewardOption,
  type RogueStarter,
} from '../game/RogueliteMode';
import { MAX_GATE_LEVEL, type FacilityTypeId } from '../facilities/FacilityTypes';
import type { JackpotReward } from '../game/RogueJackpot';
import { UnitPreviews } from '../render/UnitPreviews';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { getFacilityIconSvg, getUnitIconSvg } from './UnitIcons';

/** HUD から GameApp に頼む操作 */
export interface TDHudHost {
  readonly battle: Battle;
  getRun(): TDRun | null;
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

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 画面がこの幅以上なら、作戦室を開いたまま始める */
const ROOM_OPEN_MIN_WIDTH = 900;

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

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** タワーディフェンスモードの画面（上部の状況バー、出撃バー、作戦室、スターター選択、リザルト） */
export class RealtimeTDHud {
  private readonly root: HTMLElement;
  private readonly elTop: HTMLElement;
  private readonly elBar: HTMLElement;
  private readonly elRoom: HTMLElement;
  private readonly elAnnounce: HTMLElement;
  private readonly elModal: HTMLElement;
  private deckKey = '';
  private roomKey = '';
  private roomOpen = false;
  private announceTimer = 0;
  private refreshTimer = 0;
  private readonly cardEls = new Map<UnitTypeId, HTMLElement>();
  private readonly previews = new UnitPreviews();
  /** 作戦室の下に出す説明（触れた・押したアイコンの中身） */
  private info = '';

  constructor(private readonly host: TDHudHost) {
    this.root = document.createElement('div');
    this.root.id = 'td-hud';
    this.root.className = 'td-hud hidden';
    this.root.innerHTML = `
      <div class="td-top"></div>
      <div class="td-announce hidden"></div>
      <aside class="td-room hidden" aria-label="作戦室"></aside>
      <div class="td-bar"></div>
      <div class="td-modal hidden"></div>
    `;
    document.body.appendChild(this.root);
    this.elTop = this.root.querySelector('.td-top')!;
    this.elBar = this.root.querySelector('.td-bar')!;
    this.elRoom = this.root.querySelector('.td-room')!;
    this.elAnnounce = this.root.querySelector('.td-announce')!;
    this.elModal = this.root.querySelector('.td-modal')!;
    this.renderTop();
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-info]');
      if (el && this.elRoom.contains(el)) this.setInfo(el.dataset.info ?? '');
    });
  }

  private setInfo(text: string): void {
    this.info = text;
    const el = this.elRoom.querySelector<HTMLElement>('.td-room-info');
    if (el) el.textContent = text || 'アイコンに触れると説明が出ます';
  }

  /** モデルの表示先を取り直す（バーや作戦室を描き直したとき） */
  private bindPreviews(): void {
    this.previews.bind(this.root);
  }

  // ---- 表示の切り替え ----

  show(): void {
    this.root.classList.remove('hidden');
    document.body.classList.add('td-mode');
  }

  hide(): void {
    this.previews.unbind();
    this.root.classList.add('hidden');
    document.body.classList.remove('td-mode');
    this.setRoomOpen(false);
    this.hideModal();
  }

  get isRoomOpen(): boolean {
    return this.roomOpen;
  }

  setRoomOpen(open: boolean): void {
    this.roomOpen = open;
    this.elRoom.classList.toggle('hidden', !open);
    this.root.classList.toggle('room-open', open);
    this.roomKey = '';
    if (open) this.renderRoom();
    else this.elRoom.innerHTML = '';
    this.bindPreviews();
  }

  /** 新しいランを始めたときに表示をリセットする */
  reset(): void {
    this.deckKey = '';
    this.roomKey = '';
    this.cardEls.clear();
    this.elBar.innerHTML = '';
    this.info = '';
    // 広い画面では作戦室を開いたまま遊べるようにする
    this.setRoomOpen(this.host.getRun() !== null && window.innerWidth >= ROOM_OPEN_MIN_WIDTH);
    this.hideModal();
    this.elAnnounce.classList.add('hidden');
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
    const key = td.run.cards.map((c) => `${c.id}:${c.level}`).join(',');
    if (key !== this.deckKey) {
      this.deckKey = key;
      this.renderBar(td);
    }
    this.updateBar(td);
    this.refreshTimer -= realDt;
    if (this.roomOpen && this.refreshTimer <= 0) {
      this.refreshTimer = 0.25;
      this.renderRoom();
    }
    this.previews.update(realDt);
  }

  private consumeEvents(td: TDRun): void {
    if (td.events.length === 0) return;
    const events = td.events.splice(0);
    // 同じフレームに重なったら最も重要なものだけを出す
    const order = ['boss', 'counter', 'elite', 'wave', 'levelup'] as const;
    const top = [...events].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
    if (events.some((e) => e.kind === 'levelup')) this.host.playLevelUp();
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
      case 'levelup':
        this.announce(`LEVEL UP! Lv${top.value}`, 'levelup');
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
      <div class="td-base ally"><span class="td-base-label">🏰 自軍基地</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
      <div class="td-clock">
        <div class="td-wave"></div>
        <div class="td-time"></div>
      </div>
      <div class="td-base enemy"><span class="td-base-label">敵基地 🏯</span><div class="td-hp"><i></i></div><b class="td-hp-num"></b></div>
      <div class="td-status">
        <div class="td-xp"><span class="td-lv"></span><div class="td-xp-bar"><i></i></div></div>
        <div class="td-money"></div>
        <button type="button" class="td-btn td-room-btn" data-td="room" title="作戦室 (Tab)">🧭 作戦室<span class="td-badge hidden"></span></button>
        <button type="button" class="td-btn td-auto" data-td="auto" title="クールタイムが明けたカードを自動で出撃させる">AUTO</button>
        <button type="button" class="td-btn" data-td="pause" title="一時停止 (P)">⏸</button>
        <button type="button" class="td-btn" data-td="settings" title="設定（開いている間は止まる）">⚙</button>
        <button type="button" class="td-btn" data-td="retire" title="リタイアしてタイトルへ">🏳</button>
      </div>
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
    this.elTop.querySelector('.td-lv')!.textContent = `Lv${td.level}`;
    this.elTop.querySelector<HTMLElement>('.td-xp-bar i')!.style.width = `${Math.min(1, td.xp / td.xpToNext) * 100}%`;
    const money = this.elTop.querySelector<HTMLElement>('.td-money')!;
    money.innerHTML = `💰 <b>${td.money.toLocaleString()}</b><small>/${td.fundCap.toLocaleString()}G ・ +${td.fundIncome}/秒</small>`;
    money.classList.toggle('full', td.money >= td.fundCap);
    const badge = this.elTop.querySelector<HTMLElement>('.td-badge')!;
    badge.textContent = `⚔${td.choices}`;
    badge.classList.toggle('hidden', td.choices <= 0);
    this.elTop.querySelector('[data-td="room"]')!.classList.toggle('active', this.roomOpen);
    this.elTop.querySelector('[data-td="auto"]')!.classList.toggle('active', td.autoDeploy);
    this.elTop.querySelector('[data-td="pause"]')!.classList.toggle('active', this.host.isPaused());
  }

  private renderBar(td: TDRun): void {
    this.cardEls.clear();
    this.elBar.innerHTML = td.run.cards
      .map((c, i) => {
        const t = UNIT_TYPES[c.id];
        return `<button type="button" class="td-card slot${getUnitSlotCost(c.id)}" data-deploy="${c.id}" title="${esc(t.name)}（${i + 1} キー）">
          <span class="td-card-icon">${unitVoxel(c.id)}</span>
          <span class="td-card-name">${esc(t.name)}</span>
          <span class="td-card-meta">×${getSquadSize(c.id)} ・ Lv${c.level}</span>
          <span class="td-card-cost">💰${getDeployCost(c.id)}</span>
          <span class="td-card-key">${i + 1}</span>
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

  // ---- 作戦室 ----

  private renderRoom(): void {
    const td = this.host.getRun();
    if (!td || !this.roomOpen) return;
    const run = td.run;
    const options = td.currentOptions();
    // お金は毎秒変わるので、値そのものではなく「買えるかどうか」が変わったときだけ描き直す
    const prices = [
      td.rerollPrice,
      td.fundPrice,
      td.basePrice,
      ...run.cards.map((c) => run.cardLevelPrice(c.id)),
      ...run.relics.map((_, i) => run.relicLevelPrice(i)),
    ];
    const key = [
      prices.map((p) => (p !== null && td.money >= p ? 1 : 0)).join(''),
      td.choices,
      options?.map((o) => o.title).join('|'),
      run.cards.map((c) => `${c.id}${c.level}`).join(','),
      run.relics.map((r) => `${r.id}${r.level}`).join(','),
      td.fundLevel,
      td.baseLevel,
      run.rerollsLeft,
    ].join('/');
    if (key === this.roomKey) return;
    this.roomKey = key;
    const body = this.elRoom.querySelector('.td-room-body');
    const scroll = body?.scrollTop ?? 0;

    const can = (price: number | null) => price !== null && td.money >= price;
    const priceLabel = (price: number | null) => (price === null ? 'MAX' : `${price}G`);
    /** アイコン1つぶんのボタン。説明は data-info（触れると下に出る）と title に入れる */
    const tile = (attrs: string, icon: string, lv: string, price: number | null, info: string, enabled = can(price)) =>
      `<button type="button" class="td-tile" ${attrs} data-info="${esc(info)}" title="${esc(info)}" ${enabled ? '' : 'disabled'}>
        ${icon}<span class="td-tile-lv">${lv}</span><span class="td-tile-price">${priceLabel(price)}</span>
      </button>`;

    const choiceHtml = options
      ? `<section class="td-sec td-choices">
          <h3>⚔ 強化を選ぶ <small>×${td.choices}</small>
            <button type="button" class="td-btn td-small td-reroll" data-td="reroll" title="引き直す" ${td.money < td.rerollPrice ? 'disabled' : ''}>🔄 ${td.rerollPrice === 0 ? `無料${run.rerollsLeft}` : `${td.rerollPrice}G`}</button></h3>
          <div class="td-options">${options.map((o, i) => this.optionHtml(td, o, i)).join('')}</div>
        </section>`
      : '';

    const fund = tile(
      'data-buy="fund"',
      propVoxel('gold', '<span class="td-emoji">💰</span>'),
      `Lv${td.fundLevel}`,
      td.fundPrice,
      `資金供給力 Lv${td.fundLevel}：毎秒 +${td.fundIncome}G・上限 ${td.fundCap.toLocaleString()}G。上げると収入と上限が増える`,
    );
    const base = td.playerBase;
    const baseTile = tile(
      'data-buy="base"',
      relicVoxel('hq'),
      `Lv${td.baseLevel}`,
      td.basePrice,
      `基地強化 Lv${td.baseLevel}：最大HP ${Math.round(base?.maxHp ?? 0).toLocaleString()}・自動回復 ${td.baseRegen}/秒。上げると最大HPと自動回復が増える`,
      can(td.basePrice) && !!base?.alive,
    );

    const units = run.cards
      .map((c) => {
        const price = run.cardLevelPrice(c.id);
        const t = UNIT_TYPES[c.id];
        const next = price === null ? '（最大レベル）' : `。強化 ${price}G で Lv${c.level + 1}`;
        return tile(
          `data-card-level="${c.id}"`,
          unitVoxel(c.id),
          `Lv${c.level}`,
          price,
          `${t.name} Lv${c.level}：×${getSquadSize(c.id)}人・出撃 ${getDeployCost(c.id)}G・待機 ${getDeployCooldown(c.id)}秒${next}`,
        );
      })
      .join('');

    const relics = run.relics
      .map((r, i) => {
        const price = r.level >= MAX_GATE_LEVEL ? null : run.relicLevelPrice(i);
        return tile(
          `data-relic-level="${i}"`,
          relicVoxel(r.id),
          `Lv${r.level + 1}`,
          price,
          `${relicDisplayName(r)}：${relicDescription(r)}${price === null ? '（最大レベル）' : `。強化 ${price}G`}`,
        );
      })
      .join('');

    this.elRoom.innerHTML = `
      <header class="td-room-head"><b>🧭 作戦室</b><small>時間は止まりません</small>
        <button type="button" class="td-btn td-small" data-td="room" title="閉じる (Tab)">✕</button></header>
      <div class="td-room-body">
        ${choiceHtml}
        <section class="td-sec"><h3>🛠 強化</h3><div class="td-tiles">${fund}${baseTile}</div></section>
        <section class="td-sec"><h3>🃏 ユニット <small>押すとレベルアップ</small></h3><div class="td-tiles">${units}</div></section>
        <section class="td-sec"><h3>🏛 レリック</h3>${
          relics ? `<div class="td-tiles">${relics}</div>` : '<p>強化の選択や宝箱で手に入る。門は基地の出口に並ぶ</p>'
        }</section>
      </div>
      <footer class="td-room-info"></footer>`;
    this.elRoom.querySelector('.td-room-body')!.scrollTop = scroll;
    this.setInfo(this.info);
    this.bindPreviews();
  }

  private optionHtml(td: TDRun, o: RewardOption, i: number): string {
    const icon = o.unitId
      ? unitVoxel(o.unitId)
      : o.relicId
        ? relicVoxel(o.relicId)
        : o.kind === 'gold'
          ? propVoxel('gold', '<span class="td-emoji">💰</span>')
          : '<span class="td-emoji">➕</span>';
    const owned = o.unitId ? td.run.card(o.unitId) : undefined;
    const desc = owned ? `Lv${owned.level} → Lv${Math.min(ROGUE_MAX_UNIT_LEVEL, owned.level + 1)}（無料）` : o.description;
    const info = `${RARITY_LABELS[o.rarity]}｜${o.title}：${desc}`;
    return `<button type="button" class="td-option ${o.rarity}" data-choose="${i}" data-info="${esc(info)}" title="${esc(info)}">
      ${icon}
      <b>${esc(o.title)}</b>
    </button>`;
  }

  // ---- 操作 ----

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('button');
    if (!el || el.hasAttribute('disabled')) return;
    const td = this.host.getRun();
    const battle = this.host.battle;
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
    let ok: boolean | undefined;
    switch (d.td) {
      case 'room':
        this.setRoomOpen(!this.roomOpen);
        this.host.playClick();
        return;
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
        ok = td.reroll();
        break;
    }
    if (d.info !== undefined) this.setInfo(d.info);
    if (d.choose !== undefined) ok = td.choose(battle, Number(d.choose)) !== null;
    else if (d.cardLevel) ok = td.buyCardLevel(d.cardLevel as UnitTypeId);
    else if (d.relicLevel !== undefined) ok = td.buyRelicLevel(battle, Number(d.relicLevel));
    else if (d.buy === 'fund') ok = td.buyFund();
    else if (d.buy === 'base') ok = td.upgradeBase();
    if (ok === undefined) return;
    if (ok) {
      this.host.playClick();
      const kick = d.cardLevel ?? (d.buy === 'fund' ? 'gold' : undefined);
      if (kick) this.previews.kick(kick);
    }
    else this.host.playDenied();
    this.roomKey = '';
    this.renderRoom();
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
      <p class="td-lead">基地から部隊を出撃させ、10分間耐えながら敵基地を破壊せよ。敵基地を削るとお金が入るが、削るたびに強い反撃部隊が出てくる。</p>
      <h3>スターターを選ぶ</h3>
      <div class="td-starters">${cards}</div>
      <div class="td-modal-actions"><button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button></div>
    `);
  }

  showResult(td: TDRun, won: boolean): void {
    const time = formatTime(td.time);
    this.showModal(`
      <h2 class="${won ? 'win' : 'lose'}">${won ? '🏆 敵基地を破壊！' : '💥 基地が陥落…'}</h2>
      <div class="td-result-grid">
        <div><small>経過時間</small><b>${time}</b></div>
        <div><small>到達 WAVE</small><b>${td.wave}</b></div>
        <div><small>撃破数</small><b>${td.kills}</b></div>
        <div><small>到達レベル</small><b>${td.level}</b></div>
        <div><small>敵基地へのダメージ</small><b>${Math.round(td.baseDamage).toLocaleString()}</b></div>
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
