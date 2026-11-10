/** 空き枠に点線で描く、架空のユニットの顔 */
export const EMPTY_UNIT_FACE_SVG = `<svg viewBox="0 0 36 36" class="empty-slot-face" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 1.8">
  <path d="M9 12 V5 H27 V12"/>
  <rect x="9" y="9" width="18" height="17" rx="1"/>
  <rect x="13" y="14" width="3" height="4"/>
  <rect x="20" y="14" width="3" height="4"/>
  <path d="M15 22 H21"/>
  <path d="M6 34 V30 H30 V34"/>
</svg>`;

/** 空きレリック枠に点線で描く宝石 */
export const EMPTY_RELIC_SVG = `<svg viewBox="0 0 36 36" class="empty-slot-face" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 1.8">
  <path d="M11 7 H25 L32 15 L18 31 L4 15 Z"/>
  <path d="M4 15 H32"/>
  <path d="M13 15 L18 31 L23 15"/>
</svg>`;

/** ユニット枠の購入ボタン */
export const UNIT_SLOT_ICON_SVG = `<svg viewBox="0 0 48 48" class="room-icon" aria-hidden="true">
  <rect x="8" y="6" width="26" height="10" fill="#7a4a1f"/>
  <rect x="8" y="12" width="26" height="20" fill="#f0c39c"/>
  <rect x="13" y="18" width="5" height="6" fill="#26282e"/>
  <rect x="24" y="18" width="5" height="6" fill="#26282e"/>
  <rect x="16" y="27" width="10" height="2" fill="#a8603a"/>
  <rect x="4" y="34" width="34" height="10" fill="#3b82f6"/>
  <rect x="30" y="26" width="18" height="18" fill="#2f9e44" stroke="#fff" stroke-width="2"/>
  <rect x="37" y="30" width="4" height="10" fill="#fff"/>
  <rect x="34" y="33" width="10" height="4" fill="#fff"/>
</svg>`;

/** レリック枠の購入ボタン */
export const RELIC_SLOT_ICON_SVG = `<svg viewBox="0 0 48 48" class="room-icon" aria-hidden="true">
  <path d="M12 6 H32 L42 18 L22 42 L2 18 Z" fill="#be4bdb" stroke="#5f1a75" stroke-width="2"/>
  <path d="M12 6 L16 18 L22 42 L28 18 L32 6 Z" fill="#e599f7"/>
  <path d="M2 18 H42" stroke="#5f1a75" stroke-width="2"/>
  <rect x="30" y="26" width="18" height="18" fill="#2f9e44" stroke="#fff" stroke-width="2"/>
  <rect x="37" y="30" width="4" height="10" fill="#fff"/>
  <rect x="34" y="33" width="10" height="4" fill="#fff"/>
</svg>`;

/** 出撃ボタン（交差した剣） */
export const SORTIE_ICON_SVG = `<svg viewBox="0 0 48 48" class="room-icon" aria-hidden="true">
  <g fill="#e9ecef" stroke="#343a40" stroke-width="1.5">
    <path d="M40 3 H45 V8 L18 35 L13 30 Z"/>
    <path d="M8 3 H3 V8 L30 35 L35 30 Z"/>
  </g>
  <g fill="#ffd43b" stroke="#7a4a00" stroke-width="1.5">
    <rect x="7" y="31" width="14" height="5" transform="rotate(45 14 33.5)"/>
    <rect x="27" y="31" width="14" height="5" transform="rotate(-45 34 33.5)"/>
  </g>
  <g fill="#7a4a1f" stroke="#3b2410" stroke-width="1">
    <rect x="7" y="37" width="5" height="8" transform="rotate(45 9.5 41)"/>
    <rect x="36" y="37" width="5" height="8" transform="rotate(-45 38.5 41)"/>
  </g>
</svg>`;

/** 戦場を見るボタン（双眼鏡） */
export const SCOUT_ICON_SVG = `<svg viewBox="0 0 48 48" class="room-icon" aria-hidden="true">
  <rect x="20" y="16" width="8" height="10" fill="#495057" stroke="#212529" stroke-width="1.5"/>
  <g fill="#343a40" stroke="#212529" stroke-width="1.5">
    <rect x="7" y="8" width="13" height="16"/>
    <rect x="28" y="8" width="13" height="16"/>
    <rect x="3" y="22" width="19" height="19"/>
    <rect x="26" y="22" width="19" height="19"/>
  </g>
  <g fill="#74c0fc">
    <rect x="7" y="27" width="11" height="10"/>
    <rect x="30" y="27" width="11" height="10"/>
  </g>
  <g fill="#e7f5ff">
    <rect x="9" y="29" width="4" height="3"/>
    <rect x="32" y="29" width="4" height="3"/>
  </g>
</svg>`;
