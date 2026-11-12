// TD オンライン対戦の画面（ロビー・相手の戦況・リザルト）の HTML を組み立てる。
// 表示の切り替えとクリックの処理は RealtimeTDHud が受け持つ。
import type { TDRun } from '../game/RealtimeTDMode';
import { TD_VS_SEND_INTERVAL } from '../game/RealtimeTDMode';
import { ROGUE_STARTERS } from '../game/RogueliteMode';
import type { TDVersusSession } from '../game/TDVersusSession';
import { TD_VS_IDLE_MS, TD_VS_ROOM_NAME_MAX, type TDVersusEndReason } from '../net/tdVersusProtocol';
import { UNIT_TYPES } from '../units/UnitTypes';
import { getUnitIconSvg } from './UnitIcons';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const IDLE_MINUTES = Math.round(TD_VS_IDLE_MS / 60000);

const RULES_TEXT = `相手と同時に、同じ敵ウェーブを守り合う対戦。レベルアップの3択は相手と同じ内容が出る（宝箱の中身は各自ランダム）。
敵を倒すと相手の戦場へ敵が送り込まれる。先に敵の城を壊すか、相手の城が落ちたら勝ち。対戦中は一時停止できない。`;

/** ロビー（部屋名の入力・部屋での待機） */
export function renderVersusLobby(vs: TDVersusSession, roomDraft: string): string {
  const message = vs.message ? `<p class="td-vs-message">${esc(vs.message)}</p>` : '';
  if (vs.phase === 'idle') {
    return `
      <h2>🌐 オンライン対戦</h2>
      <p class="td-lead">${esc(RULES_TEXT)}</p>
      <h3>部屋名を入力</h3>
      <div class="td-vs-join">
        <input type="text" class="td-vs-room" maxlength="${TD_VS_ROOM_NAME_MAX}" placeholder="例: takenoko" value="${esc(roomDraft)}" autocomplete="off" />
        <button type="button" class="td-btn primary" data-td="vs-join">入室</button>
      </div>
      <p class="td-vs-note">同じ部屋名を入れた2人が対戦できます。${IDLE_MINUTES}分間だれも操作しない部屋は自動で消えます。</p>
      ${message}
      <div class="td-modal-actions">
        <button type="button" class="td-btn" data-td="vs-back">← 1人で遊ぶ</button>
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
  const opponent = !vs.opponentPresent ? '相手を待っています…' : vs.opponentReady ? '準備OK' : 'スターターを選んでいます';
  const mine = ready ? '準備OK（相手を待っています）' : 'スターターを選ぶと準備完了';
  return `
    <h2>🌐 部屋「${esc(vs.room)}」</h2>
    <div class="td-vs-slots">
      <div class="td-vs-slot me${ready ? ' ready' : ''}"><small>あなた</small><b>${mine}</b></div>
      <div class="td-vs-slot${vs.opponentPresent ? '' : ' empty'}${vs.opponentReady ? ' ready' : ''}"><small>相手</small><b>${opponent}</b></div>
    </div>
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

/** 試合中に出す相手の戦況 */
export function renderVersusPanel(): string {
  return `
    <div class="td-vs-head">⚔ 相手</div>
    <div class="td-vs-row"><span>城</span><div class="td-hp"><i></i></div><b class="td-vs-hp"></b></div>
    <div class="td-vs-row"><span>敵城</span><div class="td-hp enemy"><i></i></div><b class="td-vs-enemy"></b></div>
    <div class="td-vs-stats"></div>
    <div class="td-vs-send" title="敵を倒すとたまり、${TD_VS_SEND_INTERVAL}秒ごとに相手の戦場へ送り込まれる"></div>
  `;
}

/** 相手の戦況の表示を更新する */
export function updateVersusPanel(el: HTMLElement, td: TDRun, vs: TDVersusSession): void {
  const o = vs.opponent;
  const hpRatio = o && o.maxHp > 0 ? o.hp / o.maxHp : 1;
  el.querySelector<HTMLElement>('.td-hp:not(.enemy) i')!.style.width = `${hpRatio * 100}%`;
  el.querySelector<HTMLElement>('.td-vs-hp')!.textContent = o ? `${Math.ceil(o.hp).toLocaleString()}` : '-';
  el.querySelector<HTMLElement>('.td-hp.enemy i')!.style.width = `${(o?.enemyBaseRatio ?? 1) * 100}%`;
  el.querySelector<HTMLElement>('.td-vs-enemy')!.textContent = o ? `${Math.round(o.enemyBaseRatio * 100)}%` : '-';
  el.querySelector<HTMLElement>('.td-vs-stats')!.textContent = o
    ? `Lv${o.level} ｜ WAVE ${o.wave} ｜ 撃破 ${o.kills}`
    : vs.phase === 'playing'
      ? '相手の情報を待っています…'
      : '';
  el.querySelector<HTMLElement>('.td-vs-send')!.textContent =
    `📤 送り込み ${Math.round(td.sendBank)} ｜ 送った ${td.sentTotal} ｜ 受けた ${td.receivedTotal}`;
  el.classList.toggle('danger', hpRatio < 0.3);
}

const REASON_TEXT: Record<TDVersusEndReason, [win: string, lose: string]> = {
  castle: ['相手の城が陥落！', '城が陥落…'],
  clear: ['敵の城を先に破壊！', '相手が先に敵の城を破壊…'],
  left: ['相手が退室しました', '接続が切れました'],
  surrender: ['相手が降参しました', '降参しました'],
};

/** 対戦のリザルト */
export function renderVersusResult(td: TDRun, won: boolean, reason: TDVersusEndReason, vs: TDVersusSession): string {
  const [winText, loseText] = REASON_TEXT[reason];
  const m = Math.floor(td.time / 60);
  const s = String(Math.floor(td.time % 60)).padStart(2, '0');
  const canRematch = vs.connected && (vs.phase === 'ended' || vs.phase === 'room');
  return `
    <h2 class="${won ? 'win' : 'lose'}">${won ? '🏆 勝利！' : '💥 敗北…'}</h2>
    <p class="td-lead">${won ? winText : loseText}</p>
    <div class="td-result-grid">
      <div><small>経過時間</small><b>${m}:${s}</b></div>
      <div><small>到達 WAVE</small><b>${td.wave}</b></div>
      <div><small>撃破数</small><b>${td.kills}</b></div>
      <div><small>到達レベル</small><b>${td.level}</b></div>
      <div><small>送り込んだ予算</small><b>${td.sentTotal.toLocaleString()}</b></div>
      <div><small>送り込まれた予算</small><b>${td.receivedTotal.toLocaleString()}</b></div>
    </div>
    <div class="td-modal-actions">
      ${canRematch ? '<button type="button" class="td-btn primary" data-td="vs-lobby">↺ 同じ部屋で再戦</button>' : ''}
      <button type="button" class="td-btn" data-td="vs-leave">退室</button>
      <button type="button" class="td-btn" data-td="title">🏠 タイトルへ</button>
    </div>
  `;
}
