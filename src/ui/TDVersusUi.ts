// TD オンライン対戦（対面型）の画面（ロビー・試合中の対戦パネル・リザルト）の HTML を組み立てる。
// 表示の切り替えとクリックの処理は RealtimeTDHud が受け持つ。
import { vx } from './VoxelIcons';
import { setHtml } from '../fx/ui/dom';
import { TD_DUEL_TIME_LIMIT, type TDRun } from '../game/RealtimeTDMode';
import { RARITY_LABELS, getSquadSize, unitRarity } from '../game/RogueliteMode';
import { TD_DRAFT_PICK_SECONDS, TD_DRAFT_ROUNDS } from '../game/TDDraft';
import type { TDLockstep } from '../game/TDDuel';
import { slotColorName, type TDVersusSession, type TDVersusVerdict } from '../game/TDVersusSession';
import {
  TD_VS_IDLE_MS,
  TD_VS_ROOM_NAME_MAX,
  type TDVersusEndReason,
  type TDVersusRoomListing,
} from '../net/tdVersusProtocol';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { pixelArt, type PixelSpriteName } from './PixelArt';
import { getUnitIconSvg } from './UnitIcons';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const IDLE_MINUTES = Math.round(TD_VS_IDLE_MS / 60000);
const LIMIT_MINUTES = Math.round(TD_DUEL_TIME_LIMIT / 60);
/** 相手の操作をこの秒数以上待っていたら「通信待ち」を出す */
const STALL_NOTICE_SECONDS = 0.4;

/** ロビーで見せるルールの説明（ピクセルアートの絵・見出し・ひとこと） */
const RULE_CARDS: ReadonlyArray<{ icon: PixelSpriteName; title: string; text: string; wide?: boolean }> = [
  { icon: 'house', title: '部屋を作る・入る', text: '作った人は青（左の城）、入った人は赤（右の城）' },
  { icon: 'swords', title: '兵を出し合う', text: 'カードで兵を出撃！ 相手の兵を倒すと経験値2倍' },
  { icon: 'levelup', title: '3択は同じ', text: 'レベルアップの強化3択は相手と同じ内容が出る' },
  { icon: 'chest', title: '宝箱は自分だけ', text: '戦場の宝箱か、城強化の横のボタンで開けよう' },
  { icon: 'hourglass', title: `${LIMIT_MINUTES}分で判定`, text: '城を落とせば勝ち。時間切れは城の残りHP%で勝負' },
  { icon: 'eye', title: '観戦できる', text: '対戦中の部屋を押すと、その試合を観戦できる' },
  {
    icon: 'levelup',
    title: '初期デッキをドラフト',
    text: `両者が準備完了したら、同じ3択から1枚ずつ×${TD_DRAFT_ROUNDS}巡。同時に選んで同時に開く（同じカードでもOK）。レジェンド以上は試合中の3択だけ`,
    wide: true,
  },
  {
    icon: 'crown',
    title: '第三勢力を狩る',
    text: '戦場のわきの巣に野生の魔物が湧き続ける。兵を出して狩れば経験値とお金。真ん中のわきに出るヌシを倒すと宝箱（砲台は魔物を撃たない）',
    wide: true,
  },
];

/** ロビーの上の見出し（青の城 VS 赤の城） */
function renderVersusHero(): string {
  return `
    <div class="td-vs-hero">
      <div class="td-vs-hero-side blue">${pixelArt('soldierBlue', 'td-vs-hero-soldier')}${pixelArt('castleBlue', 'td-vs-hero-castle')}</div>
      <div class="td-vs-hero-mid">
        ${pixelArt('swords', 'td-vs-hero-swords')}
        <h2 class="td-vs-title">オンライン対戦</h2>
        <small class="td-vs-subtitle">TOWER DEFENSE VERSUS</small>
      </div>
      <div class="td-vs-hero-side red">${pixelArt('castleRed', 'td-vs-hero-castle')}${pixelArt('soldierRed', 'td-vs-hero-soldier')}</div>
    </div>`;
}

/** ルールの説明カード */
function renderRuleCards(): string {
  return `<ol class="td-vs-rules">${RULE_CARDS.map(
    (r, i) => `<li class="td-vs-rule${r.wide ? ' wide' : ''}" style="--i:${i}">
      <span class="td-vs-rule-no">${i + 1}</span>
      <span class="td-vs-rule-icon">${pixelArt(r.icon)}</span>
      <b>${esc(r.title)}</b>
      <small>${esc(r.text)}</small>
    </li>`,
  ).join('')}</ol>`;
}

/** 席の表示名 */
function slotLabel(slot: number): string {
  return slot === 0 ? 'ホスト（青）' : 'ゲスト（赤）';
}

/** ロビー（部屋名の入力・部屋での待機） */
export function renderVersusLobby(vs: TDVersusSession, roomDraft: string): string {
  const message = vs.message ? `<p class="td-vs-message">${esc(vs.message)}</p>` : '';
  if (vs.phase === 'idle') {
    return `
      <div class="td-vs-pop">
      ${renderVersusHero()}
      ${renderRuleCards()}
      <div class="td-vs-lobby">
        <section class="td-vs-lobby-col create">
          <h3>${pixelArt('house', 'td-vs-h-icon')}部屋を作る <span class="td-vs-tag blue">青・ホスト</span></h3>
          <div class="td-vs-join">
            <input type="text" class="td-vs-room" maxlength="${TD_VS_ROOM_NAME_MAX}" placeholder="部屋名 例: takenoko" value="${esc(roomDraft)}" autocomplete="off" />
            <button type="button" class="td-btn primary" data-td="vs-create">作成</button>
          </div>
          <p class="td-vs-note">作った部屋は右の一覧に「募集中」として出ます。相手が入ると対戦の準備に進みます。</p>
        </section>
        <section class="td-vs-lobby-col list">
          <h3>${pixelArt('castleRed', 'td-vs-h-icon')}部屋をさがす <span class="td-vs-tag red">赤・ゲスト</span>
            <button type="button" class="td-btn td-small" data-td="vs-refresh" title="一覧を更新">↻</button>
          </h3>
          <div class="td-vs-rooms">${renderVersusRoomList(null, null)}</div>
        </section>
      </div>
      <p class="td-vs-note">${IDLE_MINUTES}分間だれも操作しない部屋は自動で消えます。</p>
      ${message}
      </div>
      <div class="td-modal-actions">
        <button type="button" class="td-btn" data-td="vs-back">← 友人対戦へ</button>
        <button type="button" class="td-btn" data-td="title">${vx('home')} タイトルへ</button>
      </div>
    `;
  }
  if (vs.phase === 'connecting') {
    return `
      <h2>${vx('globe')} オンライン対戦</h2>
      <p class="td-lead">部屋「${esc(vs.room)}」に${vs.spectating ? '観戦で' : ''}接続しています…</p>
      <div class="td-modal-actions"><button type="button" class="td-btn" data-td="vs-leave">やめる</button></div>
    `;
  }
  if (vs.phase === 'drafting') return renderVersusDraft(vs);
  const ready = vs.ready;
  const slotCards = [0, 1]
    .map((i) => {
      const info = vs.slots[i];
      const isMe = i === vs.slot;
      const present = info?.present ?? false;
      const isReady = info?.ready ?? false;
      const state = isMe
        ? isReady
          ? '準備OK（相手を待っています）'
          : '準備完了を押してください'
        : !present
          ? '相手を待っています…'
          : isReady
            ? '準備OK'
            : '準備中';
      return `<div class="td-vs-slot ${i === 0 ? 'blue' : 'red'}${isMe ? ' me' : ''}${present ? '' : ' empty'}${isReady ? ' ready' : ''}">
        <span class="td-vs-slot-icon">${pixelArt(i === 0 ? 'castleBlue' : 'castleRed')}</span>
        <small>${slotLabel(i)}${isMe ? ' ― あなた' : ''}</small><b>${state}</b>
      </div>`;
    })
    .join('');
  return `
    <h2>${vx('globe')} 部屋「${esc(vs.room)}」</h2>
    <p class="td-lead">あなたは <b class="td-vs-color ${vs.slot === 1 ? 'red' : 'blue'}">${slotColorName(vs.slot)}</b>（${vs.slot === 0 ? '左' : '右'}の城）です。</p>
    <div class="td-vs-slots">${slotCards}</div>
    <p class="td-vs-note">両者が準備完了すると、初期デッキのドラフト（3択×${TD_DRAFT_ROUNDS}巡・1巡${TD_DRAFT_PICK_SECONDS}秒）が始まります。</p>
    <p class="td-vs-note">${IDLE_MINUTES}分間だれも操作しないと部屋は消えます。</p>
    ${message}
    <div class="td-modal-actions">
      ${
        ready
          ? '<button type="button" class="td-btn" data-td="vs-unready">取り消す</button>'
          : `<button type="button" class="td-btn primary" data-td="vs-ready">${vx('check')} 準備完了</button>`
      }
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
    </div>
  `;
}

/** ドラフトのカード1枚 */
function draftCard(id: UnitTypeId, opts: { picked: boolean; locked: boolean; badge: string | null }): string {
  const t = UNIT_TYPES[id];
  const rarity = unitRarity(id);
  const badge = opts.badge
    ? `<span class="td-draft-badge">${vx('star')} おすすめ<small>${esc(opts.badge)}</small></span>`
    : '';
  return `<button type="button" class="td-draft-card ${rarity}${opts.picked ? ' picked' : ''}${opts.badge ? ' recommended' : ''}" data-vs-pick="${id}" ${opts.locked ? 'disabled' : ''}>
    ${badge}
    <span class="td-choice-rarity">${RARITY_LABELS[rarity]}</span>
    <span class="td-draft-icon"><span class="unit-voxel td-voxel" data-unit-preview="${id}">${getUnitIconSvg(id)}<canvas aria-hidden="true"></canvas></span></span>
    <b>${esc(t.name)}</b>
    <small>${vx('coin')} ${t.cost}　${vx('people')} ×${getSquadSize(id)}</small>
  </button>`;
}

/** 選び終えたデッキの小さなアイコンの列（まだの巡は空き枠） */
function draftDeckRow(picks: readonly UnitTypeId[]): string {
  return Array.from({ length: TD_DRAFT_ROUNDS }, (_, r) => {
    const id = picks[r];
    return id
      ? `<span class="td-mini" title="${esc(UNIT_TYPES[id].name)}">${getUnitIconSvg(id)}</span>`
      : '<span class="td-mini td-draft-empty"></span>';
  }).join('');
}

/** ドラフトの画面（3択・おすすめ・制限時間・両者のデッキ） */
export function renderVersusDraft(vs: TDVersusSession): string {
  const d = vs.draft;
  if (!d || (vs.slot !== 0 && vs.slot !== 1)) return '';
  const mine = d.picks[vs.slot];
  const theirs = d.picks[1 - vs.slot];
  const rec = vs.draftRecommendation;
  const offer = vs.draftOffer;
  const cards = offer
    .map((id) => draftCard(id, { picked: d.myPick === id, locked: d.myPick !== null, badge: rec?.id === id ? rec.reason : null }))
    .join('');
  const lastRound = d.round - 1;
  const lastReveal =
    lastRound >= 0
      ? `<p class="td-draft-reveal">${lastRound + 1}巡目 ― あなた <b>${esc(UNIT_TYPES[mine[lastRound]].name)}</b> ／ 相手 <b>${esc(UNIT_TYPES[theirs[lastRound]].name)}</b></p>`
      : '<p class="td-draft-reveal">同じ3択から同時に選び、同時に開きます。同じカードを選んでもOK</p>';
  const color = vs.slot === 1 ? 'red' : 'blue';
  return `
    <h2>${vx('swords')} 初期デッキ・ドラフト <small>${Math.min(d.round + 1, TD_DRAFT_ROUNDS)} / ${TD_DRAFT_ROUNDS} 巡</small></h2>
    ${lastReveal}
    <div class="td-draft-timer" data-left="${TD_DRAFT_PICK_SECONDS}">
      <span class="td-draft-timer-bar"><i style="width:${(vs.draftSecondsLeft() / TD_DRAFT_PICK_SECONDS) * 100}%"></i></span>
      <b>${Math.ceil(vs.draftSecondsLeft())}</b>
    </div>
    <div class="td-draft-cards">${cards}</div>
    <p class="td-vs-note">${
      d.myPick
        ? `${vx('hourglass')} 相手の選択を待っています…`
        : `時間切れになると「おすすめ」が自動で選ばれます`
    }</p>
    <div class="td-draft-decks">
      <div class="td-draft-deck ${color}"><small>あなた</small><span>${draftDeckRow(mine)}</span></div>
      <div class="td-draft-deck ${color === 'blue' ? 'red' : 'blue'}"><small>相手</small><span>${draftDeckRow(theirs)}</span></div>
    </div>
    <div class="td-modal-actions">
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
    </div>
  `;
}

/** ドラフトの残り時間の表示を書き換える（3択は描き直さない） */
export function updateDraftTimer(el: HTMLElement, seconds: number): void {
  const bar = el.querySelector<HTMLElement>('.td-draft-timer-bar > i');
  if (bar) bar.style.width = `${Math.max(0, Math.min(1, seconds / TD_DRAFT_PICK_SECONDS)) * 100}%`;
  const num = el.querySelector<HTMLElement>('b');
  const text = String(Math.ceil(seconds));
  if (num && num.textContent !== text) num.textContent = text;
  el.classList.toggle('urgent', seconds <= 3);
}

/**
 * 部屋の一覧（部屋名の書かれたアイコン）。募集中の部屋は押すと入室、対戦中の部屋は押すと観戦する。
 * rooms が null なら読み込み中、error があればそれを出す
 */
export function renderVersusRoomList(rooms: readonly TDVersusRoomListing[] | null, error: string | null): string {
  if (error) return `<p class="td-vs-rooms-empty">${esc(error)}</p>`;
  if (!rooms) return `<p class="td-vs-rooms-empty searching">${pixelArt('eye', 'td-vs-empty-icon')}部屋を探しています…</p>`;
  if (rooms.length === 0) {
    return `<p class="td-vs-rooms-empty">${pixelArt('castleRed', 'td-vs-empty-icon')}いま募集中・対戦中の部屋はありません。<br />部屋を作って相手を待つか、少し待ってみてください。</p>`;
  }
  return `<div class="td-vs-room-grid">${rooms
    .map((r) =>
      r.status === 'playing'
        ? `<button type="button" class="td-vs-room-card playing" data-vs-watch="${esc(r.name)}" title="部屋「${esc(r.name)}」の対戦を観戦する">
            <span class="td-vs-room-badge">LIVE</span>
            <span class="td-vs-room-icon">${pixelArt('swords')}</span>
            <b>${esc(r.name)}</b>
            <small>${pixelArt('eye', 'td-vs-inline-icon')}観戦する${r.watchers > 0 ? `（${r.watchers}人）` : ''}</small>
          </button>`
        : `<button type="button" class="td-vs-room-card" data-vs-room="${esc(r.name)}" title="部屋「${esc(r.name)}」に入る">
            <span class="td-vs-room-badge open">募集中</span>
            <span class="td-vs-room-icon">${pixelArt('castleRed')}</span>
            <b>${esc(r.name)}</b>
            <small>入る ${r.players}/2</small>
          </button>`,
    )
    .join('')}</div>`;
}

/** 試合中の対戦パネル（自分の色・相手の城・通信の状態） */
export function renderVersusPanel(): string {
  return `
    <div class="td-vs-head"></div>
    <div class="td-vs-row"><span>相手の城</span><div class="td-hp enemy"><i></i></div><b class="td-vs-hp"></b></div>
    <div class="td-vs-stats"></div>
    <div class="td-vs-net"></div>
  `;
}

/** 対戦パネルの表示を更新する */
export function updateVersusPanel(el: HTMLElement, ls: TDLockstep | null): void {
  if (!ls) return;
  const mine = ls.mine;
  const opp = ls.opponent;
  const head = el.querySelector<HTMLElement>('.td-vs-head')!;
  const left = Math.max(0, TD_DUEL_TIME_LIMIT - mine.time);
  const m = Math.floor(left / 60);
  const s = String(Math.floor(left % 60)).padStart(2, '0');
  if (ls.slot === null) {
    // 観戦: 両陣営の様子と、追いついているかを出す
    setHtml(head, `${vx('eye')} 観戦中（青 vs 赤）`);
    head.className = 'td-vs-head';
    el.querySelector<HTMLElement>('.td-vs-row')!.classList.add('hidden');
    el.querySelector<HTMLElement>('.td-vs-stats')!.textContent =
      `青 Lv${mine.level}・撃破${mine.kills}・狩り${mine.wildKills} ｜ 赤 Lv${opp.level}・撃破${opp.kills}・狩り${opp.wildKills} ｜ 残り ${m}:${s}`;
    const net = el.querySelector<HTMLElement>('.td-vs-net')!;
    if (ls.catchingUp) {
      setHtml(net, `${vx('ffwd')} 試合に追いついています…（${(ls.lagTurns / 10).toFixed(0)}秒遅れ）`);
      net.className = 'td-vs-net wait';
    } else if (ls.stalled && ls.stallTime >= STALL_NOTICE_SECONDS) {
      setHtml(net, `${vx('hourglass')} 通信を待っています… ${ls.stallTime.toFixed(1)}s`);
      net.className = 'td-vs-net wait';
    } else {
      net.textContent = '';
      net.className = 'td-vs-net';
    }
    return;
  }
  el.querySelector<HTMLElement>('.td-vs-row')!.classList.remove('hidden');
  const color = slotColorName(ls.slot);
  setHtml(head, `${vx('swords')} あなた：${color}（${ls.slot === 0 ? '左' : '右'}の城）`);
  head.className = `td-vs-head ${ls.slot === 1 ? 'red' : 'blue'}`;
  const base = opp.playerBase;
  const ratio = base && base.maxHp > 0 ? Math.max(0, base.hp) / base.maxHp : 0;
  el.querySelector<HTMLElement>('.td-hp.enemy i')!.style.width = `${ratio * 100}%`;
  el.querySelector<HTMLElement>('.td-vs-hp')!.textContent = `${Math.ceil(Math.max(0, base?.hp ?? 0)).toLocaleString()}`;
  el.querySelector<HTMLElement>('.td-vs-stats')!.textContent = `相手 Lv${opp.level} ｜ 撃破 ${opp.kills} ｜ 狩り ${opp.wildKills} ｜ 残り ${m}:${s}`;
  const net = el.querySelector<HTMLElement>('.td-vs-net')!;
  if (ls.desyncTurn !== null) {
    setHtml(net, `${vx('warn')} 相手と戦況がずれました（勝敗は先に届いた判定で決まります）`);
    net.className = 'td-vs-net warn';
  } else if (ls.stalled && ls.stallTime >= STALL_NOTICE_SECONDS) {
    setHtml(net, `${vx('hourglass')} 相手の通信を待っています… ${ls.stallTime.toFixed(1)}s`);
    net.className = 'td-vs-net wait';
  } else {
    net.textContent = '';
    net.className = 'td-vs-net';
  }
}

const REASON_TEXT: Record<TDVersusEndReason, Record<TDVersusVerdict, string>> = {
  castle: { win: '相手の城を落とした！', lose: '城が陥落…', draw: '両方の城が同時に陥落' },
  time: { win: '時間切れ。城の残り HP で上回った！', lose: '時間切れ。城の残り HP で負けた…', draw: '時間切れ。城の残り HP が同じ' },
  left: { win: '相手が退室しました', lose: '接続が切れました', draw: '接続が切れました' },
  surrender: { win: '相手が降参しました', lose: '降参しました', draw: '降参しました' },
};

const VERDICT_TITLE: Record<TDVersusVerdict, string> = {
  win: `${vx('trophy')} 勝利！`,
  lose: `${vx('boom')} 敗北…`,
  draw: `${vx('handshake')} 引き分け`,
};

/** 対戦のリザルト */
export function renderVersusResult(
  mine: TDRun,
  opponent: TDRun,
  verdict: TDVersusVerdict,
  reason: TDVersusEndReason,
  vs: TDVersusSession,
): string {
  const m = Math.floor(mine.time / 60);
  const s = String(Math.floor(mine.time % 60)).padStart(2, '0');
  const hpText = (run: TDRun) => {
    const b = run.playerBase;
    return b ? `${Math.round((Math.max(0, b.hp) / b.maxHp) * 100)}%` : '-';
  };
  const canRematch = vs.connected && (vs.phase === 'ended' || vs.phase === 'room');
  return `
    <h2 class="${verdict === 'win' ? 'win' : 'lose'}">${VERDICT_TITLE[verdict]}</h2>
    <p class="td-lead">${REASON_TEXT[reason][verdict]}</p>
    <div class="td-result-grid">
      <div><small>経過時間</small><b>${m}:${s}</b></div>
      <div><small>撃破数（あなた / 相手）</small><b>${mine.kills} / ${opponent.kills}</b></div>
      <div><small>魔物狩り（あなた / 相手）</small><b>${mine.wildKills} / ${opponent.wildKills}</b></div>
      <div><small>到達レベル（あなた / 相手）</small><b>${mine.level} / ${opponent.level}</b></div>
      <div><small>城の残り（あなた / 相手）</small><b>${hpText(mine)} / ${hpText(opponent)}</b></div>
    </div>
    <div class="td-modal-actions">
      ${canRematch ? `<button type="button" class="td-btn primary" data-td="vs-lobby">↺ 同じ部屋で再戦</button>` : ''}
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
      <button type="button" class="td-btn" data-td="title">${vx('home')} タイトルへ</button>
    </div>
  `;
}

/** 観戦した対戦のリザルト（winner は勝った席、null は引き分け） */
export function renderVersusWatchResult(blue: TDRun, red: TDRun, winner: number | null, reason: TDVersusEndReason): string {
  const m = Math.floor(blue.time / 60);
  const s = String(Math.floor(blue.time % 60)).padStart(2, '0');
  const hpText = (run: TDRun) => {
    const b = run.playerBase;
    return b ? `${Math.round((Math.max(0, b.hp) / b.maxHp) * 100)}%` : '-';
  };
  const title = winner === null ? `${vx('handshake')} 引き分け` : `${winner === 0 ? '青' : '赤'}の勝利！`;
  const reasonText: Record<TDVersusEndReason, string> = {
    castle: winner === null ? '両方の城が同時に陥落' : '城を落として決着',
    time: '時間切れ。城の残り HP で判定',
    left: '片方が退室しました',
    surrender: '片方が降参しました',
  };
  const icon = winner === null ? pixelArt('swords', 'td-vs-result-icon') : pixelArt(winner === 0 ? 'castleBlue' : 'castleRed', 'td-vs-result-icon');
  return `
    <div class="td-vs-watch-result">${icon}${pixelArt('crown', 'td-vs-result-crown')}</div>
    <h2 class="${winner === 1 ? 'lose' : 'win'}">${title}</h2>
    <p class="td-lead">${reasonText[reason]}</p>
    <div class="td-result-grid">
      <div><small>経過時間</small><b>${m}:${s}</b></div>
      <div><small>撃破数（青 / 赤）</small><b>${blue.kills} / ${red.kills}</b></div>
      <div><small>魔物狩り（青 / 赤）</small><b>${blue.wildKills} / ${red.wildKills}</b></div>
      <div><small>到達レベル（青 / 赤）</small><b>${blue.level} / ${red.level}</b></div>
      <div><small>城の残り（青 / 赤）</small><b>${hpText(blue)} / ${hpText(red)}</b></div>
    </div>
    <p class="td-vs-note">同じ部屋で次の試合が始まると、続けて観戦できます。</p>
    <div class="td-modal-actions">
      <button type="button" class="td-btn primary" data-td="vs-leave">部屋の一覧へ</button>
      <button type="button" class="td-btn" data-td="title">${vx('home')} タイトルへ</button>
    </div>
  `;
}
