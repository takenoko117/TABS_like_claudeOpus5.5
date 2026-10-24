import { Vector3 } from 'three';
import { SoundManager } from '../audio/SoundManager';
import { SceneView } from '../render/SceneView';
import {
  CATEGORY_LABELS,
  TEAM_NAMES,
  UNIT_TYPES,
  UNIT_TYPE_LIST,
  type Team,
  type UnitCategory,
  type UnitTypeId,
} from '../units/UnitTypes';
import { Battle, type BattleResult } from './Battle';

interface PlacedRecord {
  typeId: UnitTypeId;
  team: Team;
  x: number;
  z: number;
}

export interface PresetScenario {
  name: string;
  description: string;
  units: PlacedRecord[];
}

export const PRESETS: readonly PresetScenario[] = [
  {
    name: '標準合戦',
    description: '前衛の棍棒・剣士・槍兵と後衛の弓兵が激突する基本編成',
    units: [
      // 赤軍 (x < 0)
      { typeId: 'swordsman', team: 0, x: -4.5, z: -3.0 },
      { typeId: 'swordsman', team: 0, x: -4.5, z: 0.0 },
      { typeId: 'swordsman', team: 0, x: -4.5, z: 3.0 },
      { typeId: 'spearman', team: 0, x: -6.5, z: -2.0 },
      { typeId: 'spearman', team: 0, x: -6.5, z: 2.0 },
      { typeId: 'clubber', team: 0, x: -3.2, z: -4.8 },
      { typeId: 'clubber', team: 0, x: -3.2, z: 4.8 },
      { typeId: 'archer', team: 0, x: -11.0, z: -3.5 },
      { typeId: 'archer', team: 0, x: -11.0, z: 0.0 },
      { typeId: 'archer', team: 0, x: -11.0, z: 3.5 },
      // 青軍 (x > 0)
      { typeId: 'swordsman', team: 1, x: 4.5, z: -3.0 },
      { typeId: 'swordsman', team: 1, x: 4.5, z: 0.0 },
      { typeId: 'swordsman', team: 1, x: 4.5, z: 3.0 },
      { typeId: 'spearman', team: 1, x: 6.5, z: -2.0 },
      { typeId: 'spearman', team: 1, x: 6.5, z: 2.0 },
      { typeId: 'clubber', team: 1, x: 3.2, z: -4.8 },
      { typeId: 'clubber', team: 1, x: 3.2, z: 4.8 },
      { typeId: 'archer', team: 1, x: 11.0, z: -3.5 },
      { typeId: 'archer', team: 1, x: 11.0, z: 0.0 },
      { typeId: 'archer', team: 1, x: 11.0, z: 3.5 },
    ],
  },
  {
    name: '巨人 vs 大軍勢',
    description: '赤軍の巨人 2 体に、青軍の歩兵・槍兵・弓兵の大軍が挑む',
    units: [
      { typeId: 'giant', team: 0, x: -6.0, z: -2.8 },
      { typeId: 'giant', team: 0, x: -6.0, z: 2.8 },
      { typeId: 'archer', team: 0, x: -12.0, z: -2.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 2.0 },
      // 青軍
      { typeId: 'spearman', team: 1, x: 4.5, z: -5.0 },
      { typeId: 'spearman', team: 1, x: 4.5, z: -2.5 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 0.0 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 2.5 },
      { typeId: 'spearman', team: 1, x: 4.5, z: 5.0 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: -3.6 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: -1.2 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: 1.2 },
      { typeId: 'swordsman', team: 1, x: 6.8, z: 3.6 },
      { typeId: 'archer', team: 1, x: 12.5, z: -4.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: -1.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: 1.5 },
      { typeId: 'archer', team: 1, x: 12.5, z: 4.5 },
    ],
  },
  {
    name: '全兵種総力戦',
    description: '巨人を含む全兵種が入り乱れる大乱闘',
    units: [
      { typeId: 'giant', team: 0, x: -6.5, z: 0.0 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: -3.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: -1.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: 1.6 },
      { typeId: 'swordsman', team: 0, x: -4.2, z: 3.6 },
      { typeId: 'spearman', team: 0, x: -6.2, z: -4.5 },
      { typeId: 'spearman', team: 0, x: -6.2, z: 4.5 },
      { typeId: 'clubber', team: 0, x: -3.0, z: -5.5 },
      { typeId: 'clubber', team: 0, x: -3.0, z: 5.5 },
      { typeId: 'archer', team: 0, x: -12.0, z: -4.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 0.0 },
      { typeId: 'archer', team: 0, x: -12.0, z: 4.0 },

      { typeId: 'giant', team: 1, x: 6.5, z: 0.0 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -3.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 3.6 },
      { typeId: 'spearman', team: 1, x: 6.2, z: -4.5 },
      { typeId: 'spearman', team: 1, x: 6.2, z: 4.5 },
      { typeId: 'clubber', team: 1, x: 3.0, z: -5.5 },
      { typeId: 'clubber', team: 1, x: 3.0, z: 5.5 },
      { typeId: 'archer', team: 1, x: 12.0, z: -4.0 },
      { typeId: 'archer', team: 1, x: 12.0, z: 0.0 },
      { typeId: 'archer', team: 1, x: 12.0, z: 4.0 },
    ],
  },
  {
    name: '魔法＆神話モンスター決戦',
    description: '雷導師・重力術師・紅蓮ドラゴン・分裂スライム・大鷲・戦象が激突',
    units: [
      { typeId: 'dragon', team: 0, x: -7.5, z: 0.0 },
      { typeId: 'slime', team: 0, x: -4.5, z: -3.2 },
      { typeId: 'slime', team: 0, x: -4.5, z: 3.2 },
      { typeId: 'archmage', team: 0, x: -11.5, z: -2.8 },
      { typeId: 'gravimancer', team: 0, x: -11.5, z: 2.8 },

      { typeId: 'warelephant', team: 1, x: 6.8, z: 0.0 },
      { typeId: 'giant_eagle', team: 1, x: 5.5, z: -4.2 },
      { typeId: 'giant_eagle', team: 1, x: 5.5, z: 4.2 },
      { typeId: 'archmage', team: 1, x: 11.5, z: -2.8 },
      { typeId: 'gravimancer', team: 1, x: 11.5, z: 2.8 },
    ],
  },
  {
    name: '和風軍団 vs 現代兵器',
    description: '居合の剣豪とからくり忍者の急襲に、ガトリング重装兵と対物スナイパーが迎え撃つ',
    units: [
      { typeId: 'samurai', team: 0, x: -4.5, z: -3.6 },
      { typeId: 'samurai', team: 0, x: -4.5, z: 0.0 },
      { typeId: 'samurai', team: 0, x: -4.5, z: 3.6 },
      { typeId: 'ninja', team: 0, x: -6.5, z: -5.0 },
      { typeId: 'ninja', team: 0, x: -6.5, z: -1.8 },
      { typeId: 'ninja', team: 0, x: -6.5, z: 1.8 },
      { typeId: 'ninja', team: 0, x: -6.5, z: 5.0 },

      { typeId: 'minigunner', team: 1, x: 6.5, z: -2.6 },
      { typeId: 'minigunner', team: 1, x: 6.5, z: 2.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: -1.6 },
      { typeId: 'swordsman', team: 1, x: 4.2, z: 1.6 },
      { typeId: 'sniper', team: 1, x: 15.0, z: -3.5 },
      { typeId: 'sniper', team: 1, x: 15.0, z: 0.0 },
      { typeId: 'sniper', team: 1, x: 15.0, z: 3.5 },
    ],
  },
  {
    name: '全15兵種カオス大合戦',
    description: '魔法・現代兵器・和風・動物・架空生物の全15ユニットが一堂に会する頂上決戦',
    units: [
      { typeId: 'dragon', team: 0, x: -8.0, z: -2.8 },
      { typeId: 'warelephant', team: 0, x: -6.5, z: 2.8 },
      { typeId: 'samurai', team: 0, x: -4.2, z: -4.5 },
      { typeId: 'ninja', team: 0, x: -4.2, z: 4.5 },
      { typeId: 'slime', team: 0, x: -4.0, z: 0.0 },
      { typeId: 'giant_eagle', team: 0, x: -6.0, z: -6.2 },
      { typeId: 'minigunner', team: 0, x: -9.5, z: 0.0 },
      { typeId: 'archmage', team: 0, x: -12.0, z: -3.5 },
      { typeId: 'gravimancer', team: 0, x: -12.0, z: 3.5 },
      { typeId: 'sniper', team: 0, x: -16.5, z: 0.0 },

      { typeId: 'dragon', team: 1, x: 8.0, z: 2.8 },
      { typeId: 'warelephant', team: 1, x: 6.5, z: -2.8 },
      { typeId: 'samurai', team: 1, x: 4.2, z: 4.5 },
      { typeId: 'ninja', team: 1, x: 4.2, z: -4.5 },
      { typeId: 'slime', team: 1, x: 4.0, z: 0.0 },
      { typeId: 'giant_eagle', team: 1, x: 6.0, z: 6.2 },
      { typeId: 'minigunner', team: 1, x: 9.5, z: 0.0 },
      { typeId: 'archmage', team: 1, x: 12.0, z: 3.5 },
      { typeId: 'gravimancer', team: 1, x: 12.0, z: -3.5 },
      { typeId: 'sniper', team: 1, x: 16.5, z: 0.0 },
    ],
  },
];

export type GameMode = 'placement' | 'battle';

/**
 * ゲーム全体の進行管理と UI バインディング。
 * - 配置モード: 地面クリックでユニット配置（左半分=赤軍、右半分=青軍）、右クリックで削除
 * - 戦闘モード: AI 有効化、スローモーション／倍速対応、決着時に勝敗バナー表示
 */
export class GameApp {
  readonly battle = new Battle();
  readonly view: SceneView;
  readonly sound = new SoundManager();

  mode: GameMode = 'placement';
  selectedType: UnitTypeId = 'swordsman';
  selectedCategory: UnitCategory | 'all' = 'all';
  timeScale = 1.0;
  paused = false;

  /** 配置フェーズで置かれた編成（リトライ時に復元する） */
  private savedLineup: PlacedRecord[] = [];
  private announcedResult: BattleResult = null;
  private pointerDownPos = { x: 0, y: 0, button: -1 };

  // UI 要素
  private readonly elRedStats: HTMLElement;
  private readonly elBlueStats: HTMLElement;
  private readonly elStartBtn: HTMLButtonElement;
  private readonly elPhaseBadge: HTMLElement;
  private readonly elBanner: HTMLElement;
  private readonly elBannerText: HTMLElement;
  private readonly elBannerSub: HTMLElement;
  private readonly elCategoryTabs: HTMLElement | null;
  private readonly elUnitBar: HTMLElement;
  private readonly elSpeedButtons: HTMLButtonElement[] = [];

  constructor(viewport: HTMLElement) {
    this.view = new SceneView(viewport);

    this.battle.onUnitAdded = (u) => this.view.addUnitVisual(u);
    this.battle.onUnitRemoved = (u) => this.view.removeUnitVisual(u);
    this.battle.combat.onShootArrow = () => this.sound.playBowShoot();
    this.battle.combat.onEffect = (e) => {
      this.view.spawnCombatEffect(e);
      this.sound.playEffect(e);
    };
    this.battle.combat.onHit = (e) => {
      const partBroken = this.view.spawnHitEffect(e);
      const wKind = e.attacker.type.weapon?.kind;
      const heavy =
        e.attacker.type.id === 'giant' ||
        e.attacker.type.id === 'warelephant' ||
        e.attacker.type.id === 'dragon' ||
        e.damage >= 40;
      const metallic = wKind === 'sword' || wKind === 'spear' || wKind === 'katana' || e.kind === 'slash';
      this.sound.playHit(heavy, metallic, partBroken || e.killed);
    };

    this.elRedStats = document.getElementById('red-stats')!;
    this.elBlueStats = document.getElementById('blue-stats')!;
    this.elStartBtn = document.getElementById('btn-start') as HTMLButtonElement;
    this.elPhaseBadge = document.getElementById('phase-badge')!;
    this.elBanner = document.getElementById('result-banner')!;
    this.elBannerText = document.getElementById('result-title')!;
    this.elBannerSub = document.getElementById('result-sub')!;
    this.elCategoryTabs = document.getElementById('category-tabs');
    this.elUnitBar = document.getElementById('unit-bar')!;

    this.buildUI();
    this.bindCanvasInteraction();
    this.loadPreset(PRESETS[0]);
  }

  private buildUI(): void {
    // カテゴリ切替タブを生成
    if (this.elCategoryTabs) {
      this.elCategoryTabs.innerHTML = '';
      const cats: ReadonlyArray<{ id: UnitCategory | 'all'; label: string }> = [
        { id: 'all', label: 'すべて (15)' },
        { id: 'standard', label: CATEGORY_LABELS.standard },
        { id: 'magic', label: CATEGORY_LABELS.magic },
        { id: 'modern', label: CATEGORY_LABELS.modern },
        { id: 'japanese', label: CATEGORY_LABELS.japanese },
        { id: 'animal', label: CATEGORY_LABELS.animal },
        { id: 'mythical', label: CATEGORY_LABELS.mythical },
      ];
      cats.forEach((c) => {
        const b = document.createElement('button');
        b.className = 'cat-tab' + (c.id === this.selectedCategory ? ' active' : '');
        b.dataset.cat = c.id;
        b.textContent = c.label;
        b.addEventListener('click', () => {
          this.selectedCategory = c.id;
          this.elCategoryTabs?.querySelectorAll('.cat-tab').forEach((el) => {
            el.classList.toggle('active', (el as HTMLElement).dataset.cat === c.id);
          });
          this.renderUnitCards();
        });
        this.elCategoryTabs!.appendChild(b);
      });
    }

    this.renderUnitCards();

    // プリセット選択ボタン
    const presetContainer = document.getElementById('preset-buttons')!;
    presetContainer.innerHTML = '';
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn';
      b.textContent = p.name;
      b.title = p.description;
      b.addEventListener('click', () => this.loadPreset(p));
      presetContainer.appendChild(b);
    });

    // 戦闘開始／配置に戻るボタン
    this.elStartBtn.addEventListener('click', () => {
      if (this.mode === 'placement') this.startBattle();
      else this.returnToPlacement();
    });

    document.getElementById('btn-retry')!.addEventListener('click', () => {
      this.returnToPlacement();
    });

    // 全消去ボタン
    document.getElementById('btn-clear')!.addEventListener('click', () => {
      if (this.mode !== 'placement') this.returnToPlacement();
      this.savedLineup = [];
      this.battle.clear();
      this.view.clearDebris();
      this.sound.playRemove();
      this.updateHUD();
    });

    // SE ミュート切り替えボタン
    const muteBtn = document.getElementById('btn-mute') as HTMLButtonElement | null;
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const muted = this.sound.toggleMute();
        muteBtn.textContent = muted ? '🔇 SE: OFF' : '🔊 SE: ON';
      });
    }

    // カメラリセット
    document.getElementById('btn-cam-reset')!.addEventListener('click', () => {
      this.view.resetCamera();
    });

    // 速度変更ボタン
    const speedContainer = document.getElementById('speed-buttons')!;
    const speeds: ReadonlyArray<{ label: string; scale: number; pause?: boolean }> = [
      { label: '一時停止', scale: 0, pause: true },
      { label: '0.25x スロー', scale: 0.25 },
      { label: '1x 通常', scale: 1.0 },
      { label: '2x 倍速', scale: 2.0 },
    ];
    speeds.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn' + (!s.pause && s.scale === 1.0 ? ' active' : '');
      b.textContent = s.label;
      b.addEventListener('click', () => {
        this.paused = Boolean(s.pause);
        if (!s.pause) this.timeScale = s.scale;
        this.elSpeedButtons.forEach((btn) => btn.classList.remove('active'));
        b.classList.add('active');
      });
      speedContainer.appendChild(b);
      this.elSpeedButtons.push(b);
    });

    // キーボードショートカット（Space: 戦闘開始/戻る、1〜5: 兵種選択）
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.mode === 'placement') this.startBattle();
        else this.returnToPlacement();
      } else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.replace('Digit', '')) - 1;
        if (n >= 0 && n < UNIT_TYPE_LIST.length) {
          this.selectUnitType(UNIT_TYPE_LIST[n].id);
        }
      }
    });
  }

  private renderUnitCards(): void {
    this.elUnitBar.innerHTML = '';
    const filtered = UNIT_TYPE_LIST.filter(
      (ut) => this.selectedCategory === 'all' || ut.category === this.selectedCategory,
    );
    filtered.forEach((ut, idx) => {
      const btn = document.createElement('button');
      btn.className = 'unit-card' + (ut.id === this.selectedType ? ' active' : '');
      btn.dataset.type = ut.id;
      const keyLabel = idx < 9 ? `${idx + 1}` : '';
      btn.innerHTML = `
        <div class="unit-key">${keyLabel}</div>
        <div class="unit-cat-badge">${CATEGORY_LABELS[ut.category]}</div>
        <div class="unit-name">${ut.name}</div>
        <div class="unit-meta">コスト ${ut.cost} / HP ${ut.hp}</div>
        <div class="unit-desc">${ut.description}</div>
      `;
      btn.addEventListener('click', () => this.selectUnitType(ut.id));
      this.elUnitBar.appendChild(btn);
    });
  }

  private selectUnitType(id: UnitTypeId): void {
    this.selectedType = id;
    const cards = this.elUnitBar.querySelectorAll<HTMLElement>('.unit-card');
    cards.forEach((c) => {
      c.classList.toggle('active', c.dataset.type === id);
    });
  }

  private bindCanvasInteraction(): void {
    const dom = this.view.renderer.domElement;
    const groundHit = new Vector3();

    dom.addEventListener('pointermove', (e) => {
      if (this.mode !== 'placement') {
        this.view.updatePlacementGhost(null, 0, null, false);
        return;
      }
      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (!p || !this.isInsideArena(p.x, p.z)) {
        this.view.updatePlacementGhost(this.selectedType, 0, null, false);
        return;
      }
      const team: Team = p.x < 0 ? 0 : 1;
      this.view.updatePlacementGhost(this.selectedType, team, p, Math.abs(p.x) > 1.2);
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 2) {
        // 右ドラッグでカメラ回転もできるようにする
        this.view.startOrbitDrag(e.clientX, e.clientY);
      }
    });

    dom.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (moved > 6 || this.mode !== 'placement') return;

      const p = this.view.screenToGround(e.clientX, e.clientY, groundHit);
      if (!p) return;

      if (e.button === 0 && !e.altKey) {
        // 左クリック: ユニット配置（x < 0 なら赤軍、x > 0 なら青軍）
        if (!this.isInsideArena(p.x, p.z) || Math.abs(p.x) <= 1.2) return;
        const team: Team = p.x < 0 ? 0 : 1;
        this.battle.spawnUnit(this.selectedType, team, p.x, p.z);
        this.savedLineup.push({ typeId: this.selectedType, team, x: p.x, z: p.z });
        this.sound.playPlace();
        this.updateHUD();
      } else if (e.button === 2) {
        // 右クリック: 最も近いユニットを削除
        this.removeNearestUnitAt(p.x, p.z);
      }
    });
  }

  private isInsideArena(x: number, z: number): boolean {
    return Math.abs(x) <= 22 && Math.abs(z) <= 16;
  }

  private removeNearestUnitAt(x: number, z: number): void {
    let bestIdx = -1;
    let bestDist = 1.6;
    for (let i = 0; i < this.battle.units.length; i++) {
      const u = this.battle.units[i];
      const d = Math.hypot(u.pelvis.pos.x - x, u.pelvis.pos.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const target = this.battle.units[bestIdx];
      this.battle.removeUnit(target);
      this.savedLineup.splice(bestIdx, 1);
      this.sound.playRemove();
      this.updateHUD();
    }
  }

  loadPreset(preset: PresetScenario): void {
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();
    this.savedLineup = preset.units.map((u) => ({ ...u }));
    for (const u of this.savedLineup) {
      this.battle.spawnUnit(u.typeId, u.team, u.x, u.z);
    }
    this.syncPhaseUI();
    this.updateHUD();
  }

  startBattle(): void {
    if (this.battle.aliveCount(0) === 0 || this.battle.aliveCount(1) === 0) {
      return;
    }
    this.mode = 'battle';
    this.battle.aiEnabled = true;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(false);
    this.sound.playBattleStart();
    this.syncPhaseUI();
  }

  returnToPlacement(): void {
    this.mode = 'placement';
    this.battle.aiEnabled = false;
    this.announcedResult = null;
    this.elBanner.classList.add('hidden');
    this.view.setPlacementGuidesVisible(true);
    this.battle.clear();
    this.view.clearDebris();
    for (const u of this.savedLineup) {
      this.battle.spawnUnit(u.typeId, u.team, u.x, u.z);
    }
    this.syncPhaseUI();
    this.updateHUD();
  }

  private syncPhaseUI(): void {
    if (this.mode === 'placement') {
      this.elPhaseBadge.textContent = '配置フェーズ（左半分：赤軍 ／ 右半分：青軍）';
      this.elPhaseBadge.className = 'phase-badge placement';
      this.elStartBtn.textContent = '⚔ 戦闘開始 (Space)';
      this.elStartBtn.className = 'start-btn';
      this.elUnitBar.classList.remove('disabled');
    } else {
      this.elPhaseBadge.textContent = '戦闘中';
      this.elPhaseBadge.className = 'phase-badge battle';
      this.elStartBtn.textContent = '↺ 配置に戻る (Space)';
      this.elStartBtn.className = 'start-btn stop';
      this.elUnitBar.classList.add('disabled');
    }
  }

  private updateHUD(): void {
    const statsFor = (team: Team) => {
      let alive = 0;
      let total = 0;
      let cost = 0;
      let hp = 0;
      let maxHp = 0;
      for (const u of this.battle.units) {
        if (u.team !== team) continue;
        total++;
        cost += UNIT_TYPES[u.type.id].cost;
        maxHp += u.maxHp;
        if (u.alive) {
          alive++;
          hp += Math.max(0, u.hp);
        }
      }
      const ratio = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
      return { alive, total, cost, ratio };
    };

    const r = statsFor(0);
    const b = statsFor(1);
    this.elRedStats.innerHTML = `
      <div class="team-title">赤軍: ${r.alive} / ${r.total} 体 <span class="cost-tag">(${r.cost} pt)</span></div>
      <div class="hp-bar"><div class="hp-fill red" style="width:${r.ratio}%"></div></div>
    `;
    this.elBlueStats.innerHTML = `
      <div class="team-title">青軍: ${b.alive} / ${b.total} 体 <span class="cost-tag">(${b.cost} pt)</span></div>
      <div class="hp-bar"><div class="hp-fill blue" style="width:${b.ratio}%"></div></div>
    `;
  }

  /** 毎フレームの更新ループ */
  tick(realDt: number): void {
    if (!this.paused) {
      this.battle.advance(realDt * this.timeScale);
    }

    if (this.mode === 'battle') {
      const res = this.battle.result();
      if (res !== null && this.announcedResult === null) {
        this.announcedResult = res;
        this.sound.playVictory();
        if (res === 'draw') {
          this.elBannerText.textContent = '引き分け！';
          this.elBannerSub.textContent = '両軍ともに全滅しました';
        } else {
          this.elBannerText.textContent = `${TEAM_NAMES[res]}の勝利！`;
          this.elBannerSub.textContent = `生存ユニット: ${this.battle.aliveCount(res)} 体`;
        }
        this.elBanner.classList.remove('hidden');
      }
    }

    this.updateHUD();
    this.view.renderFrame(this.battle, realDt);
  }
}
