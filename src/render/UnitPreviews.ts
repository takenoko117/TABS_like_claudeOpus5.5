import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit } from '../units/Unit';
import { UNIT_TYPES, type UnitTypeId } from '../units/UnitTypes';
import { VoxelCharacterVisual } from './VoxelModel';

/** 物理の刻み（秒） */
const STEP = 1 / 60;
/** カードの更新間隔（秒） */
const FRAME = 1 / 30;
/** 共有レンダラーの描画サイズ（px）。各カードへはこの絵を縮小して写す */
const RENDER_PX = 256;
const FOV = 24;
/** 正面やや右上から見下ろす向き */
const VIEW_DIR = new Vector3(0.58, 0.3, 0.76).normalize();
/** 歩く速さの上限（速い兵種が足踏みだけで暴れないように） */
const MAX_WALK_SPEED = 1.8;
const SETTLE_STEPS = 45;
/** 跳ねると地響きになる大きさ */
const MAX_HOP_SCALE = 1.6;

const _center = new Vector3();

/** 1体ぶんの、カード上で動き続けるモデル（描画なしで動かせる） */
export class UnitPreviewActor {
  readonly unit: Unit;
  readonly world = new PhysicsWorld();
  private swingTimer: number;
  private accumulator = 0;

  constructor(
    readonly id: UnitTypeId,
    private readonly still = false,
  ) {
    this.unit = new Unit(this.world, UNIT_TYPES[id], 0, new Vector3(0, 0, 0), 0);
    this.swingTimer = 1.5 + Math.random() * 3.5;
    for (let i = 0; i < SETTLE_STEPS; i++) this.step(STEP);
  }

  private get walkSpeed(): number {
    return this.still ? 0 : Math.min(MAX_WALK_SPEED, UNIT_TYPES[this.id].speed * 0.5) * Math.max(0.6, this.unit.scale * 0.6);
  }

  /** 攻撃の構えから振り抜きまでを1回行う */
  swing(): void {
    if (this.still || this.unit.attackPhase !== 'none') return;
    this.unit.attackPhase = 'windup';
    this.unit.phaseTime = 0;
  }

  /** その場で跳ねる（巨体はかわりに攻撃の動きだけ） */
  hop(): void {
    if (this.still) return;
    this.swing();
    if (this.unit.scale > MAX_HOP_SCALE) return;
    const jump = new Vector3(0, 3.2, 0);
    for (const p of this.unit.joints) p.addVelocity(jump, 1);
  }

  private updateAttack(dt: number): void {
    const u = this.unit;
    if (u.attackPhase === 'none') {
      this.swingTimer -= dt;
      if (this.swingTimer <= 0) {
        this.swingTimer = 2.5 + Math.random() * 4;
        this.swing();
      }
      return;
    }
    u.phaseTime += dt;
    if (u.attackPhase === 'windup' && u.phaseTime >= Math.min(0.5, u.type.windup)) {
      u.attackPhase = 'strike';
      u.phaseTime = 0;
    } else if (u.attackPhase === 'strike' && u.phaseTime >= 0.28) {
      u.attackPhase = 'none';
      u.phaseTime = 0;
    }
  }

  private step(dt: number): void {
    this.updateAttack(dt);
    this.unit.previewStep(dt, this.walkSpeed);
    this.world.step(dt);
    // 歩いても画面から外れないよう、全身をランニングマシンのように原点へ戻す
    const { x, z } = this.unit.pelvis.pos;
    for (const p of this.world.particles) {
      p.pos.x -= x;
      p.pos.z -= z;
      p.prev.x -= x;
      p.prev.z -= z;
    }
  }

  advance(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, STEP * 4);
    while (this.accumulator >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
  }
}

interface PreviewModel {
  actor: UnitPreviewActor;
  visual: VoxelCharacterVisual;
  center: Vector3;
  distance: number;
}

interface PreviewSlot {
  id: UnitTypeId;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * カードの中でボクセルモデルを動かす。
 * WebGL は1つのレンダラーを共有し、描いた絵を各カードの 2D キャンバスへ写す。
 * 画面が作り直されてもモデルは兵種ごとに保持するので、動きは途切れない。
 */
export class UnitPreviews {
  private renderer: WebGLRenderer | null = null;
  private failed = false;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 300);
  private readonly models = new Map<UnitTypeId, PreviewModel>();
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private slots: PreviewSlot[] = [];
  private root: HTMLElement | null = null;
  private frameTimer = 0;

  constructor() {
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xfff2d8, 2.4);
    sun.position.set(4, 9, 8);
    this.scene.add(sun);
  }

  private ensureRenderer(): WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      const renderer = new WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.setPixelRatio(1);
      renderer.setSize(RENDER_PX, RENDER_PX, false);
      this.renderer = renderer;
    } catch {
      // WebGL が使えない環境では、下に敷いたアイコンのまま表示する
      this.failed = true;
    }
    return this.renderer;
  }

  /** root の中の [data-unit-preview] をモデルの表示先にする */
  bind(root: HTMLElement): void {
    this.root = root;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.slots = [];
    for (const host of root.querySelectorAll<HTMLElement>('[data-unit-preview]')) {
      const canvas = host.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) continue;
      const css = Math.max(1, host.clientWidth);
      canvas.width = canvas.height = Math.min(RENDER_PX, Math.round(css * dpr));
      this.slots.push({ id: host.dataset.unitPreview as UnitTypeId, host, canvas, ctx });
      if (this.models.has(host.dataset.unitPreview as UnitTypeId)) host.classList.add('ready');
    }
    root.onpointerover = (e) => {
      const host = (e.target as HTMLElement).closest<HTMLElement>('[data-unit-preview]');
      if (host && !host.contains(e.relatedTarget as Node | null)) this.kick(host.dataset.unitPreview as UnitTypeId);
    };
    // 開いた瞬間に絵が出るよう、すでに作ってあるモデルはすぐ描く
    this.frameTimer = FRAME;
  }

  unbind(): void {
    if (this.root) this.root.onpointerover = null;
    this.root = null;
    this.slots = [];
  }

  /** モデルを跳ねさせて反応を見せる */
  kick(id: UnitTypeId): void {
    this.models.get(id)?.actor.hop();
  }

  private createModel(id: UnitTypeId): PreviewModel {
    const actor = new UnitPreviewActor(id, this.still);
    const visual = new VoxelCharacterVisual(actor.unit);
    visual.sync();
    this.scene.add(visual.group);

    // 枠に収まる距離を、実際に見えている形から決める
    visual.group.updateMatrixWorld(true);
    const box = new Box3();
    visual.group.traverseVisible((o) => {
      if (o instanceof Mesh) box.expandByObject(o);
    });
    visual.group.visible = false;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(0.6, box.getSize(_center).length() / 2);
    return { actor, visual, center, distance: (radius * 1.12) / Math.sin((FOV / 2) * (Math.PI / 180)) };
  }

  /** 毎フレーム呼ぶ */
  update(realDt: number): void {
    if (this.slots.length === 0) return;
    this.frameTimer += realDt;
    if (this.frameTimer < FRAME) return;
    const dt = Math.min(0.1, this.frameTimer);
    this.frameTimer = 0;
    const renderer = this.ensureRenderer();
    if (!renderer) return;

    // モデルの生成は重いので1フレームに1体まで
    const missing = this.slots.find((s) => !this.models.has(s.id));
    if (missing) {
      this.models.set(missing.id, this.createModel(missing.id));
      for (const s of this.slots) if (s.id === missing.id) s.host.classList.add('ready');
    }

    const view = this.root?.querySelector('.rogue-modal-inner')?.getBoundingClientRect();
    const drawn = new Set<UnitTypeId>();
    for (const slot of this.slots) {
      const model = this.models.get(slot.id);
      if (!model) continue;
      const rect = slot.host.getBoundingClientRect();
      if (view && (rect.bottom < view.top || rect.top > view.bottom)) continue;
      if (!drawn.has(slot.id)) {
        drawn.add(slot.id);
        model.actor.advance(dt);
        model.visual.sync();
        model.visual.group.visible = true;
        this.camera.position.copy(model.center).addScaledVector(VIEW_DIR, model.distance);
        this.camera.lookAt(model.center);
        renderer.render(this.scene, this.camera);
        model.visual.group.visible = false;
        // 同じ兵種のカードが複数あれば同じ絵を写す
        for (const s of this.slots) {
          if (s.id !== slot.id) continue;
          s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
          s.ctx.drawImage(renderer.domElement, 0, 0, s.canvas.width, s.canvas.height);
        }
      }
    }
  }
}
