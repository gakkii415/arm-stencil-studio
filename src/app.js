import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_MODEL, getModel } from './models.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { renderStencil } from './stencil.js';
import { SurfacePainter } from './paint.js';
import { withJpegDensity } from './jpeg.js';
import { isPhotoLibraryDevice, saveImage } from './image-export.js';
import { MeshBVH, acceleratedRaycast } from '../vendor/three-mesh-bvh.js';
import { installTouchControls } from './touch-controls.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const status = $('export-status');
const undoButton = $('undo');
const convertButton = $('convert');
const exportButton = $('export-jpg');
const preview = $('stencil-canvas');
const ink = document.createElement('canvas');
ink.width = 2048; ink.height = 4096;
let currentModel = DEFAULT_MODEL;
const painter = new SurfacePainter(ink, { deferred: true, model: currentModel });
const drawings = new Map();
let selectedColor = '#000000';
let modelLoading = true;
let modelRevision = 0;
let touchControls, keyLight;
let mode = 'draw';
let converted = false;
let stale = false;
let pointerId = null;
let exporting = false;
let textureDirty = true;
let renderer, camera, controls, arm, scene, texture;
let renderPending = false;
let labelsDirty = true;
let pendingPoints = [];
let drawingBounds = null;
let preparedFile = null;
let preparing = false;
let imageRevision = 0;
let previewCleanup = null;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const viewTarget = new THREE.Vector3(0, 0, 0);
const photoLibrary = isPhotoLibraryDevice();
if (photoLibrary) $('save-label').textContent = '写真に保存';

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function updateButtons() {
  undoButton.disabled = !painter.operations.length || exporting || modelLoading;
  convertButton.disabled = !painter.operations.some((op) => op.mode === 'draw') || exporting || modelLoading;
  exportButton.disabled = !converted || stale || !preparedFile || preparing || exporting || modelLoading;
  for (const id of ['mirror', 'guides']) $(id).disabled = exporting;
  for (const id of ['sex-select', 'part-select']) $(id).disabled = exporting || modelLoading;
}

function changed() {
  imageRevision += 1;
  preparedFile = null;
  preparing = false;
  textureDirty = true;
  const hasDrawing = painter.operations.some((op) => op.mode === 'draw');
  if (!hasDrawing) {
    converted = false;
    preview.hidden = true;
    $('empty-state').hidden = false;
  }
  stale = converted;
  updateButtons();
  if (stale) setStatus('線画が変わりました。再変換してから書き出してください。');
  else if (hasDrawing) setStatus('描いた線を2Dステンシルに変換できます。');
  else setStatus('線を描くと変換できます。');
  invalidate();
}

function invalidate() {
  if (renderPending || !renderer) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    flushInput();
    if (textureDirty) {
      texture.needsUpdate = true;
      textureDirty = false;
    }
    controls.update();
    renderer.render(scene, camera);
    if (labelsDirty) { updateLandmarkLabels(); labelsDirty = false; }
  });
}

function flushInput() {
  const points = pendingPoints;
  pendingPoints = [];
  const count = Math.min(points.length, 16);
  for (let i = 0; i < count; i += 1) {
    const index = count === points.length ? i : Math.round(i * (points.length - 1) / (count - 1));
    painter.add(hitAt(points[index], drawingBounds));
  }
  if (count) textureDirty = true;
}

function updateLandmarkLabels() {
  if (!arm) return;
  for (const [selector, y] of [['.shoulder-label', currentModel.topY], ['.wrist-label', currentModel.bottomY]]) {
    const label = viewport.querySelector(selector);
    const point = arm.localToWorld(new THREE.Vector3(0, y, 0)).project(camera);
    const top = (1 - point.y) * viewport.clientHeight / 2;
    label.hidden = point.z > 1 || top < 70 || top > viewport.clientHeight - 36;
    label.style.bottom = 'auto';
    label.style.top = `${top}px`;
  }
}

function fitCamera() {
  if (!camera || !arm || !viewport.clientHeight || !viewport.clientWidth) return;
  endStroke();
  touchControls?.reset();
  const bounds = new THREE.Box3().setFromObject(arm);
  const size = bounds.getSize(new THREE.Vector3());
  bounds.getCenter(viewTarget);
  const distance = Math.max(Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08 + size.z * 0.35, 640);
  const sideDirection = currentModel.side === 'left' ? -1 : 1;
  camera.position.copy(viewTarget).add(new THREE.Vector3(distance * 0.28 * sideDirection, distance * 0.04, distance * 0.96 * currentModel.cameraFrontZ));
  controls.minDistance = Math.max(200, Math.max(size.y, size.x) * 0.5);
  controls.maxDistance = distance * 3;
  controls.target.copy(viewTarget);
  camera.lookAt(viewTarget);
  controls.update();
  invalidate();
}

function resize() {
  if (!renderer || !viewport.clientWidth || !viewport.clientHeight) return;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  labelsDirty = true;
  invalidate();
}

function hitAt(event, bounds = drawingBounds) {
  if (!arm) return null;
  bounds ||= renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(arm, true)[0];
  if (!hit?.uv || !hit.object.userData.paintable) return null;
  const y = (1 - hit.uv.y) * currentModel.length;
  if (y < 0 || y > currentModel.length) return null;
  return { u: hit.uv.x, y };
}

function endStroke(event) {
  if (pointerId === null || (event && event.pointerId !== pointerId)) return;
  flushInput();
  const oldId = pointerId;
  pointerId = null;
  drawingBounds = null;
  if (renderer.domElement.hasPointerCapture(oldId)) renderer.domElement.releasePointerCapture(oldId);
  if (painter.end()) changed();
}

function cancelStroke() {
  pendingPoints = [];
  const oldId = pointerId;
  pointerId = null;
  drawingBounds = null;
  if (oldId !== null && renderer.domElement.hasPointerCapture(oldId)) renderer.domElement.releasePointerCapture(oldId);
  if (painter.cancel()) { textureDirty = true; invalidate(); }
  updateButtons();
}

function setMode(next) {
  endStroke();
  touchControls?.reset();
  mode = next;
  viewport.dataset.mode = mode;
  if (controls) controls.enabled = mode === 'view';
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  $('mode-label').textContent = { draw: '描画モード', erase: '消しゴムモード', view: '視点モード' }[mode];
  $('mode-dot').style.background = mode === 'view' ? '#77766f' : '#b84d27';
  $('gesture-help').textContent = mode === 'view'
    ? 'ドラッグで回転。2本指のピンチ、ホイール、＋ / − でズーム。'
    : mode === 'erase'
      ? '1本指で消去、2本指のドラッグで回転・ピンチでズーム。'
      : '1本指で描画、2本指のドラッグで回転・ピンチでズーム。';
}

function showTab(tab) {
  document.querySelector('.workspace').dataset.activeTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  resize();
}

function convert() {
  if (convertButton.disabled) return;
  endStroke();
  try {
    painter.rasterize();
    const result = renderStencil(ink, { model: currentModel, scale: 2, mirror: $('mirror').checked, guides: $('guides').checked });
    preview.width = result.width; preview.height = result.height;
    preview.getContext('2d').drawImage(result, 0, 0);
    result.width = 0; result.height = 0;
    preview.hidden = false;
    $('empty-state').hidden = true;
    converted = true; stale = false;
    updateButtons();
    prepareImage();
    if (matchMedia('(max-width: 760px)').matches) showTab('stencil');
  } catch (error) {
    setStatus(error.message || '変換できませんでした。もう一度お試しください。', true);
  }
}

async function prepareImage() {
  const revision = ++imageRevision;
  preparedFile = null;
  preparing = true;
  updateButtons();
  setStatus('保存する画像を準備しています…');
  let output;
  try {
    // Paint the converted preview first, then prepare the file before a Save tap.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (revision !== imageRevision) return;
    // Long leg templates stay below mobile Safari's canvas pixel limits.
    const dpi = currentModel.part === 'leg' ? 125 : 150;
    output = renderStencil(ink, { model: currentModel, scale: dpi / 25.4, mirror: $('mirror').checked, guides: $('guides').checked });
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.98));
    if (!blob) throw new Error('画像を作成できませんでした。');
    const bytes = withJpegDensity(new Uint8Array(await blob.arrayBuffer()), dpi);
    if (revision !== imageRevision) return;
    preparedFile = new File([bytes], `stencil-${currentModel.id}${$('mirror').checked ? '-mirrored' : ''}.jpg`, { type: 'image/jpeg' });
    setStatus(photoLibrary ? '「写真に保存」→共有画面の「画像を保存」で写真アプリへ保存できます。' : 'JPG画像を保存できます。');
  } catch (error) {
    if (revision === imageRevision) setStatus(error.message || '画像を準備できませんでした。再変換してください。', true);
  } finally {
    if (output) { output.width = 0; output.height = 0; }
    if (revision === imageRevision) { preparing = false; updateButtons(); }
  }
}

function closeImagePreview() {
  $('save-image-preview').removeAttribute('src');
  previewCleanup?.();
  previewCleanup = null;
}

async function exportJpg() {
  if (exportButton.disabled) return;
  exporting = true; updateButtons();
  setStatus(photoLibrary ? '共有画面の「画像を保存」を選んでください。' : 'JPG画像を保存しています…');
  try {
    // No encoding awaits here: iOS sharing must begin within this user gesture.
    const result = await saveImage(preparedFile);
    if (result.mode === 'preview') {
      closeImagePreview();
      previewCleanup = result.cleanup;
      $('save-image-preview').src = result.url;
      $('save-image-dialog').showModal();
      setStatus('表示された画像を長押しし、「画像を保存」を選んでください。');
    } else if (result.mode === 'canceled') {
      setStatus('共有を取り消しました。もう一度「写真に保存」から開けます。');
    } else if (result.mode === 'shared') {
      setStatus('画像を共有しました。「画像を保存」を選ぶと写真アプリに保存されます。');
    } else {
      setStatus('JPGをダウンロードしました。印刷時は50 mmの目盛を確認してください。');
    }
  } catch (error) {
    setStatus(error.message || '画像を保存できませんでした。もう一度お試しください。', true);
  } finally {
    exporting = false; updateButtons();
  }
}

function undo() {
  if (exporting) return;
  endStroke();
  if (painter.undo()) changed();
}

function disposeModel(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
}

function updateModelInfo() {
  const title = `${currentModel.sexLabel}・${currentModel.label}`;
  $('model-label').textContent = title;
  $('model-measurement').textContent = `${title} / ${currentModel.length} mm`;
  viewport.dataset.model = currentModel.id;
  viewport.setAttribute('aria-label', `${title}の3D描画領域`);
  renderer.domElement.setAttribute('aria-label', `${title}の表面に1本指で描画、2本指で視点操作`);
  const panels = currentModel.panels;
  $('shoulder-label').textContent = panels[0].startLabel;
  $('wrist-label').textContent = panels.at(-1).endLabel;
  $('model-pattern-note').textContent = currentModel.type === 'flat'
    ? `両肩の後面を含む背中の線画を1枚の平面型紙へ写します。${currentModel.length} mmはモデルの参考長さで、実際の身体には個人差があります。トルソーの胸・腹側、首元と切断面は表示用です。`
    : `${currentModel.part === 'arm' ? '腕の内側を切れ目にし、肘で上腕・前腕' : '脚の内側を切れ目にし、膝で太もも・すね'}に分けた近似型紙です。${currentModel.length} mmはモデルの参考長さで、実際の身体には個人差があります。${currentModel.part === 'arm' ? '手・指' : '足'}は表示用です。`;
  preview.setAttribute('aria-label', `${title}の2Dステンシル`);
  document.querySelector('.export-detail').textContent = `${currentModel.part === 'leg' ? 125 : 150} dpi`;
}

async function loadModel(nextModel) {
  const revision = ++modelRevision;
  endStroke();
  touchControls?.reset();
  drawings.set(currentModel.id, painter.operations);
  modelLoading = true;
  updateButtons();
  $('loading').hidden = false;
  $('loading').classList.remove('error');
  $('loading').textContent = `${nextModel.sexLabel}・${nextModel.label}を読み込んでいます…`;
  let nextArm;
  try {
    const gltf = await new GLTFLoader().loadAsync(nextModel.modelUrl);
    nextArm = gltf.scene;
    if (revision !== modelRevision) { disposeModel(nextArm); return; }
    nextArm.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.boundsTree = new MeshBVH(object.geometry, { indirect: true });
      object.raycast = acceleratedRaycast;
      const paintable = object.userData.paintable === true || object.name.startsWith('paintable');
      object.userData.paintable = paintable;
      // The shared texture survives disposal of a previously selected mesh.
      const original = object.material;
      object.material = new THREE.MeshStandardMaterial({ color: 0xdfc1a0, map: paintable ? texture : null, roughness: 0.82 });
      for (const material of Array.isArray(original) ? original : [original]) material.dispose();
    });
    if (arm) { scene.remove(arm); disposeModel(arm); }
    arm = nextArm;
    arm.rotation.z = nextModel.part === 'arm' ? (nextModel.side === 'left' ? 0.06 : -0.06) : 0;
    currentModel = nextModel;
    painter.setModel(currentModel, drawings.get(currentModel.id) || []);
    scene.add(arm);
    keyLight.position.x = currentModel.side === 'left' ? -300 : 300;
    keyLight.position.z = 500 * currentModel.cameraFrontZ;
    converted = false;
    stale = false;
    preview.hidden = true;
    $('empty-state').hidden = false;
    closeImagePreview();
    $('save-image-dialog').close();
    updateModelInfo();
    labelsDirty = true;
    resize();
    fitCamera();
    $('loading').hidden = true;
    changed();
  } catch (error) {
    if (revision !== modelRevision) return;
    $('sex-select').value = currentModel.sex;
    $('part-select').value = currentModel.part + (currentModel.side === 'left' ? '-left' : '');
    $('loading').hidden = !!arm;
    if (!arm) {
      $('loading').textContent = '3Dモデルを読み込めませんでした。通信状態を確認してページを開き直してください。';
      $('loading').classList.add('error');
    }
    setStatus('モデルを読み込めませんでした。部位を選び直して再度お試しください。', true);
  } finally {
    if (revision === modelRevision) { modelLoading = false; updateButtons(); }
  }
}

async function initialize() {
 try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '身体の表面に描画');
  viewport.prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(37, 1, 1, 5000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 390; controls.maxDistance = 2500;
  controls.enableDamping = false;
  controls.addEventListener('change', () => { labelsDirty = true; invalidate(); });
  const display = document.createElement('canvas');
  display.width = 512; display.height = 1024;
  painter.attachPreview(display);
  texture = new THREE.CanvasTexture(display);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x858078, 1.9));
  keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(300, 450, -500); scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xffeee1, 0.9);
  fill.position.set(-350, -100, 250); scene.add(fill);
  new ResizeObserver(resize).observe(viewport);
  touchControls = installTouchControls({
    element: renderer.domElement, camera, controls, getMode: () => mode,
    onGestureStart: ({ cancelStroke: cancel }) => cancel ? cancelStroke() : endStroke(),
    onChange: () => { labelsDirty = true; invalidate(); },
  });
  setMode('draw');

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (mode === 'view' || event.button !== 0 || pointerId !== null || exporting || modelLoading) return;
    event.preventDefault();
    drawingBounds = renderer.domElement.getBoundingClientRect();
    const point = hitAt(event, drawingBounds);
    if (!point) { drawingBounds = null; return; }
    pointerId = event.pointerId;
    renderer.domElement.setPointerCapture(pointerId);
    painter.begin(mode, Number($('brush-size').value) * (mode === 'erase' ? 4 : 1), selectedColor);
    painter.add(point);
    changed();
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [];
    for (const pointEvent of events.length ? events : [event]) pendingPoints.push({ clientX: pointEvent.clientX, clientY: pointEvent.clientY });
    invalidate();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(event, endStroke);
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    $('loading').hidden = false;
    $('loading').textContent = '3D表示が一時停止しました。復帰を待つか、2DからJPGを書き出してください。';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { $('loading').hidden = true; textureDirty = true; invalidate(); });
  await loadModel(currentModel);
} catch (error) {
  $('loading').hidden = false;
  $('loading').textContent = '3D表示を開始できませんでした。WebGLに対応したSafariやChromeで開き直してください。';
  $('loading').classList.add('error');
  setStatus('3D表示を開始できませんでした。ページを開き直してください。', true);
 }
}
initialize();

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
for (const button of document.querySelectorAll('[data-color]')) button.addEventListener('click', () => {
  endStroke();
  selectedColor = button.dataset.color;
  for (const choice of document.querySelectorAll('[data-color]')) {
    const selected = choice === button;
    choice.setAttribute('aria-pressed', String(selected));
    choice.classList.toggle('selected', selected);
  }
});
for (const id of ['sex-select', 'part-select']) $(id).addEventListener('change', () => {
  showTab('arm');
  const [part, side = 'right'] = $('part-select').value.split('-');
  loadModel(getModel($('sex-select').value, part, side));
});
$('brush-size').addEventListener('input', () => { $('brush-value').textContent = `${Number($('brush-size').value).toFixed(1)} mm`; });
undoButton.addEventListener('click', undo);
convertButton.addEventListener('click', convert);
exportButton.addEventListener('click', exportJpg);
for (const id of ['mirror', 'guides']) $(id).addEventListener('change', () => { if (converted && !stale) convert(); });
$('reset-view').addEventListener('click', fitCamera);
for (const [id, factor] of [['zoom-in', 0.82], ['zoom-out', 1.22]]) $(id).addEventListener('click', () => {
  if (!camera) return;
  const delta = camera.position.clone().sub(controls.target);
  delta.setLength(THREE.MathUtils.clamp(delta.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(delta); controls.update(); invalidate();
});
window.addEventListener('keydown', (event) => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    const next = { b: 'draw', e: 'erase', v: 'view' }[event.key.toLowerCase()];
    if (next) setMode(next);
  }
});

$('close-save-preview').addEventListener('click', () => $('save-image-dialog').close());
$('save-image-dialog').addEventListener('close', closeImagePreview);
