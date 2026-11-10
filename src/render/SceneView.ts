import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  NearestFilter,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Arrow, CombatEffectEvent, HitEvent } from '../combat/CombatSystem';
import type { Facility } from '../facilities/Facility';
import { getGateOpeningWidth, isFacilityTypeId, type FacilityTypeId } from '../facilities/FacilityTypes';
import { DEFAULT_RED_ZONES, type PlacementZone, type StageTerrainConfig, type StageVisualTheme } from '../game/ArcadeStages';
import type { Battle } from '../game/Battle';
import type { Unit } from '../units/Unit';
import { TEAM_COLORS, UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';
import {
  buildHeartGeometry,
  createFacilityGhost,
  GATE_TINTS,
  createFacilityMesh,
  createPreviewGhost,
  getFacilityVoxelSeeds,
  getKawariLogGeometry,
  getProjectileGeometry,
  VoxelCharacterVisual,
} from './VoxelModel';
import { EnergyGateVisual } from './EnergyGateVisual';

/** 部位損壊や薬莢・花びら・ゼリー飛沫として地面にドロップする不透明ボクセルパーティクル */
interface DroppedVoxel {
  pos: Vector3;
  vel: Vector3;
  rot: Euler;
  angVel: Vector3;
  color: Color;
  size: number;
  bounces: number;
  settled: boolean;
}

/** 魔法・炎・煙・稲妻・軌跡などの一過性エフェクトボクセル（寿命に応じて縮小消滅） */
interface FxParticle {
  pos: Vector3;
  vel: Vector3;
  scale: Vector3;
  rot: Euler;
  color: Color;
  gravity: number;
  life: number;
  maxLife: number;
}

/** 忍者の変わり身の丸太オブジェクト */
interface KawariLogItem {
  mesh: Mesh;
  vel: Vector3;
  angVel: Vector3;
  life: number;
}

const UP = new Vector3(0, 1, 0);
const _quat = new Quaternion();
const _mat4 = new Matrix4();
const _scale = new Vector3();
const _outward = new Vector3();
const _segDir = new Vector3();
const _mid = new Vector3();

/** ローグライト残機ハート1個分の描画状態 */
interface RogueHeartVisual {
  /** 位置決め用グループ（カメラの子） */
  group: Group;
  /** 一体表示用メッシュ（alive/lost でジオメトリを差し替える） */
  full: Mesh;
  /** 破砕時の左半分・右半分 */
  left: Mesh;
  right: Mesh;
  /** 半分メッシュのフェード用マテリアル（ハートごとに個別） */
  halfMat: MeshBasicMaterial;
  state: 'alive' | 'lost' | 'breaking' | 'reviving';
  /** アニメーション経過秒 */
  animT: number;
  /** 破砕時のボクセル散乱を既に出したか */
  scattered: boolean;
  /** レイアウトで決まる基準位置 */
  basePos: Vector3;
}

/** 施設の描画・HPバー管理用データ */
interface FacilityVisual {
  facility: Facility;
  group: Group;
  mesh: Mesh;
  hpBarFill: Mesh;
  hpBarGroup: Group;
  /** 進軍門の帯 */
  marchLane?: Mesh;
  /** 門の見た目（発生装置とエネルギー網） */
  energyGate?: EnergyGateVisual;
  lastHp: number;
}

/**
 * Three.js による戦場描画・カメラ操作・ボクセル損壊＆固有スキルエフェクトの管理クラス。
 */
export class SceneView {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;

  private readonly unitVisuals = new Map<number, VoxelCharacterVisual>();
  private readonly facilityVisuals = new Map<number, FacilityVisual>();
  /** ゲートのエネルギーのアニメーション用の時刻 */
  private gateClock = 0;
  private readonly arrowMeshes: Mesh[] = [];
  private readonly arrowMaterial = new MeshLambertMaterial({ vertexColors: true });

  // 損壊時にドロップする不透明ボクセルキューブ（InstancedMesh で一括描画）
  private readonly droppedVoxels: DroppedVoxel[] = [];
  private readonly voxelDropMesh: InstancedMesh;
  private readonly maxDroppedVoxels = 3000;
  private dropRingCursor = 0;

  // スキル・魔法・炎・レーザー・残像などの発光風ボクセルエフェクト（InstancedMesh）
  private readonly fxParticles: FxParticle[] = [];
  private readonly fxMesh: InstancedMesh;
  private readonly maxFxInstances = 2400;

  // 忍者の変わり身の丸太リスト
  private readonly kawariLogs: KawariLogItem[] = [];

  // ローグライト残機のボクセルハート（カメラに追従する HUD 的 3D 表示）
  private readonly rogueHeartGroup = new Group();
  private readonly rogueHearts: RogueHeartVisual[] = [];
  /** 一体表示用マテリアル（色はジオメトリの頂点色に焼き込み済み。alive/lost はジオメトリ差し替えで切り替える） */
  private readonly rogueHeartMat = new MeshBasicMaterial({
    vertexColors: true,
    depthTest: false,
    transparent: true,
  });
  /** ハートのジオメトリ一式（全ハートで共有） */
  private rogueHeartGeos: {
    full: BufferGeometry;
    lost: BufferGeometry;
    left: BufferGeometry;
    right: BufferGeometry;
  } | null = null;
  /** 同期済みの表示ライフ数（-1 は未同期。次の同期はアニメーションなしで即時反映する） */
  private rogueLivesShown = -1;
  private rogueMaxLivesShown = 0;

  // 配置フェーズ用の中心境界ライン・プレビューゴースト・ステージ地形グループ
  private readonly dividerGroup = new Group();
  private readonly terrainGroup = new Group();
  private ghostGroup: Group | null = null;
  private ghostLane: Mesh | null = null;
  private ghostLaneType: FacilityTypeId | null = null;
  private ghostKey = '';
  private ghostShownValid = true;

  // カメラ制御（オービット＋WASD 平行移動＋スマホ用タッチ＆2本指スワイプ平行移動＆ピンチズーム）
  private readonly camTarget = new Vector3(0, 0.8, 0);
  private camYaw = 0;
  private camPitch = 0.58;
  private camDistance = 24;
  private isDraggingOrbit = false;
  private isTouchOrbitPending = false;
  private touchStartX = 0;
  private touchStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly activeTouches = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;
  private lastTwoFingerMidX = 0;
  private lastTwoFingerMidY = 0;
  private hadMultiTouch = false;
  private readonly keys = new Set<string>();

  // 観戦カメラ（個体の追跡・決着時の寄り・衝撃の揺れ）
  private followedUnit: Unit | null = null;
  private finisherFocus: { target: Vector3; distance: number } | null = null;
  private cameraBeforeFinisher: { target: Vector3; yaw: number; pitch: number; distance: number } | null = null;
  private cameraShake = 0;

  // 傷ついたユニットの頭上に出す HP バー（InstancedMesh で一括描画）
  showHpBars = true;
  private readonly hpBarBack: InstancedMesh;
  private readonly hpBarFill: InstancedMesh;
  private readonly maxHpBars = 400;
  /** タイトル画面の背景デモ中、カメラをゆっくり回す */
  autoOrbit = false;
  private readonly cameraRestPos = new Vector3();
  private readonly shakeEnabled =
    typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 地面とのレイキャスト
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();

  // ステージ固有ビジュアルテーマ（空・フォグ・地面・ライト・環境パーティクル）
  private currentVisualTheme: StageVisualTheme | null = null;
  private ambientWeatherTimer = 0;
  private dirLight!: DirectionalLight;
  private hemiLight!: HemisphereLight;
  private groundCanvas!: HTMLCanvasElement;
  private groundTex!: CanvasTexture;

  constructor(container: HTMLElement) {
    this.scene.background = new Color(0x87b8de);
    this.scene.fog = new FogExp2(0x87b8de, 0.0085);

    this.camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.2, 200);
    this.updateCameraTransform();

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupEnvironment();

    const boxGeo = new BoxGeometry(1, 1, 1);
    const boxMat = new MeshLambertMaterial({
      color: 0xffffff,
      transparent: false,
    });
    this.voxelDropMesh = new InstancedMesh(boxGeo, boxMat, this.maxDroppedVoxels);
    this.voxelDropMesh.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    this.voxelDropMesh.castShadow = true;
    this.voxelDropMesh.receiveShadow = true;
    this.voxelDropMesh.count = 0;
    this.voxelDropMesh.frustumCulled = false;
    this.scene.add(this.voxelDropMesh);

    const fxMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
    });
    this.fxMesh = new InstancedMesh(boxGeo, fxMat, this.maxFxInstances);
    this.fxMesh.instanceMatrix.setUsage(35048);
    this.fxMesh.count = 0;
    this.fxMesh.frustumCulled = false;
    this.scene.add(this.fxMesh);

    const barGeo = new PlaneGeometry(1, 1);
    this.hpBarBack = new InstancedMesh(
      barGeo,
      new MeshBasicMaterial({ color: 0x11151c, depthTest: false, transparent: true, opacity: 0.75 }),
      this.maxHpBars,
    );
    this.hpBarFill = new InstancedMesh(
      barGeo,
      new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      this.maxHpBars,
    );
    for (const mesh of [this.hpBarBack, this.hpBarFill]) {
      mesh.instanceMatrix.setUsage(35048);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    this.hpBarBack.renderOrder = 10;
    this.hpBarFill.renderOrder = 11;

    this.setupInputListeners();
  }

  private setupLights(): void {
    this.hemiLight = new HemisphereLight(0xdff0ff, 0x5d7a47, 0.85);
    this.scene.add(this.hemiLight);

    const amb = new AmbientLight(0xffffff, 0.25);
    this.scene.add(amb);

    this.dirLight = new DirectionalLight(0xfff6e5, 1.35);
    this.dirLight.position.set(18, 32, 20);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    const d = 28;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 80;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);
  }

  private setupEnvironment(): void {
    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = 64;
    this.groundCanvas.height = 64;
    this.groundTex = new CanvasTexture(this.groundCanvas);
    this.groundTex.magFilter = NearestFilter;
    this.groundTex.minFilter = NearestFilter;
    this.groundTex.wrapS = RepeatWrapping;
    this.groundTex.wrapT = RepeatWrapping;
    this.groundTex.repeat.set(30, 30);
    this.groundTex.colorSpace = SRGBColorSpace;
    this.drawGroundTexture();

    const groundGeo = new PlaneGeometry(120, 120);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new MeshLambertMaterial({ map: this.groundTex });
    const ground = new Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rockMat = new MeshLambertMaterial({ color: 0x7b8288 });
    const trunkMat = new MeshLambertMaterial({ color: 0x6b4423 });
    const leafMat = new MeshLambertMaterial({ color: 0x3e7a34 });
    const cube = new BoxGeometry(1, 1, 1);

    const ringCount = 28;
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2 + (i % 3) * 0.07;
      const r = 34 + (i % 5) * 3.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (i % 2 === 0) {
        const tree = new Group();
        const h = 2.2 + (i % 3) * 0.6;
        const trunk = new Mesh(cube, trunkMat);
        trunk.scale.set(0.6, h, 0.6);
        trunk.position.y = h / 2;
        trunk.castShadow = true;
        tree.add(trunk);

        const crown = new Mesh(cube, leafMat);
        const cs = 2.0 + (i % 2) * 0.5;
        crown.scale.set(cs, cs * 1.1, cs);
        crown.position.y = h + cs * 0.45;
        crown.castShadow = true;
        tree.add(crown);

        tree.position.set(x, 0, z);
        this.scene.add(tree);
      } else {
        const rock = new Mesh(cube, rockMat);
        const sx = 1.4 + (i % 3) * 0.6;
        const sy = 0.9 + (i % 2) * 0.5;
        const sz = 1.2 + ((i + 1) % 3) * 0.5;
        rock.scale.set(sx, sy, sz);
        rock.position.set(x, sy / 2, z);
        rock.rotation.y = a;
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
      }
    }

    const lineGeo = new BoxGeometry(0.14, 0.03, 0.9);
    const whiteMat = new MeshBasicMaterial({ color: 0xf8f8f2 });
    for (let z = -22; z <= 22; z += 1.6) {
      const dash = new Mesh(lineGeo, whiteMat);
      dash.position.set(0, 0.02, z);
      this.dividerGroup.add(dash);
    }

    const makeBorder = (team: Team) => {
      const mat = new MeshBasicMaterial({
        color: TEAM_COLORS[team].shirt,
        transparent: true,
        opacity: 0.45,
      });
      const sign = team === 0 ? -1 : 1;
      const sideH = new Mesh(new BoxGeometry(22, 0.025, 0.14), mat);
      sideH.position.set(sign * 11, 0.015, -16);
      const sideH2 = sideH.clone();
      sideH2.position.set(sign * 11, 0.015, 16);
      const sideV = new Mesh(new BoxGeometry(0.14, 0.025, 32), mat);
      sideV.position.set(sign * 22, 0.015, 0);
      this.dividerGroup.add(sideH, sideH2, sideV);
    };
    makeBorder(0);
    makeBorder(1);
    this.scene.add(this.dividerGroup);
    this.scene.add(this.terrainGroup);

    // 残機ハートはカメラの子にして、カメラを回しても画面左上に固定表示する
    this.scene.add(this.camera);
    this.rogueHeartGroup.visible = false;
    this.camera.add(this.rogueHeartGroup);
  }

  /** ステージ固有のビジュアル環境（背景色・フォグ・床テクスチャ・環境光・天候）を適用する */
  setStageTheme(theme?: StageVisualTheme): void {
    this.currentVisualTheme = theme ?? null;
    const sky = theme ? theme.skyColor : 0x87b8de;
    const fog = theme ? theme.fogColor : 0x87b8de;
    const density = theme?.fogDensity ?? 0.0085;

    this.scene.background = new Color(sky);
    this.scene.fog = new FogExp2(fog, density);

    if (this.dirLight) {
      this.dirLight.color.setHex(theme?.lightColor ?? 0xfff6e5);
      this.dirLight.intensity = theme?.lightIntensity ?? 1.35;
    }
    if (this.hemiLight) {
      this.hemiLight.color.setHex(theme?.hemiSkyColor ?? 0xdff0ff);
      this.hemiLight.groundColor.setHex(theme?.hemiGroundColor ?? 0x5d7a47);
    }

    this.drawGroundTexture(theme);
  }

  private drawGroundTexture(theme?: StageVisualTheme): void {
    if (!this.groundCanvas || !this.groundTex) return;
    const ctx = this.groundCanvas.getContext('2d')!;
    const c1 = theme?.groundColor1 ?? '#6ea84f';
    const c2 = theme?.groundColor2 ?? '#659c47';
    const pType = theme?.particleType;

    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, 64, 64);

    if (pType === 'embers') {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 14, 64, 4);
      ctx.fillRect(28, 0, 4, 64);
      ctx.fillRect(10, 40, 44, 4);
      ctx.fillRect(44, 18, 4, 36);
      ctx.fillStyle = '#ffedd5';
      ctx.fillRect(29, 15, 2, 2);
      ctx.fillRect(45, 41, 2, 2);
    } else if (pType === 'snow') {
      ctx.fillStyle = c2;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if ((x + y) % 2 === 0) ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      }
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(4, 4, 56, 56);
      ctx.strokeRect(20, 20, 24, 24);
    } else if (pType === 'spores') {
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(16, 16, 10, 0, Math.PI * 2);
      ctx.arc(48, 48, 12, 0, Math.PI * 2);
      ctx.arc(48, 16, 7, 0, Math.PI * 2);
      ctx.arc(16, 48, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (pType === 'gravity') {
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 62, 62);
      ctx.strokeRect(16, 16, 32, 32);
      ctx.fillStyle = c2;
      ctx.fillRect(30, 30, 4, 4);
    } else if (pType === 'sparks') {
      ctx.fillStyle = c2;
      ctx.fillRect(8, 0, 2, 64);
      ctx.fillRect(40, 0, 2, 64);
      ctx.fillRect(0, 24, 64, 2);
      ctx.fillRect(0, 56, 64, 2);
    } else if (pType === 'blood') {
      ctx.fillStyle = c2;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if ((x * 3 + y * 7) % 5 === 0) ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      }
    } else if (pType === 'void') {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillRect(32, 32, 32, 32);
    } else if (pType === 'time') {
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.arc(32, 32, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(2, 2, 60, 60);
    } else if (pType === 'flare') {
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, 52, 52);
      ctx.fillStyle = c2;
      ctx.fillRect(28, 6, 8, 52);
      ctx.fillRect(6, 28, 52, 8);
    } else if (pType === 'apocalypse') {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 20, 64, 4);
      ctx.fillRect(20, 0, 4, 64);
      ctx.fillRect(36, 10, 4, 54);
      ctx.fillRect(10, 48, 54, 4);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(22, 22, 12, 12);
    } else {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const even = (x + y) % 2 === 0;
          ctx.fillStyle = even ? c1 : c2;
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      }
    }

    this.groundTex.needsUpdate = true;
  }

  /**
   * ステージ固有の地形（石柱・一本橋の奈落）および配置可能ゾーン枠を構築・更新する。
   */
  setStageTerrain(terrain: StageTerrainConfig | null, isArcade: boolean): void {
    // 1. 既存の地形メッシュをクリア
    while (this.terrainGroup.children.length > 0) {
      this.terrainGroup.remove(this.terrainGroup.children[0]);
    }

    const cube = new BoxGeometry(1, 1, 1);

    // 2. 一本橋・複数橋・奈落ステージの描画
    if (terrain?.chasm) {
      const c = terrain.chasm;
      const chasmW = c.maxX - c.minX;
      const abyssMat = new MeshBasicMaterial({ color: 0x0b1017 });
      const cliffMat = new MeshLambertMaterial({ color: 0x495057 });
      const bridgeMat = new MeshLambertMaterial({ color: 0x868e96 });
      const railMat = new MeshLambertMaterial({ color: 0xadb5bd });

      const centers = c.bridgeCentersZ && c.bridgeCentersZ.length > 0 ? [...c.bridgeCentersZ].sort((a, b) => a - b) : [0];

      // 全体の奈落ベース（黒い谷底マスク）
      const totalZLen = 48;
      const pit = new Mesh(cube, abyssMat);
      pit.scale.set(chasmW, 0.04, totalZLen);
      pit.position.set((c.minX + c.maxX) * 0.5, 0.01, 0);
      this.terrainGroup.add(pit);

      // 崖の縁の岩壁
      const edgeL = new Mesh(cube, cliffMat);
      edgeL.scale.set(0.35, 0.22, totalZLen);
      edgeL.position.set(c.minX, 0.08, 0);
      const edgeR = edgeL.clone();
      edgeR.position.set(c.maxX, 0.08, 0);
      this.terrainGroup.add(edgeL, edgeR);

      // 各橋のプレートと欄干縁石
      for (const cz of centers) {
        const bridgeFloor = new Mesh(cube, bridgeMat);
        bridgeFloor.scale.set(chasmW + 0.8, 0.08, c.bridgeHalfWidth * 2);
        bridgeFloor.position.set((c.minX + c.maxX) * 0.5, 0.03, cz);
        bridgeFloor.receiveShadow = true;
        this.terrainGroup.add(bridgeFloor);

        for (const sign of [-1, 1]) {
          const curb = new Mesh(cube, railMat);
          curb.scale.set(chasmW + 0.6, 0.18, 0.22);
          curb.position.set((c.minX + c.maxX) * 0.5, 0.1, cz + sign * (c.bridgeHalfWidth - 0.1));
          curb.castShadow = true;
          this.terrainGroup.add(curb);
        }
      }
    }

    // 2.5 円形奈落ホール（すり鉢クレーター等）の描画
    if (terrain?.pits && terrain.pits.length > 0) {
      const abyssMat = new MeshBasicMaterial({ color: 0x090d14 });
      const rimMat = new MeshLambertMaterial({ color: 0x495057 });
      for (const pit of terrain.pits) {
        // 16角形風にボックスを組み合わせて円形奈落マスクと縁石を描画
        const segs = 16;
        for (let i = 0; i < segs; i++) {
          const ang = (i / segs) * Math.PI;
          const slab = new Mesh(cube, abyssMat);
          slab.scale.set(pit.radius * 1.95, 0.05, pit.radius * 0.45);
          slab.position.set(pit.x, 0.015, pit.z);
          slab.rotation.y = ang;
          this.terrainGroup.add(slab);
        }
        const rimSegs = 24;
        for (let i = 0; i < rimSegs; i++) {
          const ang = (i / rimSegs) * Math.PI * 2;
          const rim = new Mesh(cube, rimMat);
          rim.scale.set(0.4, 0.2, (pit.radius * 2 * Math.PI) / rimSegs + 0.1);
          rim.position.set(
            pit.x + Math.cos(ang) * pit.radius,
            0.09,
            pit.z + Math.sin(ang) * pit.radius,
          );
          rim.rotation.y = -ang;
          this.terrainGroup.add(rim);
        }
      }
    }

    // 2.6 浮島アリーナ（外周奈落）の描画
    if (terrain?.arenaBounds) {
      const b = terrain.arenaBounds;
      const abyssMat = new MeshBasicMaterial({ color: 0x080c14 });
      const cliffMat = new MeshLambertMaterial({ color: 0xadb5bd });
      // 上下左右の外周を奈落マスクで覆う
      const outer = 60;
      const topPit = new Mesh(cube, abyssMat);
      topPit.scale.set(outer * 2, 0.05, outer - b.maxZ);
      topPit.position.set(0, 0.015, -(b.maxZ + (outer - b.maxZ) * 0.5));
      const botPit = topPit.clone();
      botPit.position.set(0, 0.015, b.maxZ + (outer - b.maxZ) * 0.5);

      const leftPit = new Mesh(cube, abyssMat);
      leftPit.scale.set(outer - b.maxX, 0.05, b.maxZ * 2);
      leftPit.position.set(-(b.maxX + (outer - b.maxX) * 0.5), 0.015, 0);
      const rightPit = leftPit.clone();
      rightPit.position.set(b.maxX + (outer - b.maxX) * 0.5, 0.015, 0);
      this.terrainGroup.add(topPit, botPit, leftPit, rightPit);

      // 浮島の縁の白い神殿石枠
      const borderH = new Mesh(cube, cliffMat);
      borderH.scale.set(b.maxX * 2 + 0.4, 0.22, 0.35);
      borderH.position.set(0, 0.1, -b.maxZ);
      const borderH2 = borderH.clone();
      borderH2.position.set(0, 0.1, b.maxZ);
      const borderV = new Mesh(cube, cliffMat);
      borderV.scale.set(0.35, 0.22, b.maxZ * 2 + 0.4);
      borderV.position.set(-b.maxX, 0.1, 0);
      const borderV2 = borderV.clone();
      borderV2.position.set(b.maxX, 0.1, 0);
      this.terrainGroup.add(borderH, borderH2, borderV, borderV2);
    }

    // 3. 円柱障害物（ボクセル風の角柱・石柱）の描画
    if (terrain?.obstacles) {
      for (const obs of terrain.obstacles) {
        const pillarGroup = new Group();
        const col = obs.color ?? 0x868e96;
        const mainMat = new MeshLambertMaterial({ color: col });
        const capMat = new MeshLambertMaterial({ color: 0xadb5bd });
        const d = obs.radius * 1.75;

        // 台座
        const base = new Mesh(cube, capMat);
        base.scale.set(d * 1.15, 0.35, d * 1.15);
        base.position.y = 0.175;
        base.castShadow = true;
        base.receiveShadow = true;
        pillarGroup.add(base);

        // 柱身
        const shaft = new Mesh(cube, mainMat);
        shaft.scale.set(d, obs.height - 0.5, d);
        shaft.position.y = obs.height * 0.5;
        shaft.castShadow = true;
        shaft.receiveShadow = true;
        pillarGroup.add(shaft);

        // 柱頭
        const top = new Mesh(cube, capMat);
        top.scale.set(d * 1.15, 0.3, d * 1.15);
        top.position.y = obs.height - 0.15;
        top.castShadow = true;
        top.receiveShadow = true;
        pillarGroup.add(top);

        pillarGroup.position.set(obs.x, 0, obs.z);
        this.terrainGroup.add(pillarGroup);
      }
    }

    // 4. 配置ガイド枠の更新
    while (this.dividerGroup.children.length > 0) {
      this.dividerGroup.remove(this.dividerGroup.children[0]);
    }
    const lineGeo = new BoxGeometry(0.14, 0.03, 0.9);
    const whiteMat = new MeshBasicMaterial({ color: 0xf8f8f2 });
    for (let z = -22; z <= 22; z += 1.6) {
      const dash = new Mesh(lineGeo, whiteMat);
      dash.position.set(0, 0.02, z);
      this.dividerGroup.add(dash);
    }

    const addRectBorder = (minX: number, maxX: number, minZ: number, maxZ: number, color: number, opacity = 0.55) => {
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity });
      const w = maxX - minX;
      const h = maxZ - minZ;
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const topB = new Mesh(new BoxGeometry(w, 0.03, 0.16), mat);
      topB.position.set(cx, 0.02, minZ);
      const botB = topB.clone();
      botB.position.set(cx, 0.02, maxZ);
      const leftB = new Mesh(new BoxGeometry(0.16, 0.03, h), mat);
      leftB.position.set(minX, 0.02, cz);
      const rightB = leftB.clone();
      rightB.position.set(maxX, 0.02, cz);
      this.dividerGroup.add(topB, botB, leftB, rightB);
    };

    const redZones = terrain?.redZones ?? DEFAULT_RED_ZONES;
    for (const z of redZones) {
      addRectBorder(z.minX, z.maxX, z.minZ, z.maxZ, TEAM_COLORS[0].shirt, 0.65);
    }
    if (!isArcade) {
      addRectBorder(1.2, 22, -16, 16, TEAM_COLORS[1].shirt, 0.45);
    }
  }

  /**
   * 友人対戦モード用の配置ゾーン枠（2〜4人）を描画し、現在の手番プレイヤーのゾーンを強調表示する。
   */
  setVersusZones(zones: readonly PlacementZone[], activeTeam: Team): void {
    while (this.terrainGroup.children.length > 0) {
      this.terrainGroup.remove(this.terrainGroup.children[0]);
    }
    while (this.dividerGroup.children.length > 0) {
      this.dividerGroup.remove(this.dividerGroup.children[0]);
    }

    const lineGeoV = new BoxGeometry(0.14, 0.03, 0.9);
    const whiteMat = new MeshBasicMaterial({ color: 0xf8f8f2 });
    for (let z = -22; z <= 22; z += 1.6) {
      const dash = new Mesh(lineGeoV, whiteMat);
      dash.position.set(0, 0.02, z);
      this.dividerGroup.add(dash);
    }

    // 3〜4人対戦時は横方向の中央分割破線も描画
    if (zones.length >= 3) {
      const lineGeoH = new BoxGeometry(0.9, 0.03, 0.14);
      for (let x = -22; x <= 22; x += 1.6) {
        const dash = new Mesh(lineGeoH, whiteMat);
        dash.position.set(x, 0.02, 0);
        this.dividerGroup.add(dash);
      }
    }

    zones.forEach((z, idx) => {
      const team = idx as Team;
      const isActive = team === activeTeam;
      const color = TEAM_COLORS[team]?.shirt ?? 0xffffff;
      const opacity = isActive ? 0.85 : 0.25;
      const thickness = isActive ? 0.22 : 0.14;
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity });
      const w = z.maxX - z.minX;
      const h = z.maxZ - z.minZ;
      const cx = (z.minX + z.maxX) * 0.5;
      const cz = (z.minZ + z.maxZ) * 0.5;
      const topB = new Mesh(new BoxGeometry(w, 0.035, thickness), mat);
      topB.position.set(cx, 0.022, z.minZ);
      const botB = topB.clone();
      botB.position.set(cx, 0.022, z.maxZ);
      const leftB = new Mesh(new BoxGeometry(thickness, 0.035, h), mat);
      leftB.position.set(z.minX, 0.022, cz);
      const rightB = leftB.clone();
      rightB.position.set(z.maxX, 0.022, cz);
      this.dividerGroup.add(topB, botB, leftB, rightB);

      // 現在配置中のプレイヤーのエリアには薄い地面ハイライトを敷く
      if (isActive) {
        const floorMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.12 });
        const floorMesh = new Mesh(new BoxGeometry(w, 0.01, h), floorMat);
        floorMesh.position.set(cx, 0.01, cz);
        this.dividerGroup.add(floorMesh);
      }
    });
  }

  private setupInputListeners(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.activeTouches.size === 1) {
          this.hadMultiTouch = false;
          this.isTouchOrbitPending = true;
          this.touchStartX = e.clientX;
          this.touchStartY = e.clientY;
          this.lastPointerX = e.clientX;
          this.lastPointerY = e.clientY;
        } else if (this.activeTouches.size >= 2) {
          this.hadMultiTouch = true;
          this.isTouchOrbitPending = false;
          this.isDraggingOrbit = false;
          const pts = [...this.activeTouches.values()];
          this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          this.lastTwoFingerMidX = (pts[0].x + pts[1].x) * 0.5;
          this.lastTwoFingerMidY = (pts[0].y + pts[1].y) * 0.5;
        }
        return;
      }

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isDraggingOrbit = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }
    });

    const endPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.activeTouches.delete(e.pointerId);
        if (this.activeTouches.size === 2) {
          const pts = [...this.activeTouches.values()];
          this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          this.lastTwoFingerMidX = (pts[0].x + pts[1].x) * 0.5;
          this.lastTwoFingerMidY = (pts[0].y + pts[1].y) * 0.5;
        } else if (this.activeTouches.size < 2) {
          this.lastPinchDist = 0;
        }
        if (this.activeTouches.size === 0) {
          this.isDraggingOrbit = false;
          this.isTouchOrbitPending = false;
        }
      } else {
        this.isDraggingOrbit = false;
      }
    };

    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && this.activeTouches.has(e.pointerId)) {
        this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.activeTouches.size >= 2) {
          const pts = [...this.activeTouches.values()];
          const midX = (pts[0].x + pts[1].x) * 0.5;
          const midY = (pts[0].y + pts[1].y) * 0.5;
          const dxMid = midX - this.lastTwoFingerMidX;
          const dyMid = midY - this.lastTwoFingerMidY;
          this.lastTwoFingerMidX = midX;
          this.lastTwoFingerMidY = midY;

          // 2本指スワイプでカメラ平行移動（地面を掴んでドラッグする感覚でパン）
          if (dxMid !== 0 || dyMid !== 0) {
            const viewHeight = Math.max(300, this.renderer.domElement.clientHeight || window.innerHeight);
            const worldPerPixel =
              (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camDistance) / viewHeight;
            const pitchFactor = 1 / Math.max(0.45, Math.sin(this.camPitch));
            const rightOffset = -dxMid * worldPerPixel;
            const forwardOffset = dyMid * worldPerPixel * pitchFactor;
            this.panCameraByOffsets(rightOffset, forwardOffset);
          }

          // ピンチイン・ピンチアウトでズーム
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.lastPinchDist > 10 && dist > 10) {
            const ratio = this.lastPinchDist / dist;
            this.camDistance = Math.max(6, Math.min(55, this.camDistance * ratio));
          }
          this.lastPinchDist = dist;
          this.updateCameraTransform();
          return;
        }

        if (this.activeTouches.size === 1) {
          const movedFromStart = Math.hypot(e.clientX - this.touchStartX, e.clientY - this.touchStartY);
          if (this.isTouchOrbitPending && movedFromStart > 8) {
            this.isTouchOrbitPending = false;
            this.isDraggingOrbit = true;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
          }
        }
      }

      if (!this.isDraggingOrbit) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.camYaw -= dx * 0.007;
      this.camPitch = Math.max(0.15, Math.min(1.42, this.camPitch + dy * 0.007));
      this.updateCameraTransform();
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDistance = Math.max(6, Math.min(55, this.camDistance * (1 + e.deltaY * 0.001)));
        this.updateCameraTransform();
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  screenToGround(clientX: number, clientY: number, out = new Vector3()): Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  startOrbitDrag(clientX: number, clientY: number): void {
    this.isDraggingOrbit = true;
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;
  }

  /** 2本指以上のマルチタッチ操作が関与した一連のタッチ中かどうかを返す */
  isMultiTouchInvolved(): boolean {
    return this.hadMultiTouch || this.activeTouches.size > 1;
  }

  resetCamera(): void {
    this.camTarget.set(0, 0.8, 0);
    this.camYaw = 0;
    this.camPitch = 0.58;
    this.camDistance = 24;
    this.updateCameraTransform();
  }

  /** 描画品質を切り替える（2: 高画質 / 1: 解像度を抑える / 0: さらに影も切る） */
  setQualityLevel(level: 0 | 1 | 2): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(level === 2 ? Math.min(dpr, 2) : level === 1 ? Math.min(dpr, 1.25) : Math.min(dpr, 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.dirLight.castShadow = level > 0;
  }

  /** 指定ユニットをカメラで追い続ける（null で解除） */
  setFollowedUnit(unit: Unit | null): void {
    this.followedUnit = unit;
    if (unit) this.finisherFocus = null;
  }

  get isFollowingUnit(): boolean {
    return this.followedUnit !== null;
  }

  /** 決着の瞬間にカメラを寄せる。配置に戻るときに元の視点へ戻せるよう控えておく */
  playFinisherCamera(focus: Vector3): void {
    this.followedUnit = null;
    this.cameraBeforeFinisher = {
      target: this.camTarget.clone(),
      yaw: this.camYaw,
      pitch: this.camPitch,
      distance: this.camDistance,
    };
    this.finisherFocus = {
      target: new Vector3(focus.x, Math.max(0.8, focus.y), focus.z),
      distance: Math.min(this.camDistance, 14),
    };
  }

  /** 決着演出の視点を取りやめ、演出前の視点へ戻す */
  restoreCameraAfterFinisher(): void {
    this.followedUnit = null;
    this.finisherFocus = null;
    const saved = this.cameraBeforeFinisher;
    if (!saved) return;
    this.cameraBeforeFinisher = null;
    this.camTarget.copy(saved.target);
    this.camYaw = saved.yaw;
    this.camPitch = saved.pitch;
    this.camDistance = saved.distance;
    this.updateCameraTransform();
  }

  /** 大きな衝撃で画面を揺らす（既存の揺れより強いときだけ上書きする） */
  addCameraShake(amount: number): void {
    if (this.shakeEnabled) this.cameraShake = Math.max(this.cameraShake, Math.min(0.45, amount));
  }

  setPlacementGuidesVisible(visible: boolean): void {
    this.dividerGroup.visible = visible;
    if (!visible && this.ghostGroup) {
      this.ghostGroup.visible = false;
    }
    if (!visible && this.ghostLane) {
      this.ghostLane.visible = false;
    }
  }

  updatePlacementGhost(
    typeId: UnitTypeId | FacilityTypeId | null,
    team: Team,
    pos: Vector3 | null,
    valid: boolean,
    facing?: number,
    gateLane?: { fromX: number; width: number },
  ): void {
    if (!typeId || !pos) {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      if (this.ghostLane) this.ghostLane.visible = false;
      return;
    }
    this.updateGhostLane(typeId, pos, gateLane);
    const key = `${typeId}:${team}`;
    if (this.ghostKey !== key) {
      if (this.ghostGroup) this.scene.remove(this.ghostGroup);
      if (isFacilityTypeId(typeId)) {
        this.ghostGroup = createFacilityGhost(typeId, team);
      } else {
        this.ghostGroup = createPreviewGhost(UNIT_TYPES[typeId], team);
      }
      this.scene.add(this.ghostGroup);
      this.ghostKey = key;
      this.ghostShownValid = true;
    }
    if (this.ghostGroup) {
      // 置けない場所では赤く半透明にして、なぜ置けないかが分かるようにする
      if (this.ghostShownValid !== valid) {
        this.ghostShownValid = valid;
        this.ghostGroup.traverse((obj) => {
          if (!(obj instanceof Mesh)) return;
          const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (!(mat instanceof MeshLambertMaterial || mat instanceof MeshPhysicalMaterial)) continue;
            mat.userData.ghostColor ??= mat.color.getHex();
            mat.userData.ghostOpacity ??= mat.opacity;
            mat.color.set(valid ? (mat.userData.ghostColor as number) : 0xff4d4d);
            mat.opacity = valid ? (mat.userData.ghostOpacity as number) : 0.38;
          }
        });
      }
      this.ghostGroup.visible = true;
      this.ghostGroup.position.copy(pos);
      this.ghostGroup.rotation.y =
        facing ?? (team === 0 ? Math.PI / 2 : team === 1 ? -Math.PI / 2 : team === 2 ? Math.PI : 0);
      this.ghostGroup.scale.x = gateLane ? gateLane.width / getGateOpeningWidth(0) : 1;
    }
  }

  /** 進軍門を置こうとしているときだけ、置いた場合の帯を表示する */
  private updateGhostLane(
    typeId: UnitTypeId | FacilityTypeId,
    pos: Vector3,
    gateLane: { fromX: number; width: number } | undefined,
  ): void {
    if (!gateLane || !isFacilityTypeId(typeId)) {
      if (this.ghostLane) this.ghostLane.visible = false;
      return;
    }
    if (this.ghostLaneType !== typeId) {
      if (this.ghostLane) {
        this.scene.remove(this.ghostLane);
        this.ghostLane.geometry.dispose();
        (this.ghostLane.material as Material).dispose();
      }
      this.ghostLane = this.createGateLaneMesh(typeId);
      this.ghostLaneType = typeId;
      this.scene.add(this.ghostLane);
    }
    if (!this.ghostLane) return;
    this.ghostLane.visible = true;
    this.placeGateLane(this.ghostLane, gateLane.fromX, pos.x, pos.z, gateLane.width);
  }

  // ---------------------------------------------------------------
  // ユニット・矢・ボクセル損壊ドロップ・スキルエフェクトの同期
  // ---------------------------------------------------------------

  addUnitVisual(unit: Unit): void {
    if (this.unitVisuals.has(unit.id)) return;
    const vis = new VoxelCharacterVisual(unit);
    this.unitVisuals.set(unit.id, vis);
    this.scene.add(vis.group);
  }

  removeUnitVisual(unit: Unit): void {
    const vis = this.unitVisuals.get(unit.id);
    if (!vis) return;
    this.scene.remove(vis.group);
    vis.dispose();
    this.unitVisuals.delete(unit.id);
  }

  /** 施設ビジュアルを登録する */
  addFacilityVisual(facility: Facility): void {
    if (this.facilityVisuals.has(facility.id)) return;
    // 門は左右のエネルギー発生装置と網でできていて、開口が変わっても装置は伸びない
    const heightScale = facility.isGate ? 1 + 0.18 * facility.gateLevel : 1;
    const energyGate = facility.isGate
      ? new EnergyGateVisual(facility.type.id, facility.team, facility.gateOpening / 2 + facility.gatePoleRadius, heightScale)
      : undefined;
    const mesh = energyGate ? energyGate.body : createFacilityMesh(facility.type.id, facility.team);
    const group = new Group();
    group.position.copy(facility.pos);
    group.rotation.y = facility.facing;
    group.add(energyGate ? energyGate.root : mesh);

    // 進軍門は、開戦時に通過する帯を地面に示す
    const marchLane = facility.isMarchGate ? this.createGateLaneMesh(facility.type.id) : undefined;
    if (marchLane) this.scene.add(marchLane);

    // 頭上HPバーの構築
    const hpBarGroup = new Group();
    hpBarGroup.position.set(0, facility.height * heightScale + 0.38, 0);
    const barWidth = 1.35;
    const barHeight = 0.12;

    const bgMat = new MeshBasicMaterial({ color: 0x1a1d24 });
    const bgMesh = new Mesh(new BoxGeometry(barWidth + 0.04, barHeight + 0.04, 0.04), bgMat);
    hpBarGroup.add(bgMesh);

    const fillMat = new MeshBasicMaterial({ color: TEAM_COLORS[facility.team]?.shirt ?? 0xe0473a });
    const fillMesh = new Mesh(new BoxGeometry(barWidth, barHeight, 0.05), fillMat);
    hpBarGroup.add(fillMesh);
    hpBarGroup.visible = !facility.isTerrain && !facility.isEnchantGate;
    group.add(hpBarGroup);

    this.scene.add(group);
    this.facilityVisuals.set(facility.id, {
      facility,
      group,
      mesh,
      hpBarFill: fillMesh,
      hpBarGroup,
      lastHp: facility.hp,
      marchLane,
      energyGate,
    });
  }

  /** 進軍門の帯の板を作る（大きさと位置は placeGateLane で決める） */
  private createGateLaneMesh(typeId: FacilityTypeId): Mesh {
    const lane = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: GATE_TINTS[typeId] ?? 0x66ccff, transparent: true, opacity: 0.26, depthWrite: false }),
    );
    lane.rotation.x = -Math.PI / 2;
    return lane;
  }

  /** 帯の板を X 方向 fromX〜toX、Z 方向は z を中心に幅 width で地面に敷く */
  private placeGateLane(lane: Mesh, fromX: number, toX: number, z: number, width: number): void {
    lane.position.set((fromX + toX) / 2, 0.06, z);
    lane.scale.set(Math.max(0.01, Math.abs(toX - fromX)), width, 1);
  }

  /** 施設ビジュアルを削除する */
  removeFacilityVisual(facility: Facility): void {
    const vis = this.facilityVisuals.get(facility.id);
    if (!vis) return;
    this.scene.remove(vis.group);
    if (vis.marchLane) {
      this.scene.remove(vis.marchLane);
      vis.marchLane.geometry.dispose();
      (vis.marchLane.material as Material).dispose();
    }
    if (vis.energyGate) {
      vis.energyGate.dispose();
    } else {
      vis.mesh.geometry.dispose();
      if (vis.mesh.material instanceof MeshLambertMaterial) {
        vis.mesh.material.dispose();
      }
    }
    this.facilityVisuals.delete(facility.id);
  }

  /** 施設の状態・被弾フラッシュ・HPバー・破壊演出を同期する */
  syncFacilities(battle: Battle, dt: number): void {
    this.gateClock += dt;
    // 既存ビジュアルの同期と破壊判定
    for (const [id, vis] of this.facilityVisuals) {
      const fac = vis.facility;
      vis.group.position.copy(fac.pos);

      if (vis.marchLane) {
        vis.marchLane.visible = fac.marchLaneVisible;
        if (fac.marchLaneVisible) {
          this.placeGateLane(vis.marchLane, fac.marchLaneStartX, fac.marchHomeX, fac.pos.z, fac.gateOpening);
        }
      }

      // キャノン砲塔の場合、砲身の向きを反映
      if (fac.type.id === 'cannon_tower' && fac.cannonAngle !== 0) {
        vis.group.rotation.y = fac.cannonAngle;
      } else {
        vis.group.rotation.y = fac.facing;
      }

      // 被弾フラッシュ
      const mat = vis.mesh.material as MeshLambertMaterial;
      if (fac.hitFlash > 0) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = fac.hitFlash * 0.7;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }

      if (vis.energyGate) {
        vis.energyGate.update(this.gateClock, fac.isEnchantGate ? fac.marchOpacity / 0.9 : 1);
      }

      // ローグライトの進軍門は開戦後に戦場の中央へ出て視界を遮るため、滑り始めたら半透明にする
      if (fac.isMarchGate) {
        const targetOpacity = fac.isEnchantGate ? fac.marchOpacity : fac.marchBegun ? 0.45 : 1;
        if (mat.opacity !== targetOpacity) {
          mat.opacity = targetOpacity;
          mat.transparent = targetOpacity < 1;
          mat.depthWrite = targetOpacity >= 1;
          mat.needsUpdate = true;
        }
      }

      // HPバーの向き（常にカメラ正面を向くビルボード）とスケール更新
      vis.hpBarGroup.quaternion.copy(this.camera.quaternion);
      const hpRatio = clamp01(fac.hp / fac.maxHp);
      vis.hpBarFill.scale.x = Math.max(0.001, hpRatio);
      vis.hpBarFill.position.x = (-1.35 * (1 - hpRatio)) / 2;

      // 施設が破壊された瞬間: 大量のボクセル破片を四方八方へ爆散！
      if (!fac.alive) {
        const seeds = getFacilityVoxelSeeds(fac.type.id, fac.team, fac.pos, fac.facing, 85);
        for (const seed of seeds) {
          const outward = new Vector3()
            .subVectors(seed.pos, fac.pos)
            .setY(0)
            .normalize();
          const scatterSpeed = 2.4 + Math.random() * 4.2;
          const vel = new Vector3(
            outward.x * scatterSpeed + (Math.random() - 0.5) * 2,
            2.5 + Math.random() * 4.5,
            outward.z * scatterSpeed + (Math.random() - 0.5) * 2,
          );
          this.pushDroppedVoxel(seed.pos, vel, seed.color, seed.size);
        }

        // 煙と炎のパーティクル
        for (let i = 0; i < 28; i++) {
          this.pushFxParticle(
            fac.pos.clone().add(new Vector3((Math.random() - 0.5) * 1.8, 0.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.8)),
            new Vector3((Math.random() - 0.5) * 3, 2.0 + Math.random() * 3, (Math.random() - 0.5) * 3),
            i % 3 === 0 ? 0xff6622 : i % 2 === 0 ? 0xffcc33 : 0x555860,
            0.18 + Math.random() * 0.14,
            0.7 + Math.random() * 0.5,
            -1.2,
          );
        }

        this.scene.remove(vis.group);
        vis.energyGate?.dispose();
        this.facilityVisuals.delete(id);
      }
    }

    // 未登録の施設があれば自動登録
    for (const fac of battle.facilities) {
      if (fac.alive && !this.facilityVisuals.has(fac.id)) {
        this.addFacilityVisual(fac);
      }
    }
  }

  /** 戦場にドロップしたボクセル破片・エフェクト・丸太をすべて消去する */
  clearDebris(): void {
    this.droppedVoxels.length = 0;
    this.dropRingCursor = 0;
    this.voxelDropMesh.count = 0;
    this.voxelDropMesh.instanceMatrix.needsUpdate = true;

    this.fxParticles.length = 0;
    this.fxMesh.count = 0;
    this.fxMesh.instanceMatrix.needsUpdate = true;

    for (const log of this.kawariLogs) {
      this.scene.remove(log.mesh);
    }
    this.kawariLogs.length = 0;
  }

  private pushDroppedVoxel(pos: Vector3, vel: Vector3, colorHex: number, size: number): void {
    const item: DroppedVoxel = {
      pos,
      vel,
      rot: new Euler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ),
      angVel: new Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
      ),
      color: new Color(colorHex),
      size,
      bounces: 0,
      settled: false,
    };

    if (this.droppedVoxels.length < this.maxDroppedVoxels) {
      this.droppedVoxels.push(item);
    } else {
      this.droppedVoxels[this.dropRingCursor] = item;
      this.dropRingCursor = (this.dropRingCursor + 1) % this.maxDroppedVoxels;
    }
  }

  private pushFxParticle(
    pos: Vector3,
    vel: Vector3,
    colorHex: number,
    size: number | Vector3,
    life: number,
    gravity = 0,
    rot?: Euler,
  ): void {
    if (this.fxParticles.length >= this.maxFxInstances - 400) {
      this.fxParticles.shift();
    }
    this.fxParticles.push({
      pos,
      vel,
      scale: typeof size === 'number' ? new Vector3(size, size, size) : size,
      rot: rot ?? new Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      color: new Color(colorHex),
      gravity,
      life,
      maxLife: life,
    });
  }

  /**
   * 攻撃ヒット時にユニットのボクセル部位を損壊（欠損・部位破壊）させ、
   * 剥がれ落ちた不透明ボクセルパーティクルを地面へドロップさせる。
   */
  spawnHitEffect(e: HitEvent): boolean {
    const vis = this.unitVisuals.get(e.victim.id);
    if (!vis) return false;

    const { drops, partBroken } = vis.applyHitDamage(
      e.hitParticle,
      e.point,
      e.damage,
      e.killed,
      e.carveScale ?? 1.0,
    );

    for (const seed of drops) {
      _outward.subVectors(seed.pos, e.point);
      if (_outward.lengthSq() < 1e-5) {
        _outward.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5);
      }
      _outward.normalize();

      const scatterSpeed = (partBroken ? 2.6 : 1.6) + Math.random() * 2.8;
      const vel = new Vector3(
        _outward.x * scatterSpeed + e.impulse.x * 0.42 + (Math.random() - 0.5) * 1.4,
        Math.abs(_outward.y) * 1.6 + 1.4 + Math.random() * 2.6,
        _outward.z * scatterSpeed + e.impulse.z * 0.42 + (Math.random() - 0.5) * 1.4,
      );
      this.pushDroppedVoxel(seed.pos, vel, seed.color, seed.size * 1.15);
    }

    return partBroken;
  }

  /** 新ユニット固有のビジュアルエフェクトを発生させる */
  spawnCombatEffect(e: CombatEffectEvent): void {
    switch (e.kind) {
      case 'lightning': {
        // 連鎖した各着弾点から青白い電気スパークを散らす
        for (let i = 1; i < e.points.length; i++) {
          const pt = e.points[i];
          for (let k = 0; k < 14; k++) {
            const vel = new Vector3(
              (Math.random() - 0.5) * 8,
              Math.random() * 5 + 1,
              (Math.random() - 0.5) * 8,
            );
            this.pushFxParticle(
              pt.clone(),
              vel,
              k % 2 === 0 ? 0x66f0ff : 0xffffff,
              0.09,
              0.28 + Math.random() * 0.15,
              6,
            );
          }
        }
        break;
      }
      case 'gravity_pull': {
        for (let i = 0; i < 20; i++) {
          const ang = (i / 20) * Math.PI * 2;
          const p = e.pos.clone().add(new Vector3(Math.cos(ang) * 2.5, (Math.random() - 0.5) * 1.5, Math.sin(ang) * 2.5));
          const vel = new Vector3().subVectors(e.pos, p).multiplyScalar(1.8);
          this.pushFxParticle(p, vel, i % 2 === 0 ? 0x9c36b5 : 0x3b0d54, 0.14, 0.65, 0);
        }
        break;
      }
      case 'gravity_blast': {
        // 重力爆縮の紫黒色ショックウェーブ
        for (let i = 0; i < 36; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
          const speed = 5 + Math.random() * 8;
          this.pushFxParticle(
            e.pos.clone(),
            dir.multiplyScalar(speed),
            i % 3 === 0 ? 0xe599f7 : i % 3 === 1 ? 0x9c36b5 : 0x240938,
            0.18,
            0.45 + Math.random() * 0.2,
            4,
          );
        }
        break;
      }
      case 'sniper_shot': {
        // 銃口のマズルフラッシュと弾道上の白いヴェイパートレイル（飛行機雲状の煙）
        for (let i = 0; i < 10; i++) {
          this.pushFxParticle(
            e.from.clone(),
            new Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4),
            i % 2 === 0 ? 0xffe066 : 0xff922b,
            0.14,
            0.18,
            0,
          );
        }
        const steps = 32;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const p = new Vector3().lerpVectors(e.from, e.to, t);
          this.pushFxParticle(
            p,
            new Vector3((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4),
            0xf1f3f5,
            0.08,
            0.55 - t * 0.2,
            -0.5,
          );
        }
        break;
      }
      case 'minigun_shot': {
        // マズルフラッシュ＋地面に転がる金色の空薬莢ボクセル
        this.pushFxParticle(
          e.from.clone(),
          new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
          0xffe066,
          0.11,
          0.08,
          0,
        );
        const shellVel = e.rightDir
          .clone()
          .multiplyScalar(2.2 + Math.random() * 1.4)
          .add(new Vector3((Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8));
        this.pushDroppedVoxel(e.from.clone(), shellVel, 0xffd43b, 0.042);
        break;
      }
      case 'minigun_steam': {
        for (let i = 0; i < 14; i++) {
          this.pushFxParticle(
            e.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)),
            new Vector3((Math.random() - 0.5) * 1.2, 1.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2),
            0xf8f9fa,
            0.12,
            0.65 + Math.random() * 0.3,
            -1.5,
          );
        }
        break;
      }
      case 'iaido_charge': {
        // 居合の構え中に舞い散る桜の花びらボクセルと鞘口の閃光
        for (let i = 0; i < 16; i++) {
          const petalPos = e.pos
            .clone()
            .add(new Vector3((Math.random() - 0.5) * 1.8, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8));
          const petalVel = new Vector3((Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
          this.pushDroppedVoxel(petalPos, petalVel, i % 2 === 0 ? 0xffb3d9 : 0xff85c0, 0.045);
        }
        this.pushFxParticle(
          e.pos.clone().add(new Vector3(0, 0.25, 0)),
          new Vector3(0, 0, 0),
          0xffffff,
          new Vector3(0.32, 0.32, 0.32),
          0.22,
          0,
        );
        break;
      }
      case 'iaido_dash': {
        // すり抜け軌道上の3体の残像と蒼白い一閃ライン
        const ghosts = 3;
        for (let i = 1; i <= ghosts; i++) {
          const t = i / (ghosts + 1);
          const gp = new Vector3().lerpVectors(e.from, e.to, t);
          this.pushFxParticle(
            gp.clone().add(new Vector3(0, 0.1, 0)),
            new Vector3(0, 0.2, 0),
            TEAM_COLORS[e.team].shirt,
            new Vector3(0.36, 0.85, 0.26),
            0.38,
            0,
            new Euler(0, e.facing, 0),
          );
        }
        const steps = 18;
        for (let i = 0; i <= steps; i++) {
          const p = new Vector3().lerpVectors(e.from, e.to, i / steps);
          p.y += 0.35;
          this.pushFxParticle(
            p,
            new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2),
            i % 2 === 0 ? 0xa5f3fc : 0xffffff,
            0.12,
            0.32,
            0,
          );
        }
        break;
      }
      case 'iaido_burst': {
        // 時間差斬撃の十字スラッシュエフェクト
        for (let i = 0; i < 14; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7);
          this.pushFxParticle(e.pos.clone(), vel, i % 2 === 0 ? 0xa5f3fc : 0xffffff, 0.11, 0.28, 3);
        }
        break;
      }
      case 'ninja_kawari': {
        // 紫と白の煙幕＋転がる変わり身の丸太
        for (let i = 0; i < 26; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 4.5,
            Math.random() * 3.5 + 0.5,
            (Math.random() - 0.5) * 4.5,
          );
          this.pushFxParticle(
            e.from.clone(),
            vel,
            i % 3 === 0 ? 0xae3ec9 : 0xf1f3f5,
            0.22 + Math.random() * 0.12,
            0.55 + Math.random() * 0.25,
            -1.0,
          );
        }
        const logMat = new MeshLambertMaterial({ vertexColors: true });
        const logMesh = new Mesh(getKawariLogGeometry(), logMat);
        logMesh.position.copy(e.from);
        logMesh.castShadow = true;
        this.scene.add(logMesh);
        this.kawariLogs.push({
          mesh: logMesh,
          vel: new Vector3((Math.random() - 0.5) * 2.5, 3.8, (Math.random() - 0.5) * 2.5),
          angVel: new Vector3(8, 4, 6),
          life: 6.0,
        });
        break;
      }
      case 'elephant_step':
      case 'elephant_roar':
      case 'eagle_drop_impact': {
        const count = e.kind === 'elephant_step' ? 8 : 22;
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2;
          const spd = (e.kind === 'elephant_step' ? 1.8 : 4.2) + Math.random() * 2;
          const vel = new Vector3(Math.cos(ang) * spd, 1.2 + Math.random() * 2.2, Math.sin(ang) * spd);
          this.pushFxParticle(
            e.pos.clone(),
            vel,
            i % 2 === 0 ? 0xa89070 : 0x8c7658,
            0.16,
            0.45 + Math.random() * 0.25,
            3,
          );
        }
        break;
      }
      case 'eagle_cry': {
        // 舞い散る茶色と白の羽根ボクセル
        for (let i = 0; i < 12; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
          this.pushDroppedVoxel(e.pos.clone(), vel, i % 2 === 0 ? 0x755132 : 0xf4f4f6, 0.055);
        }
        break;
      }
      case 'dragon_roar': {
        for (let i = 0; i < 14; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
          const col = i % 3 === 0 ? 0xffe066 : i % 3 === 1 ? 0xff6b1a : 0x343a40;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.15 + Math.random() * 0.08, 0.45 + Math.random() * 0.2, -2.5);
        }
        break;
      }
      case 'dragon_breath': {
        // 描画上の口先から噴き出す派手な火炎（白熱の芯・黄・橙・赤の炎、火の粉、黒煙）
        const vis = e.ownerId !== undefined ? this.unitVisuals.get(e.ownerId) : undefined;
        if (vis) vis.notifyDragonBreath(e.dir);
        const origin = vis ? vis.dragonMouth : e.from;
        for (let i = 0; i < 18; i++) {
          const r = Math.random();
          const isSmoke = r > 0.9;
          const spread = 1.2 + Math.random() * 2.8;
          const vel = e.dir
            .clone()
            .multiplyScalar((isSmoke ? 5 : 10) + Math.random() * 10)
            .add(new Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread, (Math.random() - 0.5) * spread));
          const col = r < 0.18 ? 0xfff4c2 : r < 0.42 ? 0xffd43b : r < 0.7 ? 0xff922b : r < 0.9 ? 0xe8590c : 0x3b3b40;
          const pos = origin.clone().add(new Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15));
          this.pushFxParticle(
            pos,
            vel,
            col,
            (isSmoke ? 0.3 : 0.16) + Math.random() * 0.18,
            (isSmoke ? 0.8 : 0.35) + Math.random() * 0.3,
            isSmoke ? -3.5 : -2.0,
          );
        }
        // 四方へ弾ける火の粉
        for (let i = 0; i < 5; i++) {
          const vel = e.dir
            .clone()
            .multiplyScalar(6 + Math.random() * 6)
            .add(new Vector3((Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7));
          this.pushFxParticle(origin.clone(), vel, Math.random() < 0.5 ? 0xffe066 : 0xffffff, 0.06, 0.5 + Math.random() * 0.3, 9);
        }
        break;
      }
      case 'slime_jump':
      case 'slime_slam':
      case 'slime_split': {
        const count = e.kind === 'slime_jump' ? 10 : 22;
        const jellyCol = e.team === 0 ? 0x4cd97b : e.team === 1 ? 0x38d996 : e.team === 2 ? 0xfcc419 : 0x20c997;
        for (let i = 0; i < count; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 6,
            2.0 + Math.random() * 4.0,
            (Math.random() - 0.5) * 6,
          );
          this.pushDroppedVoxel(e.pos.clone(), vel, jellyCol, 0.065 * e.scale);
        }
        break;
      }
      case 'buggy_smoke': {
        // バギー走行時のタイヤスモークと土煙
        for (let i = 0; i < 6; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 2.5, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
          const col = i % 2 === 0 ? 0xadb5bd : 0x868e96;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.14, 0.35 + Math.random() * 0.15, -1.0);
        }
        break;
      }
      case 'buggy_ram': {
        // バギー激突時の火花と破片
        for (let i = 0; i < 18; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7.5, 2.5 + Math.random() * 4.5, (Math.random() - 0.5) * 7.5);
          const col = i % 3 === 0 ? 0xff922b : i % 3 === 1 ? 0xffd43b : 0x495057;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.12, 0.3 + Math.random() * 0.2, 5.0);
        }
        break;
      }
      case 'anaconda_hiss': {
        // アナコンダ威嚇の毒気
        for (let i = 0; i < 8; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 2.0, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 2.0);
          this.pushFxParticle(e.pos.clone(), vel, 0x40c057, 0.12, 0.4 + Math.random() * 0.2, -1.5);
        }
        break;
      }
      case 'anaconda_bite': {
        // 毒牙噛みつきの毒飛沫
        for (let i = 0; i < 16; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 5.5, 1.8 + Math.random() * 3.5, (Math.random() - 0.5) * 5.5);
          const col = i % 2 === 0 ? 0x2f9e44 : 0x51cf66;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.11, 0.35 + Math.random() * 0.15, 6.0);
        }
        break;
      }
      case 'decoy_pop': {
        // おとり破壊時の藁・木片・リボンの大破裂
        const teamCol = TEAM_COLORS[e.team].shirt;
        for (let i = 0; i < 28; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7.0, 2.2 + Math.random() * 5.0, (Math.random() - 0.5) * 7.0);
          const col = i % 4 === 0 ? teamCol : i % 4 === 1 ? 0xb08968 : i % 4 === 2 ? 0xd4a373 : 0x7f5539;
          this.pushDroppedVoxel(e.pos.clone(), vel, col, 0.055 + Math.random() * 0.035);
        }
        break;
      }
      case 'shield_block': {
        // 大盾ガード時の黄金＆白銀スパーク
        for (let i = 0; i < 10; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 5,
            Math.random() * 3.5 + 0.5,
            (Math.random() - 0.5) * 5,
          );
          this.pushFxParticle(
            e.pos.clone(),
            vel,
            i % 2 === 0 ? 0xffd43b : 0xffffff,
            0.09,
            0.22 + Math.random() * 0.1,
            5,
          );
        }
        break;
      }
      case 'charge_leap':
      case 'bomb_throw': {
        for (let i = 0; i < 8; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 3, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 3);
          this.pushFxParticle(e.pos.clone(), vel, 0xdee2e6, 0.11, 0.25, 1);
        }
        break;
      }
      case 'bomb_explosion': {
        // 爆弾の閃光＋黒煙＋飛び散る破片ボクセル
        for (let i = 0; i < 34; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
          const spd = 4 + Math.random() * 8;
          const col = i % 3 === 0 ? 0xff922b : i % 3 === 1 ? 0xffe066 : 0x343a40;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.2, 0.45 + Math.random() * 0.25, 4);
        }
        for (let i = 0; i < 14; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7, 2.5 + Math.random() * 4.5, (Math.random() - 0.5) * 7);
          this.pushDroppedVoxel(e.pos.clone(), vel, i % 2 === 0 ? 0x2b3035 : 0xd9480f, 0.065);
        }
        break;
      }
      case 'portal_spawn': {
        // 召喚ポータル: 魔法陣の光柱と浮遊パーティクル
        const teamCol = TEAM_COLORS[e.team].shirt;
        for (let i = 0; i < 20; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 0.2 + Math.random() * 0.8;
          const pos = e.pos.clone().add(new Vector3(Math.cos(angle) * dist, Math.random() * 0.4, Math.sin(angle) * dist));
          const vel = new Vector3((Math.random() - 0.5) * 0.6, 1.8 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6);
          this.pushFxParticle(pos, vel, i % 2 === 0 ? teamCol : 0xffffff, 0.13, 0.5 + Math.random() * 0.3, -1.0);
        }
        break;
      }
      case 'totem_pulse': {
        // 加護のトーテム: 地面を広がる光の波紋リング
        const teamCol = TEAM_COLORS[e.team].accent;
        const ringPoints = 24;
        for (let i = 0; i < ringPoints; i++) {
          const angle = (i / ringPoints) * Math.PI * 2;
          const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
          const pos = e.pos.clone().addScaledVector(dir, 0.5);
          pos.y = 0.08;
          const vel = dir.clone().multiplyScalar(4.5);
          this.pushFxParticle(pos, vel, teamCol, 0.16, 0.65, 0);
        }
        break;
      }
      case 'gate_multiply': {
        // 増殖ゲート: キラキラ光る複製エフェクト
        const teamCol = TEAM_COLORS[e.team].shirt;
        for (let i = 0; i < 24; i++) {
          const pos = e.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.8, Math.random() * 1.2, (Math.random() - 0.5) * 0.8));
          const vel = new Vector3((Math.random() - 0.5) * 2.2, 1.5 + Math.random() * 2.8, (Math.random() - 0.5) * 2.2);
          this.pushFxParticle(pos, vel, i % 2 === 0 ? 0xffd700 : teamCol, 0.11, 0.45 + Math.random() * 0.3, 1.5);
        }
        break;
      }
      case 'cannon_fire': {
        // キャノン砲台: マズルフラッシュと白煙
        for (let i = 0; i < 16; i++) {
          const spreadDir = e.dir.clone().add(new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5)).normalize();
          const vel = spreadDir.multiplyScalar(3.5 + Math.random() * 6.0);
          this.pushFxParticle(e.pos.clone(), vel, i % 3 === 0 ? 0xffe066 : i % 2 === 0 ? 0xff922b : 0xe9ecef, 0.18, 0.35 + Math.random() * 0.25, 0.5);
        }
        break;
      }
      case 'facility_hit': {
        // 施設被弾火花
        for (let i = 0; i < 7; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 4);
          this.pushFxParticle(e.pos.clone(), vel, i % 2 === 0 ? 0xffd43b : 0xff922b, 0.08, 0.2, 3);
        }
        break;
      }
      case 'facility_destroy': {
        // 施設崩壊爆発
        for (let i = 0; i < 30; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
          const spd = 3.5 + Math.random() * 7;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), i % 2 === 0 ? 0xff922b : 0x495057, 0.22, 0.65 + Math.random() * 0.3, 1.0);
        }
        break;
      }
      case 'tank_fire': {
        // 超巨大戦車の主砲発砲（特大マズルフラッシュ＋砲煙リング）
        for (let i = 0; i < 28; i++) {
          const spread = e.dir.clone().add(new Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6)).normalize();
          const vel = spread.multiplyScalar(5.0 + Math.random() * 9.0);
          const col = i % 3 === 0 ? 0xffd43b : i % 2 === 0 ? 0xff922b : 0xf1f3f5;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.24, 0.4 + Math.random() * 0.3, 1.0);
        }
        break;
      }
      case 'tank_explosion': {
        // 戦車榴弾の超巨大爆発（炎・黒煙・飛散破片・衝撃波）
        for (let i = 0; i < 48; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
          const spd = 5 + Math.random() * 11;
          const col = i % 3 === 0 ? 0xff6b1a : i % 3 === 1 ? 0xffe066 : 0x212529;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.26, 0.55 + Math.random() * 0.35, 3.5);
        }
        for (let i = 0; i < 18; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 9, 3.0 + Math.random() * 6.0, (Math.random() - 0.5) * 9);
          this.pushDroppedVoxel(e.pos.clone(), vel, i % 2 === 0 ? 0x3d4a3e : 0xd4af37, 0.08);
        }
        break;
      }
      case 'rocket_fire': {
        // ロケットランチャー発射（後方バックブラスト火炎・煙＋前方煙）
        const backDir = e.dir.clone().multiplyScalar(-1);
        for (let i = 0; i < 16; i++) {
          const vel = backDir.clone().add(new Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7)).normalize().multiplyScalar(4 + Math.random() * 5);
          this.pushFxParticle(e.pos.clone(), vel, i % 2 === 0 ? 0xff922b : 0xced4da, 0.16, 0.35, 1.0);
        }
        break;
      }
      case 'rocket_explosion': {
        // ロケット弾爆発
        for (let i = 0; i < 36; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.15, Math.random() - 0.5).normalize();
          const spd = 4 + Math.random() * 8.5;
          const col = i % 3 === 0 ? 0xff922b : i % 3 === 1 ? 0xffd43b : 0x343a40;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.2, 0.45 + Math.random() * 0.25, 4.0);
        }
        for (let i = 0; i < 10; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7, 2.5 + Math.random() * 5, (Math.random() - 0.5) * 7);
          this.pushDroppedVoxel(e.pos.clone(), vel, 0x3d4a3e, 0.06);
        }
        break;
      }
      case 'satellite_target': {
        // 衛星照準リング（目標足元に収束するリング状光粒子）
        const r = 2.5 * (1.0 - e.progress * 0.65);
        for (let i = 0; i < 6; i++) {
          const ang = Math.random() * Math.PI * 2;
          const pos = e.pos.clone().add(new Vector3(Math.cos(ang) * r, 0.08, Math.sin(ang) * r));
          this.pushFxParticle(pos, new Vector3(0, 0.4, 0), 0xff3b30, 0.12, 0.2, 0);
        }
        break;
      }
      case 'satellite_beam': {
        // 宇宙軌道からの超巨大垂直ビーム柱＆プラズマ衝撃波！
        const topY = 32;
        const groundY = e.pos.y;
        // 垂直ビーム柱（天頂から地面まで連続配置）
        for (let y = groundY; y <= topY; y += 0.8) {
          const pos = new Vector3(e.pos.x + (Math.random() - 0.5) * 0.35, y, e.pos.z + (Math.random() - 0.5) * 0.35);
          this.pushFxParticle(pos, new Vector3(0, -6.0, 0), Math.random() < 0.6 ? 0xffffff : 0x38d9a9, 0.32, 0.5, 0);
        }
        // 地面プラズマ衝撃波リング
        const ringN = 32;
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const dir = new Vector3(Math.cos(ang), 0.05, Math.sin(ang));
          const p = e.pos.clone().addScaledVector(dir, 0.3);
          const vel = dir.clone().multiplyScalar(7.5);
          this.pushFxParticle(p, vel, i % 2 === 0 ? 0x38d9a9 : 0x74c0fc, 0.22, 0.6, 1.0);
        }
        // 激しく吹き飛ぶプラズマ火花
        for (let i = 0; i < 28; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 8, 4.0 + Math.random() * 8, (Math.random() - 0.5) * 8);
          this.pushFxParticle(e.pos.clone(), vel, 0xffffff, 0.16, 0.4, 8);
        }
        break;
      }
      case 'robot_punch_fire': {
        // 巨大ロボットのロケットパンチ射出（後方バーニア噴煙＋推進火炎）
        const backDir = e.dir.clone().multiplyScalar(-1);
        for (let i = 0; i < 22; i++) {
          const vel = backDir.clone().add(new Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7)).normalize().multiplyScalar(5 + Math.random() * 6);
          const col = i % 3 === 0 ? 0x74c0fc : i % 2 === 0 ? 0xffa94d : 0xced4da;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.2, 0.4, 1.2);
        }
        break;
      }
      case 'at_field': {
        const isSuper = e.scale >= 3.0;
        const r = (isSuper ? 1.65 : 1.35) * e.scale;
        const ringN = isSuper ? 32 : 16;
        // 進行方向に対して垂直な3D八角形バリア平面基底を構築
        const fwd = e.dir && e.dir.lengthSq() > 1e-4 ? e.dir.clone().normalize() : new Vector3(0, 0, 1);
        const up = new Vector3(0, 1, 0);
        const right = new Vector3().crossVectors(up, fwd);
        if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
        else right.normalize();
        const planeUp = new Vector3().crossVectors(fwd, right).normalize();
        const center = e.pos.clone().addScaledVector(fwd, isSuper ? 0.55 * e.scale : 0.2 * e.scale);

        // 外層八角形・幾何学リング
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const cos = Math.cos(ang);
          const sin = Math.sin(ang);
          const radial = right.clone().multiplyScalar(cos).addScaledVector(planeUp, sin);
          const p = center.clone().addScaledVector(radial, r);
          this.pushFxParticle(p, radial.clone().multiplyScalar(1.2), isSuper ? 0xff922b : 0xffa94d, isSuper ? 0.30 : 0.22, 0.45, 0);
        }
        // 中層バリアライン
        const midN = isSuper ? 24 : 8;
        for (let i = 0; i < midN; i++) {
          const ang = (i / midN) * Math.PI * 2;
          const radial = right.clone().multiplyScalar(Math.cos(ang)).addScaledVector(planeUp, Math.sin(ang));
          const p = center.clone().addScaledVector(radial, r * 0.65);
          this.pushFxParticle(p, radial.clone().multiplyScalar(0.6), 0xffd43b, isSuper ? 0.25 : 0.18, 0.35, 0);
        }
        // ゼルエルの神話級多重拒絶結界: 内層コアと8方向の空間歪曲放電＆前方拒絶衝撃波
        if (isSuper) {
          for (let i = 0; i < 16; i++) {
            const ang = (i / 16) * Math.PI * 2;
            const radial = right.clone().multiplyScalar(Math.cos(ang)).addScaledVector(planeUp, Math.sin(ang));
            const p = center.clone().addScaledVector(radial, r * 0.35);
            this.pushFxParticle(p, fwd.clone().multiplyScalar(2.5), 0xff1744, 0.24, 0.32, 0);
          }
          // 8方向の八角形頂点からの電撃・拒絶スパーク
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
            const radial = right.clone().multiplyScalar(Math.cos(ang)).addScaledVector(planeUp, Math.sin(ang));
            for (let d = 0.4; d <= r * 1.25; d += 0.5) {
              const p = center.clone().addScaledVector(radial, d);
              this.pushFxParticle(p, radial.clone().multiplyScalar(2.5).addScaledVector(fwd, 3.0), 0xff6b6b, 0.20, 0.38, 0);
            }
          }
        }
        break;
      }
      case 'zeruel_charge': {
        for (let i = 0; i < 5; i++) {
          const dist = 3.2 * (1.0 - e.progress * 0.65);
          const ang = Math.random() * Math.PI * 2;
          const elev = (Math.random() - 0.5) * Math.PI;
          const offset = new Vector3(
            Math.cos(ang) * Math.cos(elev) * dist,
            Math.sin(elev) * dist,
            Math.sin(ang) * Math.cos(elev) * dist,
          );
          const vel = offset.clone().multiplyScalar(-3.8);
          const col = i % 3 === 0 ? 0xff0033 : i % 3 === 1 ? 0xffffff : 0x9d4edd;
          this.pushFxParticle(e.pos.clone().add(offset), vel, col, 0.22, 0.28, 0);
        }
        break;
      }
      case 'ramiel_charge': {
        const prog = e.progress;
        // 1. 広範囲から螺旋を描いてコアへ収束するプリズム荷電粒子（シアン・純白・虹彩バイオレット・ゴールド）
        const count = prog > 0.7 ? 10 : 6;
        for (let i = 0; i < count; i++) {
          const dist = (4.2 - prog * 2.6) * (0.6 + Math.random() * 0.6);
          const ang = Math.random() * Math.PI * 2;
          const elev = (Math.random() - 0.5) * Math.PI;
          const offset = new Vector3(
            Math.cos(ang) * Math.cos(elev) * dist,
            Math.sin(elev) * dist,
            Math.sin(ang) * Math.cos(elev) * dist,
          );
          const tangent = new Vector3(-Math.sin(ang), 0.2, Math.cos(ang)).multiplyScalar(2.5 + prog * 4.0);
          const vel = offset.clone().multiplyScalar(-(3.2 + prog * 4.5)).add(tangent);
          const palette = [0xffffff, 0x00f5d4, 0x74c0fc, 0xe599f7, 0xffe066];
          const col = palette[(i + Math.floor(prog * 10)) % palette.length];
          const size = 0.14 + prog * 0.14;
          this.pushFxParticle(e.pos.clone().add(offset), vel, col, size, 0.26, 0);
        }

        // 2. 反重力で地面から浮かび上がる結晶粒子＆収束オクタゴンリング（中盤以降）
        if (prog > 0.25 && Math.random() < 0.65) {
          const ringR = 3.6 * (1.0 - prog * 0.55);
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2;
            const gPos = new Vector3(e.pos.x + Math.cos(a) * ringR, 0.1, e.pos.z + Math.sin(a) * ringR);
            const gVel = new Vector3(0, 3.5 + prog * 5.5, 0);
            this.pushFxParticle(gPos, gVel, k % 2 === 0 ? 0x00f5d4 : 0xffffff, 0.16, 0.35, -2.0);
          }
        }

        // 3. 発射直前の臨界スパーク＆照準先（aim）に収束するロックオンリング
        if (prog > 0.65 && e.aim) {
          const lockR = 3.2 * (1.05 - prog);
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2;
            const p = e.aim.clone().add(new Vector3(Math.cos(a) * lockR, 0.15, Math.sin(a) * lockR));
            this.pushFxParticle(p, new Vector3(0, 1.8, 0), k % 2 === 0 ? 0xff2a85 : 0x00f5d4, 0.18, 0.22, 0);
          }
        }
        break;
      }
      case 'mouth_laser_charge':
        break;
      case 'mouth_laser': {
        const glow = TEAM_COLORS[e.team].shirt;
        const dir = new Vector3().subVectors(e.to, e.from).normalize();
        // 本体の光線はモデル側で描くので、ここでは口元と着弾点の火花だけを出す
        const sparks = e.isInitial ? 26 : 5;
        for (let i = 0; i < sparks; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 9, 2 + Math.random() * 6, (Math.random() - 0.5) * 9);
          this.pushFxParticle(e.to.clone(), vel, i % 2 === 0 ? 0xffffff : glow, 0.16, 0.32, 5);
        }
        if (e.isInitial) {
          for (let i = 0; i < 16; i++) {
            const ang = (i / 16) * Math.PI * 2;
            const radial = new Vector3(Math.cos(ang) * dir.z, Math.sin(ang), -Math.cos(ang) * dir.x);
            this.pushFxParticle(e.from.clone().addScaledVector(dir, 0.3), radial.multiplyScalar(5.5), i % 2 === 0 ? 0xffffff : glow, 0.16, 0.3, 0);
          }
        }
        break;
      }
      case 'ramiel_beam': {
        const isInit = e.isInitial !== false;
        const dir = new Vector3().subVectors(e.to, e.from);
        const dist = dir.length();
        if (dist > 0.001) dir.normalize();
        else dir.set(1, 0, 0);

        const right = new Vector3().crossVectors(UP, dir);
        if (right.lengthSq() < 1e-4) right.set(0, 0, 1);
        else right.normalize();
        const planeUp = new Vector3().crossVectors(dir, right).normalize();

        // ターゲットを貫通して戦場奥まで突き抜ける超極太レーザー粒子群
        const totalLen = Math.max(dist + 12.0, 34.0);
        const step = isInit ? 0.45 : 0.85;
        for (let d = 0; d <= totalLen; d += step) {
          const baseP = e.from.clone().addScaledVector(dir, d);
          // 中心の純白超高輝度コア粒子
          this.pushFxParticle(
            baseP.clone().add(new Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)),
            dir.clone().multiplyScalar(8.0),
            0xffffff,
            isInit ? 0.58 : 0.42,
            isInit ? 0.48 : 0.26,
            0,
          );
          // 外周を螺旋状に駆け抜ける極太シアン・蒼・紫プラズマ渦
          const spiralAng = d * 1.4 + Math.random() * Math.PI * 2;
          const spiralR = 0.9 + Math.random() * 1.45;
          const radial = right.clone().multiplyScalar(Math.cos(spiralAng)).addScaledVector(planeUp, Math.sin(spiralAng));
          const outerP = baseP.clone().addScaledVector(radial, spiralR);
          const outerVel = dir.clone().multiplyScalar(14.0).addScaledVector(radial, 2.5);
          const col = Math.random() < 0.45 ? 0x00f5d4 : Math.random() < 0.75 ? 0x4dabf7 : 0xe599f7;
          this.pushFxParticle(outerP, outerVel, col, isInit ? 0.42 : 0.30, isInit ? 0.45 : 0.25, 0);
        }

        // 発射口（マズル）＆中間点の垂直ショックウェーブリング
        if (isInit) {
          const ringSteps = 24;
          for (let i = 0; i < ringSteps; i++) {
            const ang = (i / ringSteps) * Math.PI * 2;
            const radial = right.clone().multiplyScalar(Math.cos(ang)).addScaledVector(planeUp, Math.sin(ang));
            const muzzleRingPos = e.from.clone().addScaledVector(dir, 1.2).addScaledVector(radial, 0.8);
            this.pushFxParticle(muzzleRingPos, radial.clone().multiplyScalar(9.5), i % 2 === 0 ? 0xffffff : 0x00f5d4, 0.32, 0.45, 0);
          }

          // 着弾点から天を衝く超巨大プラズマ光柱（高さ16m）
          for (let y = 0; y <= 16; y += 0.65) {
            const pCol = y % 2 === 0 ? 0xffffff : 0x00f5d4;
            this.pushFxParticle(
              new Vector3(e.to.x + (Math.random() - 0.5) * 0.9, e.to.y + y, e.to.z + (Math.random() - 0.5) * 0.9),
              new Vector3((Math.random() - 0.5) * 3.0, 8.0 + Math.random() * 6.0, (Math.random() - 0.5) * 3.0),
              pCol,
              0.46,
              0.55,
              0,
            );
          }

          // 着弾点の地表大衝撃波リング（半径6m超へ一気に拡散）
          const groundRingN = 36;
          for (let i = 0; i < groundRingN; i++) {
            const ang = (i / groundRingN) * Math.PI * 2;
            const rDir = new Vector3(Math.cos(ang), 0.08, Math.sin(ang));
            this.pushFxParticle(
              e.to.clone().addScaledVector(rDir, 0.5),
              rDir.clone().multiplyScalar(14.5),
              i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0x00f5d4 : 0x4dabf7,
              0.36,
              0.62,
              0.5,
            );
          }

          // 結晶＆プラズマ破片の大量飛散
          for (let i = 0; i < 20; i++) {
            const dVel = new Vector3((Math.random() - 0.5) * 14, 4.0 + Math.random() * 9.0, (Math.random() - 0.5) * 14);
            this.pushDroppedVoxel(e.to.clone(), dVel, i % 2 === 0 ? 0x74c0fc : 0xe0f2fe, 0.09);
          }
        }

        // 着弾点のプラズマ爆炎スパーク
        const sparkCount = isInit ? 48 : 16;
        for (let i = 0; i < sparkCount; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 16, 3.0 + Math.random() * 12, (Math.random() - 0.5) * 16);
          const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0x00f5d4 : 0x4dabf7;
          this.pushFxParticle(e.to.clone(), vel, col, isInit ? 0.34 : 0.24, isInit ? 0.65 : 0.35, 5.5);
        }
        break;
      }
      case 'sachiel_pile': {
        const dir = new Vector3().subVectors(e.to, e.from);
        const dist = dir.length();
        dir.normalize();
        for (let d = 0; d <= dist; d += 0.3) {
          const p = e.from.clone().addScaledVector(dir, d);
          this.pushFxParticle(p, dir.clone().multiplyScalar(4.0), Math.random() < 0.5 ? 0xffffff : 0x74c0fc, 0.22, 0.35, 0);
        }
        break;
      }
      case 'sachiel_cross': {
        for (let y = -4; y <= 16; y += 0.8) {
          this.pushFxParticle(e.pos.clone().add(new Vector3(0, y, 0)), new Vector3(0, 1.2, 0), 0xff6b6b, 0.35, 0.5, 0);
        }
        for (let x = -6; x <= 6; x += 0.8) {
          this.pushFxParticle(e.pos.clone().add(new Vector3(x, 2, 0)), new Vector3(x * 0.5, 0, 0), 0xff8787, 0.3, 0.45, 0);
        }
        for (let i = 0; i < 28; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 8, (Math.random() - 0.5) * 10);
          this.pushFxParticle(e.pos.clone(), vel, 0xffd43b, 0.2, 0.45, 4.0);
        }
        break;
      }
      case 'zeruel_ribbon': {
        const reach = e.reach;
        const dir = e.dir.clone().normalize();
        const right = new Vector3(-dir.z, 0, dir.x).normalize();
        // 1. 双胴リボンカッター光刃（左右から交差して突き抜ける超高速光条）
        const steps = 32;
        for (let i = 0; i <= steps; i++) {
          const frac = i / steps;
          const dist = frac * reach;
          // 左刃と右刃の交差スウィープ
          const sweepL = Math.sin(frac * Math.PI * 1.5) * 2.8 - (frac - 0.5) * 1.2;
          const sweepR = -Math.sin(frac * Math.PI * 1.5) * 2.8 + (frac - 0.5) * 1.2;
          const pL = e.from.clone().addScaledVector(dir, dist).addScaledVector(right, sweepL);
          const pR = e.from.clone().addScaledVector(dir, dist).addScaledVector(right, sweepR);
          pL.y += Math.sin(frac * Math.PI) * 0.4;
          pR.y -= Math.sin(frac * Math.PI) * 0.4;

          this.pushFxParticle(pL, dir.clone().multiplyScalar(18.0), frac < 0.6 ? 0xffffff : 0xff1744, 0.32, 0.38, 0);
          this.pushFxParticle(pR, dir.clone().multiplyScalar(18.0), frac < 0.6 ? 0xffffff : 0xd90429, 0.32, 0.38, 0);

          // 中央の超高速空間断裂光線
          if (i % 2 === 0) {
            const pMid = e.from.clone().addScaledVector(dir, dist);
            this.pushFxParticle(pMid, dir.clone().multiplyScalar(24.0), 0xff4d6d, 0.36, 0.3, 0);
          }
        }
        // 2. 前方に炸裂する横断真空スライス衝撃波リング
        for (let k = 1; k <= 3; k++) {
          const shockDist = reach * (k * 0.3);
          const shockCenter = e.from.clone().addScaledVector(dir, shockDist);
          for (let s = -6; s <= 6; s++) {
            const sp = shockCenter.clone().addScaledVector(right, s * 0.7);
            const vel = right.clone().multiplyScalar(s * 1.5).addScaledVector(dir, 5.0);
            this.pushFxParticle(sp, vel, 0xff0033, 0.28, 0.45, 0);
          }
        }
        // 3. 先端および直線軌道の飛散プラズマスパーク＆十字火柱インパクト
        const crossCenter = e.from.clone().addScaledVector(dir, reach * 0.72);
        for (let y = -3; y <= 14; y += 0.9) {
          this.pushFxParticle(crossCenter.clone().add(new Vector3(0, y, 0)), new Vector3(0, 2.0, 0), 0xff0033, 0.36, 0.48, 0);
        }
        for (let s = -5; s <= 5; s += 0.8) {
          this.pushFxParticle(crossCenter.clone().addScaledVector(right, s).add(new Vector3(0, 2.5, 0)), right.clone().multiplyScalar(s * 0.6), 0xff4d6d, 0.32, 0.42, 0);
        }
        for (let j = 0; j < 36; j++) {
          const randDist = Math.random() * reach;
          const pos = e.from.clone().addScaledVector(dir, randDist).addScaledVector(right, (Math.random() - 0.5) * 3.5);
          pos.y += (Math.random() - 0.5) * 2.0;
          const vel = new Vector3((Math.random() - 0.5) * 8.0, Math.random() * 6.0 + 1.0, (Math.random() - 0.5) * 8.0);
          const col = j % 3 === 0 ? 0xffffff : j % 3 === 1 ? 0xff1744 : 0xffa94d;
          this.pushFxParticle(pos, vel, col, 0.22, 0.45, 2.5);
        }
        break;
      }
      case 'sahaquiel_bomb': {
        for (let i = 0; i < 48; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
          const spd = 6 + Math.random() * 11;
          const col = i % 3 === 0 ? 0xf76707 : i % 3 === 1 ? 0xffd43b : 0xff0000;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.32, 0.6, 4.0);
        }
        const ringN = 32;
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const dir = new Vector3(Math.cos(ang), 0.05, Math.sin(ang));
          const p = e.pos.clone().addScaledVector(dir, 0.3);
          const vel = dir.clone().multiplyScalar(9.5);
          this.pushFxParticle(p, vel, 0xf76707, 0.26, 0.55, 1.2);
        }
        break;
      }
      case 'robot_punch_impact': {
        // ロケットパンチ直撃の大爆発・金属衝撃波・破片飛散
        for (let i = 0; i < 44; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.85 + 0.15, Math.random() - 0.5).normalize();
          const spd = 5 + Math.random() * 10;
          const col = i % 3 === 0 ? 0xffa94d : i % 3 === 1 ? 0xffd43b : 0xffffff;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.25, 0.5 + Math.random() * 0.3, 3.8);
        }
        // 衝撃波リング
        const ringN = 24;
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const dir = new Vector3(Math.cos(ang), 0.05, Math.sin(ang));
          const p = e.pos.clone().addScaledVector(dir, 0.25);
          const vel = dir.clone().multiplyScalar(8.0);
          this.pushFxParticle(p, vel, 0xffd43b, 0.2, 0.45, 1.0);
        }
        // 飛散するチタン金属ボクセル片
        for (let i = 0; i < 16; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 8.5, 3.0 + Math.random() * 6.5, (Math.random() - 0.5) * 8.5);
          this.pushDroppedVoxel(e.pos.clone(), vel, i % 2 === 0 ? 0x4a5568 : 0x2d3748, 0.07);
        }
        break;
      }
      case 'sezain_shot': {
        // セザインのマシンガンマズルフラッシュと薬莢
        for (let i = 0; i < 3; i++) {
          const spreadDir = e.dir.clone().add(new Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2)).normalize();
          const vel = spreadDir.multiplyScalar(4.0 + Math.random() * 3.0);
          this.pushFxParticle(e.from.clone(), vel, i % 2 === 0 ? 0xffe066 : 0xff922b, 0.08, 0.15, 2.0);
        }
        break;
      }
      case 'sezain_ram': {
        // セザインのバイク体当たりインパクト
        for (let i = 0; i < 16; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 7.0, 2.0 + Math.random() * 4.0, (Math.random() - 0.5) * 7.0);
          const col = i % 3 === 0 ? 0xffd43b : i % 3 === 1 ? 0xff922b : 0x212529;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.11, 0.3 + Math.random() * 0.15, 4.0);
        }
        break;
      }
      case 'eruption_burst': {
        // 富士山の火口大噴火（上空へ噴き上がる火柱・黒煙・火の粉）
        const s = e.scale ?? 1.0;
        for (let i = 0; i < 36; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 4.0 * s,
            8.0 * s + Math.random() * 12.0 * s,
            (Math.random() - 0.5) * 4.0 * s,
          );
          const col = i % 4 === 0 ? 0xff3b00 : i % 4 === 1 ? 0xff922b : i % 4 === 2 ? 0xffd43b : 0x343a40;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.24 * s, 0.65 + Math.random() * 0.45, 12.0);
        }
        break;
      }
      case 'eruption_explosion': {
        // 火山弾の大爆発と飛び散る灼熱溶岩
        for (let i = 0; i < 48; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
          const spd = 6.0 + Math.random() * 12.0;
          const col = i % 4 === 0 ? 0xff3b00 : i % 4 === 1 ? 0xff7700 : i % 4 === 2 ? 0xffd43b : 0x212529;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.28, 0.6 + Math.random() * 0.35, 6.0);
        }
        // 溶岩破片ボクセル
        for (let i = 0; i < 18; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 9.0, 3.5 + Math.random() * 7.5, (Math.random() - 0.5) * 9.0);
          this.pushDroppedVoxel(e.pos.clone(), vel, i % 2 === 0 ? 0x212529 : 0xff3b00, 0.08);
        }
        // 衝撃波リング
        const ringN = 28;
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const dir = new Vector3(Math.cos(ang), 0.05, Math.sin(ang));
          const p = e.pos.clone().addScaledVector(dir, 0.3);
          const vel = dir.clone().multiplyScalar(9.0);
          this.pushFxParticle(p, vel, 0xff7700, 0.22, 0.5, 1.0);
        }
        break;
      }
      case 'yamamuron_awaken': {
        // 強化モード発動: 全身から天へ噴き上がる業火と、地を這う灼熱の衝撃波
        const s = e.scale;
        for (let i = 0; i < 180; i++) {
          const ang = Math.random() * Math.PI * 2;
          const out = 2 + Math.random() * 9;
          const vel = new Vector3(Math.cos(ang) * out, 9 + Math.random() * 22, Math.sin(ang) * out);
          const col = i % 4 === 0 ? 0xffffff : i % 4 === 1 ? 0xffd43b : i % 4 === 2 ? 0xff7700 : 0xff1f00;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.34, 0.9 + Math.random() * 0.6, 7.0);
        }
        for (const [speed, col] of [[26, 0xffffff], [17, 0xff9500], [10, 0xff1f00]] as const) {
          const ringN = 64;
          for (let i = 0; i < ringN; i++) {
            const ang = (i / ringN) * Math.PI * 2;
            const dir = new Vector3(Math.cos(ang), 0.03, Math.sin(ang));
            const p = e.pos.clone().addScaledVector(dir, 0.9 * s);
            p.y = 0.3;
            this.pushFxParticle(p, dir.multiplyScalar(speed), col, 0.3, 0.8, 0.5);
          }
        }
        break;
      }
      case 'yamamuron_aura': {
        // 強化モード中: 山肌から立ち昇り続ける火の粉
        const s = e.scale;
        for (let i = 0; i < 9; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = (0.5 + Math.random() * 1.1) * s;
          const p = new Vector3(
            e.pos.x + Math.cos(ang) * r,
            0.2 + Math.random() * 1.2 * s,
            e.pos.z + Math.sin(ang) * r,
          );
          // 山を螺旋状に巻き上がる
          const vel = new Vector3(-Math.sin(ang) * 3.2, 5 + Math.random() * 8, Math.cos(ang) * 3.2);
          const col = i % 5 === 0 ? 0xffffff : i % 3 === 0 ? 0xffd43b : i % 2 === 0 ? 0xff7700 : 0xff2a00;
          this.pushFxParticle(p, vel, col, 0.2, 0.55 + Math.random() * 0.45, 2.5);
        }
        break;
      }
      case 'yamamuron_quake': {
        // 地震: 外へ走る地割れの波と、跳ね上がる岩盤
        const ringN = 72;
        for (const [life, col] of [[0.7, 0xffb347], [0.5, 0x8d6e4a]] as const) {
          for (let i = 0; i < ringN; i++) {
            const ang = (i / ringN) * Math.PI * 2;
            const dir = new Vector3(Math.cos(ang), 0.02, Math.sin(ang));
            const p = e.pos.clone().addScaledVector(dir, 1.0);
            p.y = 0.15;
            this.pushFxParticle(p, dir.multiplyScalar(e.radius / life), col, 0.3, life, 0.3);
          }
        }
        for (let i = 0; i < 46; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * e.radius;
          const p = new Vector3(e.pos.x + Math.cos(ang) * r, 0.1, e.pos.z + Math.sin(ang) * r);
          const vel = new Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 7, (Math.random() - 0.5) * 3);
          if (i % 2 === 0) this.pushDroppedVoxel(p, vel, i % 4 === 0 ? 0x5c4631 : 0x8d6e4a, 0.14);
          else this.pushFxParticle(p, vel, 0xb79a7a, 0.3, 0.55 + Math.random() * 0.3, 4.0);
        }
        break;
      }
      case 'piano_wave': {
        // ピアノ演奏の音楽波紋（美しい同心円状の音波リング）
        const teamCol = TEAM_COLORS[e.team].accent;
        const ringN = 32;
        const baseDir = e.forward.clone().setY(0).normalize();
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const dir = new Vector3(Math.cos(ang), 0.04, Math.sin(ang));
          const p = e.pos.clone().addScaledVector(dir, 0.4);
          p.y = 0.25;
          const vel = dir.clone().multiplyScalar(7.5);
          // 前方への音波はより明るく速い
          const dot = dir.dot(baseDir);
          const col = dot > 0.2 ? 0xfef08a : i % 2 === 0 ? teamCol : 0x38bdf8;
          this.pushFxParticle(p, vel, col, 0.18, 0.55, 0.5);
        }
        break;
      }
      case 'piano_note': {
        // 空中に浮かぶカラフルな音符・輝きパーティクル
        for (let i = 0; i < 5; i++) {
          const p = e.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.6));
          const vel = new Vector3((Math.random() - 0.5) * 1.5, 1.8 + Math.random() * 2.2, (Math.random() - 0.5) * 1.5);
          const colors = [0xf43f5e, 0x8b5cf6, 0x06b6d4, 0x10b981, 0xfbbf24];
          const col = e.color ?? colors[Math.floor(Math.random() * colors.length)];
          this.pushFxParticle(p, vel, col, 0.14, 0.45 + Math.random() * 0.2, -1.2);
        }
        break;
      }
      case 'dragon_charge': {
        // ザイサンの溜め: 足元から螺旋状に立ち昇る翠龍の気流・オーラ
        const count = 18;
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
          const r = 0.5 + Math.random() * 0.7;
          const p = e.pos.clone().add(new Vector3(Math.cos(ang) * r, 0.05, Math.sin(ang) * r));
          const vel = new Vector3(-Math.sin(ang) * 2.2 - Math.cos(ang) * 0.8, 2.5 + Math.random() * 2.5, Math.cos(ang) * 2.2 - Math.sin(ang) * 0.8);
          const col = i % 3 === 0 ? 0x10b981 : i % 3 === 1 ? 0x34d399 : 0xfbbf24;
          this.pushFxParticle(p, vel, col, 0.16, 0.45 + Math.random() * 0.2, -1.0);
        }
        break;
      }
      case 'dragon_slash': {
        // ザイサンのきりもみ回転突進＆ドラゴンエフェクト
        const fwd = e.dir.clone().normalize();
        const up = new Vector3(0, 1, 0);
        const right = new Vector3().crossVectors(fwd, up).normalize();
        const normUp = new Vector3().crossVectors(right, fwd).normalize();

        // 1. 先端の巨大な翠龍の頭部（龍の眼光・角・牙）
        const headPos = e.pos.clone().addScaledVector(fwd, 0.85);
        for (const side of [-1, 1]) {
          const eyeOffset = right.clone().multiplyScalar(side * 0.35).addScaledVector(normUp, 0.25);
          const eyeP = headPos.clone().add(eyeOffset);
          this.pushFxParticle(eyeP, fwd.clone().multiplyScalar(6.0), 0xfde047, 0.24, 0.25, 0);
        }
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const r = 0.45;
          const p = headPos.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(normUp, Math.sin(ang) * r);
          const vel = fwd.clone().multiplyScalar(5.5).add(new Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
          this.pushFxParticle(p, vel, i % 2 === 0 ? 0x059669 : 0x34d399, 0.22, 0.3, 1.0);
        }

        // 2. きりもみ回転する三刀流スパイラル光輪（3つの刃の軌跡）
        const roll = e.roll;
        for (let blade = 0; blade < 3; blade++) {
          const bladeAng = roll + (blade * Math.PI * 2) / 3;
          const cosB = Math.cos(bladeAng);
          const sinB = Math.sin(bladeAng);
          const rBlade = 1.35;
          const bladePos = e.pos.clone().addScaledVector(right, cosB * rBlade).addScaledVector(normUp, sinB * rBlade);
          const tanDir = right.clone().multiplyScalar(-sinB * 7.0).addScaledVector(normUp, cosB * 7.0).addScaledVector(fwd, -2.5);
          this.pushFxParticle(bladePos, tanDir, blade === 0 ? 0xf8fafc : blade === 1 ? 0x34d399 : 0x10b981, 0.2, 0.22, 0.5);
        }

        // 3. 龍の身体・尾の螺旋トレイル（後方に残る翡翠色のウロコ光球）
        for (let i = 0; i < 4; i++) {
          const tailOffset = (i + 1) * 0.4;
          const tailRoll = roll - tailOffset * 3.5;
          const tailP = e.pos.clone().addScaledVector(fwd, -tailOffset)
            .addScaledVector(right, Math.cos(tailRoll) * 0.6)
            .addScaledVector(normUp, Math.sin(tailRoll) * 0.6);
          const col = i % 2 === 0 ? 0x10b981 : 0x6ee7b7;
          this.pushFxParticle(tailP, fwd.clone().multiplyScalar(-1.5), col, 0.18 - i * 0.02, 0.35, 0.5);
        }
        break;
      }
      case 'dragon_slash_hit': {
        // 三刀流斬撃直撃時の翡翠＆白銀クロススラッシュ火花
        for (let i = 0; i < 16; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 8.0, 1.5 + Math.random() * 6.0, (Math.random() - 0.5) * 8.0);
          const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0x34d399 : 0x10b981;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.15, 0.3 + Math.random() * 0.2, 3.0);
        }
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI;
          const dir = new Vector3(Math.cos(ang), Math.sin(ang), (Math.random() - 0.5) * 0.5).normalize();
          this.pushDroppedVoxel(e.pos.clone(), dir.multiplyScalar(6.0), 0x34d399, 0.06);
        }
        break;
      }
      case 'ant_dash': {
        // 光速アリの超高速残像トレイル（シアン＆イエロー＆チームカラーの光の軌跡）
        const teamCol = TEAM_COLORS[e.team].shirt;
        const dir = new Vector3().subVectors(e.to, e.from);
        const dist = dir.length();
        const steps = Math.max(3, Math.min(8, Math.ceil(dist / 0.25)));
        for (let i = 0; i <= steps; i++) {
          const frac = i / steps;
          const p = e.from.clone().lerp(e.to, frac);
          p.y += 0.08 + Math.random() * 0.1;
          const vel = new Vector3((Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
          const col = i % 3 === 0 ? 0x38bdf8 : i % 3 === 1 ? 0xfef08a : teamCol;
          this.pushFxParticle(p, vel, col, 0.085, 0.16 + Math.random() * 0.08, 0);
        }
        break;
      }
      case 'ant_bite': {
        // 光速アリの大顎噛みつきスパーク
        for (let i = 0; i < 8; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 5.0, 1.0 + Math.random() * 3.5, (Math.random() - 0.5) * 5.0);
          const col = i % 2 === 0 ? 0x38bdf8 : 0xfef08a;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.08, 0.18 + Math.random() * 0.1, 3.0);
        }
        break;
      }
      case 'deoxys_teleport': {
        // デオキシスの瞬間移動（テレポート）: 空間跳躍の紫＆シアン幾何学フラッシュ＆残像
        const colors = [0xa855f7, 0x00d2d3, 0xffffff, 0xc084fc];
        // 移動元の空間消滅パーティクル
        for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2;
          const speed = 2.5 + Math.random() * 3.0;
          const vel = new Vector3(Math.cos(angle) * speed, (Math.random() - 0.2) * 2.0, Math.sin(angle) * speed);
          const col = colors[i % colors.length];
          this.pushFxParticle(e.from.clone(), vel, col, 0.14, 0.35 + Math.random() * 0.15, -1.0);
        }
        // 移動先での空間再構成フラッシュ
        for (let i = 0; i < 18; i++) {
          const angle = (i / 18) * Math.PI * 2;
          const speed = 3.0 + Math.random() * 3.5;
          const vel = new Vector3(Math.cos(angle) * speed, (Math.random() + 0.3) * 3.0, Math.sin(angle) * speed);
          const col = colors[(i + 1) % colors.length];
          this.pushFxParticle(e.to.clone(), vel, col, 0.16, 0.4 + Math.random() * 0.2, 2.0);
        }
        // 移動の軌跡をつなぐ量子サイキックストリーム
        const streamCount = 10;
        for (let i = 0; i <= streamCount; i++) {
          const frac = i / streamCount;
          const p = e.from.clone().lerp(e.to, frac);
          p.y += Math.sin(frac * Math.PI) * 0.8;
          const vel = new Vector3((Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5);
          const col = i % 2 === 0 ? 0x00d2d3 : 0xa855f7;
          this.pushFxParticle(p, vel, col, 0.12, 0.28, 0);
        }
        break;
      }
      case 'deoxys_psychic_wave': {
        // デオキシスのサイコキネシス: ターゲットへ照射される螺旋状のサイキック念力波束
        const colors = [0xa855f7, 0x00d2d3, 0xe879f9, 0xffffff];
        const dir = new Vector3().subVectors(e.to, e.from);
        const dist = dir.length();
        const steps = Math.max(6, Math.min(18, Math.ceil(dist / 0.8)));
        for (let i = 0; i <= steps; i++) {
          const frac = i / steps;
          const p = e.from.clone().lerp(e.to, frac);
          // 螺旋状のうねりオフセット
          const helixAngle = frac * Math.PI * 8;
          const hRadius = 0.35 * (1 - frac * 0.3);
          p.x += Math.cos(helixAngle) * hRadius;
          p.y += Math.sin(helixAngle) * hRadius;
          const vel = new Vector3(
            (Math.random() - 0.5) * 0.8,
            0.5 + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.8,
          );
          const col = colors[i % colors.length];
          this.pushFxParticle(p, vel, col, 0.13, 0.22 + Math.random() * 0.1, -0.5);
        }
        // ターゲット周囲の反重力浮遊フィールド（上へ舞い上がるサイキック粒子）
        const r = e.radius ?? 4.5;
        for (let i = 0; i < 8; i++) {
          const angle = Math.random() * Math.PI * 2;
          const distFromTarget = Math.random() * r;
          const p = e.to.clone();
          p.x += Math.cos(angle) * distFromTarget;
          p.z += Math.sin(angle) * distFromTarget;
          p.y = Math.max(0.1, p.y - 0.5 + Math.random() * 1.2);
          const liftVel = new Vector3(
            -Math.cos(angle) * 1.2,
            3.5 + Math.random() * 2.5,
            -Math.sin(angle) * 1.2,
          );
          const col = i % 2 === 0 ? 0xa855f7 : 0x00d2d3;
          this.pushFxParticle(p, liftVel, col, 0.15, 0.35 + Math.random() * 0.15, -1.5);
        }
        break;
      }
      case 'deoxys_psychic_hit': {
        // サイコキネシス衝撃・拘束パルス
        for (let i = 0; i < 10; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 6.0,
            1.5 + Math.random() * 4.0,
            (Math.random() - 0.5) * 6.0,
          );
          const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xa855f7 : 0x00d2d3;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.12, 0.25 + Math.random() * 0.12, 1.0);
        }
        break;
      }
      case 'stage_inferno_surge': {
        // マグマ熱波: 5本の火柱が地底から噴出
        const cols = [0xff4500, 0xff7700, 0xffd000];
        for (let pillar = 0; pillar < 5; pillar++) {
          const px = (pillar - 2) * 8 + (Math.random() - 0.5) * 3;
          const pz = (Math.random() - 0.5) * 16;
          for (let i = 0; i < 22; i++) {
            const vel = new Vector3(
              (Math.random() - 0.5) * 2.5,
              6.0 + Math.random() * 9.0,
              (Math.random() - 0.5) * 2.5,
            );
            const col = cols[Math.floor(Math.random() * cols.length)];
            this.pushFxParticle(
              new Vector3(px, 0.1, pz),
              vel,
              col,
              0.16 + Math.random() * 0.12,
              0.6 + Math.random() * 0.4,
              2.0,
            );
          }
        }
        break;
      }
      case 'stage_blizzard_blast': {
        // 永久凍土: 画面を横切る猛吹雪ストーム
        for (let i = 0; i < 60; i++) {
          const rx = (Math.random() - 0.5) * 44;
          const rz = (Math.random() - 0.5) * 32;
          const vel = new Vector3(
            -16.0 - Math.random() * 8.0,
            -2.0 + (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 4.0,
          );
          const col = i % 3 === 0 ? 0x38bdf8 : i % 3 === 1 ? 0xbae6fd : 0xffffff;
          this.pushFxParticle(
            new Vector3(rx + 15, 3.0 + Math.random() * 4.0, rz),
            vel,
            col,
            0.12 + Math.random() * 0.08,
            0.5 + Math.random() * 0.3,
            0,
          );
        }
        break;
      }
      case 'stage_poison_spore': {
        // 腐食毒胞子バブル爆発
        for (let i = 0; i < 20; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 4.5,
            1.5 + Math.random() * 4.0,
            (Math.random() - 0.5) * 4.5,
          );
          const col = i % 2 === 0 ? 0x84cc16 : 0xa855f7;
          this.pushFxParticle(
            e.pos.clone(),
            vel,
            col,
            0.18 + Math.random() * 0.1,
            0.7 + Math.random() * 0.5,
            -0.8,
          );
        }
        break;
      }
      case 'stage_gravity_wave': {
        // 重力特異点: 全方位へ広がるリング衝撃波
        const segs = 32;
        for (let i = 0; i < segs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          const vel = new Vector3(Math.cos(ang) * 9.0, 1.2, Math.sin(ang) * 9.0);
          const col = i % 2 === 0 ? 0xc084fc : 0xec4899;
          this.pushFxParticle(
            new Vector3(0, 0.6, 0),
            vel,
            col,
            0.2,
            0.6,
            0,
          );
        }
        break;
      }
      case 'stage_lightning_strike': {
        // 電磁嵐の天罰落雷
        const top = e.pos.clone().setY(18);
        const sub = 12;
        for (let s = 1; s <= sub; s++) {
          const next = new Vector3().lerpVectors(top, e.pos, s / sub);
          if (s < sub) {
            next.x += (Math.random() - 0.5) * 1.5;
            next.z += (Math.random() - 0.5) * 1.5;
          }
          for (let p = 0; p < 3; p++) {
            const vel = new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
            this.pushFxParticle(next.clone(), vel, 0x67e8f9, 0.16, 0.25, 0);
          }
        }
        // 着弾点の放電
        for (let i = 0; i < 28; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 9.0,
            2.0 + Math.random() * 5.0,
            (Math.random() - 0.5) * 9.0,
          );
          const col = i % 2 === 0 ? 0x38bdf8 : 0xfef08a;
          this.pushFxParticle(e.pos.clone(), vel, col, 0.14, 0.35 + Math.random() * 0.2, 3.0);
        }
        break;
      }
      case 'stage_blood_surge': {
        // 狂乱血煙パルス
        const segs = 28;
        for (let i = 0; i < segs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          const vel = new Vector3(Math.cos(ang) * 7.5, 0.6, Math.sin(ang) * 7.5);
          this.pushFxParticle(
            new Vector3(0, 0.5, 0),
            vel,
            0xdc2626,
            0.18,
            0.6,
            -0.5,
          );
        }
        break;
      }
      case 'stage_time_slip': {
        // 時空歪曲の波動
        const segs = 24;
        const col = e.isFast ? 0x10b981 : 0x06b6d4;
        for (let i = 0; i < segs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          const vel = new Vector3(Math.cos(ang) * 6.5, 0.5, Math.sin(ang) * 6.5);
          this.pushFxParticle(new Vector3(0, 0.5, 0), vel, col, 0.16, 0.55, 0);
        }
        break;
      }
      case 'stage_flare_blind': {
        // 日食フレア金環閃光
        for (let i = 0; i < 40; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 4.0 + Math.random() * 7.0;
          const vel = new Vector3(Math.cos(ang) * spd, 1.0 + Math.random() * 4.0, Math.sin(ang) * spd);
          const col = i % 2 === 0 ? 0xfacc15 : 0xffffff;
          this.pushFxParticle(new Vector3(0, 1.2, 0), vel, col, 0.18, 0.5 + Math.random() * 0.3, 0);
        }
        break;
      }
      case 'stage_meteor_impact': {
        // 終末巨大隕石直撃
        for (let i = 0; i < 50; i++) {
          const vel = new Vector3(
            (Math.random() - 0.5) * 14.0,
            4.0 + Math.random() * 11.0,
            (Math.random() - 0.5) * 14.0,
          );
          const col = i % 3 === 0 ? 0xf43f5e : i % 3 === 1 ? 0xf97316 : 0xa855f7;
          this.pushFxParticle(
            e.pos.clone(),
            vel,
            col,
            0.24 + Math.random() * 0.16,
            0.8 + Math.random() * 0.4,
            6.0,
          );
        }
        // 爆風衝撃波
        const segs = 32;
        for (let i = 0; i < segs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          const vel = new Vector3(Math.cos(ang) * 12.0, 0.5, Math.sin(ang) * 12.0);
          this.pushFxParticle(e.pos.clone(), vel, 0xf43f5e, 0.22, 0.7, 0);
        }
        break;
      }
    }
  }

  private syncArrows(arrows: readonly Arrow[]): void {
    while (this.arrowMeshes.length < arrows.length) {
      const m = new Mesh(getProjectileGeometry('arrow'), this.arrowMaterial);
      m.castShadow = true;
      this.scene.add(m);
      this.arrowMeshes.push(m);
    }
    for (let i = 0; i < this.arrowMeshes.length; i++) {
      const mesh = this.arrowMeshes[i];
      if (i >= arrows.length) {
        mesh.visible = false;
        continue;
      }
      const a = arrows[i];
      mesh.visible = true;
      const targetGeo = getProjectileGeometry(a.projectileKind);
      if (mesh.geometry !== targetGeo) {
        mesh.geometry = targetGeo;
      }
      mesh.position.copy(a.pos);
      mesh.scale.setScalar(1);
      if (a.projectileKind === 'flame') {
        // 火炎弾: 描画上の口先から噴き出し、0.35 秒かけて物理の弾道へ合流しながら膨張・回転する
        const age = Math.max(0, 0.9 - a.life);
        if (a.state === 'flying') {
          const vis = a.owner.type.id === 'dragon' ? this.unitVisuals.get(a.owner.id) : undefined;
          if (vis) {
            const fade = Math.max(0, 1 - age / 0.35);
            mesh.position.addScaledVector(vis.dragonBreathOffset, fade * fade);
          }
          const grow = 0.75 + Math.min(age, 0.9) * 2.6;
          mesh.scale.setScalar(grow);
          mesh.rotation.set(age * 9 + i, age * 6.5, age * 4 + i * 0.7);
          // 炎の尾: 火の粉と煙を撒き散らす
          if (Math.random() < 0.55) {
            const r = Math.random();
            const vel = new Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
            this.pushFxParticle(
              mesh.position.clone(),
              vel,
              r < 0.35 ? 0xffd43b : r < 0.75 ? 0xff6b1a : 0x495057,
              0.1 + grow * 0.07,
              0.25 + Math.random() * 0.2,
              -1.5,
            );
          }
        } else {
          mesh.scale.setScalar(1.3);
        }
      } else if (a.projectileKind === 'shuriken') {
        mesh.rotation.set(0, a.spinAngle, 0);
      } else {
        _quat.setFromUnitVectors(UP, a.dir);
        mesh.quaternion.copy(_quat);
      }
      if (a.state === 'flying' && a.projectileKind === 'rocket') {
        const backDir = a.dir.clone().multiplyScalar(-0.4);
        const smokePos = a.pos.clone().add(backDir);
        const smokeVel = backDir.clone().multiplyScalar(2).add(new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
        this.pushFxParticle(smokePos, smokeVel, Math.random() < 0.4 ? 0xff922b : 0xd8dee8, 0.12, 0.28, -0.5);
      }
      if (a.state === 'flying' && a.projectileKind === 'angel_bomb') {
        const backDir = a.dir.clone().multiplyScalar(-0.4);
        const trailPos = a.pos.clone().add(backDir);
        const trailVel = backDir.clone().multiplyScalar(2.5).add(new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
        this.pushFxParticle(trailPos, trailVel, Math.random() < 0.6 ? 0xf76707 : 0xffd43b, 0.22, 0.35, -0.2);
      }
      if (a.state === 'flying' && a.projectileKind === 'rocket_punch') {
        const backDir = a.dir.clone().multiplyScalar(-0.5);
        const jetPos = a.pos.clone().add(backDir);
        const jetVel = backDir.clone().multiplyScalar(3.5).add(new Vector3((Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 1.0));
        this.pushFxParticle(jetPos, jetVel, Math.random() < 0.6 ? 0x4dabf7 : 0xffa94d, 0.18, 0.3, -0.6);
        this.pushFxParticle(jetPos, jetVel.clone().multiplyScalar(0.4), 0xd8dee8, 0.14, 0.22, 0.2);
      }
    }
  }

  /** ドロップした不透明ボクセルパーティクルの落下・バウンド・地面への堆積を更新する */
  private updateDroppedVoxels(dt: number): void {
    const list = this.droppedVoxels;
    const count = list.length;
    if (count === 0) return;

    let anyUpdated = false;
    for (let i = 0; i < count; i++) {
      const p = list[i];
      if (!p.settled) {
        anyUpdated = true;
        p.vel.y -= 13.5 * dt;
        p.pos.addScaledVector(p.vel, dt);

        p.rot.x += p.angVel.x * dt;
        p.rot.y += p.angVel.y * dt;
        p.rot.z += p.angVel.z * dt;

        const half = p.size * 0.5;
        if (p.pos.y <= half) {
          p.pos.y = half;
          p.bounces++;
          if (p.bounces >= 3 || (Math.abs(p.vel.y) < 0.8 && p.vel.x * p.vel.x + p.vel.z * p.vel.z < 0.35)) {
            p.vel.set(0, 0, 0);
            p.angVel.set(0, 0, 0);
            p.rot.x = 0;
            p.rot.z = 0;
            p.settled = true;
          } else {
            p.vel.y = -p.vel.y * 0.34;
            p.vel.x *= 0.62;
            p.vel.z *= 0.62;
            p.angVel.multiplyScalar(0.55);
          }
        }
      }

      _quat.setFromEuler(p.rot);
      _scale.setScalar(p.size);
      _mat4.compose(p.pos, _quat, _scale);
      this.voxelDropMesh.setMatrixAt(i, _mat4);
      this.voxelDropMesh.setColorAt(i, p.color);
    }

    this.voxelDropMesh.count = count;
    if (anyUpdated || this.voxelDropMesh.count !== count) {
      this.voxelDropMesh.instanceMatrix.needsUpdate = true;
      if (this.voxelDropMesh.instanceColor) {
        this.voxelDropMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** 忍者の変わり身の丸太の物理バウンドとフェードを更新する */
  private updateKawariLogs(dt: number): void {
    for (let i = this.kawariLogs.length - 1; i >= 0; i--) {
      const item = this.kawariLogs[i];
      item.life -= dt;
      if (item.life <= 0) {
        this.scene.remove(item.mesh);
        this.kawariLogs.splice(i, 1);
        continue;
      }
      if (item.mesh.position.y > 0.16 || item.vel.y > 0) {
        item.vel.y -= 12 * dt;
        item.mesh.position.addScaledVector(item.vel, dt);
        item.mesh.rotation.x += item.angVel.x * dt;
        item.mesh.rotation.z += item.angVel.z * dt;
        if (item.mesh.position.y <= 0.16) {
          item.mesh.position.y = 0.16;
          item.vel.y = -item.vel.y * 0.3;
          item.vel.x *= 0.5;
          item.vel.z *= 0.5;
          item.angVel.multiplyScalar(0.4);
        }
      }
    }
  }

  /**
   * 一過性エフェクト粒子＋チェインライトニング線分＋重力球＋レーザーサイト＋延焼ゾーンを
   * 単一の InstancedMesh (fxMesh) に合成して高速描画する。
   */
  private updateFxAndDynamicVisuals(battle: Battle, dt: number): void {
    // 0. ステージ環境アンビエントパーティクルの常時発生
    this.emitAmbientWeatherParticles(dt);

    // 1. 延焼ゾーンや炎上中ユニットから火の粉を発生させる
    for (const z of battle.combat.fireZones) {
      if (Math.random() < 0.45) {
        const p = z.pos
          .clone()
          .add(new Vector3((Math.random() - 0.5) * z.radius * 1.5, 0.08, (Math.random() - 0.5) * z.radius * 1.5));
        this.pushFxParticle(
          p,
          new Vector3((Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6),
          Math.random() < 0.5 ? 0xff6b1a : 0xffd43b,
          0.13,
          0.35 + Math.random() * 0.2,
          -1.5,
        );
      }
    }
    for (const u of battle.units) {
      if (!u.alive) continue;
      if (u.burnTimer > 0 && Math.random() < 0.55) {
        this.pushFxParticle(
          u.chest.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)),
          new Vector3((Math.random() - 0.5) * 0.8, 1.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8),
          Math.random() < 0.5 ? 0xff5900 : 0xffe066,
          0.11,
          0.3,
          -2,
        );
      }
      if (u.shockTimer > 0 && Math.random() < 0.6) {
        this.pushFxParticle(
          u.chest.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5)),
          new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3),
          0x66f0ff,
          0.075,
          0.14,
          0,
        );
      }
      if (u.freezeTimer > 0 && Math.random() < 0.65) {
        this.pushFxParticle(
          u.chest.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5)),
          new Vector3((Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5),
          Math.random() < 0.4 ? 0x38bdf8 : 0xffffff,
          0.12,
          0.3,
          -0.5,
        );
      }
    }

    // 2. パーティクル配列の更新と書き込み
    let write = 0;
    const list = this.fxParticles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);

      const ratio = clamp01(p.life / p.maxLife);
      _quat.setFromEuler(p.rot);
      _scale.copy(p.scale).multiplyScalar(ratio);
      _mat4.compose(p.pos, _quat, _scale);
      if (write < this.maxFxInstances) {
        this.fxMesh.setMatrixAt(write, _mat4);
        this.fxMesh.setColorAt(write, p.color);
        list[write++] = p;
      }
    }
    list.length = write;

    // 3. 重力術師のブラックホール球と吸引リングの描画
    const colBlack = new Color(0x140424);
    const colViolet = new Color(0xb042ff);
    for (const orb of battle.combat.gravityOrbs) {
      if (write >= this.maxFxInstances - 8) break;
      const pulse = 0.42 + Math.sin(battle.time * 18) * 0.06;
      _quat.identity();
      _scale.setScalar(pulse);
      _mat4.compose(orb.pos, _quat, _scale);
      this.fxMesh.setMatrixAt(write, _mat4);
      this.fxMesh.setColorAt(write, colBlack);
      write++;

      const ringCount = 6;
      for (let r = 0; r < ringCount && write < this.maxFxInstances; r++) {
        const a = battle.time * 8 + (r / ringCount) * Math.PI * 2;
        const rad = orb.phase === 'pulling' ? 0.55 + (r % 2) * 0.35 : 0.32;
        _mid.set(
          orb.pos.x + Math.cos(a) * rad,
          orb.pos.y + Math.sin(a * 1.5) * 0.2,
          orb.pos.z + Math.sin(a) * rad,
        );
        _scale.setScalar(0.12);
        _mat4.compose(_mid, _quat, _scale);
        this.fxMesh.setMatrixAt(write, _mat4);
        this.fxMesh.setColorAt(write, colViolet);
        write++;
      }
    }

    // 4. 雷導師のチェインライトニング（ギザギザの稲妻折れ線）
    const colCyan = new Color(0x66f0ff);
    const colWhite = new Color(0xffffff);
    for (const bolt of battle.combat.lightningBolts) {
      for (let i = 0; i < bolt.points.length - 1; i++) {
        const a = bolt.points[i];
        const b = bolt.points[i + 1];
        const subSegments = 4;
        let prev = a;
        for (let s = 1; s <= subSegments && write < this.maxFxInstances; s++) {
          const next = new Vector3().lerpVectors(a, b, s / subSegments);
          if (s < subSegments) {
            next.x += (Math.random() - 0.5) * 0.38;
            next.y += (Math.random() - 0.5) * 0.38;
            next.z += (Math.random() - 0.5) * 0.38;
          }
          this.writeBeamSegment(write++, prev, next, 0.085, s % 2 === 0 ? colCyan : colWhite);
          prev = next;
        }
      }
    }

    // 5. 対物スナイパーの赤い照準レーザーサイト
    const colLaser = new Color(0xff2b2b);
    for (const u of battle.units) {
      if (!u.alive || !u.laserActive || write >= this.maxFxInstances) continue;
      const muzzle = u.chest.pos.clone().addScaledVector(u.forward, 0.8 * u.scale);
      muzzle.y += 0.16 * u.scale;
      this.writeBeamSegment(write++, muzzle, u.laserAimPos, 0.032, colLaser);
    }

    // 6. バフ付与中の味方ユニットの足元オーラ
    const colBuff = new Color(0xffdf6d);
    for (const u of battle.units) {
      if (!u.alive || !u.hasBuff || write >= this.maxFxInstances) continue;
      const ringPts = 4;
      for (let r = 0; r < ringPts && write < this.maxFxInstances; r++) {
        const a = battle.time * 6 + (r / ringPts) * Math.PI * 2;
        const rad = 0.38 * u.scale;
        _mid.set(
          u.pelvis.pos.x + Math.cos(a) * rad,
          0.06,
          u.pelvis.pos.z + Math.sin(a) * rad,
        );
        _scale.setScalar(0.08);
        _quat.identity();
        _mat4.compose(_mid, _quat, _scale);
        this.fxMesh.setMatrixAt(write, _mat4);
        this.fxMesh.setColorAt(write, colBuff);
        write++;
      }
    }

    this.fxMesh.count = write;
    this.fxMesh.instanceMatrix.needsUpdate = true;
    if (this.fxMesh.instanceColor) {
      this.fxMesh.instanceColor.needsUpdate = true;
    }
  }

  /** 2 点 a→b を結ぶ細長い直方体ビームを fxMesh の指定インデックスに書き込む */
  private writeBeamSegment(idx: number, a: Vector3, b: Vector3, thickness: number, color: Color): void {
    _segDir.subVectors(b, a);
    const len = _segDir.length();
    if (len < 1e-4) return;
    _mid.addVectors(a, b).multiplyScalar(0.5);
    _segDir.divideScalar(len);
    _quat.setFromUnitVectors(UP, _segDir);
    _scale.set(thickness, len, thickness);
    _mat4.compose(_mid, _quat, _scale);
    this.fxMesh.setMatrixAt(idx, _mat4);
    this.fxMesh.setColorAt(idx, color);
  }

  private panCameraByOffsets(rightOffset: number, forwardOffset: number): void {
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    this.camTarget.x += rightOffset * cos - forwardOffset * sin;
    this.camTarget.z += -rightOffset * sin - forwardOffset * cos;
    this.camTarget.x = Math.max(-35, Math.min(35, this.camTarget.x));
    this.camTarget.z = Math.max(-35, Math.min(35, this.camTarget.z));
  }

  private updateCameraMovement(dt: number): void {
    const moveSpeed = 14 * dt * (this.camDistance / 20);
    let forward = 0;
    let right = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
    if (this.keys.has('KeyQ')) this.camYaw += 1.6 * dt;
    if (this.keys.has('KeyE')) this.camYaw -= 1.6 * dt;

    if (forward !== 0 || right !== 0 || this.keys.has('KeyQ') || this.keys.has('KeyE')) {
      // プレイヤーが自分で動かしたら自動カメラはやめる
      if (forward !== 0 || right !== 0) {
        this.followedUnit = null;
        this.finisherFocus = null;
      }
      this.panCameraByOffsets(right * moveSpeed, forward * moveSpeed);
      this.updateCameraTransform();
    }
    this.updateAutoCamera(dt);
  }

  /** 個体追跡・決着時の寄りを滑らかに反映する */
  private updateAutoCamera(dt: number): void {
    if (this.autoOrbit) {
      this.camYaw += dt * 0.09;
      this.updateCameraTransform();
    }
    if (this.followedUnit && !this.followedUnit.alive) this.followedUnit = null;
    const followed = this.followedUnit;
    if (followed) {
      this.camTarget.lerp(followed.chest.pos, 1 - Math.exp(-dt * 6));
      this.updateCameraTransform();
    } else if (this.finisherFocus) {
      const k = 1 - Math.exp(-dt * 2.6);
      this.camTarget.lerp(this.finisherFocus.target, k);
      this.camDistance += (this.finisherFocus.distance - this.camDistance) * k;
      this.updateCameraTransform();
    }
  }

  private updateCameraTransform(): void {
    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const vert = Math.sin(this.camPitch) * this.camDistance;
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.camYaw) * horiz,
      this.camTarget.y + vert,
      this.camTarget.z + Math.cos(this.camYaw) * horiz,
    );
    this.camera.lookAt(this.camTarget);
  }

  /** ステージ環境アンビエントパーティクルを毎フレーム発生させる */
  private emitAmbientWeatherParticles(dt: number): void {
    const theme = this.currentVisualTheme;
    if (!theme || !theme.particleType) return;
    this.ambientWeatherTimer += dt;
    if (this.ambientWeatherTimer < 0.035) return;
    this.ambientWeatherTimer = 0;

    const pType = theme.particleType;
    const count = pType === 'snow' || pType === 'embers' || pType === 'apocalypse' ? 5 : 3;

    for (let k = 0; k < count; k++) {
      const rx = (Math.random() - 0.5) * 44;
      const rz = (Math.random() - 0.5) * 32;

      if (pType === 'embers') {
        // 溶岩の火の粉
        const p = new Vector3(rx, 0.1 + Math.random() * 0.4, rz);
        const vel = new Vector3((Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 0.8);
        const col = Math.random() < 0.6 ? 0xff5500 : 0xffa200;
        this.pushFxParticle(p, vel, col, 0.12, 0.8 + Math.random() * 0.6, -1.2);
      } else if (pType === 'snow') {
        // 横殴りの猛吹雪
        const p = new Vector3(rx + 10, 6.0 + Math.random() * 6.0, rz);
        const vel = new Vector3(-6.5 - Math.random() * 3.0, -3.5 - Math.random() * 2.0, (Math.random() - 0.5) * 1.5);
        const col = Math.random() < 0.3 ? 0xbae6fd : 0xffffff;
        this.pushFxParticle(p, vel, col, 0.1, 1.4 + Math.random() * 0.8, 0.2);
      } else if (pType === 'spores') {
        // 毒胞子バブル
        const p = new Vector3(rx, 0.2, rz);
        const vel = new Vector3((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 1.0, (Math.random() - 0.5) * 0.5);
        const col = Math.random() < 0.5 ? 0x84cc16 : 0xa855f7;
        this.pushFxParticle(p, vel, col, 0.13, 1.2 + Math.random() * 0.6, -0.6);
      } else if (pType === 'gravity') {
        // 重力反転オーブ逆流
        const p = new Vector3(rx, 0.1, rz);
        const vel = new Vector3((Math.random() - 0.5) * 0.4, 2.0 + Math.random() * 1.6, (Math.random() - 0.5) * 0.4);
        const col = Math.random() < 0.5 ? 0xc084fc : 0xec4899;
        this.pushFxParticle(p, vel, col, 0.14, 1.6 + Math.random() * 0.8, -1.8);
      } else if (pType === 'sparks') {
        // 電磁スパーク放電
        const p = new Vector3(rx, 0.5 + Math.random() * 3.5, rz);
        const vel = new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
        const col = Math.random() < 0.5 ? 0x38bdf8 : 0xfde047;
        this.pushFxParticle(p, vel, col, 0.08, 0.12 + Math.random() * 0.08, 0);
      } else if (pType === 'blood') {
        // 真紅の血霧
        const p = new Vector3(rx, 0.2 + Math.random() * 1.0, rz);
        const vel = new Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6);
        const col = Math.random() < 0.6 ? 0xb91c1c : 0x7f1d1d;
        this.pushFxParticle(p, vel, col, 0.14, 1.0 + Math.random() * 0.5, -0.4);
      } else if (pType === 'void') {
        // 虚無の黒灰
        const p = new Vector3(rx, 2.0 + Math.random() * 4.0, rz);
        const vel = new Vector3((Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
        const col = Math.random() < 0.5 ? 0x27272a : 0x71717a;
        this.pushFxParticle(p, vel, col, 0.11, 1.5, 0.2);
      } else if (pType === 'time') {
        // 時空の光子
        const p = new Vector3(rx, 0.8 + Math.random() * 2.5, rz);
        const vel = new Vector3(2.5 + Math.random() * 2.0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
        const col = Math.random() < 0.5 ? 0x10b981 : 0xfacc15;
        this.pushFxParticle(p, vel, col, 0.12, 1.2, 0);
      } else if (pType === 'flare') {
        // 日食フレア金粉
        const p = new Vector3(rx, 0.5 + Math.random() * 3.0, rz);
        const vel = new Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
        const col = Math.random() < 0.6 ? 0xfacc15 : 0x1c1917;
        this.pushFxParticle(p, vel, col, 0.13, 0.9 + Math.random() * 0.4, -0.6);
      } else if (pType === 'apocalypse') {
        // 終末隕石火片
        const p = new Vector3(rx, 8.0 + Math.random() * 5.0, rz);
        const vel = new Vector3(-3.0 + (Math.random() - 0.5) * 2, -7.0 - Math.random() * 3, (Math.random() - 0.5) * 2);
        const col = Math.random() < 0.4 ? 0xf43f5e : Math.random() < 0.7 ? 0xfb923c : 0xa855f7;
        this.pushFxParticle(p, vel, col, 0.18, 1.2, 2.0);
      }
    }
  }

  /** 傷ついたユニットの頭上に HP バーを並べる（無傷の間は表示しない） */
  private updateHpBars(battle: Battle): void {
    let count = 0;
    if (this.showHpBars) {
      const camQuat = this.camera.quaternion;
      _hpRight.set(1, 0, 0).applyQuaternion(camQuat);
      for (const u of battle.units) {
        if (count >= this.maxHpBars) break;
        if (!u.alive || u.hp >= u.maxHp) continue;
        const ratio = clamp01(u.hp / u.maxHp);
        const width = Math.min(2.4, 0.55 + u.scale * 0.32);
        const height = 0.09 + Math.min(0.07, u.scale * 0.02);

        _hpPos.copy(u.chest.pos);
        _hpPos.y += 0.72 * u.scale + 0.25;
        _hpScale.set(width + 0.05, height + 0.05, 1);
        _hpMatrix.compose(_hpPos, camQuat, _hpScale);
        this.hpBarBack.setMatrixAt(count, _hpMatrix);

        // バーは左端を固定して右から減らす
        _hpPos.addScaledVector(_hpRight, -width * (1 - ratio) * 0.5);
        _hpScale.set(Math.max(0.001, width * ratio), height, 1);
        _hpMatrix.compose(_hpPos, camQuat, _hpScale);
        this.hpBarFill.setMatrixAt(count, _hpMatrix);
        _hpColor.setHex(TEAM_COLORS[u.team]?.shirt ?? 0xffffff);
        this.hpBarFill.setColorAt(count, _hpColor);
        count++;
      }
    }
    this.hpBarBack.count = count;
    this.hpBarFill.count = count;
    if (count > 0) {
      this.hpBarBack.instanceMatrix.needsUpdate = true;
      this.hpBarFill.instanceMatrix.needsUpdate = true;
      if (this.hpBarFill.instanceColor) this.hpBarFill.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------
  // ローグライト残機ハート
  // ---------------------------------------------------------------

  /** 残機ハート表示の ON/OFF（ローグライトモードのときだけ ON にする） */
  setRogueHeartsVisible(visible: boolean): void {
    this.rogueHeartGroup.visible = visible;
  }

  /**
   * 残機ハートをライフ数に同期する。
   * 減っていたら破砕アニメーション、増えていたら復活アニメーションを再生する。
   * instant=true（または初回同期）のときはアニメーションなしで即時反映する。
   */
  syncRogueHearts(lives: number, maxLives: number, instant = false): void {
    this.rogueHeartGroup.visible = true;
    if (maxLives !== this.rogueMaxLivesShown || this.rogueHearts.length !== maxLives) {
      this.buildRogueHearts(maxLives);
      this.rogueLivesShown = -1;
    }
    const clamped = Math.max(0, Math.min(maxLives, lives));
    if (instant || this.rogueLivesShown < 0) {
      for (let i = 0; i < maxLives; i++) {
        this.setHeartImmediate(this.rogueHearts[i], i < clamped);
      }
      this.rogueLivesShown = clamped;
      return;
    }
    if (clamped < this.rogueLivesShown) {
      // 右側のハートから割れる
      for (let i = clamped; i < this.rogueLivesShown; i++) {
        const heart = this.rogueHearts[i];
        if (heart.state === 'alive' || heart.state === 'reviving') {
          heart.state = 'breaking';
          heart.animT = 0;
          heart.scattered = false;
        } else if (heart.state === 'lost') {
          // 既に失っている表示なら何もしない
        }
      }
    } else if (clamped > this.rogueLivesShown) {
      for (let i = this.rogueLivesShown; i < clamped; i++) {
        const heart = this.rogueHearts[i];
        if (heart.state === 'lost') {
          heart.state = 'reviving';
          heart.animT = 0;
          heart.full.visible = true;
          if (this.rogueHeartGeos) heart.full.geometry = this.rogueHeartGeos.full;
          heart.left.visible = false;
          heart.right.visible = false;
        } else if (heart.state === 'breaking') {
          // 割れている最中に戻ってきた場合は即時復活に倒す
          this.setHeartImmediate(heart, true);
        }
      }
    }
    this.rogueLivesShown = clamped;
  }

  /** ハート表示をアニメーションなしで alive/lost のどちらかに固定する */
  private setHeartImmediate(heart: RogueHeartVisual, alive: boolean): void {
    heart.state = alive ? 'alive' : 'lost';
    heart.animT = 0;
    heart.scattered = false;
    heart.full.visible = true;
    if (this.rogueHeartGeos) heart.full.geometry = alive ? this.rogueHeartGeos.full : this.rogueHeartGeos.lost;
    heart.left.visible = false;
    heart.right.visible = false;
    heart.left.position.set(0, 0, 0);
    heart.right.position.set(0, 0, 0);
    heart.left.rotation.set(0, 0, 0);
    heart.right.rotation.set(0, 0, 0);
    heart.group.scale.setScalar(1);
    heart.group.rotation.set(0, 0, 0);
  }

  /** ハートのメッシュ一式を（最大ライフ数ぶん）構築する */
  private buildRogueHearts(maxLives: number): void {
    for (const heart of this.rogueHearts) {
      this.rogueHeartGroup.remove(heart.group);
      heart.halfMat.dispose();
    }
    this.rogueHearts.length = 0;
    if (this.rogueHeartGeos) {
      this.rogueHeartGeos.full.dispose();
      this.rogueHeartGeos.lost.dispose();
      this.rogueHeartGeos.left.dispose();
      this.rogueHeartGeos.right.dispose();
    }
    this.rogueMaxLivesShown = maxLives;

    const voxel = 0.03;
    const fullGeo = buildHeartGeometry('alive', 'full', voxel);
    const lostGeo = buildHeartGeometry('lost', 'full', voxel);
    const leftGeo = buildHeartGeometry('alive', 'left', voxel);
    const rightGeo = buildHeartGeometry('alive', 'right', voxel);
    this.rogueHeartGeos = { full: fullGeo, lost: lostGeo, left: leftGeo, right: rightGeo };

    for (let i = 0; i < maxLives; i++) {
      const group = new Group();
      const halfMat = new MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
      const full = new Mesh(fullGeo, this.rogueHeartMat);
      full.renderOrder = 999;
      const left = new Mesh(leftGeo, halfMat);
      left.renderOrder = 999;
      left.visible = false;
      const right = new Mesh(rightGeo, halfMat);
      right.renderOrder = 999;
      right.visible = false;
      group.add(full, left, right);
      this.rogueHeartGroup.add(group);
      this.rogueHearts.push({
        group,
        full,
        left,
        right,
        halfMat,
        state: 'alive',
        animT: 0,
        scattered: false,
        basePos: new Vector3(),
      });
    }
  }

  /** ハートを画面左上に横並び配置する（カメラ子座標系で、毎フレーム再計算して追従を保証する） */
  private layoutRogueHearts(): void {
    const dist = 2.4;
    const halfH = Math.tan(((this.camera.fov * Math.PI) / 180) * 0.5) * dist;
    const halfW = halfH * this.camera.aspect;
    const w = 9 * 0.03;
    const h = 8 * 0.03;
    const gap = 0.055;
    for (let i = 0; i < this.rogueHearts.length; i++) {
      const heart = this.rogueHearts[i];
      heart.basePos.set(-halfW + 0.1 + w / 2 + i * (w + gap), halfH - 0.21 - h / 2, -dist);
      if (heart.state !== 'breaking') heart.group.position.copy(heart.basePos);
    }
  }

  /** ハートのアニメーション進行（renderFrame から毎フレーム呼ぶ） */
  private updateRogueHearts(dt: number): void {
    if (!this.rogueHeartGroup.visible || this.rogueHearts.length === 0) return;
    this.layoutRogueHearts();
    const shakeDur = 0.22;
    const fallDur = 0.75;
    for (const heart of this.rogueHearts) {
      if (heart.state === 'breaking') {
        heart.animT += dt;
        if (heart.animT < shakeDur) {
          // 割れる直前に小刻みに震える
          const amp = 0.012 + 0.03 * (heart.animT / shakeDur);
          heart.group.position.set(
            heart.basePos.x + (Math.random() - 0.5) * 2 * amp,
            heart.basePos.y + (Math.random() - 0.5) * 2 * amp,
            heart.basePos.z,
          );
        } else {
          if (!heart.scattered) {
            heart.scattered = true;
            heart.group.position.copy(heart.basePos);
            heart.full.visible = false;
            heart.left.visible = true;
            heart.right.visible = true;
            heart.halfMat.opacity = 1;
            // 赤いボクセル破片を散らす（ワールド座標へ変換してから既存のドロップ機構へ）
            const world = new Vector3();
            heart.group.getWorldPosition(world);
            const colors = [0xef3e57, 0xdd2a47, 0xff92a5, 0xa81c34];
            for (let k = 0; k < 16; k++) {
              const vel = new Vector3(
                (Math.random() - 0.5) * 2.4,
                Math.random() * 1.6 + 0.4,
                (Math.random() - 0.5) * 2.4,
              );
              this.pushDroppedVoxel(world.clone(), vel, colors[k % colors.length], 0.055);
            }
          }
          const t = Math.min(1, (heart.animT - shakeDur) / fallDur);
          const spread = 0.17 * t;
          const drop = 0.38 * t * t;
          heart.left.position.set(-spread, -drop, 0);
          heart.right.position.set(spread, -drop, 0);
          heart.left.rotation.set(0.5 * t, 0, 0.95 * t);
          heart.right.rotation.set(0.5 * t, 0, -0.95 * t);
          heart.halfMat.opacity = 1 - t;
          if (t >= 1) {
            heart.left.visible = false;
            heart.right.visible = false;
            heart.left.position.set(0, 0, 0);
            heart.right.position.set(0, 0, 0);
            heart.left.rotation.set(0, 0, 0);
            heart.right.rotation.set(0, 0, 0);
            heart.full.visible = true;
            if (this.rogueHeartGeos) heart.full.geometry = this.rogueHeartGeos.lost;
            heart.state = 'lost';
          }
        }
      } else if (heart.state === 'reviving') {
        heart.animT += dt;
        const dur = 0.38;
        const k = Math.min(1, heart.animT / dur);
        // easeOutBack でポップさせる
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const eased = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        heart.group.scale.setScalar(Math.max(0.05, 0.45 + 0.55 * eased));
        if (k >= 1) {
          heart.group.scale.setScalar(1);
          heart.state = 'alive';
        }
      }
    }
  }

  /** 毎フレームの描画更新 */
  renderFrame(battle: Battle, realDt: number): void {
    this.updateCameraMovement(realDt);
    for (const vis of this.unitVisuals.values()) {
      vis.sync();
    }
    this.syncFacilities(battle, realDt);
    this.syncArrows(battle.combat.arrows);
    this.updateRogueHearts(realDt);
    this.updateDroppedVoxels(realDt);
    this.updateKawariLogs(realDt);
    this.updateFxAndDynamicVisuals(battle, realDt);
    this.updateHpBars(battle);

    if (this.cameraShake > 0.004) {
      // 揺れは描画の間だけ加え、カメラ本来の位置は動かさない
      this.cameraRestPos.copy(this.camera.position);
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.z += (Math.random() - 0.5) * this.cameraShake;
      this.renderer.render(this.scene, this.camera);
      this.camera.position.copy(this.cameraRestPos);
      this.cameraShake *= Math.exp(-realDt * 9);
    } else {
      this.cameraShake = 0;
      this.renderer.render(this.scene, this.camera);
    }
  }
}

const _hpPos = new Vector3();
const _hpRight = new Vector3();
const _hpScale = new Vector3();
const _hpMatrix = new Matrix4();
const _hpColor = new Color();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
