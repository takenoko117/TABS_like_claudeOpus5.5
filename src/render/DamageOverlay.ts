import { Vector3, type PerspectiveCamera } from 'three';
import type { DamageEvent, DamageKind } from '../combat/CombatSystem';
import type { Unit } from '../units/Unit';

/** 数値表示の量 */
export type DamageNumberMode = 'all' | 'big' | 'off';

export const DAMAGE_NUMBER_MODE_LABELS: Readonly<Record<DamageNumberMode, string>> = {
  all: 'すべて',
  big: '大きいものだけ',
  off: 'オフ',
};

/** 同時に出すダメージ数字の上限 */
export const MAX_DAMAGE_LABELS = 60;
/** 同時に出す HP の数字の上限（HP バーの上限に合わせる） */
export const MAX_HP_LABELS = 400;
/** 生きているユニットがこれより多いときは、減っている HP とボスの数字だけを出す（DOM の書き込みを減らす） */
export const HP_NUMBER_CROWD_UNITS = 40;
/** 混雑時に出す HP の数字の上限 */
export const HP_NUMBER_CROWD_MAX = 40;

/** HP の数字を出すかどうか（混雑時は減っている HP とボスだけにする） */
export function shouldShowHpNumber(hp: number, maxHp: number, isBoss: boolean, crowded: boolean): boolean {
  if (!crowded) return true;
  return isBoss || hp < maxHp;
}
/** この時間内の同じユニット・同じ種類のダメージは1つの数字に合算する（秒） */
export const DAMAGE_MERGE_WINDOW = 0.3;
/** この値以上の一撃は特大表示にする */
export const HUGE_HIT_THRESHOLD = 300;

const LABEL_LIFE = 0.95;

const KIND_CLASSES: Readonly<Record<DamageKind, string>> = {
  physical: 'dmg-physical',
  explosion: 'dmg-explosion',
  fire: 'dmg-fire',
  shock: 'dmg-shock',
  poison: 'dmg-poison',
  impact: 'dmg-impact',
};

/**
 * 「大きいものだけ」モードで表示するか。
 * 受けた側の最大HPの10%以上の一撃、撃破の一撃、または一定以上のダメージを表示する。
 */
export function isSignificantDamage(amount: number, victimMaxHp: number, killed: boolean): boolean {
  if (killed) return true;
  if (amount >= 60) return true;
  return amount >= Math.max(8, victimMaxHp * 0.1);
}

/** ダメージ量から文字サイズ（px）を決める。大きいほど大きく、上限あり */
export function damageFontSize(amount: number): number {
  return Math.round(12 + Math.min(22, Math.log10(Math.max(1, amount) + 1) * 7));
}

/** 表示用の数値の整形（3桁区切り） */
export function formatDamage(amount: number): string {
  return Math.max(1, Math.round(amount)).toLocaleString('ja-JP');
}

interface DamageLabel {
  el: HTMLDivElement;
  victimId: number;
  kind: DamageKind;
  amount: number;
  pos: Vector3;
  age: number;
  active: boolean;
  drift: number;
}

const _proj = new Vector3();

/**
 * 戦場に重ねる HTML のオーバーレイ。
 * - 被弾位置から浮かぶダメージ数字（種類ごとの色、大きさは量に比例、小さな連続ダメージは合算）
 * - 巨体・ボス・選択中の兵種の HP の数字（HP バー本体は SceneView が描く）
 */
export class DamageOverlay {
  mode: DamageNumberMode = 'big';
  private readonly root: HTMLDivElement;
  private readonly labels: DamageLabel[] = [];
  private readonly hpLabels: HTMLDivElement[] = [];
  /** HP の数字の表示状態と位置（同じ値なら DOM に書き込まない） */
  private readonly hpShown: boolean[] = [];
  private readonly hpTransforms: string[] = [];
  private width = 1;
  private height = 1;
  /** 大きさを測り直す必要があるか（毎フレーム測るとレイアウトの再計算が走る） */
  private sizeDirty = true;

  constructor(
    container: HTMLElement,
    private readonly camera: PerspectiveCamera,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'damage-overlay';
    container.appendChild(this.root);
    const markDirty = () => {
      this.sizeDirty = true;
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markDirty).observe(this.root);
    else window.addEventListener('resize', markDirty);
  }

  /** ダメージを受け取り、表示する数字を追加または合算する */
  onDamage(e: DamageEvent): void {
    if (this.mode === 'off') return;
    if (this.mode === 'big' && !isSignificantDamage(e.amount, e.victim.maxHp, e.killed)) {
      // 小さな連続ダメージも合算先があれば足しておく（後で大きくなれば表示される）
      const merged = this.findMergeTarget(e.victim.id, e.kind);
      if (merged) this.addToLabel(merged, e.amount);
      return;
    }

    const merged = this.findMergeTarget(e.victim.id, e.kind);
    if (merged) {
      this.addToLabel(merged, e.amount);
      return;
    }

    let label = this.labels.find((l) => !l.active);
    if (!label) {
      if (this.labels.length < MAX_DAMAGE_LABELS) {
        const el = document.createElement('div');
        el.className = 'dmg-label';
        this.root.appendChild(el);
        label = {
          el,
          victimId: 0,
          kind: 'physical',
          amount: 0,
          pos: new Vector3(),
          age: 0,
          active: false,
          drift: 0,
        };
        this.labels.push(label);
      } else {
        // 上限に達したら一番小さい数字を差し替える
        label = this.labels.reduce((min, l) => (l.amount < min.amount ? l : min), this.labels[0]);
        if (label.amount > e.amount) return;
      }
    }

    label.active = true;
    label.victimId = e.victim.id;
    label.kind = e.kind;
    label.amount = e.amount;
    label.age = 0;
    label.drift = (Math.random() - 0.5) * 1.6;
    label.pos.set(
      e.pos.x + (Math.random() - 0.5) * 0.5,
      e.pos.y + 0.5 * e.victim.scale + Math.random() * 0.4,
      e.pos.z + (Math.random() - 0.5) * 0.5,
    );
    label.el.style.display = 'block';
    this.renderLabelText(label, e.killed);
  }

  private findMergeTarget(victimId: number, kind: DamageKind): DamageLabel | undefined {
    return this.labels.find(
      (l) => l.active && l.victimId === victimId && l.kind === kind && l.age < DAMAGE_MERGE_WINDOW,
    );
  }

  private addToLabel(label: DamageLabel, amount: number): void {
    label.amount += amount;
    label.age = Math.min(label.age, DAMAGE_MERGE_WINDOW * 0.5);
    this.renderLabelText(label, false);
  }

  private renderLabelText(label: DamageLabel, killed: boolean): void {
    const huge = label.amount >= HUGE_HIT_THRESHOLD;
    label.el.className = `dmg-label ${KIND_CLASSES[label.kind]}${huge ? ' dmg-huge' : ''}${killed ? ' dmg-kill' : ''}`;
    label.el.style.fontSize = `${damageFontSize(label.amount)}px`;
    label.el.textContent = formatDamage(label.amount);
  }

  /** 全ての数字と HP バーを消す（配置フェーズに戻るときなど） */
  clear(): void {
    for (const l of this.labels) {
      l.active = false;
      l.el.style.display = 'none';
    }
    for (let i = 0; i < this.hpLabels.length; i++) this.setHpShown(i, false);
  }

  private setHpShown(i: number, shown: boolean): void {
    if (this.hpShown[i] === shown) return;
    this.hpShown[i] = shown;
    this.hpLabels[i].style.display = shown ? 'block' : 'none';
  }

  /**
   * 毎フレームの更新。
   * @param dt 数字の経過時間（スロー観戦中は短くなり、数字が長く残る）
   * @param showHpNumbers HP の数字を表示するか（配置フェーズや HP バー非表示の設定では出さない）
   */
  update(units: readonly Unit[], dt: number, showHpNumbers: boolean): void {
    if (this.sizeDirty) {
      const rect = this.root.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.sizeDirty = false;
    }

    for (const l of this.labels) {
      if (!l.active) continue;
      l.age += dt;
      if (l.age >= LABEL_LIFE) {
        l.active = false;
        l.el.style.display = 'none';
        continue;
      }
      const t = l.age / LABEL_LIFE;
      _proj.set(l.pos.x + l.drift * t, l.pos.y + 1.1 * t, l.pos.z);
      if (!this.project(_proj)) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = 'block';
      const pop = l.age < 0.12 ? 1 + (0.12 - l.age) * 4 : 1;
      l.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      l.el.style.transform = `translate(${_proj.x}px, ${_proj.y}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
    }

    // HP バー本体は SceneView が描くので、ここでは全ユニットの HP の数字だけを重ねる
    let used = 0;
    if (showHpNumbers) {
      let aliveCount = 0;
      for (const u of units) if (u.alive) aliveCount++;
      const crowded = aliveCount > HP_NUMBER_CROWD_UNITS;
      const max = crowded ? HP_NUMBER_CROWD_MAX : MAX_HP_LABELS;
      for (const u of units) {
        if (used >= max) break;
        if (!u.alive || !shouldShowHpNumber(u.hp, u.maxHp, u.isBoss, crowded)) continue;
        _proj.set(u.chest.pos.x, u.chest.pos.y + 0.72 * u.scale + 0.25, u.chest.pos.z);
        if (!this.project(_proj)) continue;
        const i = used++;
        const el = this.getHpLabel(i);
        this.setHpShown(i, true);
        // 数が多いので、変わらない className・位置・文字は書き換えない
        const className = `hp-number team-${u.team}${u.isBoss ? ' boss' : ''}`;
        if (el.className !== className) el.className = className;
        const transform = `translate(${Math.round(_proj.x)}px, ${Math.round(_proj.y)}px) translate(-50%, -135%)`;
        if (this.hpTransforms[i] !== transform) {
          this.hpTransforms[i] = transform;
          el.style.transform = transform;
        }
        const text = `${formatDamage(Math.max(0, u.hp))} / ${formatDamage(u.maxHp)}`;
        if (el.textContent !== text) el.textContent = text;
      }
    }
    for (let i = used; i < this.hpLabels.length; i++) this.setHpShown(i, false);
  }

  private getHpLabel(i: number): HTMLDivElement {
    let el = this.hpLabels[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'hp-number';
      el.style.display = 'none';
      this.root.appendChild(el);
      this.hpLabels[i] = el;
      this.hpShown[i] = false;
      this.hpTransforms[i] = '';
    }
    return el;
  }

  /** ワールド座標を画面座標（px）に変換する。カメラの後ろなら false */
  private project(v: Vector3): boolean {
    v.project(this.camera);
    if (v.z > 1 || v.z < -1) return false;
    v.x = ((v.x + 1) / 2) * this.width;
    v.y = ((1 - v.y) / 2) * this.height;
    return v.x > -60 && v.x < this.width + 60 && v.y > -60 && v.y < this.height + 60;
  }
}
