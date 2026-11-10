import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { UnitCategory, UnitTypeId } from '../units/UnitTypes';

export type PaletteCategory = UnitCategory | 'facility' | 'terrain';

/** カテゴリごとのシンボルアイコン（タブ・バッジ表示用） */
export const CATEGORY_ICONS: Readonly<Record<PaletteCategory | 'all', string>> = {
  all: '🗂️',
  standard: '⚔️',
  magic: '🔮',
  modern: '💣',
  japanese: '⛩️',
  animal: '🐾',
  mythical: '🐉',
  divine: '👁️',
  facility: '🏛️',
  terrain: '🧱',
};

/** カテゴリごとのテーマ背景グラデーション色 */
export const CATEGORY_THEME_COLORS: Readonly<Record<PaletteCategory, { bg: string; border: string }>> = {
  standard: { bg: 'linear-gradient(135deg, #2b3a4a, #1e293b)', border: '#60a5fa' },
  magic: { bg: 'linear-gradient(135deg, #3b1d5e, #24123b)', border: '#c084fc' },
  modern: { bg: 'linear-gradient(135deg, #2d3d32, #1c261f)', border: '#8ce99a' },
  japanese: { bg: 'linear-gradient(135deg, #4a1d2e, #2b121c)', border: '#ff85c0' },
  animal: { bg: 'linear-gradient(135deg, #4a3723, #2d2115)', border: '#fcc419' },
  mythical: { bg: 'linear-gradient(135deg, #4f1d1d, #2d1010)', border: '#ff6b6b' },
  divine: { bg: 'linear-gradient(135deg, #341a4a, #1a0d26)', border: '#845ef7' },
  facility: { bg: 'linear-gradient(135deg, #2a3a40, #17242a)', border: '#38d9a9' },
  terrain: { bg: 'linear-gradient(135deg, #3d352a, #241f18)', border: '#f59f00' },
};

/** コスト（コイン）アイコン SVG */
export const COST_ICON_SVG = `<svg class="stat-icon cost-icon" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
  <circle cx="10" cy="10" r="8.5" fill="#ffd43b" stroke="#e67700" stroke-width="1.8"/>
  <circle cx="10" cy="10" r="6" fill="none" stroke="#fff3bf" stroke-width="1" stroke-dasharray="2 1.5"/>
  <path d="M10 5.5 L11.4 8.5 L14.6 9 L12.2 11.2 L12.8 14.4 L10 12.8 L7.2 14.4 L7.8 11.2 L5.4 9 L8.6 8.5 Z" fill="#f08c00"/>
</svg>`;

/** HP（ハート）アイコン SVG */
export const HP_ICON_SVG = `<svg class="stat-icon hp-icon" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
  <path d="M10 17.2 C10 17.2 2.5 12.2 2.5 6.8 C2.5 4.2 4.5 2.3 7 2.3 C8.5 2.3 9.5 3.1 10 4.1 C10.5 3.1 11.5 2.3 13 2.3 C15.5 2.3 17.5 4.2 17.5 6.8 C17.5 12.2 10 17.2 10 17.2 Z" fill="#ff6b6b" stroke="#c92a2a" stroke-width="1.4"/>
  <path d="M5.5 5.2 C4.6 5.8 4.3 6.8 4.3 7.5" stroke="#ffc9c9" stroke-width="1.4" stroke-linecap="round" fill="none"/>
</svg>`;

/**
 * 全18兵種それぞれの特徴（兜・頭巾・髪・髭・角・武器・エフェクト）を描いた
 * ボクセル風キャラクターアイコン SVG を返す。
 */
export function getUnitIconSvg(typeId: UnitTypeId): string {
  switch (typeId) {
    case 'clubber':
      // 棍棒兵: 茶髪＋赤シャツ＋木の棍棒
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="9" y="23" width="14" height="10" rx="1" fill="#c8372d"/>
        <!-- 顔 -->
        <rect x="9" y="10" width="14" height="13" rx="1" fill="#f0c39c"/>
        <!-- 茶髪 -->
        <rect x="8" y="7" width="16" height="5" fill="#5a3a20"/>
        <rect x="8" y="10" width="2" height="5" fill="#5a3a20"/>
        <!-- 目 -->
        <rect x="12" y="15" width="3" height="3" fill="#ffffff"/>
        <rect x="13" y="15" width="2" height="3" fill="#181820"/>
        <rect x="18" y="15" width="3" height="3" fill="#ffffff"/>
        <rect x="19" y="15" width="2" height="3" fill="#181820"/>
        <!-- 木の棍棒 -->
        <g transform="rotate(18 28 18)">
          <rect x="25" y="6" width="6" height="14" rx="1.5" fill="#8b5a2b" stroke="#4a2e14" stroke-width="1"/>
          <rect x="26.5" y="19" width="3" height="9" fill="#a06b38"/>
          <rect x="24" y="9" width="2" height="2" fill="#d9a066"/>
        </g>
      </svg>`;

    case 'swordsman':
      // 剣士: 鉄兜＋鎧＋銀の長剣
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 鎧胴体 -->
        <rect x="8" y="23" width="15" height="10" fill="#8a9098"/>
        <rect x="11" y="25" width="9" height="6" fill="#c8372d"/>
        <!-- 顔 -->
        <rect x="9" y="11" width="13" height="12" fill="#f0c39c"/>
        <!-- 鉄兜 -->
        <rect x="7" y="6" width="17" height="7" fill="#9aa0a8"/>
        <rect x="14" y="4" width="4" height="3" fill="#e0473a"/>
        <rect x="7" y="12" width="3" height="9" fill="#707882"/>
        <rect x="21" y="12" width="3" height="9" fill="#707882"/>
        <rect x="14.5" y="11" width="2" height="6" fill="#707882"/>
        <!-- 目 -->
        <rect x="11" y="15" width="3" height="2.5" fill="#181820"/>
        <rect x="17" y="15" width="3" height="2.5" fill="#181820"/>
        <!-- 銀の剣 -->
        <g transform="rotate(15 28 18)">
          <polygon points="28,3 31,7 31,21 25,21 25,7" fill="#e9ecef" stroke="#495057" stroke-width="1"/>
          <rect x="23" y="21" width="10" height="2.5" fill="#ffd43b"/>
          <rect x="26.5" y="23.5" width="3" height="6" fill="#6b4423"/>
        </g>
      </svg>`;

    case 'spearman':
      // 槍兵: 銅兜＋長槍
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="8" y="23" width="14" height="10" fill="#c8372d"/>
        <!-- 顔 -->
        <rect x="9" y="11" width="12" height="12" fill="#f0c39c"/>
        <!-- 銅の陣笠風兜 -->
        <polygon points="5,12 15,5 25,12" fill="#b08a4a" stroke="#7a5c28" stroke-width="1"/>
        <rect x="8" y="11" width="14" height="2.5" fill="#8c6d36"/>
        <!-- 目 -->
        <rect x="11" y="15" width="2.5" height="3" fill="#181820"/>
        <rect x="16.5" y="15" width="2.5" height="3" fill="#181820"/>
        <!-- 長槍 -->
        <line x1="25" y1="33" x2="30" y2="9" stroke="#8b5a2b" stroke-width="3"/>
        <polygon points="31,2 34,11 27,10" fill="#dee2e6" stroke="#495057" stroke-width="0.8"/>
      </svg>`;

    case 'archer':
      // 弓兵: 緑のフード＋木弓と矢
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="8" y="23" width="14" height="10" fill="#3f6b2e"/>
        <!-- フード外枠 -->
        <rect x="7" y="7" width="16" height="16" rx="2" fill="#3f6b2e"/>
        <!-- 顔 -->
        <rect x="10" y="11" width="11" height="11" fill="#f0c39c"/>
        <!-- 目 -->
        <rect x="12" y="15" width="2.5" height="2.5" fill="#181820"/>
        <rect x="17" y="15" width="2.5" height="2.5" fill="#181820"/>
        <!-- 弓と矢 -->
        <path d="M25 5 Q34 18 25 31" fill="none" stroke="#8b5a2b" stroke-width="2.6"/>
        <line x1="25" y1="5" x2="25" y2="31" stroke="#dee2e6" stroke-width="1"/>
        <line x1="19" y1="18" x2="33" y2="18" stroke="#ffd43b" stroke-width="1.8"/>
        <polygon points="35,18 31,15.5 31,20.5" fill="#adb5bd"/>
      </svg>`;

    case 'shielder':
      // 盾兵: 重装鉄兜＋巨大な盾
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="6" y="22" width="14" height="11" fill="#626a74"/>
        <!-- 鉄兜・顔 -->
        <rect x="6" y="7" width="14" height="15" rx="1" fill="#707882"/>
        <rect x="8" y="12" width="10" height="4" fill="#1e242b"/>
        <rect x="9" y="13" width="3" height="2" fill="#f0c39c"/>
        <rect x="14" y="13" width="3" height="2" fill="#f0c39c"/>
        <!-- 巨大な大盾 -->
        <rect x="17" y="7" width="15" height="24" rx="2" fill="#495057" stroke="#adb5bd" stroke-width="2"/>
        <rect x="20" y="10" width="9" height="18" fill="#c8372d"/>
        <rect x="23" y="16" width="3" height="6" fill="#ffd43b"/>
      </svg>`;

    case 'charger':
      // 突撃兵: 赤毛・赤髭のバーサーカー＋角兜＋戦斧
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="8" y="23" width="14" height="10" fill="#c8372d"/>
        <!-- 顔 -->
        <rect x="9" y="11" width="13" height="11" fill="#f0c39c"/>
        <!-- 赤髭・赤髪 -->
        <rect x="8" y="18" width="15" height="7" fill="#c94a29"/>
        <!-- 角付き革兜 -->
        <rect x="8" y="7" width="15" height="5" fill="#8c7048"/>
        <polygon points="8,9 3,4 6,11" fill="#f8f9fa"/>
        <polygon points="23,9 28,4 25,11" fill="#f8f9fa"/>
        <!-- 怒り目 -->
        <rect x="11" y="14" width="3" height="2.5" fill="#181820"/>
        <rect x="17" y="14" width="3" height="2.5" fill="#181820"/>
        <!-- 戦斧 -->
        <line x1="27" y1="7" x2="27" y2="32" stroke="#8b5a2b" stroke-width="2.8"/>
        <path d="M27 8 L35 5 L35 17 L27 14 Z" fill="#dee2e6" stroke="#495057" stroke-width="1"/>
      </svg>`;

    case 'bomber':
      // 爆弾兵: 赤バンダナ・黒髭＋火花散る黒色火薬爆弾
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体 -->
        <rect x="7" y="23" width="14" height="10" fill="#495057"/>
        <!-- 顔と黒髭 -->
        <rect x="8" y="11" width="12" height="11" fill="#f0c39c"/>
        <rect x="8" y="18" width="12" height="5" fill="#2b2b2b"/>
        <!-- バンダナ頭巾 -->
        <rect x="7" y="7" width="14" height="5" fill="#8c3b2b"/>
        <!-- 目 -->
        <rect x="10" y="14" width="2.5" height="2.5" fill="#181820"/>
        <rect x="15" y="14" width="2.5" height="2.5" fill="#181820"/>
        <!-- 黒爆弾と火花 -->
        <circle cx="27" cy="21" r="7" fill="#212529" stroke="#495057" stroke-width="1.2"/>
        <circle cx="25" cy="19" r="1.8" fill="#868e96"/>
        <path d="M27 14 Q28 10 31 9" fill="none" stroke="#d9a066" stroke-width="1.8"/>
        <circle cx="31.5" cy="8.5" r="3" fill="#ff922b"/>
        <circle cx="31.5" cy="8.5" r="1.5" fill="#ffe066"/>
      </svg>`;

    case 'giant':
      // 巨人: 巨大な顔・茶髭＋大棍棒
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 巨体の肩 -->
        <rect x="4" y="22" width="20" height="12" rx="2" fill="#d9a77a"/>
        <rect x="7" y="27" width="14" height="7" fill="#c8372d"/>
        <!-- 巨大な頭部 -->
        <rect x="6" y="6" width="16" height="17" rx="1.5" fill="#d9a77a"/>
        <!-- 髪と顎髭 -->
        <rect x="6" y="5" width="16" height="4" fill="#6a3a1a"/>
        <rect x="6" y="18" width="16" height="6" fill="#6a3a1a"/>
        <!-- 牙と目 -->
        <rect x="9" y="12" width="3.5" height="3" fill="#181820"/>
        <rect x="15.5" y="12" width="3.5" height="3" fill="#181820"/>
        <rect x="10" y="17" width="2" height="2" fill="#ffffff"/>
        <rect x="16" y="17" width="2" height="2" fill="#ffffff"/>
        <!-- 大棍棒 -->
        <rect x="24" y="4" width="9" height="20" rx="2" fill="#6b4423" stroke="#3d2512" stroke-width="1.2"/>
        <rect x="26.5" y="24" width="4" height="9" fill="#8b5a2b"/>
      </svg>`;

    case 'archmage':
      // 雷導師: 紫のローブ・白髭＋稲妻を放つ杖
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 紫ローブ -->
        <rect x="7" y="22" width="15" height="11" fill="#3b2266"/>
        <!-- 紫フード -->
        <polygon points="14.5,3 4,13 7,23 22,23 25,13" fill="#4b2e83"/>
        <!-- 顔・白髭 -->
        <rect x="9.5" y="11" width="10" height="10" fill="#f0c39c"/>
        <polygon points="9,17 19.5,17 14.5,28" fill="#e8edf5"/>
        <!-- 光る青白い目 -->
        <rect x="11" y="13.5" width="2.5" height="2.5" fill="#66f0ff"/>
        <rect x="16" y="13.5" width="2.5" height="2.5" fill="#66f0ff"/>
        <!-- 雷の杖と稲妻 -->
        <line x1="27" y1="12" x2="27" y2="33" stroke="#8b5a2b" stroke-width="2.5"/>
        <circle cx="27" cy="10" r="3.5" fill="#66f0ff" stroke="#ffffff" stroke-width="1"/>
        <polyline points="31,3 27,8 32,9 26,15" fill="none" stroke="#ffe066" stroke-width="2"/>
      </svg>`;

    case 'gravimancer':
      // 重力術師: 黄金冠・暗黒フード＋紫黒のブラックホール球
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- ローブ -->
        <rect x="7" y="22" width="14" height="11" fill="#2a1d4e"/>
        <!-- フードと黄金冠 -->
        <rect x="7" y="8" width="14" height="14" rx="2" fill="#1f1638"/>
        <polygon points="7,9 10,4 14,8 18,4 21,9" fill="#d4af37"/>
        <!-- 薄紫の肌と紫に光る目 -->
        <rect x="9.5" y="11" width="9" height="10" fill="#dcc8f0"/>
        <rect x="11" y="14" width="2.5" height="2.5" fill="#e599f7"/>
        <rect x="15" y="14" width="2.5" height="2.5" fill="#e599f7"/>
        <!-- ブラックホール球 -->
        <circle cx="27.5" cy="16" r="6.5" fill="#190628" stroke="#ae3ec9" stroke-width="2"/>
        <circle cx="27.5" cy="16" r="3.5" fill="none" stroke="#e599f7" stroke-width="1.2" stroke-dasharray="3 2"/>
        <circle cx="27.5" cy="16" r="1.8" fill="#ffffff"/>
      </svg>`;

    case 'sniper':
      // 対物スナイパー: ギリーフード＋赤いレーザー照準スコープ銃
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 迷彩スーツ -->
        <rect x="7" y="22" width="14" height="11" fill="#354230"/>
        <rect x="6" y="7" width="16" height="15" rx="2" fill="#4a5d43"/>
        <rect x="9" y="11" width="10" height="9" fill="#2b3627"/>
        <!-- 赤く光るスコープゴーグル -->
        <circle cx="12" cy="15" r="2.2" fill="#ff4d4f"/>
        <circle cx="17" cy="15" r="2.2" fill="#ff4d4f"/>
        <!-- 対物ライフルとレーザー照準マーク -->
        <rect x="16" y="21" width="18" height="3.2" fill="#212529"/>
        <rect x="21" y="18.5" width="7" height="2" fill="#495057"/>
        <circle cx="28" cy="11" r="4.5" fill="none" stroke="#ff4d4f" stroke-width="1.4"/>
        <line x1="22" y1="11" x2="34" y2="11" stroke="#ff4d4f" stroke-width="1.2"/>
        <line x1="28" y1="5" x2="28" y2="17" stroke="#ff4d4f" stroke-width="1.2"/>
      </svg>`;

    case 'minigunner':
      // ガトリング重装兵: 重装甲ヘルメット・バイザー＋ガトリング砲身
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 重装甲ボディ -->
        <rect x="6" y="20" width="16" height="13" rx="1" fill="#4f5661"/>
        <!-- ヘルメット -->
        <rect x="7" y="6" width="14" height="14" rx="2" fill="#424852"/>
        <!-- 黄色いタクティカルバイザー -->
        <rect x="9" y="11" width="10" height="4" fill="#ffd43b"/>
        <!-- 多銃身ガトリングとマズルフラッシュ -->
        <rect x="15" y="22" width="16" height="7" rx="1" fill="#212529" stroke="#adb5bd" stroke-width="1"/>
        <line x1="20" y1="24" x2="31" y2="24" stroke="#ced4da" stroke-width="1.4"/>
        <line x1="20" y1="27" x2="31" y2="27" stroke="#ced4da" stroke-width="1.4"/>
        <polygon points="31,21 36,23 33,25.5 36,28 31,30" fill="#ffe066"/>
      </svg>`;

    case 'samurai':
      // 居合の剣豪: 黒兜・三日月前立＋日本刀の一閃と桜
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 和装鎧 -->
        <rect x="8" y="22" width="14" height="11" fill="#26232e"/>
        <line x1="10" y1="22" x2="18" y2="33" stroke="#c8372d" stroke-width="2"/>
        <!-- 兜吹き返し -->
        <polygon points="4,16 9,8 21,8 26,16" fill="#2b2b36"/>
        <!-- 顔 -->
        <rect x="9.5" y="11" width="11" height="11" fill="#f0c39c"/>
        <!-- 三日月前立 -->
        <path d="M11 6 L15 9 L19 6 L15 11 Z" fill="#ffd43b"/>
        <!-- 目 -->
        <rect x="11" y="15" width="2.5" height="2" fill="#181820"/>
        <rect x="16.5" y="15" width="2.5" height="2" fill="#181820"/>
        <!-- 日本刀の蒼い一閃と桜の花びら -->
        <path d="M24 31 Q33 17 26 3" fill="none" stroke="#e9ecef" stroke-width="2.5"/>
        <path d="M26 31 Q35 17 28 3" fill="none" stroke="#66f0ff" stroke-width="1.2"/>
        <circle cx="31" cy="9" r="2" fill="#ff85c0"/>
        <circle cx="28" cy="14" r="1.5" fill="#ffb3d9"/>
      </svg>`;

    case 'ninja':
      // からくり忍者: 黒頭巾・赤鉢巻・マスク＋十字手裏剣
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 忍装束 -->
        <rect x="8" y="22" width="13" height="11" fill="#1e2029"/>
        <!-- 頭巾と覆面マスク -->
        <rect x="7" y="7" width="15" height="15" rx="2" fill="#1e2029"/>
        <!-- 目の隙間 -->
        <rect x="9" y="12" width="11" height="4.5" fill="#f0c39c"/>
        <rect x="10.5" y="13" width="2.5" height="2.5" fill="#181820"/>
        <rect x="16" y="13" width="2.5" height="2.5" fill="#181820"/>
        <!-- 赤い鉢巻 -->
        <rect x="7" y="9" width="15" height="2.5" fill="#e0473a"/>
        <!-- 十字手裏剣 -->
        <g transform="translate(27,16)">
          <polygon points="0,-8 2.5,-2.5 8,0 2.5,2.5 0,8 -2.5,2.5 -8,0 -2.5,-2.5" fill="#ced4da" stroke="#495057" stroke-width="1"/>
          <circle cx="0" cy="0" r="2" fill="#1e2029"/>
        </g>
      </svg>`;

    case 'warelephant':
      // 鎧戦象: 大きな耳・黄金の戦兜・長い鼻と白い巨牙
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 大きな左右の象の耳 -->
        <rect x="2" y="10" width="7" height="14" rx="2" fill="#686d76"/>
        <rect x="27" y="10" width="7" height="14" rx="2" fill="#686d76"/>
        <!-- 象の頭部 -->
        <rect x="8" y="8" width="20" height="17" rx="2" fill="#7b808a"/>
        <!-- 黄金の戦兜 -->
        <polygon points="9,9 18,3 27,9" fill="#d4af37"/>
        <rect x="15" y="8" width="6" height="6" fill="#d4af37"/>
        <rect x="16.5" y="9.5" width="3" height="3" fill="#e0473a"/>
        <!-- 目 -->
        <rect x="10.5" y="14" width="2.5" height="2.5" fill="#181820"/>
        <rect x="23" y="14" width="2.5" height="2.5" fill="#181820"/>
        <!-- 長い鼻 -->
        <rect x="15" y="17" width="6" height="16" rx="2" fill="#7b808a" stroke="#5c6068" stroke-width="1"/>
        <!-- 左右の白い巨牙 -->
        <path d="M12 22 Q8 29 13 32" fill="none" stroke="#faf8f0" stroke-width="3" stroke-linecap="round"/>
        <path d="M24 22 Q28 29 23 32" fill="none" stroke="#faf8f0" stroke-width="3" stroke-linecap="round"/>
      </svg>`;

    case 'giant_eagle':
      // 大鷲: 白い頭羽・鋭い黄色い鉤クチバシ・茶色の翼
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 茶色の翼と胴体 -->
        <polygon points="2,28 11,17 14,32" fill="#5c3d24"/>
        <polygon points="34,28 25,17 22,32" fill="#5c3d24"/>
        <rect x="10" y="21" width="16" height="12" rx="2" fill="#755132"/>
        <!-- 白い羽毛の頭部 -->
        <rect x="10" y="7" width="16" height="15" rx="3" fill="#f4f4f6"/>
        <!-- 黄金の目 -->
        <rect x="12" y="12" width="3" height="3" fill="#ffd43b"/>
        <rect x="13" y="12.5" width="2" height="2" fill="#181820"/>
        <rect x="21" y="12" width="3" height="3" fill="#ffd43b"/>
        <rect x="21" y="12.5" width="2" height="2" fill="#181820"/>
        <!-- 鋭い鉤クチバシ -->
        <polygon points="15,15 21,15 20,23 18,26 16,23" fill="#f5b82e" stroke="#d99b16" stroke-width="1"/>
      </svg>`;

    case 'dragon':
      // ドラゴン: 広げた皮膜翼・反り返る大角・S字の首・開いた顎から火炎ブレス
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 背後に広げた皮膜翼（指骨とスカラップ状の翼膜） -->
        <polygon points="17,20 33,4 34,12 30,13 32,19 26,19 27,25" fill="#5c1a14" stroke="#2b0d0a" stroke-width="0.8"/>
        <line x1="17" y1="20" x2="33" y2="4" stroke="#8a2a1f" stroke-width="1.4"/>
        <line x1="24" y1="13" x2="30" y2="13" stroke="#8a2a1f" stroke-width="0.8"/>
        <line x1="24" y1="13" x2="26" y2="19" stroke="#8a2a1f" stroke-width="0.8"/>
        <!-- 胴体と腹鱗 -->
        <ellipse cx="18" cy="27" rx="9" ry="5.5" fill="#b8281f"/>
        <path d="M11,29 Q18,34 25,29" fill="none" stroke="#e9cf98" stroke-width="2.4"/>
        <!-- S字の首（前面の腹鱗） -->
        <path d="M13,26 Q9,19 12,12" fill="none" stroke="#b8281f" stroke-width="6" stroke-linecap="round"/>
        <path d="M10.5,25 Q7,19 9.8,13" fill="none" stroke="#e9cf98" stroke-width="2" stroke-linecap="round"/>
        <!-- 後方へ反り返る大角 -->
        <path d="M13,8 Q17,4 18,0.8" fill="none" stroke="#f1e7cf" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M11,8 Q13,3 12.5,0.8" fill="none" stroke="#bfae8a" stroke-width="1.8" stroke-linecap="round"/>
        <!-- 頭部（長い鼻面と開いた顎） -->
        <polygon points="9,7 15,7 15,11 4,12 2.5,10.5 7,8" fill="#c8372d" stroke="#5c1a14" stroke-width="0.6"/>
        <polygon points="6,13.5 14,12 14,14.5 8,15.5" fill="#b8281f" stroke="#5c1a14" stroke-width="0.6"/>
        <polygon points="4,12 14,11.2 14,12.2 6,13.5" fill="#5c0b0b"/>
        <!-- 牙と黄金の瞳 -->
        <polygon points="5,12 5.8,13.3 6.4,11.9" fill="#fbf7ea"/>
        <polygon points="8,11.7 8.7,13 9.3,11.6" fill="#fbf7ea"/>
        <rect x="10.4" y="8.3" width="2" height="1.4" fill="#ffd43b"/>
        <rect x="11.2" y="8.3" width="0.6" height="1.4" fill="#140a00"/>
        <!-- 火炎ブレス -->
        <circle cx="2.2" cy="15.5" r="2.4" fill="#ff7a18" opacity="0.9"/>
        <circle cx="2.4" cy="15.2" r="1.2" fill="#ffd166"/>
      </svg>`;

    case 'slime':
      // 分裂キングスライム: 黄金の王冠＋エメラルドグリーンのぷるぷるボディ
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 黄金の王冠 -->
        <polygon points="9,12 11,4 15,9 18,3 21,9 25,4 27,12" fill="#ffd43b" stroke="#e67700" stroke-width="1"/>
        <!-- スライム本体 -->
        <rect x="5" y="12" width="26" height="20" rx="7" fill="#38d976" stroke="#26b860" stroke-width="1.5"/>
        <!-- ハイライト -->
        <rect x="8" y="15" width="5" height="3" rx="1.5" fill="#b2f2bb"/>
        <!-- 目と口 -->
        <rect x="11" y="19" width="3" height="4" rx="1" fill="#181820"/>
        <rect x="22" y="19" width="3" height="4" rx="1" fill="#181820"/>
        <rect x="15" y="24" width="6" height="2.5" rx="1" fill="#1b4332"/>
      </svg>`;

    case 'buggy':
      // 暴走バギー: オフロードタイヤ・ロールケージ・フォグランプ
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 後輪・前輪タイヤ -->
        <rect x="3" y="18" width="7" height="15" rx="2.5" fill="#1f1f1f" stroke="#495057" stroke-width="1"/>
        <rect x="26" y="18" width="7" height="15" rx="2.5" fill="#1f1f1f" stroke="#495057" stroke-width="1"/>
        <circle cx="6.5" cy="25.5" r="2.5" fill="#ced4da"/>
        <circle cx="29.5" cy="25.5" r="2.5" fill="#ced4da"/>
        <!-- 車体シャーシ＆ボンネット -->
        <rect x="8" y="19" width="20" height="9" rx="2" fill="#212529"/>
        <rect x="10" y="21" width="16" height="6" fill="#e0473a"/>
        <!-- フロントブルバー -->
        <rect x="6" y="26" width="24" height="3" rx="1.5" fill="#495057"/>
        <rect x="14" y="24" width="8" height="2" fill="#ced4da"/>
        <!-- ロールバー（パイプフレーム） -->
        <path d="M11,19 L13,10 L23,10 L25,19" fill="none" stroke="#495057" stroke-width="2.5" stroke-linecap="round"/>
        <!-- ルーフ天板 -->
        <rect x="13" y="8" width="10" height="3" rx="1" fill="#343a40"/>
        <!-- 大型オフロード・フォグランプ -->
        <circle cx="15" cy="7" r="2.2" fill="#ffe066" stroke="#ffd43b" stroke-width="0.8"/>
        <circle cx="21" cy="7" r="2.2" fill="#ffe066" stroke="#ffd43b" stroke-width="0.8"/>
      </svg>`;

    case 'anaconda':
      // 巨大アナコンダ: 鋭い蛇眼・開いた大口と毒牙・二又舌
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- うねる胴体の奥 -->
        <path d="M6,29 Q12,23 18,29 T30,28" fill="none" stroke="#1b4332" stroke-width="7" stroke-linecap="round"/>
        <path d="M6,29 Q12,23 18,29 T30,28" fill="none" stroke="#2d6a4f" stroke-width="5" stroke-linecap="round"/>
        <!-- 蛇頭部（三角形） -->
        <polygon points="18,6 29,18 7,18" fill="#245a30"/>
        <!-- 蛇腹（ペールグリーン） -->
        <polygon points="18,10 24,18 12,18" fill="#b7e4c7"/>
        <!-- 開いた大口（赤） -->
        <polygon points="18,13 25,24 11,24" fill="#991b1b"/>
        <!-- 鋭い白い毒牙 -->
        <polygon points="13,18 15,18 14,23" fill="#f8f9fa"/>
        <polygon points="21,18 23,18 22,23" fill="#f8f9fa"/>
        <!-- 赤い二又の舌 -->
        <path d="M18,22 L18,27 M18,27 L15,31 M18,27 L21,31" stroke="#e03131" stroke-width="1.8" stroke-linecap="round" fill="none"/>
        <!-- 鋭い黄色い蛇眼（縦長の瞳） -->
        <ellipse cx="12" cy="14" rx="2.2" ry="3" fill="#ffd43b"/>
        <ellipse cx="24" cy="14" rx="2.2" ry="3" fill="#ffd43b"/>
        <rect x="11.5" y="12" width="1" height="4" fill="#181820"/>
        <rect x="23.5" y="12" width="1" height="4" fill="#181820"/>
      </svg>`;

    case 'decoy':
      // おとり: 麦わら帽子・藁人形・同心円のターゲットマーク
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 木製の腕・脚棒 -->
        <line x1="4" y1="18" x2="32" y2="18" stroke="#7f5539" stroke-width="3" stroke-linecap="round"/>
        <line x1="18" y1="20" x2="18" y2="33" stroke="#7f5539" stroke-width="3" stroke-linecap="round"/>
        <!-- 麦わら帽子のつば -->
        <ellipse cx="18" cy="10" rx="14" ry="4" fill="#b08968" stroke="#7f5539" stroke-width="1"/>
        <ellipse cx="18" cy="8.5" rx="7" ry="3" fill="#ddb892"/>
        <!-- 帽子リボン -->
        <rect x="12" y="8" width="12" height="1.8" fill="#e0473a"/>
        <!-- 麻袋の頭 -->
        <circle cx="18" cy="13.5" r="4.5" fill="#d4a373"/>
        <circle cx="16" cy="13" r="0.9" fill="#212529"/>
        <circle cx="20" cy="13" r="0.9" fill="#212529"/>
        <!-- 藁の胴体 -->
        <rect x="12" y="17" width="12" height="12" rx="2" fill="#d4a373"/>
        <!-- 胸のターゲットマーク（同心円） -->
        <circle cx="18" cy="23" r="5" fill="#e03131"/>
        <circle cx="18" cy="23" r="3.2" fill="#ffffff"/>
        <circle cx="18" cy="23" r="1.5" fill="#e03131"/>
      </svg>`;

    case 'giant_tank':
      // 戦車（超巨大）: 巨大な装甲車体・キャタピラ・旋回砲塔・長大な主砲
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 左右の履帯（キャタピラ） -->
        <rect x="2" y="24" width="32" height="9" rx="3" fill="#212529" stroke="#121416" stroke-width="1"/>
        <circle cx="6" cy="28.5" r="2.5" fill="#495057"/>
        <circle cx="12" cy="28.5" r="2.5" fill="#495057"/>
        <circle cx="18" cy="28.5" r="2.5" fill="#495057"/>
        <circle cx="24" cy="28.5" r="2.5" fill="#495057"/>
        <circle cx="30" cy="28.5" r="2.5" fill="#495057"/>
        <!-- 重装甲車体シャーシ -->
        <polygon points="4,24 7,16 29,16 32,24" fill="#3d4a3e" stroke="#283329" stroke-width="1"/>
        <!-- チームカラーの識別ストライプ -->
        <rect x="8" y="20" width="20" height="2.5" fill="#e0473a"/>
        <!-- 旋回砲塔 -->
        <rect x="10" y="10" width="16" height="7" rx="1.5" fill="#283329" stroke="#182019" stroke-width="1"/>
        <!-- 長大な主砲バレル＆マズルブレーキ -->
        <rect x="24" y="12" width="11" height="3" fill="#182019"/>
        <rect x="33" y="11" width="2.5" height="5" rx="0.5" fill="#495057"/>
        <!-- コマンダーハッチ -->
        <rect x="13" y="8" width="5" height="2.5" rx="1" fill="#e0473a"/>
      </svg>`;

    case 'rocket_soldier':
      // ロケットランチャー兵士: ヘルメット＋ゴーグル＋肩担ぎRPG
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 胴体ベスト -->
        <rect x="8" y="22" width="14" height="11" fill="#4a554a"/>
        <rect x="10" y="24" width="10" height="5" fill="#e0473a"/>
        <!-- 顔 -->
        <rect x="9" y="11" width="12" height="11" fill="#f0c39c"/>
        <!-- 目 -->
        <rect x="11" y="16" width="3" height="2.5" fill="#181820"/>
        <rect x="16" y="16" width="3" height="2.5" fill="#181820"/>
        <!-- コンバットヘルメット -->
        <rect x="7" y="6" width="16" height="7" rx="1" fill="#3b443b"/>
        <!-- タクティカルゴーグル（額） -->
        <rect x="8" y="9" width="14" height="3" rx="0.8" fill="#212529"/>
        <rect x="10" y="9.5" width="4" height="2" fill="#ff922b"/>
        <rect x="16" y="9.5" width="4" height="2" fill="#ff922b"/>
        <!-- 肩担ぎロケットランチャー -->
        <g transform="rotate(-18 24 16)">
          <rect x="16" y="13" width="18" height="5" rx="1" fill="#283329" stroke="#182019" stroke-width="0.8"/>
          <rect x="14" y="12" width="3" height="7" rx="0.5" fill="#212529"/>
          <!-- 突き出たロケット弾頭 -->
          <polygon points="34,13 38,15.5 34,18" fill="#ff922b"/>
          <rect x="22" y="11" width="4" height="2" fill="#495057"/>
        </g>
      </svg>`;

    case 'satellite_soldier':
      // 衛星攻撃兵士: 近未来バイザーヘルメット＋PDA端末＋天頂ビーム
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 天頂からの細い誘導光線 -->
        <line x1="28" y1="0" x2="28" y2="36" stroke="#38d9a9" stroke-width="1.8" stroke-dasharray="2 1.5"/>
        <circle cx="28" cy="32" r="3.5" fill="none" stroke="#38d9a9" stroke-width="1.2"/>
        <!-- 胴体スーツ -->
        <rect x="6" y="22" width="13" height="11" fill="#111827"/>
        <rect x="8" y="24" width="9" height="5" fill="#e0473a"/>
        <!-- 顔・ヘルメット -->
        <rect x="6" y="10" width="13" height="12" rx="2" fill="#1f2937"/>
        <!-- 発光アイバイザー -->
        <rect x="7" y="13" width="11" height="4" rx="1" fill="#38d9a9"/>
        <rect x="9" y="14" width="2" height="2" fill="#ffffff"/>
        <!-- 通信アンテナ -->
        <line x1="16" y1="10" x2="16" y2="3" stroke="#9ca3af" stroke-width="1.5"/>
        <circle cx="16" cy="2.5" r="1.2" fill="#ff6b6b"/>
        <!-- 手元の戦術PDA端末 -->
        <rect x="15" y="20" width="8" height="10" rx="1" fill="#1f2937" stroke="#38d9a9" stroke-width="0.8"/>
        <rect x="16.5" y="21.5" width="5" height="5" fill="#38d9a9"/>
      </svg>`;

    case 'angel_ramiel':
      return `<svg viewBox="0 0 48 48" class="unit-portrait-svg" fill="none" stroke="currentColor">
        <polygon points="24,2 44,24 24,46 4,24" fill="#1864ab" fill-opacity="0.55" stroke="#e0f2fe" stroke-width="2"/>
        <polygon points="24,2 44,24 24,24" fill="#74c0fc" fill-opacity="0.65"/>
        <polygon points="24,2 4,24 24,24" fill="#e0f2fe" fill-opacity="0.75"/>
        <polygon points="24,46 44,24 24,24" fill="#1971c2" fill-opacity="0.7"/>
        <polygon points="24,46 4,24 24,24" fill="#339af0" fill-opacity="0.6"/>
        <polygon points="24,9 37,24 24,39 11,24" stroke="#a5f3fc" stroke-width="1.2" fill="#38bdf8" fill-opacity="0.25"/>
        <line x1="24" y1="2" x2="24" y2="46" stroke="#ffffff" stroke-width="1.6"/>
        <line x1="4" y1="24" x2="44" y2="24" stroke="#ffffff" stroke-width="1.6"/>
        <circle cx="24" cy="24" r="5.5" fill="#ff0044" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="15" cy="14" r="1.8" fill="#ffffff"/>
        <circle cx="34" cy="16" r="1.4" fill="#a5f3fc"/>
        <circle cx="17" cy="33" r="1.3" fill="#e0f2fe"/>
      </svg>`;
    case 'angel_sachiel':
      return `<svg viewBox="0 0 48 48" class="unit-portrait-svg" fill="none" stroke="currentColor">
        <path d="M24,6 C16,6 13,14 13,24 C13,34 18,42 24,44 C30,42 35,34 35,24 C35,14 32,6 24,6 Z" fill="#141517" stroke="#343a40" stroke-width="2"/>
        <polygon points="24,10 18,22 24,36 30,22" fill="#f8f9fa"/>
        <circle cx="21" cy="20" r="2" fill="#141517"/>
        <circle cx="27" cy="20" r="2" fill="#141517"/>
        <circle cx="24" cy="28" r="3.2" fill="#ff1744"/>
      </svg>`;
    case 'angel_zeruel':
      return `<svg viewBox="0 0 48 48" class="unit-portrait-svg" fill="none" stroke="currentColor">
        <path d="M4,12 L44,12 L38,36 L30,44 L18,44 L10,36 Z" fill="#141518" stroke="#343a40" stroke-width="2"/>
        <path d="M4,14 L14,14 L12,28 L4,22 Z M44,14 L34,14 L36,28 L44,22 Z" fill="#1f2126" stroke="#c92a2a" stroke-width="1.2"/>
        <path d="M18,12 C18,12 21,8 24,8 C27,8 30,12 30,12 L31,21 C31,23 27,25 24,25 C21,25 17,23 17,21 Z" fill="#f8f9fa"/>
        <ellipse cx="21" cy="16" rx="1.8" ry="2.2" fill="#141518"/>
        <ellipse cx="27" cy="16" rx="1.8" ry="2.2" fill="#141518"/>
        <circle cx="21" cy="16" r="0.8" fill="#ff0033"/>
        <circle cx="27" cy="16" r="0.8" fill="#ff0033"/>
        <path d="M21,21 L27,21" stroke="#141518" stroke-width="1.2"/>
        <path d="M7,16 Q2,28 7,42" stroke="#f8f9fa" stroke-width="2.5" fill="none"/>
        <path d="M5,16 Q0,28 5,42" stroke="#ff0033" stroke-width="1.2" fill="none"/>
        <path d="M41,16 Q46,28 41,42" stroke="#f8f9fa" stroke-width="2.5" fill="none"/>
        <path d="M43,16 Q48,28 43,42" stroke="#ff0033" stroke-width="1.2" fill="none"/>
        <circle cx="24" cy="33" r="4.2" fill="#ff0033" stroke="#ffa8b8" stroke-width="1.2"/>
        <ellipse cx="24" cy="33" rx="6.5" ry="2.2" stroke="#ff8787" stroke-width="0.9" fill="none"/>
      </svg>`;
    case 'angel_sahaquiel':
      return `<svg viewBox="0 0 48 48" class="unit-portrait-svg" fill="none" stroke="currentColor">
        <ellipse cx="24" cy="24" rx="20" ry="12" fill="#f76707" stroke="#ffd43b" stroke-width="2"/>
        <circle cx="24" cy="24" r="7.5" fill="#ffffff"/>
        <circle cx="24" cy="24" r="4.5" fill="#1971c2"/>
        <circle cx="24" cy="24" r="2" fill="#ff0000"/>
        <circle cx="10" cy="24" r="3" fill="#ffd43b"/>
        <circle cx="38" cy="24" r="3" fill="#ffd43b"/>
      </svg>`;
    case 'giant_robot':
      // 巨大ロボット: V字アンテナ＋発光ツインアイ＋重装甲ショルダー＋ロケットナックル
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 巨大ショルダーアーマー（左肩） -->
        <polygon points="2,16 9,14 8,24 1,23" fill="#e0473a" stroke="#b02518" stroke-width="0.8"/>
        <!-- 重装甲胸部ボディ＆コックピット -->
        <rect x="7" y="19" width="14" height="14" rx="2" fill="#343a40" stroke="#212529" stroke-width="1"/>
        <rect x="10" y="21" width="8" height="6" fill="#e0473a"/>
        <rect x="12" y="23" width="4" height="2" fill="#ffd43b"/>
        <!-- ロボット頭部本体 -->
        <rect x="9" y="8" width="10" height="11" rx="1" fill="#495057" stroke="#212529" stroke-width="0.8"/>
        <!-- フェイスマスク＆ダクト -->
        <rect x="11" y="14" width="6" height="4" fill="#212529"/>
        <line x1="14" y1="14.5" x2="14" y2="17.5" stroke="#adb5bd" stroke-width="0.8"/>
        <!-- 発光ツインアイ（シアン） -->
        <rect x="10.5" y="11" width="2.5" height="2" fill="#38d9a9"/>
        <rect x="15" y="11" width="2.5" height="2" fill="#38d9a9"/>
        <!-- ヘルメットひさし（チームカラー） -->
        <polygon points="8,9 14,7 20,9 18,10.5 10,10.5" fill="#e0473a"/>
        <!-- V字ブレードアンテナ -->
        <polygon points="13,8 14,4 15,8" fill="#ffd43b"/>
        <polygon points="12,7 6,2 8,5 13,8" fill="#ffd43b"/>
        <polygon points="16,7 22,2 20,5 15,8" fill="#ffd43b"/>
        <!-- 前方に射出されるロケットパンチ（右腕ナックル＋噴射炎） -->
        <g>
          <!-- 推進バーニア炎 -->
          <polygon points="20,24 23,26 20,28" fill="#4dabf7"/>
          <polygon points="21,24.5 24,26 21,27.5" fill="#ffffff"/>
          <!-- ロケットナックル本体 -->
          <rect x="23" y="21" width="9" height="10" rx="2" fill="#212529" stroke="#121416" stroke-width="0.8"/>
          <!-- ナックルプレート（チームカラー） -->
          <rect x="25" y="22" width="6" height="8" rx="1" fill="#e0473a"/>
          <!-- 拳の指関節ガード -->
          <rect x="31" y="22" width="2.5" height="2" fill="#adb5bd"/>
          <rect x="31" y="25" width="2.5" height="2" fill="#adb5bd"/>
          <rect x="31" y="28" width="2.5" height="2" fill="#adb5bd"/>
        </g>
      </svg>`;
    case 'sezain':
      // セザイン: 1000cc超え巨大リッターバイク＋双角バトルヘルメット＋両手デュアル重機関銃
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 後輪ワイドタイヤ＆4本出しマフラー -->
        <circle cx="6.5" cy="27.5" r="6" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
        <circle cx="6.5" cy="27.5" r="2.8" fill="#e2e8f0"/>
        <circle cx="6.5" cy="27.5" r="1.2" fill="#d4af37"/>
        <polygon points="1,20 9,23 9,26 1,23" fill="#e2e8f0" stroke="#475569" stroke-width="0.6"/>
        <!-- 前輪ワイドタイヤ＆ゴールド倒立フォーク -->
        <circle cx="28.5" cy="27.5" r="6" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
        <circle cx="28.5" cy="27.5" r="2.8" fill="#e2e8f0"/>
        <circle cx="28.5" cy="27.5" r="1.2" fill="#d4af37"/>
        <line x1="23" y1="16" x2="28.5" y2="27.5" stroke="#d4af37" stroke-width="2.5"/>
        <!-- 1000cc大排気量エンジン＆クローム冷却フィン -->
        <rect x="11" y="21" width="11" height="7" rx="1" fill="#334155" stroke="#0f172a" stroke-width="0.8"/>
        <line x1="12" y1="23" x2="21" y2="23" stroke="#e2e8f0" stroke-width="1.2"/>
        <line x1="12" y1="25.5" x2="21" y2="25.5" stroke="#e2e8f0" stroke-width="1.2"/>
        <circle cx="15" cy="26" r="1.8" fill="#d4af37"/>
        <!-- ビッグタンク＆大型フロントカウル -->
        <path d="M 8,21 L 14,16 L 26,15 L 29,20 L 22,22 Z" fill="#e0473a" stroke="#991b1b" stroke-width="0.7"/>
        <polygon points="26,16 30,17 29,19 25,18" fill="#fef08a"/>
        <!-- バイクにまたがるライダーの脚（ニーグリップ＆ブーツ） -->
        <path d="M 12,19 L 17,23 L 15,29" fill="none" stroke="#1e293b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="15.5" y="21.5" width="2" height="2" fill="#d4af37"/>
        <!-- ライダー胴体＆スパイク肩アーマー -->
        <rect x="10" y="12" width="7" height="8" rx="1" fill="#0f172a"/>
        <polygon points="9,12 16,12 15,16 8,15" fill="#e0473a" stroke="#d4af37" stroke-width="0.7"/>
        <!-- 双角＆クレスト付き重装ヘルメット -->
        <rect x="9.5" y="5.5" width="8" height="7" rx="1.5" fill="#18181b" stroke="#334155" stroke-width="0.7"/>
        <polygon points="12,5.5 13.5,2 16,5.5" fill="#e0473a"/>
        <polygon points="9.5,8 6.5,3.5 9,9.5" fill="#facc15"/>
        <polygon points="17.5,8 20.5,3.5 18,9.5" fill="#facc15"/>
        <rect x="12" y="7.5" width="5" height="2.2" rx="0.5" fill="#38bdf8"/>
        <!-- 両手のツインバレル重機関銃＆マズルフラッシュ -->
        <rect x="18" y="9.5" width="11" height="3.5" rx="0.5" fill="#1e293b" stroke="#d4af37" stroke-width="0.7"/>
        <line x1="23" y1="10.5" x2="29" y2="10.5" stroke="#e2e8f0" stroke-width="1.2"/>
        <polygon points="29,9.5 35,8 32,11 35,13.5 29,12.5" fill="#fef08a"/>
        <rect x="16" y="14" width="11" height="3.5" rx="0.5" fill="#1e293b" stroke="#d4af37" stroke-width="0.7"/>
        <line x1="21" y1="15" x2="27" y2="15" stroke="#e2e8f0" stroke-width="1.2"/>
        <polygon points="27,14 33,12.5 30,15.5 33,18 27,17" fill="#f59e0b"/>
      </svg>`;
    case 'yamamuron':
      // ヤマムロン: 霊峰富士山＋山頂雪冠＋カルデラ噴火
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 富士山山体（美しい末広がりコニカル） -->
        <polygon points="2,33 13,15 23,15 34,33" fill="#1e3a8a"/>
        <!-- 裾野の樹海（深緑） -->
        <polygon points="2,33 7,30 29,30 34,33" fill="#1b4332"/>
        <!-- 山肌ハイライト・赤富士/青富士アクセント -->
        <polygon points="11,19 14,30 22,30 25,19" fill="#2563eb" opacity="0.8"/>
        <!-- 山頂の万年雪冠（美しい雪渓パターン） -->
        <polygon points="13,15 15,19 17,17 19,21 21,18 23,15" fill="#ffffff"/>
        <!-- 山頂カルデラ火口 -->
        <ellipse cx="18" cy="15" rx="5" ry="1.5" fill="#991b1b"/>
        <ellipse cx="18" cy="15" rx="3.5" ry="1" fill="#ff5900"/>
        <!-- 噴煙＆吹き上がる巨大火山弾 -->
        <circle cx="16" cy="10" r="3.5" fill="#64748b" opacity="0.75"/>
        <circle cx="20" cy="8" r="4.5" fill="#475569" opacity="0.85"/>
        <circle cx="17" cy="5" r="3" fill="#94a3b8" opacity="0.6"/>
        <!-- 灼熱火山弾 -->
        <circle cx="23" cy="4" r="2.5" fill="#ff3b00" stroke="#ffd43b" stroke-width="0.8"/>
        <circle cx="12" cy="7" r="1.8" fill="#f97316" stroke="#fef08a" stroke-width="0.8"/>
      </svg>`;
    case 'hongon':
      // ホンゴン: 巨大グランドピアノ（跳ね上げ大屋根）＋ブロンド長髪の女性ピアニスト＋舞う音符
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- ピアノ跳ね上げ大屋根（斜めに開いたシルエット） -->
        <path d="M 12,24 L 28,10 L 32,12 L 18,25 Z" fill="#18181b" stroke="#3f3f46" stroke-width="0.8"/>
        <!-- 黄金の大屋根支え棒 -->
        <line x1="26" y1="12" x2="26" y2="23" stroke="#f59e0b" stroke-width="1"/>
        <!-- ピアノ内部の黄金ハープ -->
        <polygon points="14,24 25,23 23,17 14,19" fill="#d97706" opacity="0.85"/>
        <line x1="16" y1="20" x2="22" y2="23" stroke="#fef08a" stroke-width="0.8"/>
        <line x1="18" y1="19" x2="24" y2="22" stroke="#fef08a" stroke-width="0.8"/>
        <!-- ピアノボディ本体 -->
        <path d="M 6,24 L 6,19 Q 12,17 26,19 L 28,24 Z" fill="#09090b" stroke="#27272a" stroke-width="1"/>
        <!-- ピアノ脚 -->
        <line x1="8" y1="24" x2="8" y2="32" stroke="#09090b" stroke-width="1.8"/>
        <line x1="26" y1="24" x2="26" y2="32" stroke="#09090b" stroke-width="1.8"/>
        <circle cx="8" cy="32" r="0.9" fill="#ffd43b"/>
        <circle cx="26" cy="32" r="0.9" fill="#ffd43b"/>
        <!-- 白鍵盤＆赤フェルト -->
        <rect x="7" y="22" width="20" height="0.8" fill="#e11d48"/>
        <rect x="7" y="23" width="20" height="3" rx="0.3" fill="#ffffff"/>
        <!-- 黒鍵 -->
        <rect x="9" y="23" width="1.2" height="1.8" fill="#09090b"/>
        <rect x="11" y="23" width="1.2" height="1.8" fill="#09090b"/>
        <rect x="14" y="23" width="1.2" height="1.8" fill="#09090b"/>
        <rect x="16" y="23" width="1.2" height="1.8" fill="#09090b"/>
        <rect x="18" y="23" width="1.2" height="1.8" fill="#09090b"/>
        <!-- ブロンド長髪の女性ピアニスト（演奏姿） -->
        <!-- 長いウェーブ金髪（背中・肩へ流れる髪） -->
        <path d="M 7,10 Q 5,14 4,21 Q 6,21 7,16 Q 8,22 9,24 Q 10,18 10,12 Z" fill="#f59e0b"/>
        <path d="M 6,11 Q 5,16 5,20 Q 7,18 8,14 Q 9,19 9,22" fill="#fbbf24"/>
        <!-- 女性ピアニストの頭部・顔 -->
        <circle cx="8.5" cy="11.5" r="2.8" fill="#fde2e4"/>
        <!-- 金髪トップ＆前髪 -->
        <path d="M 6,11 Q 8.5,8 11,10 Q 9.5,12 8,12 Z" fill="#fef08a"/>
        <!-- ゴールドティアラ -->
        <path d="M 8.5,8.8 L 9.5,8.2 L 10.5,9" stroke="#ffd43b" stroke-width="0.8" fill="none"/>
        <circle cx="9.5" cy="8.2" r="0.5" fill="#38bdf8"/>
        <!-- ドレス＆伸びる腕（演奏ポーズ） -->
        <path d="M 6.5,14 Q 5,18 4.5,23 L 9,23 Q 9,18 8.5,14 Z" fill="#f43f5e"/>
        <line x1="8" y1="14.5" x2="13" y2="19" stroke="#fde2e4" stroke-width="1.2"/>
        <line x1="13" y1="19" x2="15" y2="22.5" stroke="#ffffff" stroke-width="1.2"/>
        <!-- 舞い上がるカラフルな音符 ♪ ♫ -->
        <ellipse cx="19" cy="6" rx="1.6" ry="1.2" fill="#ffd43b" transform="rotate(-20 19 6)"/>
        <line x1="20.3" y1="5.6" x2="20.3" y2="1.5" stroke="#ffd43b" stroke-width="1"/>
        <path d="M 20.3,1.5 Q 23,2.2 22,4.5" stroke="#ffd43b" stroke-width="1" fill="none"/>
        <ellipse cx="29" cy="5" rx="1.5" ry="1.1" fill="#38bdf8" transform="rotate(-20 29 5)"/>
        <line x1="30.2" y1="4.6" x2="30.2" y2="1" stroke="#38bdf8" stroke-width="0.9"/>
      </svg>`;
    case 'zaisan':
      // ザイサン: 三刀流剣士（口と両手の刀）＋深緑の短髪・黒バンダナ＋翡翠のドラゴンオーラ
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 背景の翡翠龍の螺旋オーラ -->
        <path d="M 4,32 Q 2,18 12,8 Q 22,-2 32,10 Q 36,22 28,30" fill="none" stroke="#10b981" stroke-width="2.5" opacity="0.35"/>
        <path d="M 8,30 Q 8,14 20,8 Q 30,8 30,22" fill="none" stroke="#34d399" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.6"/>
        <!-- 龍の眼光（オーラ） -->
        <circle cx="28" cy="8" r="1.5" fill="#fde047"/>
        <!-- 交差する刀1（左手刀：左下から右上へ） -->
        <line x1="3" y1="33" x2="29" y2="5" stroke="#18181b" stroke-width="2.5"/>
        <line x1="10" y1="26" x2="31" y2="3" stroke="#f1f5f9" stroke-width="1.8"/>
        <rect x="8" y="24" width="3" height="3" fill="#d4af37" transform="rotate(-45 9.5 25.5)"/>
        <!-- 交差する刀2（右手刀：右下から左上へ） -->
        <line x1="33" y1="33" x2="7" y2="5" stroke="#18181b" stroke-width="2.5"/>
        <line x1="26" y1="26" x2="5" y2="3" stroke="#f1f5f9" stroke-width="1.8"/>
        <rect x="25" y="24" width="3" height="3" fill="#d4af37" transform="rotate(45 26.5 25.5)"/>
        <!-- 胴体＆赤い腹巻き -->
        <path d="M 12,25 L 14,34 L 22,34 L 24,25 Z" fill="#14532d"/>
        <rect x="13" y="27" width="10" height="3.5" fill="#b91c1c" rx="0.5"/>
        <!-- 頭部（肌・髪・バンダナ） -->
        <circle cx="18" cy="17" r="5" fill="#f0c39c"/>
        <path d="M 13,15 Q 18,10 23,15 L 23,12 Q 18,9 13,12 Z" fill="#16a34a"/>
        <!-- 黒バンダナ -->
        <rect x="13" y="14" width="10" height="2.5" rx="0.5" fill="#18181b"/>
        <!-- 鋭い目＆左目刀傷 -->
        <line x1="15" y1="17.5" x2="16.5" y2="18" stroke="#18181b" stroke-width="1"/>
        <line x1="19.5" y1="18" x2="21" y2="17.5" stroke="#18181b" stroke-width="1"/>
        <line x1="15.8" y1="16.5" x2="15.8" y2="19.5" stroke="#991b1b" stroke-width="0.7"/>
        <!-- 3本目の刀（口にくわえた横一文字の刀） -->
        <line x1="4" y1="20.5" x2="32" y2="20.5" stroke="#f8fafc" stroke-width="2"/>
        <line x1="4" y1="21.5" x2="30" y2="21.5" stroke="#94a3b8" stroke-width="0.8"/>
        <!-- 口元の柄・鍔 -->
        <rect x="11" y="19.5" width="4" height="2" fill="#18181b"/>
        <rect x="15" y="19" width="1.5" height="3" fill="#d4af37"/>
        <!-- 斬撃スパーク（翡翠の光火） -->
        <polygon points="31,19 35,20.5 31,22 32,20.5" fill="#34d399"/>
        <polygon points="30,4 34,2 32,6" fill="#fde047"/>
      </svg>`;

    case 'lightspeed_ant':
      // 光速アリ: 超高速のシアン＆イエロー残像ラインと鋭い大顎・触角・6本脚のアリ
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 背後の光速スピードライン・残像 -->
        <line x1="1" y1="9" x2="17" y2="9" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
        <line x1="2" y1="15" x2="14" y2="15" stroke="#fef08a" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="1" y1="22" x2="13" y2="22" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="3" y1="28" x2="16" y2="28" stroke="#fef08a" stroke-width="1.6" stroke-linecap="round"/>
        <!-- アリの6本脚（黒キチン質＋シアン関節） -->
        <polyline points="16,22 12,28 8,33" fill="none" stroke="#18181b" stroke-width="2" stroke-linecap="round"/>
        <polyline points="20,20 19,27 16,33" fill="none" stroke="#18181b" stroke-width="2" stroke-linecap="round"/>
        <polyline points="24,18 25,26 24,33" fill="none" stroke="#18181b" stroke-width="2" stroke-linecap="round"/>
        <polyline points="17,18 14,12 10,8" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round"/>
        <polyline points="21,17 20,11 18,6" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round"/>
        <!-- 腹部（Gaster）＆光速ネオンストライプ -->
        <ellipse cx="11" cy="19" rx="6.5" ry="4.8" fill="#18181b" stroke="#38bdf8" stroke-width="1"/>
        <path d="M 9,14.5 L 9,23.5" stroke="#e0473a" stroke-width="2"/>
        <path d="M 12.5,14.8 L 12.5,23.2" stroke="#fef08a" stroke-width="1.5"/>
        <!-- くびれ（腹柄節）＆胸部（Thorax） -->
        <circle cx="17.5" cy="18.5" r="2" fill="#27272a"/>
        <ellipse cx="21.5" cy="17.5" rx="4.2" ry="3" fill="#18181b" stroke="#38bdf8" stroke-width="0.9"/>
        <!-- 頭部（Head）＆光速複眼 -->
        <circle cx="27" cy="16.5" r="3.8" fill="#18181b" stroke="#27272a" stroke-width="1"/>
        <ellipse cx="27.8" cy="15.2" rx="1.6" ry="1.1" fill="#38bdf8"/>
        <circle cx="28.2" cy="15.0" r="0.6" fill="#fef08a"/>
        <!-- 鋭い光速大顎（Mandibles） -->
        <path d="M 30,15 L 35,13.5 L 32.5,16.5 Z" fill="#38bdf8"/>
        <path d="M 30,18 L 35,19.5 L 32.5,16.8 Z" fill="#fef08a"/>
        <!-- 2本のくの字触角 -->
        <polyline points="27,13 29,8 34,6" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round"/>
        <polyline points="28.5,14 31,10 35,9.5" fill="none" stroke="#fef08a" stroke-width="1.3" stroke-linecap="round"/>
      </svg>`;

    case 'hayato':
      return `<svg viewBox="0 0 48 48" class="unit-portrait-svg" fill="none">
        <polygon points="24,3 37,8 41,20 39,32 32,43 24,46 16,43 9,32 7,20 11,8" fill="#e9b782"/>
        <polygon points="24,3 37,8 41,20 39,30 34,17 27,13 21,14 14,17 9,30 7,20 11,8" fill="#17151a"/>
        <path d="M13,20 L21,17 M28,15 L36,19" stroke="#201a18" stroke-width="2.2" stroke-linecap="round"/>
        <ellipse cx="17" cy="23" rx="4" ry="3.2" fill="#fbfbf6"/><circle cx="17" cy="22.3" r="1.9" fill="#1a1210"/>
        <ellipse cx="31" cy="23" rx="4" ry="3.2" fill="#fbfbf6"/><circle cx="31" cy="22.3" r="1.9" fill="#1a1210"/>
        <polygon points="24,22 28,30 20,30" fill="#c48a57"/>
        <ellipse cx="24" cy="37" rx="7" ry="5.5" fill="#54161a" stroke="#b05a4c" stroke-width="1.4"/>
        <rect x="19" y="32.8" width="10" height="2.2" fill="#fbf6e8"/>
      </svg>`;
    case 'deoxys':
      // デオキシス: 三叉の角状突起・白いフェイスマスク・胸の紫クリスタルコア・DNA二重螺旋腕
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 背景のサイキックオーラリング -->
        <circle cx="18" cy="18" r="16" fill="none" stroke="#9333ea" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.6"/>
        <circle cx="18" cy="18" r="14" fill="none" stroke="#00d2d3" stroke-width="0.8" opacity="0.5"/>
        <!-- DNA二重螺旋の触手腕（左右） -->
        <path d="M 12,17 C 8,19 6,24 8,28 C 9,30 11,27 10,24 C 9,21 11,19 13,18" fill="none" stroke="#ee5a24" stroke-width="2" stroke-linecap="round"/>
        <path d="M 11,18 C 9,22 11,25 9,29" fill="none" stroke="#00d2d3" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M 24,17 C 28,19 30,24 28,28 C 27,30 25,27 26,24 C 27,21 25,19 23,18" fill="none" stroke="#ee5a24" stroke-width="2" stroke-linecap="round"/>
        <path d="M 25,18 C 27,22 25,25 27,29" fill="none" stroke="#00d2d3" stroke-width="1.6" stroke-linecap="round"/>
        <!-- 細身の流線型胴体（赤橙） -->
        <path d="M 15,16 L 21,16 L 19,25 L 17,25 Z" fill="#ee5a24"/>
        <!-- 胸の中央に輝く紫クリスタルコア -->
        <polygon points="18,17 20.5,20 18,23 15.5,20" fill="#a855f7" stroke="#ffffff" stroke-width="0.8"/>
        <circle cx="18" cy="20" r="1" fill="#ffffff"/>
        <!-- 頭部サイドの三叉突起（左右の大きな角） -->
        <path d="M 13,8 L 6,4 L 8,11 L 13,11 Z" fill="#ee5a24"/>
        <polygon points="6,4 4,2 7,6" fill="#00d2d3"/>
        <path d="M 23,8 L 30,4 L 28,11 L 23,11 Z" fill="#ee5a24"/>
        <polygon points="30,4 32,2 29,6" fill="#00d2d3"/>
        <!-- 頭頂部センタークレスト -->
        <polygon points="17,8 18,2 19,8" fill="#ee5a24"/>
        <line x1="18" y1="3" x2="18" y2="7" stroke="#00d2d3" stroke-width="1"/>
        <!-- 頭部中央（赤橙ベース） -->
        <ellipse cx="18" cy="9.5" rx="5" ry="4.5" fill="#ee5a24"/>
        <!-- 白いフェイスマスク -->
        <ellipse cx="18" cy="10" rx="3.2" ry="3.5" fill="#f1f5f9"/>
        <!-- 顔のセンター縦ライン（シアン） -->
        <line x1="18" y1="6.8" x2="18" y2="13.2" stroke="#00d2d3" stroke-width="1.4"/>
        <!-- 額の紫コア -->
        <circle cx="18" cy="7.5" r="1.1" fill="#9333ea"/>
        <!-- 鋭い眼光（シアン） -->
        <ellipse cx="16.2" cy="9.8" rx="1.0" ry="0.6" fill="#00d2d3"/>
        <circle cx="16.2" cy="9.8" r="0.4" fill="#ffffff"/>
        <ellipse cx="19.8" cy="9.8" rx="1.0" ry="0.6" fill="#00d2d3"/>
        <circle cx="19.8" cy="9.8" r="0.4" fill="#ffffff"/>
      </svg>`;
  }
}

/** 施設用アイコン SVG を返す */
/** ローグライトの門のアイコン（色と1文字の記号で種類を表す） */
function gateIconSvg(color: string, label: string): string {
  return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
    <rect x="4" y="6" width="6" height="26" rx="1" fill="#3d434e" stroke="#282c34" stroke-width="1"/>
    <rect x="26" y="6" width="6" height="26" rx="1" fill="#3d434e" stroke="#282c34" stroke-width="1"/>
    <rect x="6" y="8" width="2" height="22" fill="${color}"/>
    <rect x="28" y="8" width="2" height="22" fill="${color}"/>
    <rect x="4" y="4" width="28" height="6" rx="1.5" fill="#4e5563"/>
    <rect x="12" y="2.5" width="12" height="8" rx="1" fill="#1e222a" stroke="${color}" stroke-width="1"/>
    <text x="18" y="9" font-size="6" font-weight="900" text-anchor="middle" fill="${color}" font-family="sans-serif">${label}</text>
    <rect x="11" y="12" width="14" height="18" rx="1" fill="${color}" opacity="0.28"/>
  </svg>`;
}

export function getFacilityIconSvg(facilityId: FacilityTypeId): string {
  switch (facilityId) {
    case 'barracks':
      // 召喚ポータル: 古代の石柱と渦巻く魔力コア
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 石の台座 -->
        <rect x="4" y="26" width="28" height="6" rx="1.5" fill="#3a3d46" stroke="#25272c" stroke-width="1"/>
        <!-- 左右のオベリスク柱 -->
        <rect x="6" y="7" width="5" height="20" fill="#555a66"/>
        <rect x="25" y="7" width="5" height="20" fill="#555a66"/>
        <polygon points="6,7 8.5,3 11,7" fill="#ffd43b"/>
        <polygon points="25,7 27.5,3 30,7" fill="#ffd43b"/>
        <!-- 柱のルーンライン -->
        <rect x="8" y="11" width="1" height="12" fill="#60c0ff"/>
        <rect x="27" y="11" width="1" height="12" fill="#60c0ff"/>
        <!-- 中央の浮遊魔力クリスタル -->
        <polygon points="18,9 23,16 18,23 13,16" fill="#60c0ff" stroke="#38d9a9" stroke-width="1"/>
        <polygon points="18,12 21,16 18,20 15,16" fill="#ffffff"/>
      </svg>`;

    case 'buff_totem':
      // 加護のトーテム: 翼のあるトーテムポールと黄金冠・輝く宝珠
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 台座 -->
        <rect x="8" y="27" width="20" height="5" rx="1" fill="#3c3f47"/>
        <!-- 木のトーテム柱 -->
        <rect x="13" y="11" width="10" height="17" fill="#5c3d26"/>
        <!-- 左右の翼 -->
        <polygon points="13,15 4,12 5,18 13,18" fill="#e0473a"/>
        <polygon points="23,15 32,12 31,18 23,18" fill="#e0473a"/>
        <!-- 黄金の帯 -->
        <rect x="12" y="19" width="12" height="3" fill="#ffd23a"/>
        <!-- 頂上の黄金冠 -->
        <rect x="11" y="8" width="14" height="3" rx="0.5" fill="#ffd23a"/>
        <!-- 輝く大宝珠 -->
        <circle cx="18" cy="5.5" r="4" fill="#ff6b6b" stroke="#ffd23a" stroke-width="1.2"/>
        <circle cx="16.5" cy="4" r="1.2" fill="#ffffff"/>
      </svg>`;

    case 'multiplier_gate':
      // 増殖ゲート: テクノアーチと「x2」プレート・エネルギー膜
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 左右の門柱 -->
        <rect x="4" y="6" width="6" height="26" rx="1" fill="#3d434e" stroke="#282c34" stroke-width="1"/>
        <rect x="26" y="6" width="6" height="26" rx="1" fill="#3d434e" stroke="#282c34" stroke-width="1"/>
        <rect x="6" y="8" width="2" height="22" fill="#38d9a9"/>
        <rect x="28" y="8" width="2" height="22" fill="#38d9a9"/>
        <!-- 上部アーチ梁 -->
        <rect x="4" y="4" width="28" height="6" rx="1.5" fill="#4e5563"/>
        <!-- 中央の「x2」プレート -->
        <rect x="12" y="3" width="12" height="7" rx="1" fill="#1e222a" stroke="#ffd700" stroke-width="1"/>
        <text x="18" y="8.5" font-size="5.5" font-weight="900" text-anchor="middle" fill="#ffd700" font-family="sans-serif">x2</text>
        <!-- エネルギーカーテン -->
        <line x1="13" y1="11" x2="13" y2="30" stroke="#38d9a9" stroke-width="1" stroke-dasharray="2 2"/>
        <line x1="18" y1="11" x2="18" y2="30" stroke="#60c0ff" stroke-width="1.5" stroke-dasharray="3 1.5"/>
        <line x1="23" y1="11" x2="23" y2="30" stroke="#38d9a9" stroke-width="1" stroke-dasharray="2 2"/>
      </svg>`;

    case 'giant_gate':
      return gateIconSvg('#ffb35c', '大');
    case 'shrink_gate':
      return gateIconSvg('#7fd6ff', '小');
    case 'fire_gate':
      return gateIconSvg('#ff6a3d', '炎');
    case 'thunder_gate':
      return gateIconSvg('#fff06a', '雷');
    case 'venom_gate':
      return gateIconSvg('#8fe36a', '毒');
    case 'power_gate':
      return gateIconSvg('#ff3b3b', '攻');
    case 'reach_gate':
      return gateIconSvg('#5b8cff', '遠');
    case 'haste_gate':
      return gateIconSvg('#66ffe0', '連');
    case 'vitality_gate':
      return gateIconSvg('#ff9ec4', '命');
    case 'swift_gate':
      return gateIconSvg('#d8ff5c', '速');
    case 'guard_gate':
      return gateIconSvg('#b0bccc', '守');
    case 'impact_gate':
      return gateIconSvg('#e0c090', '衝');
    case 'rebirth_gate':
      return gateIconSvg('#7ee0a8', '転');
    case 'samsara_gate':
      return gateIconSvg('#ffe08a', '輪');
    case 'blast_gate':
      return gateIconSvg('#ff8a3d', '爆');
    case 'magnet_gate':
      return gateIconSvg('#c48aff', '磁');

    case 'cannon_tower':
      // 防衛キャノン砲台: 円柱石積みタワーと突き出る大砲
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 石積みタワー -->
        <rect x="6" y="14" width="24" height="18" rx="2" fill="#484b54" stroke="#2d3036" stroke-width="1"/>
        <rect x="5" y="29" width="26" height="4" rx="1" fill="#383a42"/>
        <!-- チームカラーの帯 -->
        <rect x="6" y="21" width="24" height="3" fill="#e0473a"/>
        <!-- 上部胸壁 -->
        <rect x="5" y="11" width="26" height="4" fill="#585d68"/>
        <rect x="5" y="9" width="5" height="3" fill="#585d68"/>
        <rect x="15" y="9" width="6" height="3" fill="#585d68"/>
        <rect x="26" y="9" width="5" height="3" fill="#585d68"/>
        <!-- 大砲の砲身 -->
        <g transform="rotate(-15 18 10)">
          <rect x="14" y="5" width="16" height="6" rx="1.5" fill="#202226" stroke="#121315" stroke-width="1"/>
          <circle cx="30" cy="8" r="2.2" fill="#343840"/>
        </g>
      </svg>`;

    case 'terrain_wall':
      // 防壁ブロック（壁）: 重厚な石積み城壁とクレネル（銃眼）
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 城壁上部の凸部（クレネル） -->
        <rect x="3" y="7" width="6" height="5" rx="0.8" fill="#8a8275" stroke="#3b3731" stroke-width="1"/>
        <rect x="11" y="7" width="6" height="5" rx="0.8" fill="#8a8275" stroke="#3b3731" stroke-width="1"/>
        <rect x="19" y="7" width="6" height="5" rx="0.8" fill="#8a8275" stroke="#3b3731" stroke-width="1"/>
        <rect x="27" y="7" width="6" height="5" rx="0.8" fill="#8a8275" stroke="#3b3731" stroke-width="1"/>
        <!-- 主壁面 -->
        <rect x="3" y="11" width="30" height="20" rx="1.5" fill="#787166" stroke="#3b3731" stroke-width="1.2"/>
        <!-- 石積みレンガ目地 -->
        <line x1="3" y1="16" x2="33" y2="16" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="3" y1="21" x2="33" y2="21" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="3" y1="26" x2="33" y2="26" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="12" y1="11" x2="12" y2="16" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="24" y1="11" x2="24" y2="16" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="18" y1="16" x2="18" y2="21" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="10" y1="21" x2="10" y2="26" stroke="#4b463e" stroke-width="1.2"/>
        <line x1="26" y1="21" x2="26" y2="26" stroke="#4b463e" stroke-width="1.2"/>
        <!-- 補強の琥珀リベット帯 -->
        <rect x="5" y="18" width="26" height="2" fill="#f59f00" opacity="0.85"/>
        <!-- 下部土台 -->
        <rect x="2" y="29" width="32" height="4" rx="1" fill="#524c43" stroke="#2b2927" stroke-width="1"/>
      </svg>`;

    case 'terrain_slope':
      // スロープブロック（坂道）: 登坂ランプと進行方向シェブロン矢印
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- スロープ側面（三角形の石・鉄骨構造） -->
        <polygon points="3,30 31,10 31,30" fill="#5f5950" stroke="#2b2927" stroke-width="1.2"/>
        <!-- スロープ天面（斜めの登坂路） -->
        <polygon points="3,30 9,26 33,8 31,13" fill="#8a7968" stroke="#3b3731" stroke-width="1"/>
        <!-- 登坂シェブロン矢印 -->
        <polyline points="11,23 17,17 17,22" fill="none" stroke="#ffd43b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="19,17 25,11 25,16" fill="none" stroke="#f59f00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- 支柱トラスライン -->
        <line x1="14" y1="22" x2="14" y2="30" stroke="#3b3731" stroke-width="1.5"/>
        <line x1="23" y1="16" x2="23" y2="30" stroke="#3b3731" stroke-width="1.5"/>
        <!-- ベースプレート -->
        <rect x="2" y="29" width="31" height="3.5" rx="1" fill="#495057"/>
      </svg>`;

    case 'terrain_pit':
      // 落とし穴ブロック（奈落）: 地面に空いた漆黒のホールと危険ストライプ・内向きスパイク
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 外周の危険石枠 -->
        <ellipse cx="18" cy="21" rx="15" ry="9.5" fill="#524c44" stroke="#f59f00" stroke-width="1.6" stroke-dasharray="3.5 2"/>
        <!-- 奈落の暗黒開口部 -->
        <ellipse cx="18" cy="21" rx="11.5" ry="6.8" fill="#07060a" stroke="#2b2927" stroke-width="1.2"/>
        <!-- 深淵の渦リング -->
        <ellipse cx="18" cy="22" rx="7.5" ry="4" fill="none" stroke="#3b2854" stroke-width="1" stroke-dasharray="3 2"/>
        <!-- 内向きスパイク牙 -->
        <polygon points="7,20 11,21 8,23" fill="#ced4da"/>
        <polygon points="29,20 25,21 28,23" fill="#ced4da"/>
        <polygon points="18,14 17,17.5 19,17.5" fill="#ced4da"/>
        <polygon points="18,28 17,24.5 19,24.5" fill="#ced4da"/>
        <!-- 落下を示す下向き矢印 -->
        <path d="M18 4 L18 13 M14.5 10 L18 14 L21.5 10" stroke="#ff6b6b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`;
  }
}
