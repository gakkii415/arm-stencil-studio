import { ARM, circumferenceAt } from './arm.js';

const MARGIN = 14;
const GAP = 24;
const TOP = 36;
const FOOTER = 44;

function maximumCircumference(startMm, endMm) {
  let maximum = 0;
  for (let distance = startMm; distance <= endMm; distance += 1) {
    maximum = Math.max(maximum, circumferenceAt(distance));
  }
  return Math.max(maximum, circumferenceAt(endMm));
}

/** Physical layout dimensions in mm, independent of canvas resolution. */
export function stencilDimensions() {
  const upperWidth = maximumCircumference(0, ARM.elbow);
  const forearmWidth = maximumCircumference(ARM.elbow, ARM.length);
  const panels = [
    { id: 'upper', label: '上腕', startMm: 0, endMm: ARM.elbow, x: MARGIN, width: upperWidth },
    { id: 'forearm', label: '前腕', startMm: ARM.elbow, endMm: ARM.length, x: MARGIN + upperWidth + GAP, width: forearmWidth },
  ].map((panel) => ({
    ...panel,
    y: TOP,
    height: panel.endMm - panel.startMm,
    centerX: panel.x + panel.width / 2,
  }));
  return {
    width: MARGIN * 2 + upperWidth + GAP + forearmWidth,
    height: TOP + Math.max(...panels.map((panel) => panel.height)) + FOOTER,
    panels,
  };
}

/**
 * Map a normalized wrap coordinate and shoulder distance to the flat stencil.
 * At the elbow, the default section is the forearm. Pass section:'upper' to
 * obtain the matching lower edge of the upper-arm panel.
 * The seam stays split into two page edges; u=1 must not wrap back to u=0.
 */
export function projectStencilPoint(u, yMm, { mirror = false, section } = {}) {
  if (!Number.isFinite(u) || !Number.isFinite(yMm)) {
    throw new TypeError('Stencil coordinates must be finite.');
  }
  const distance = Math.min(ARM.length, Math.max(0, yMm));
  const layout = stencilDimensions();
  const panel = section
    ? layout.panels.find((item) => item.id === section)
    : layout.panels[distance < ARM.elbow ? 0 : 1];
  if (!panel || distance < panel.startMm || distance > panel.endMm) {
    throw new RangeError('Distance is outside the requested stencil section.');
  }
  const normalizedU = Math.min(1, Math.max(0, u));
  const width = circumferenceAt(distance);
  const left = panel.centerX - width / 2;
  return {
    section: panel.id,
    x: left + (mirror ? 1 - normalizedU : normalizedU) * width,
    y: panel.y + distance - panel.startMm,
    width,
    left,
    right: left + width,
    centerX: panel.centerX,
    yMm: distance,
  };
}

function drawArtwork(context, texture, panel, scale, mirror) {
  context.save();
  if (mirror) {
    context.translate(panel.centerX * scale * 2, 0);
    context.scale(-1, 1);
  }
  const rows = Math.ceil(panel.height * scale);
  for (let row = 0; row < rows; row += 1) {
    const localStart = row / scale;
    const localEnd = Math.min(panel.height, (row + 1) / scale);
    const distance = panel.startMm + (localStart + localEnd) / 2;
    const width = circumferenceAt(distance);
    const left = panel.centerX - width / 2;
    const sourceY = ((panel.startMm + localStart) / ARM.length) * texture.height;
    const sourceHeight = ((localEnd - localStart) / ARM.length) * texture.height;
    context.drawImage(
      texture, 0, sourceY, texture.width, sourceHeight,
      left * scale, (panel.y + localStart) * scale,
      width * scale, (localEnd - localStart) * scale,
    );
  }
  context.restore();
}

function drawPanelGuides(context, panel) {
  const label = (text, x, y, alignment = 'left') => {
    context.textAlign = alignment;
    context.fillText(text, x, y);
  };
  context.fillStyle = '#25282a';
  context.font = '600 5px sans-serif';
  label(`${panel.label} · ${panel.id === 'upper' ? '肩 → 肘' : '肘 → 手首'}`, panel.centerX, 13, 'center');
  context.font = '3.4px sans-serif';
  label(`長さ ${panel.height} mm / 最大周長 ${panel.width} mm`, panel.centerX, 21, 'center');
  label('切れ目 L · 内側', panel.x + 1, 30);
  label('切れ目 R · 内側', panel.x + panel.width - 1, 30, 'right');

  context.strokeStyle = '#899093';
  context.lineWidth = 0.3;
  context.setLineDash([2, 2]);
  context.beginPath();
  for (const u of [0, 1]) {
    for (let local = 0; local <= panel.height; local += 1) {
      const width = circumferenceAt(panel.startMm + local);
      const x = panel.centerX + (u === 0 ? -width / 2 : width / 2);
      const y = panel.y + local;
      if (local === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  context.stroke();
  context.setLineDash([]);

  // Endpoint ticks leave the artwork unobscured while identifying the cut.
  for (const local of [0, panel.height]) {
    const width = circumferenceAt(panel.startMm + local);
    const y = panel.y + local;
    context.beginPath();
    context.moveTo(panel.centerX - width / 2 - 2, y);
    context.lineTo(panel.centerX - width / 2 + 2, y);
    context.moveTo(panel.centerX + width / 2 - 2, y);
    context.lineTo(panel.centerX + width / 2 + 2, y);
    context.stroke();
  }
  context.fillStyle = '#25282a';
  const endpoint = panel.id === 'upper' ? `肘 · 肩から ${ARM.elbow} mm` : `手首 · 肩から ${ARM.length} mm`;
  label(endpoint, panel.centerX, panel.y + panel.height + 8, 'center');
  if (panel.id === 'forearm') {
    context.font = '3px sans-serif';
    label(`上端は肘 · 肩から ${ARM.elbow} mm`, panel.centerX, panel.y - 2, 'center');
  }
}

/**
 * Approximate tapered wrap stencil. Artwork alone is mirrored; all labels stay
 * readable. The transparent drawing canvas is composited onto white paper.
 * scale is pixels per mm (3 for preview, 300/25.4 for a 300 DPI export).
 */
export function renderStencil(textureCanvas, { scale = 3, mirror = false, guides = true } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Stencil scale must be positive.');
  if (!textureCanvas || textureCanvas.width <= 0 || textureCanvas.height <= 0) {
    throw new TypeError('A nonempty drawing canvas is required.');
  }
  const layout = stencilDimensions();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the stencil canvas.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  for (const panel of layout.panels) drawArtwork(context, textureCanvas, panel, scale, mirror);

  if (guides) {
    context.save();
    context.scale(scale, scale);
    for (const panel of layout.panels) drawPanelGuides(context, panel);
    const rulerY = layout.height - 13;
    context.strokeStyle = '#25282a';
    context.lineWidth = 0.45;
    context.beginPath();
    context.moveTo(MARGIN, rulerY);
    context.lineTo(MARGIN + 50, rulerY);
    for (const x of [MARGIN, MARGIN + 50]) {
      context.moveTo(x, rulerY - 2);
      context.lineTo(x, rulerY + 2);
    }
    context.stroke();
    context.font = '3.4px sans-serif';
    context.fillStyle = '#25282a';
    context.textAlign = 'center';
    context.fillText('50 mm', MARGIN + 25, rulerY - 4);
    context.textAlign = 'left';
    context.fillText('モデル寸法の目安です。実際の腕に合わせて調整してください。', MARGIN + 65, rulerY + 1);
    context.restore();
  }
  return canvas;
}
