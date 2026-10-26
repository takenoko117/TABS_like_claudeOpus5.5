import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { VoxelCharacterVisual } from './render/VoxelModel';
import { Unit } from './units/Unit';
import { UNIT_TYPES, type UnitTypeId } from './units/UnitTypes';

declare global {
  interface Window {
    renderDone?: boolean;
    switchUnit?: (id: UnitTypeId, angle?: string, mode?: string) => void;
  }
}

const viewport = document.getElementById('viewport') as HTMLElement;
const unitSelect = document.getElementById('unit-select') as HTMLSelectElement;
const angleSelect = document.getElementById('angle-select') as HTMLSelectElement;
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement;

const scene = new Scene();
scene.background = new Color(0x1e2430);

const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

// ライト
const hemi = new HemisphereLight(0xffffff, 0x444455, 0.9);
scene.add(hemi);
const amb = new AmbientLight(0xffffff, 0.35);
scene.add(amb);
const dir = new DirectionalLight(0xfff5ea, 1.4);
dir.position.set(15, 25, 20);
scene.add(dir);
const dirBack = new DirectionalLight(0x88aacc, 0.6);
dirBack.position.set(-15, 10, -15);
scene.add(dirBack);

// 地面グリッド（Y=0）
const grid = new GridHelper(20, 20, 0x4fd1c5, 0x2d3748);
grid.position.y = 0;
scene.add(grid);

let currentVisual: VoxelCharacterVisual | null = null;
let currentUnit: Unit | null = null;
let world: PhysicsWorld = new PhysicsWorld();

function renderUnit(typeId: UnitTypeId, angle = 'iso', mode = 'idle') {
  window.renderDone = false;
  if (currentVisual) {
    scene.remove(currentVisual.group);
    currentVisual.dispose();
    currentVisual = null;
  }

  world = new PhysicsWorld();
  const uType = UNIT_TYPES[typeId];
  if (!uType) return;

  // y=0 の地面にスポーン
  currentUnit = new Unit(world, uType, 0, new Vector3(0, 0, 0), 0);

  // 物理ステップを進めて自然に地面に接地させる
  const speed = mode === 'move' ? currentUnit.type.speed : 0;
  const anyUnit = currentUnit as any;
  for (let step = 0; step < 15; step++) {
    anyUnit.computePose(0.016, speed);
    anyUnit.applyMuscles(0.016);
    world.step(0.016);
  }

  currentVisual = new VoxelCharacterVisual(currentUnit);
  currentVisual.sync();
  scene.add(currentVisual.group);

  // カメラ位置設定（骨盤の高さを基準に画面中央にフォーカス）
  const s = currentUnit.scale;
  const targetY = currentUnit.pelvis.pos.y + 0.15 * s;
  const dist = Math.max(3.8, s * 3.6);

  if (angle === 'iso') {
    camera.position.set(dist * 0.72, targetY + dist * 0.42, dist * 0.72);
  } else if (angle === 'side') {
    camera.position.set(dist * 1.05, targetY + dist * 0.18, 0);
  } else if (angle === 'front') {
    camera.position.set(0, targetY + dist * 0.15, dist * 1.05);
  } else if (angle === 'top') {
    camera.position.set(0, dist * 1.3, 0.01);
  } else if (angle === 'rear') {
    camera.position.set(0, targetY + dist * 0.15, -dist * 1.05);
  }
  camera.lookAt(0, targetY, 0);

  renderer.render(scene, camera);
  window.renderDone = true;
}

// UI初期化
const allUnitIds = Object.keys(UNIT_TYPES) as UnitTypeId[];
allUnitIds.forEach((id) => {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = `${UNIT_TYPES[id].name} (${id})`;
  unitSelect.appendChild(opt);
});

// URLパラメータ解析
const params = new URLSearchParams(window.location.search);
const initialUnit = (params.get('unit') as UnitTypeId) || 'giant_tank';
const initialAngle = params.get('angle') || 'iso';
const initialMode = params.get('mode') || 'idle';

unitSelect.value = initialUnit;
angleSelect.value = initialAngle;
modeSelect.value = initialMode;

function update() {
  renderUnit(unitSelect.value as UnitTypeId, angleSelect.value, modeSelect.value);
}

unitSelect.addEventListener('change', update);
angleSelect.addEventListener('change', update);
modeSelect.addEventListener('change', update);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
});

window.switchUnit = (id, angle, mode) => {
  unitSelect.value = id;
  if (angle) angleSelect.value = angle;
  if (mode) modeSelect.value = mode;
  update();
};

update();

// アニメーションループ（ブラウザ閲覧時のインタラクティブプレビュー用）
let lastT = performance.now();
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (currentUnit && currentVisual && modeSelect.value === 'move') {
    const anyUnit = currentUnit as any;
    anyUnit.computePose(dt, currentUnit.type.speed);
    anyUnit.applyMuscles(dt);
    world.step(dt);
    currentVisual.sync();
    renderer.render(scene, camera);
  }
}
requestAnimationFrame(loop);
