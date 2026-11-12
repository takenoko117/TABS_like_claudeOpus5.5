// TD オンライン対戦（対面型）の画面（ロビー・試合中の対戦パネル・リザルト）の HTML を組み立てる。
// 表示の切り替えとクリックの処理は RealtimeTDHud が受け持つ。
import { TD_DUEL_TIME_LIMIT, type TDRun } from '../game/RealtimeTDMode';
import { ROGUE_STARTERS } from '../game/RogueliteMode';
import type { TDLockstep } from '../game/TDDuel';
import { slotColorName, type TDVersusSession, type TDVersusVerdict } from '../game/TDVersusSession';
import {
  TD_VS_IDLE_MS,
  TD_VS_ROOM_NAME_MAX,
  type TDVersusEndReason,
  type TDVersusRoomListing,
} from '../net/tdVersusProtocol';
import { UNIT_TYPES } from '../units/UnitTypes';
import { getUnitIconSvg } from './UnitIcons';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const IDLE_MINUTES = Math.round(TD_VS_IDLE_MS / 60000);
const LIMIT_MINUTES = Math.round(TD_DUEL_TIME_LIMIT / 60);
/** 相手の操作をこの秒数以上待っていたら「通信待ち」を出す */
const STALL_NOTICE_SECONDS = 0.4;

const RULES_TEXT = `1つの戦場で、ホスト（青・左の城）とゲスト（赤・右の城）が兵を出し合い、相手の城を攻める対戦。
レベルアップの3択は相手と同じ内容が出る（宝箱の中身は各自ランダム）。相手の城を落としたら勝ち。
${LIMIT_MINUTES}分たったら、城の残り HP の割合が多いほうの勝ち。対戦中は一時停止できない。`;

/** 席の表示名 */
function slotLabel(slot: number): string {
  return slot === 0 ? 'ホスト（青）' : 'ゲスト（赤）';
}

/** ロビー（部屋名の入力・部屋での待機） */
export function renderVersusLobby(vs: TDVersusSession, roomDraft: string): string {
  const message = vs.message ? `<p class="td-vs-message">${esc(vs.message)}</p>` : '';
  if (vs.phase === 'idle') {
    return `
      <h2>🌐 オンライン対戦（タワーディフェンス）</h2>
      <p class="td-lead">${esc(RULES_TEXT)}</p>
      <div class="td-vs-lobby">
        <section class="td-vs-lobby-col">
          <h3>🏠 部屋を作る（ホスト・青）</h3>
          <div class="td-vs-join">
            <input type="text" class="td-vs-room" maxlength="${TD_VS_ROOM_NAME_MAX}" placeholder="部屋名 例: takenoko" value="${esc(roomDraft)}" autocomplete="off" />
            <button type="button" class="td-btn primary" data-td="vs-create">作成</button>
          </div>
          <p class="td-vs-note">作った部屋は右の一覧に「募集中」として出ます。相手が入ると対戦の準備に進みます。</p>
        </section>
        <section class="td-vs-lobby-col">
          <h3>🚪 募集中の部屋に入る（ゲスト・赤）
            <button type="button" class="td-btn td-small" data-td="vs-refresh" title="一覧を更新">↻</button>
          </h3>
          <div class="td-vs-rooms">${renderVersusRoomList(null, null)}</div>
        </section>
      </div>
      <p class="td-vs-note">${IDLE_MINUTES}分間だれも操作しない部屋は自動で消えます。</p>
      ${message}
      <div class="td-modal-actions">
        <button type="button" class="td-btn" data-td="vs-back">← 友人対戦へ</button>
        <button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button>
      </div>
    `;
  }
  if (vs.phase === 'connecting') {
    return `
      <h2>🌐 オンライン対戦</h2>
      <p class="td-lead">部屋「${esc(vs.room)}」に接続しています…</p>
      <div class="td-modal-actions"><button type="button" class="td-btn" data-td="vs-leave">やめる</button></div>
    `;
  }
  const ready = vs.ready;
  const cards = ROGUE_STARTERS.map(
    (st) => `<button type="button" class="td-starter${vs.starterId === st.id ? ' selected' : ''}" data-vs-starter="${st.id}" ${ready ? 'disabled' : ''}>
      <b>${esc(st.name)}</b>
      <span class="td-starter-units">${st.units.map((id) => `<span class="td-mini">${getUnitIconSvg(id)}</span>`).join('')}</span>
      <small>${st.units.map((id) => UNIT_TYPES[id].name).join('・')}</small>
    </button>`,
  ).join('');
  const slotCards = [0, 1]
    .map((i) => {
      const info = vs.slots[i];
      const isMe = i === vs.slot;
      const present = info?.present ?? false;
      const isReady = info?.ready ?? false;
      const state = isMe
        ? isReady
          ? '準備OK（相手を待っています）'
          : 'スターターを選ぶと準備完了'
        : !present
          ? '相手を待っています…'
          : isReady
            ? '準備OK'
            : 'スターターを選んでいます';
      return `<div class="td-vs-slot ${i === 0 ? 'blue' : 'red'}${isMe ? ' me' : ''}${present ? '' : ' empty'}${isReady ? ' ready' : ''}">
        <small>${slotLabel(i)}${isMe ? ' ― あなた' : ''}</small><b>${state}</b>
      </div>`;
    })
    .join('');
  return `
    <h2>🌐 部屋「${esc(vs.room)}」</h2>
    <p class="td-lead">あなたは <b class="td-vs-color ${vs.slot === 1 ? 'red' : 'blue'}">${slotColorName(vs.slot)}</b>（${vs.slot === 0 ? '左' : '右'}の城）です。</p>
    <div class="td-vs-slots">${slotCards}</div>
    <h3>スターターを選ぶ</h3>
    <div class="td-starters">${cards}</div>
    <p class="td-vs-note">${IDLE_MINUTES}分間だれも操作しないと部屋は消えます。</p>
    ${message}
    <div class="td-modal-actions">
      ${ready ? '<button type="button" class="td-btn" data-td="vs-unready">選び直す</button>' : ''}
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
    </div>
  `;
}

/**
 * 募集中の部屋の一覧（部屋名の書かれたアイコン。押すとその部屋に入る）。
 * rooms が null なら読み込み中、error があればそれを出す
 */
export function renderVersusRoomList(rooms: readonly TDVersusRoomListing[] | null, error: string | null): string {
  if (error) return `<p class="td-vs-rooms-empty">${esc(error)}</p>`;
  if (!rooms) return '<p class="td-vs-rooms-empty">部屋を探しています…</p>';
  if (rooms.length === 0) return '<p class="td-vs-rooms-empty">いま募集中の部屋はありません。<br />部屋を作って相手を待つか、少し待ってみてください。</p>';
  return `<div class="td-vs-room-grid">${rooms
    .map(
      (r) => `<button type="button" class="td-vs-room-card" data-vs-room="${esc(r.name)}" title="部屋「${esc(r.name)}」に入る">
        <span class="td-vs-room-icon">🏰</span>
        <b>${esc(r.name)}</b>
        <small>募集中 ${r.players}/2</small>
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
  const color = slotColorName(ls.slot);
  const head = el.querySelector<HTMLElement>('.td-vs-head')!;
  head.textContent = `⚔ あなた：${color}（${ls.slot === 0 ? '左' : '右'}の城）`;
  head.className = `td-vs-head ${ls.slot === 1 ? 'red' : 'blue'}`;
  const base = opp.playerBase;
  const ratio = base && base.maxHp > 0 ? Math.max(0, base.hp) / base.maxHp : 0;
  el.querySelector<HTMLElement>('.td-hp.enemy i')!.style.width = `${ratio * 100}%`;
  el.querySelector<HTMLElement>('.td-vs-hp')!.textContent = `${Math.ceil(Math.max(0, base?.hp ?? 0)).toLocaleString()}`;
  const left = Math.max(0, TD_DUEL_TIME_LIMIT - mine.time);
  const m = Math.floor(left / 60);
  const s = String(Math.floor(left % 60)).padStart(2, '0');
  el.querySelector<HTMLElement>('.td-vs-stats')!.textContent = `相手 Lv${opp.level} ｜ 撃破 ${opp.kills} ｜ 残り ${m}:${s}`;
  const net = el.querySelector<HTMLElement>('.td-vs-net')!;
  if (ls.desyncTurn !== null) {
    net.textContent = '⚠ 相手と戦況がずれました（勝敗は先に届いた判定で決まります）';
    net.className = 'td-vs-net warn';
  } else if (ls.stalled && ls.stallTime >= STALL_NOTICE_SECONDS) {
    net.textContent = `⏳ 相手の通信を待っています… ${ls.stallTime.toFixed(1)}s`;
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
  win: '🏆 勝利！',
  lose: '💥 敗北…',
  draw: '🤝 引き分け',
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
      <div><small>到達レベル（あなた / 相手）</small><b>${mine.level} / ${opponent.level}</b></div>
      <div><small>城の残り（あなた / 相手）</small><b>${hpText(mine)} / ${hpText(opponent)}</b></div>
    </div>
    <div class="td-modal-actions">
      ${canRematch ? '<button type="button" class="td-btn primary" data-td="vs-lobby">↺ 同じ部屋で再戦</button>' : ''}
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
      <button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button>
    </div>
  `;
}
