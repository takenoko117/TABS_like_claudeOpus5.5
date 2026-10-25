import type { FacilityTypeId } from '../facilities/FacilityTypes';
import type { UnitCategory, UnitTypeId } from '../units/UnitTypes';

export type PaletteCategory = UnitCategory | 'facility';

/** カテゴリごとのシンボルアイコン（タブ・バッジ表示用） */
export const CATEGORY_ICONS: Readonly<Record<PaletteCategory | 'all', string>> = {
  all: '🗂️',
  standard: '⚔️',
  magic: '🔮',
  modern: '💣',
  japanese: '⛩️',
  animal: '🐾',
  mythical: '🐉',
  facility: '🏛️',
};

/** カテゴリごとのテーマ背景グラデーション色 */
export const CATEGORY_THEME_COLORS: Readonly<Record<PaletteCategory, { bg: string; border: string }>> = {
  standard: { bg: 'linear-gradient(135deg, #2b3a4a, #1e293b)', border: '#60a5fa' },
  magic: { bg: 'linear-gradient(135deg, #3b1d5e, #24123b)', border: '#c084fc' },
  modern: { bg: 'linear-gradient(135deg, #2d3d32, #1c261f)', border: '#8ce99a' },
  japanese: { bg: 'linear-gradient(135deg, #4a1d2e, #2b121c)', border: '#ff85c0' },
  animal: { bg: 'linear-gradient(135deg, #4a3723, #2d2115)', border: '#fcc419' },
  mythical: { bg: 'linear-gradient(135deg, #4f1d1d, #2d1010)', border: '#ff6b6b' },
  facility: { bg: 'linear-gradient(135deg, #2a3a40, #17242a)', border: '#38d9a9' },
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
      // ドラゴン: 2本の黄金角・気高き竜頭・火炎ブレス
      return `<svg viewBox="0 0 36 36" class="unit-portrait-svg" aria-hidden="true">
        <!-- 2本の黄金の角 -->
        <polygon points="8,11 4,2 13,8" fill="#ffd43b" stroke="#e6a122" stroke-width="1"/>
        <polygon points="24,11 28,2 19,8" fill="#ffd43b" stroke="#e6a122" stroke-width="1"/>
        <!-- ドラゴンの頭部と首（赤と青のツートン／中立竜カラー） -->
        <rect x="8" y="21" width="16" height="12" fill="#5c2d91"/>
        <rect x="7" y="8" width="18" height="15" rx="2" fill="#7048e8"/>
        <!-- 額の黄金鱗 -->
        <polygon points="16,8 20,8 18,13" fill="#ffd43b"/>
        <!-- 黄色く光る竜の目 -->
        <polygon points="9,13 14,14 9,16" fill="#ffe042"/>
        <polygon points="23,13 18,14 23,16" fill="#ffe042"/>
        <!-- 顎と火炎ブレス -->
        <rect x="10" y="18" width="12" height="5" fill="#e6a122"/>
        <circle cx="29" cy="24" r="5.5" fill="#ff6b35"/>
        <circle cx="28" cy="24" r="3.2" fill="#ffe066"/>
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
  }
}

/** 施設用アイコン SVG を返す */
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
  }
}
