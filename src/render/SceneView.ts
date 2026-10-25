import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
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
import { isFacilityTypeId, type FacilityTypeId } from '../facilities/FacilityTypes';
import { DEFAULT_RED_ZONES, type StageTerrainConfig } from '../game/ArcadeStages';
import type { Battle } from '../game/Battle';
import type { Unit } from '../units/Unit';
import { TEAM_COLORS, UNIT_TYPES, type Team, type UnitTypeId } from '../units/UnitTypes';
import {
  createFacilityGhost,
  createFacilityMesh,
  createPreviewGhost,
  getFacilityVoxelSeeds,
  getKawariLogGeometry,
  getProjectileGeometry,
  VoxelCharacterVisual,
} from './VoxelModel';

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

/** 施設の描画・HPバー管理用データ */
interface FacilityVisual {
  facility: Facility;
  group: Group;
  mesh: Mesh;
  hpBarFill: Mesh;
  hpBarGroup: Group;
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

  // 配置フェーズ用の中心境界ライン・プレビューゴースト・ステージ地形グループ
  private readonly dividerGroup = new Group();
  private readonly terrainGroup = new Group();
  private ghostGroup: Group | null = null;
  private ghostKey = '';

  // カメラ制御（オービット＋WASD 平行移動＋スマホ用タッチ＆ピンチズーム）
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
  private readonly keys = new Set<string>();

  // 地面とのレイキャスト
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();

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

    this.setupInputListeners();
  }

  private setupLights(): void {
    const hemi = new HemisphereLight(0xdff0ff, 0x5d7a47, 0.85);
    this.scene.add(hemi);

    const amb = new AmbientLight(0xffffff, 0.25);
    this.scene.add(amb);

    const dir = new DirectionalLight(0xfff6e5, 1.35);
    dir.position.set(18, 32, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const d = 28;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.camera.near = 2;
    dir.shadow.camera.far = 80;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);
  }

  private setupEnvironment(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const even = (x + y) % 2 === 0;
        ctx.fillStyle = even ? '#6ea84f' : '#659c47';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    }
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(30, 30);
    tex.colorSpace = SRGBColorSpace;

    const groundGeo = new PlaneGeometry(120, 120);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new MeshLambertMaterial({ map: tex });
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

    // 2. 一本橋・奈落ステージの描画
    if (terrain?.chasm) {
      const c = terrain.chasm;
      const chasmW = c.maxX - c.minX;
      const abyssMat = new MeshBasicMaterial({ color: 0x0b1017 });
      const cliffMat = new MeshLambertMaterial({ color: 0x495057 });
      const bridgeMat = new MeshLambertMaterial({ color: 0x868e96 });
      const railMat = new MeshLambertMaterial({ color: 0xadb5bd });

      // 上下（北・南）の奈落の黒い谷底マスク
      for (const sign of [-1, 1]) {
        const zStart = c.bridgeHalfWidth;
        const zEnd = 24;
        const zLen = zEnd - zStart;
        const zCenter = sign * (zStart + zLen * 0.5);

        const pit = new Mesh(cube, abyssMat);
        pit.scale.set(chasmW, 0.04, zLen);
        pit.position.set((c.minX + c.maxX) * 0.5, 0.01, zCenter);
        this.terrainGroup.add(pit);

        // 崖の縁の岩壁
        const edgeL = new Mesh(cube, cliffMat);
        edgeL.scale.set(0.35, 0.22, zLen);
        edgeL.position.set(c.minX, 0.08, zCenter);
        const edgeR = edgeL.clone();
        edgeR.position.set(c.maxX, 0.08, zCenter);
        this.terrainGroup.add(edgeL, edgeR);
      }

      // 中央の石橋プレートと低い欄干縁石
      const bridgeFloor = new Mesh(cube, bridgeMat);
      bridgeFloor.scale.set(chasmW + 0.8, 0.08, c.bridgeHalfWidth * 2);
      bridgeFloor.position.set((c.minX + c.maxX) * 0.5, 0.03, 0);
      bridgeFloor.receiveShadow = true;
      this.terrainGroup.add(bridgeFloor);

      for (const sign of [-1, 1]) {
        const curb = new Mesh(cube, railMat);
        curb.scale.set(chasmW + 0.6, 0.18, 0.22);
        curb.position.set((c.minX + c.maxX) * 0.5, 0.1, sign * (c.bridgeHalfWidth - 0.1));
        curb.castShadow = true;
        this.terrainGroup.add(curb);
      }
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

  private setupInputListeners(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.activeTouches.size === 1) {
          this.isTouchOrbitPending = true;
          this.touchStartX = e.clientX;
          this.touchStartY = e.clientY;
          this.lastPointerX = e.clientX;
          this.lastPointerY = e.clientY;
        } else if (this.activeTouches.size === 2) {
          this.isTouchOrbitPending = false;
          this.isDraggingOrbit = false;
          const pts = [...this.activeTouches.values()];
          this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
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
        if (this.activeTouches.size < 2) {
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

        if (this.activeTouches.size === 2) {
          const pts = [...this.activeTouches.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.lastPinchDist > 10 && dist > 10) {
            const ratio = this.lastPinchDist / dist;
            this.camDistance = Math.max(6, Math.min(55, this.camDistance * ratio));
            this.updateCameraTransform();
          }
          this.lastPinchDist = dist;
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

  resetCamera(): void {
    this.camTarget.set(0, 0.8, 0);
    this.camYaw = 0;
    this.camPitch = 0.58;
    this.camDistance = 24;
    this.updateCameraTransform();
  }

  setPlacementGuidesVisible(visible: boolean): void {
    this.dividerGroup.visible = visible;
    if (!visible && this.ghostGroup) {
      this.ghostGroup.visible = false;
    }
  }

  updatePlacementGhost(
    typeId: UnitTypeId | FacilityTypeId | null,
    team: Team,
    pos: Vector3 | null,
    valid: boolean,
  ): void {
    if (!typeId || !pos) {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      return;
    }
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
    }
    if (this.ghostGroup) {
      this.ghostGroup.visible = valid;
      this.ghostGroup.position.copy(pos);
    }
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
    const mesh = createFacilityMesh(facility.type.id, facility.team);
    const group = new Group();
    group.position.copy(facility.pos);
    group.rotation.y = facility.facing;
    group.add(mesh);

    // 頭上HPバーの構築
    const hpBarGroup = new Group();
    hpBarGroup.position.set(0, facility.height + 0.38, 0);
    const barWidth = 1.35;
    const barHeight = 0.12;

    const bgMat = new MeshBasicMaterial({ color: 0x1a1d24 });
    const bgMesh = new Mesh(new BoxGeometry(barWidth + 0.04, barHeight + 0.04, 0.04), bgMat);
    hpBarGroup.add(bgMesh);

    const fillMat = new MeshBasicMaterial({ color: facility.team === 0 ? 0xe0473a : 0x3a72e0 });
    const fillMesh = new Mesh(new BoxGeometry(barWidth, barHeight, 0.05), fillMat);
    hpBarGroup.add(fillMesh);
    group.add(hpBarGroup);

    this.scene.add(group);
    this.facilityVisuals.set(facility.id, {
      facility,
      group,
      mesh,
      hpBarFill: fillMesh,
      hpBarGroup,
      lastHp: facility.hp,
    });
  }

  /** 施設ビジュアルを削除する */
  removeFacilityVisual(facility: Facility): void {
    const vis = this.facilityVisuals.get(facility.id);
    if (!vis) return;
    this.scene.remove(vis.group);
    vis.mesh.geometry.dispose();
    if (vis.mesh.material instanceof MeshLambertMaterial) {
      vis.mesh.material.dispose();
    }
    this.facilityVisuals.delete(facility.id);
  }

  /** 施設の状態・被弾フラッシュ・HPバー・破壊演出を同期する */
  syncFacilities(battle: Battle, dt: number): void {
    // 既存ビジュアルの同期と破壊判定
    for (const [id, vis] of this.facilityVisuals) {
      const fac = vis.facility;
      vis.group.position.copy(fac.pos);

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
      case 'dragon_roar':
      case 'dragon_breath': {
        const count = e.kind === 'dragon_roar' ? 14 : 4;
        for (let i = 0; i < count; i++) {
          const p = e.kind === 'dragon_roar' ? e.pos.clone() : e.from.clone();
          const vel =
            e.kind === 'dragon_roar'
              ? new Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5)
              : e.dir
                  .clone()
                  .multiplyScalar(8 + Math.random() * 5)
                  .add(new Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5));
          const col = i % 3 === 0 ? 0xffe066 : i % 3 === 1 ? 0xff6b1a : 0x343a40;
          this.pushFxParticle(p, vel, col, 0.15 + Math.random() * 0.08, 0.45 + Math.random() * 0.2, -2.5);
        }
        break;
      }
      case 'slime_jump':
      case 'slime_slam':
      case 'slime_split': {
        const count = e.kind === 'slime_jump' ? 10 : 22;
        const jellyCol = e.team === 0 ? 0x4cd97b : 0x38d996;
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
        // 八角形幾何学ATフィールド展開エフェクト（琥珀色・オレンジ多層防壁）
        const r = 1.35 * e.scale;
        const ringN = 16;
        for (let i = 0; i < ringN; i++) {
          const ang = (i / ringN) * Math.PI * 2;
          const p = e.pos.clone().add(new Vector3(Math.cos(ang) * r, Math.sin(ang) * r, 0));
          this.pushFxParticle(p, new Vector3(Math.cos(ang) * 0.6, Math.sin(ang) * 0.6, 0), 0xffa94d, 0.22, 0.38, 0);
        }
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const p = e.pos.clone().add(new Vector3(Math.cos(ang) * (r * 0.55), Math.sin(ang) * (r * 0.55), 0));
          this.pushFxParticle(p, new Vector3(0, 0, 0), 0xffd43b, 0.18, 0.28, 0);
        }
        break;
      }
      case 'ramiel_charge': {
        // 幾何神ラミエルの空間収束光粒子
        for (let i = 0; i < 4; i++) {
          const dist = 2.2 * (1.0 - e.progress * 0.65);
          const ang = Math.random() * Math.PI * 2;
          const elev = (Math.random() - 0.5) * Math.PI;
          const offset = new Vector3(
            Math.cos(ang) * Math.cos(elev) * dist,
            Math.sin(elev) * dist,
            Math.sin(ang) * Math.cos(elev) * dist,
          );
          const vel = offset.clone().multiplyScalar(-3.0);
          this.pushFxParticle(e.pos.clone().add(offset), vel, Math.random() < 0.5 ? 0x4dabf7 : 0xffffff, 0.15, 0.3, 0);
        }
        break;
      }
      case 'ramiel_beam': {
        // 加粒子砲照射（超高エネルギー極太荷電粒子ビーム柱＆プラズマリング）
        const dir = new Vector3().subVectors(e.to, e.from);
        const dist = dir.length();
        dir.normalize();
        const step = 0.5;
        for (let d = 0; d <= dist; d += step) {
          const p = e.from.clone().addScaledVector(dir, d);
          p.add(new Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
          this.pushFxParticle(p, new Vector3(0, 0, 0), Math.random() < 0.7 ? 0xffffff : 0x4dabf7, 0.38, 0.45, 0);
        }
        // 着弾爆発プラズマ
        for (let i = 0; i < 36; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 12, 2.0 + Math.random() * 9, (Math.random() - 0.5) * 12);
          this.pushFxParticle(e.to.clone(), vel, i % 2 === 0 ? 0x4dabf7 : 0xffffff, 0.28, 0.6, 5.0);
        }
        break;
      }
      case 'sachiel_pile': {
        // 使徒神サキエルの光杭パイルランス突刺
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
        // 使徒特有の十字架状クロス閃光爆発
        // 縦軸光柱
        for (let y = -4; y <= 16; y += 0.8) {
          this.pushFxParticle(e.pos.clone().add(new Vector3(0, y, 0)), new Vector3(0, 1.2, 0), 0xff6b6b, 0.35, 0.5, 0);
        }
        // 横軸光柱
        for (let x = -6; x <= 6; x += 0.8) {
          this.pushFxParticle(e.pos.clone().add(new Vector3(x, 2, 0)), new Vector3(x * 0.5, 0, 0), 0xff8787, 0.3, 0.45, 0);
        }
        // 爆風破片
        for (let i = 0; i < 28; i++) {
          const vel = new Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 8, (Math.random() - 0.5) * 10);
          this.pushFxParticle(e.pos.clone(), vel, 0xffd43b, 0.2, 0.45, 4.0);
        }
        break;
      }
      case 'zeruel_ribbon': {
        // 拒絶神ゼルエルの帯状リボンカッター薙ぎ払い残像
        const n = 18;
        for (let i = 0; i < n; i++) {
          const frac = i / n;
          const p = e.from.clone().addScaledVector(e.dir, frac * e.reach);
          const right = new Vector3(-e.dir.z, 0, e.dir.x).multiplyScalar((frac - 0.5) * 3.5);
          p.add(right);
          this.pushFxParticle(p, e.dir.clone().multiplyScalar(10.0), frac < 0.5 ? 0xffffff : 0xd90429, 0.26, 0.32, 0);
        }
        break;
      }
      case 'sahaquiel_bomb': {
        // 天落神サハクィエルの落天爆弾の大爆発
        for (let i = 0; i < 48; i++) {
          const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
          const spd = 6 + Math.random() * 11;
          const col = i % 3 === 0 ? 0xf76707 : i % 3 === 1 ? 0xffd43b : 0xff0000;
          this.pushFxParticle(e.pos.clone(), dir.multiplyScalar(spd), col, 0.32, 0.6, 4.0);
        }
        // 巨大衝撃波リング
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
      if (a.projectileKind === 'shuriken') {
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
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      this.camTarget.x += (right * cos - forward * sin) * moveSpeed;
      this.camTarget.z += (-right * sin - forward * cos) * moveSpeed;
      this.camTarget.x = Math.max(-35, Math.min(35, this.camTarget.x));
      this.camTarget.z = Math.max(-35, Math.min(35, this.camTarget.z));
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

  /** 毎フレームの描画更新 */
  renderFrame(battle: Battle, realDt: number): void {
    this.updateCameraMovement(realDt);
    for (const vis of this.unitVisuals.values()) {
      vis.sync();
    }
    this.syncFacilities(battle, realDt);
    this.syncArrows(battle.combat.arrows);
    this.updateDroppedVoxels(realDt);
    this.updateKawariLogs(realDt);
    this.updateFxAndDynamicVisuals(battle, realDt);
    this.renderer.render(this.scene, this.camera);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
