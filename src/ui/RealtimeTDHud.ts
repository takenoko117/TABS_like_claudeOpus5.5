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
import { MAX_GATE_LEVEL } from '../facilities/FacilityTypes';
import type { JackpotReward } from '../game/RogueJackpot';
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
  not_in_deck: '控え',
  ended: '終了',
};

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  }

  // ---- 表示の切り替え ----

  show(): void {
    this.root.classList.remove('hidden');
    document.body.classList.add('td-mode');
  }

  hide(): void {
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
  }

  /** 新しいランを始めたときに表示をリセットする */
  reset(): void {
    this.deckKey = '';
    this.roomKey = '';
    this.cardEls.clear();
    this.elBar.innerHTML = '';
    this.setRoomOpen(false);
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
    const key = td.run.deck.map((c) => `${c.id}:${c.level}`).join(',');
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
        <button type="button" class="td-btn td-room-btn" data-td="room">🧭 作戦室<span class="td-badge hidden"></span></button>
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
    money.innerHTML = `💰 <b>${td.money.toLocaleString()}</b><small>/${td.walletCap.toLocaleString()}G ・ +${td.walletIncome}/秒</small>`;
    money.classList.toggle('full', td.money >= td.walletCap);
    const badge = this.elTop.querySelector<HTMLElement>('.td-badge')!;
    badge.textContent = `⚔${td.choices}`;
    badge.classList.toggle('hidden', td.choices <= 0);
    this.elTop.querySelector('[data-td="room"]')!.classList.toggle('active', this.roomOpen);
    this.elTop.querySelector('[data-td="auto"]')!.classList.toggle('active', td.autoDeploy);
    this.elTop.querySelector('[data-td="pause"]')!.classList.toggle('active', this.host.isPaused());
  }

  private renderBar(td: TDRun): void {
    this.cardEls.clear();
    this.elBar.innerHTML = td.run.deck
      .map((c, i) => {
        const t = UNIT_TYPES[c.id];
        return `<button type="button" class="td-card slot${getUnitSlotCost(c.id)}" data-deploy="${c.id}" title="${esc(t.name)}（${i + 1} キー）">
          <span class="td-card-icon">${getUnitIconSvg(c.id)}</span>
          <span class="td-card-name">${esc(t.name)}</span>
          <span class="td-card-meta">×${getSquadSize(c.id)} ・ Lv${c.level}</span>
          <span class="td-card-cost">💰${getDeployCost(c.id)}</span>
          <span class="td-card-key">${i + 1}</span>
          <span class="td-card-cd"></span>
          <span class="td-card-state"></span>
        </button>`;
      })
      .join('');
    if (td.run.deck.length === 0) {
      this.elBar.innerHTML = '<div class="td-bar-empty">デッキが空です。作戦室でカードを入れてください</div>';
    }
    this.elBar.querySelectorAll<HTMLElement>('[data-deploy]').forEach((el) => {
      this.cardEls.set(el.dataset.deploy as UnitTypeId, el);
    });
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
    if (!td) return;
    const run = td.run;
    const options = td.currentOptions();
    // お金は毎秒変わるので、値そのものではなく「買えるかどうか」が変わったときだけ描き直す
    const prices = [
      td.rerollPrice,
      run.unitSlotPrice,
      run.relicSlotPrice,
      td.walletPrice,
      td.repairPrice,
      td.fortifyPrice,
      ...run.cards.map((c) => run.cardLevelPrice(c.id)),
      ...run.relics.map((_, i) => run.relicLevelPrice(i)),
    ];
    const key = [
      prices.map((p) => (p !== null && td.money >= p ? 1 : 0)).join(''),
      td.choices,
      options?.map((o) => o.title).join('|'),
      run.cards.map((c) => `${c.id}${c.level}${c.inDeck}`).join(','),
      run.relics.map((r) => `${r.id}${r.level}${r.active}`).join(','),
      run.unitSlots,
      run.relicSlots,
      td.walletLevel,
      td.repairs,
      td.fortifies,
      Math.round(td.playerBase?.hp ?? 0),
      run.rerollsLeft,
    ].join('/');
    if (key === this.roomKey) return;
    this.roomKey = key;
    const scroll = this.elRoom.scrollTop;

    const choiceHtml = options
      ? `<section class="td-sec td-choices">
          <h3>⚔ 強化の選択 <small>残り ${td.choices} 回</small></h3>
          <div class="td-options">${options.map((o, i) => this.optionHtml(td, o, i)).join('')}</div>
          <button type="button" class="td-btn td-small" data-td="reroll" ${td.money < td.rerollPrice ? 'disabled' : ''}>🔄 引き直す（${td.rerollPrice === 0 ? `無料・残り${run.rerollsLeft}` : `${td.rerollPrice}G`}）</button>
        </section>`
      : `<section class="td-sec td-choices empty"><h3>⚔ 強化の選択</h3><p>敵を倒して経験値をためると、レベルアップで選べるようになる。</p></section>`;

    const used = run.usedUnitSlots;
    const cardRow = (id: UnitTypeId) => {
      const c = run.card(id)!;
      const t = UNIT_TYPES[id];
      const price = run.cardLevelPrice(id);
      const canToggle = c.inDeck || run.fitsInDeck(id);
      return `<div class="td-row ${c.inDeck ? 'in' : 'out'}">
        <span class="td-row-icon">${getUnitIconSvg(id)}</span>
        <span class="td-row-main"><b>${esc(t.name)}</b><small>枠${getUnitSlotCost(id)} ・ ×${getSquadSize(id)} ・ 💰${getDeployCost(id)} ・ ${getDeployCooldown(id)}秒</small></span>
        <span class="td-row-lv">Lv${c.level}</span>
        <button type="button" class="td-btn td-small" data-card-toggle="${id}" ${canToggle ? '' : 'disabled'}>${c.inDeck ? '外す' : '入れる'}</button>
        <button type="button" class="td-btn td-small" data-card-level="${id}" ${price === null || td.money < price ? 'disabled' : ''}>${price === null ? `Lv${ROGUE_MAX_UNIT_LEVEL}` : `強化 ${price}G`}</button>
      </div>`;
    };
    const deckHtml = `<section class="td-sec">
      <h3>🃏 デッキ <small>枠 ${used} / ${run.unitSlots}</small></h3>
      ${run.deck.map((c) => cardRow(c.id)).join('')}
      ${run.bench.length > 0 ? `<h4>控え</h4>${run.bench.map((c) => cardRow(c.id)).join('')}` : ''}
    </section>`;

    const activeRelics = run.relics.filter((r) => r.active).length;
    const relicRows = run.relics
      .map((r, i) => {
        const price = run.relicLevelPrice(i);
        const canOn = r.active || activeRelics < run.relicSlots;
        return `<div class="td-row ${r.active ? 'in' : 'out'}">
          <span class="td-row-icon">${getFacilityIconSvg(r.id)}</span>
          <span class="td-row-main"><b>${esc(relicDisplayName(r))}</b><small>${esc(relicDescription(r))}</small></span>
          <button type="button" class="td-btn td-small" data-relic-toggle="${i}" ${canOn ? '' : 'disabled'}>${r.active ? 'OFF' : 'ON'}</button>
          <button type="button" class="td-btn td-small" data-relic-level="${i}" ${price === null || td.money < price ? 'disabled' : ''}>${price === null || r.level >= MAX_GATE_LEVEL ? 'MAX' : `強化 ${price}G`}</button>
        </div>`;
      })
      .join('');
    const relicHtml = `<section class="td-sec">
      <h3>🏛 レリック <small>発動 ${activeRelics} / ${run.relicSlots}</small></h3>
      ${relicRows || '<p>強化の選択や宝箱で手に入る。門は基地の出口に置かれ、出撃した兵がくぐると効果が掛かる。</p>'}
    </section>`;

    const buy = (attr: string, label: string, price: number | null, extra = '', disabled = false) =>
      `<button type="button" class="td-btn td-buy" data-buy="${attr}" ${price === null || td.money < price || disabled ? 'disabled' : ''}>
        <b>${label}</b><small>${price === null ? '上限' : `${price}G`}${extra}</small></button>`;
    const base = td.playerBase;
    const shopHtml = `<section class="td-sec">
      <h3>🛠 強化</h3>
      <div class="td-buys">
        ${buy('slot', `ユニット枠 +1（${run.unitSlots}）`, run.unitSlotPrice)}
        ${buy('relic-slot', `レリック枠 +1（${run.relicSlots}）`, run.relicSlotPrice)}
        ${buy('wallet', `財布 Lv${td.walletLevel}`, td.walletPrice, ' ・ 収入と上限UP')}
        ${buy('repair', '基地の修理 +25%', td.repairPrice, '', !base || base.hp >= base.maxHp)}
        ${buy('fortify', '基地の強化 +20%', td.fortifyPrice)}
      </div>
    </section>`;

    this.elRoom.innerHTML = `
      <header class="td-room-head"><b>🧭 作戦室</b><small>時間は止まりません</small>
        <button type="button" class="td-btn td-small" data-td="room">✕ 閉じる</button></header>
      ${choiceHtml}${deckHtml}${relicHtml}${shopHtml}`;
    this.elRoom.scrollTop = scroll;
  }

  private optionHtml(td: TDRun, o: RewardOption, i: number): string {
    const icon = o.unitId
      ? getUnitIconSvg(o.unitId)
      : o.relicId
        ? getFacilityIconSvg(o.relicId)
        : `<span class="td-emoji">${o.kind === 'gold' ? '💰' : '➕'}</span>`;
    const owned = o.unitId ? td.run.card(o.unitId) : undefined;
    const desc = owned ? `Lv${owned.level} → Lv${Math.min(ROGUE_MAX_UNIT_LEVEL, owned.level + 1)}（無料）` : o.description;
    return `<button type="button" class="td-option ${o.rarity}" data-choose="${i}">
      <span class="td-option-rarity">${RARITY_LABELS[o.rarity]}</span>
      <span class="td-option-icon">${icon}</span>
      <b>${esc(o.title)}</b>
      <small>${esc(desc)}</small>
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
    if (d.choose !== undefined) ok = td.choose(battle, Number(d.choose)) !== null;
    else if (d.cardToggle) ok = td.toggleDeck(battle, d.cardToggle as UnitTypeId);
    else if (d.cardLevel) ok = td.buyCardLevel(d.cardLevel as UnitTypeId);
    else if (d.relicToggle !== undefined) ok = td.toggleRelic(battle, Number(d.relicToggle));
    else if (d.relicLevel !== undefined) ok = td.buyRelicLevel(battle, Number(d.relicLevel));
    else if (d.buy === 'slot') ok = td.buyUnitSlot();
    else if (d.buy === 'relic-slot') ok = td.buyRelicSlot();
    else if (d.buy === 'wallet') ok = td.buyWallet();
    else if (d.buy === 'repair') ok = td.repairBase();
    else if (d.buy === 'fortify') ok = td.fortifyBase();
    if (ok === undefined) return;
    if (ok) this.host.playClick();
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

  /** デッキの n 番目（0始まり）を出撃させる */
  deployIndex(n: number): void {
    const td = this.host.getRun();
    const card = td?.run.deck[n];
    if (card) this.tryDeploy(card.id);
  }

  /** 3択を数字キーで選ぶ（作戦室が開いているとき） */
  chooseIndex(n: number): boolean {
    const td = this.host.getRun();
    if (!td || !this.roomOpen || !td.currentOptions()?.[n]) return false;
    td.choose(this.host.battle, n);
    this.host.playClick();
    this.roomKey = '';
    this.renderRoom();
    return true;
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
