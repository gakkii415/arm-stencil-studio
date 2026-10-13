import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARM, createArmGeometry, pointOnArm } from './arm.js';
import { renderStencil } from './stencil.js';
import { SurfacePainter } from './paint.js';
import { withJpegDensity } from './jpeg.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const status = $('export-status');
const undoButton = $('undo');
const convertButton = $('convert');
const exportButton = $('export-jpg');
const preview = $('stencil-canvas');
const ink = document.createElement('canvas');
ink.width = 2048; ink.height = 4096;
const painter = new SurfacePainter(ink);
let mode = 'draw';
let converted = false;
let stale = false;
let pointerId = null;
let exporting = false;
let textureDirty = true;
let renderer, camera, controls, arm, scene, texture, displayContext;
let renderPending = false;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const viewTarget = new THREE.Vector3(0, 0, 0);

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function updateButtons() {
  undoButton.disabled = !painter.operations.length || exporting;
  convertButton.disabled = !painter.operations.some((op) => op.mode === 'draw') || exporting;
  exportButton.disabled = !converted || stale || exporting;
}

function changed() {
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
    if (textureDirty) {
      displayContext.globalCompositeOperation = 'source-over';
      displayContext.fillStyle = '#fff';
      displayContext.fillRect(0, 0, ink.width, ink.height);
      displayContext.drawImage(ink, 0, 0);
      texture.needsUpdate = true;
      textureDirty = false;
    }
    controls.update();
    renderer.render(scene, camera);
  });
}

function fitCamera() {
  if (!camera || !viewport.clientHeight || !viewport.clientWidth) return;
  const distance = Math.max(ARM.length / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.17, 640);
  camera.position.set(distance * 0.32, distance * 0.06, distance * 0.95);
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
  invalidate();
}

function hitAt(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(arm, false)[0];
  if (!hit?.uv || hit.face.materialIndex !== 0) return null;
  return { u: hit.uv.x, y: (1 - hit.uv.y) * ARM.length };
}

function endStroke(event) {
  if (pointerId === null || (event && event.pointerId !== pointerId)) return;
  const oldId = pointerId;
  pointerId = null;
  if (renderer.domElement.hasPointerCapture(oldId)) renderer.domElement.releasePointerCapture(oldId);
  if (painter.end()) changed();
}

function setMode(next) {
  endStroke();
  mode = next;
  viewport.dataset.mode = mode;
  if (controls) controls.enabled = mode === 'view';
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  $('mode-label').textContent = { draw: '描画モード', erase: '消しゴムモード', view: '視点モード' }[mode];
  $('mode-dot').style.background = mode === 'view' ? '#77766f' : '#b84d27';
  $('gesture-help').textContent = mode === 'view'
    ? 'ドラッグで回転。2本指のピンチ、ホイール、＋ / − でズーム。'
    : mode === 'erase'
      ? '線をなぞって消去。消した操作も「戻す」で取り消せます。'
      : '腕の表面をドラッグして描画。回転するときは「視点」を選択。';
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
    const result = renderStencil(ink, { scale: 2, mirror: $('mirror').checked, guides: $('guides').checked });
    preview.width = result.width; preview.height = result.height;
    preview.getContext('2d').drawImage(result, 0, 0);
    result.width = 0; result.height = 0;
    preview.hidden = false;
    $('empty-state').hidden = true;
    converted = true; stale = false;
    updateButtons();
    setStatus('上腕・前腕の型紙に変換しました。JPGで書き出せます。');
    if (matchMedia('(max-width: 760px)').matches) showTab('stencil');
  } catch (error) {
    setStatus(error.message || '変換できませんでした。もう一度お試しください。', true);
  }
}

async function exportJpg() {
  if (exportButton.disabled) return;
  exporting = true; updateButtons();
  setStatus('JPGを作成しています…');
  let output;
  try {
    // 642 × 360 mm at 150 dpi stays under common iOS canvas memory limits.
    output = renderStencil(ink, { scale: 150 / 25.4, mirror: $('mirror').checked, guides: $('guides').checked });
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.98));
    if (!blob) throw new Error('JPGを作成できませんでした。');
    const bytes = withJpegDensity(new Uint8Array(await blob.arrayBuffer()), 150);
    const jpeg = new Blob([bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(jpeg);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arm-stencil${$('mirror').checked ? '-mirrored' : ''}.jpg`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus('JPGをダウンロードしました。印刷時は50 mmの目盛を確認してください。');
  } catch (error) {
    setStatus(error.message || 'JPGを書き出せませんでした。', true);
  } finally {
    if (output) { output.width = 0; output.height = 0; }
    exporting = false; updateButtons();
  }
}

function undo() {
  if (exporting) return;
  endStroke();
  if (painter.undo()) changed();
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'ドラッグして腕の表面に描画');
  viewport.prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(37, 1, 1, 5000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 390; controls.maxDistance = 1900;
  controls.enableDamping = false;
  controls.addEventListener('change', invalidate);
  const display = document.createElement('canvas');
  display.width = ink.width; display.height = ink.height;
  displayContext = display.getContext('2d');
  texture = new THREE.CanvasTexture(display);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  arm = new THREE.Mesh(createArmGeometry(), [
    new THREE.MeshStandardMaterial({ color: 0xe1c7aa, map: texture, roughness: 0.83 }),
    new THREE.MeshStandardMaterial({ color: 0xbba58d, roughness: 0.95 }),
  ]);
  arm.rotation.z = -0.12;
  scene.add(arm);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b877d, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(-300, 500, 550); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffeee1, 0.9);
  fill.position.set(350, -100, -300); scene.add(fill);
  // A quiet visible seam guide has no ink and is excluded from raycasting/export.
  const seamGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 91 }, (_, i) => {
    const p = pointOnArm(0, i / 90 * ARM.length);
    p.x -= 0.35;
    return p;
  }));
  const seam = new THREE.Line(seamGeometry, new THREE.LineDashedMaterial({ color: 0x8b806e, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.45 }));
  seam.computeLineDistances(); arm.add(seam);
  resize(); fitCamera(); setMode('draw');
  new ResizeObserver(resize).observe(viewport);
  $('loading').hidden = true;

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (mode === 'view' || event.button !== 0 || pointerId !== null || exporting) return;
    event.preventDefault();
    const point = hitAt(event);
    if (!point) return;
    pointerId = event.pointerId;
    renderer.domElement.setPointerCapture(pointerId);
    painter.begin(mode, Number($('brush-size').value) * (mode === 'erase' ? 4 : 1));
    painter.add(point);
    textureDirty = true; invalidate();
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [];
    for (const pointEvent of events.length ? events : [event]) painter.add(hitAt(pointEvent));
    textureDirty = true; invalidate();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(event, endStroke);
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    $('loading').hidden = false;
    $('loading').textContent = '3D表示が一時停止しました。復帰を待つか、2DからJPGを書き出してください。';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { $('loading').hidden = true; textureDirty = true; invalidate(); });
} catch (error) {
  $('loading').hidden = false;
  $('loading').textContent = '3D表示を開始できません。WebGLに対応したSafariやChromeで開き直してください。';
  $('loading').classList.add('error');
  setStatus('3D表示を開始できませんでした。', true);
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
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
