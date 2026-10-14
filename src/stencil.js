import { ARM, circumferenceAt } from './arm.js';

const MARGIN = 14;
const GAP = 24;
const TOP = 44;
const FOOTER = 44;

function widthAt(model, distance) {
  const width = model.type === 'flat'
    ? model.width
    : model.widthAt?.(distance) ?? model.circumferenceAt?.(distance) ?? circumferenceAt(distance);
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('Stencil width must be positive.');
  return width;
}

function maximumWidth(model, startMm, endMm) {
  let maximum = 0;
  for (let distance = startMm; distance <= endMm; distance += 1) {
    maximum = Math.max(maximum, widthAt(model, distance));
  }
  return Math.max(maximum, widthAt(model, endMm));
}

function panelDefinitions(model) {
  if (model.panels?.length) return model.panels;
  if (model.type === 'flat') {
    return [{ id: 'back', label: model.label ?? '背中', startMm: 0, endMm: model.length, startLabel: '肩上部', endLabel: '腰' }];
  }
  const split = model.split ?? model.elbow ?? ARM.elbow;
  const leg = model.part === 'leg';
  return [
    { id: leg ? 'thigh' : 'upper', label: leg ? '太もも' : '上腕', startMm: 0, endMm: split, startLabel: leg ? '股関節' : '肩', endLabel: leg ? '膝' : '肘' },
    { id: leg ? 'shin' : 'forearm', label: leg ? 'すね' : '前腕', startMm: split, endMm: model.length, startLabel: leg ? '膝' : '肘', endLabel: leg ? '足首' : '手首' },
  ];
}

/** Physical layout dimensions in mm, independent of canvas resolution. */
export function stencilDimensions(model = ARM) {
  if (!Number.isFinite(model.length) || model.length <= 0) throw new RangeError('Model length must be positive.');
  let nextX = MARGIN;
  const panels = panelDefinitions(model).map((panel) => {
    if (!Number.isFinite(panel.startMm) || !Number.isFinite(panel.endMm)
      || panel.startMm < 0 || panel.endMm > model.length || panel.endMm <= panel.startMm) {
      throw new RangeError('Stencil panel must be within the model length.');
    }
    const width = maximumWidth(model, panel.startMm, panel.endMm);
    const result = { ...panel, x: nextX, width, y: TOP, height: panel.endMm - panel.startMm, centerX: nextX + width / 2 };
    nextX += width + GAP;
    return result;
  });
  return {
    width: nextX - GAP + MARGIN,
    height: TOP + Math.max(...panels.map((panel) => panel.height)) + FOOTER,
    panels,
  };
}

/**
 * Map normalized u and distance from the model top to the flat stencil.
 * A shared section boundary belongs to the lower panel by default. Pass its
 * section id to obtain the matching lower edge of the upper panel.
 * The seam stays split into two page edges; u=1 must not wrap back to u=0.
 */
export function projectStencilPoint(u, yMm, { model = ARM, mirror = false, section } = {}) {
  if (!Number.isFinite(u) || !Number.isFinite(yMm)) {
    throw new TypeError('Stencil coordinates must be finite.');
  }
  const distance = Math.min(model.length, Math.max(0, yMm));
  const layout = stencilDimensions(model);
  const panel = section
    ? layout.panels.find((item) => item.id === section)
    : layout.panels.find((item, index) => distance >= item.startMm
      && (distance < item.endMm || (index === layout.panels.length - 1 && distance === item.endMm)));
  if (!panel || distance < panel.startMm || distance > panel.endMm) {
    throw new RangeError('Distance is outside the requested stencil section.');
  }
  const normalizedU = Math.min(1, Math.max(0, u));
  const width = widthAt(model, distance);
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

function drawArtwork(context, texture, panel, model, scale, mirror) {
  context.save();
  if (mirror) {
    context.translate(panel.centerX * scale * 2, 0);
    context.scale(-1, 1);
  }
  if (model.type === 'flat') {
    context.drawImage(
      texture, 0, panel.startMm / model.length * texture.height, texture.width, panel.height / model.length * texture.height,
      panel.x * scale, panel.y * scale, panel.width * scale, panel.height * scale,
    );
  } else {
    // GPU canvases antialias fractional one-pixel destination rows separately,
    // mixing solid ink with white at every row boundary. Keep full rows on the
    // pixel grid and preserve the original physical lower edge in the last row.
    const outputTop = Math.round(panel.y * scale);
    const outputBottom = (panel.y + panel.height) * scale;
    const outputHeight = outputBottom - outputTop;
    const rows = Math.ceil(outputHeight);
    for (let row = 0; row < rows; row += 1) {
      const rowEnd = Math.min(outputHeight, row + 1);
      const localStart = row / outputHeight * panel.height;
      const localEnd = rowEnd / outputHeight * panel.height;
      const distance = panel.startMm + (localStart + localEnd) / 2;
      const width = widthAt(model, distance);
      const left = panel.centerX - width / 2;
      const sourceY = ((panel.startMm + localStart) / model.length) * texture.height;
      const sourceHeight = ((localEnd - localStart) / model.length) * texture.height;
      context.drawImage(
        texture, 0, sourceY, texture.width, sourceHeight,
        left * scale, outputTop + row,
        width * scale, rowEnd - row,
      );
    }
  }
  context.restore();
}

function drawPanelGuides(context, panel, model, originLabel) {
  const label = (text, x, y, alignment = 'left') => {
    context.textAlign = alignment;
    context.fillText(text, x, y);
  };
  context.fillStyle = '#25282a';
  context.font = '600 5px sans-serif';
  label(`${panel.label} · ${panel.startLabel} → ${panel.endLabel}`, panel.centerX, 22, 'center');
  context.font = '3.4px sans-serif';
  const format = (value) => String(Math.round(value * 10) / 10);
  label(`長さ ${format(panel.height)} mm / ${model.type === 'flat' ? '幅' : '最大周長'} ${format(panel.width)} mm`, panel.centerX, 30, 'center');
  if (model.type === 'flat') {
    label(panel.startLabel, panel.centerX, 38, 'center');
  } else {
    label('切れ目 L · 内側', panel.x + 1, 38);
    label('切れ目 R · 内側', panel.x + panel.width - 1, 38, 'right');
  }

  context.strokeStyle = '#899093';
  context.lineWidth = 0.3;
  context.setLineDash([2, 2]);
  context.beginPath();
  for (const u of [0, 1]) {
    for (let sample = 0; sample <= Math.ceil(panel.height); sample += 1) {
      const local = Math.min(sample, panel.height);
      const width = widthAt(model, panel.startMm + local);
      const x = panel.centerX + (u === 0 ? -width / 2 : width / 2);
      const y = panel.y + local;
      if (local === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  if (model.type === 'flat') {
    for (const y of [panel.y, panel.y + panel.height]) {
      context.moveTo(panel.x, y);
      context.lineTo(panel.x + panel.width, y);
    }
  }
  context.stroke();
  context.setLineDash([]);

  // Endpoint ticks leave the artwork unobscured while identifying the cut.
  for (const local of [0, panel.height]) {
    const width = widthAt(model, panel.startMm + local);
    const y = panel.y + local;
    context.beginPath();
    context.moveTo(panel.centerX - width / 2 - 2, y);
    context.lineTo(panel.centerX - width / 2 + 2, y);
    context.moveTo(panel.centerX + width / 2 - 2, y);
    context.lineTo(panel.centerX + width / 2 + 2, y);
    context.stroke();
  }
  context.fillStyle = '#25282a';
  label(`${panel.endLabel} · ${originLabel}から ${format(panel.endMm)} mm`, panel.centerX, panel.y + panel.height + 8, 'center');
}

/**
 * Approximate wrap or rectangular stencil. Artwork alone is mirrored; all
 * labels stay readable. Transparent color artwork is composited onto white.
 * scale is pixels per mm (3 for preview, 300/25.4 for a 300 DPI export).
 */
export function renderStencil(textureCanvas, { model = ARM, scale = 3, mirror = false, guides = true } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Stencil scale must be positive.');
  if (!textureCanvas || textureCanvas.width <= 0 || textureCanvas.height <= 0) {
    throw new TypeError('A nonempty drawing canvas is required.');
  }
  const layout = stencilDimensions(model);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the stencil canvas.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  for (const panel of layout.panels) drawArtwork(context, textureCanvas, panel, model, scale, mirror);

  if (guides) {
    context.save();
    context.scale(scale, scale);
    context.font = '600 6px sans-serif';
    context.fillStyle = '#25282a';
    context.textAlign = 'left';
    context.fillText([model.sexLabel, model.label ?? '腕'].filter(Boolean).join(' · '), MARGIN, 10);
    for (const panel of layout.panels) drawPanelGuides(context, panel, model, layout.panels[0].startLabel);
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
    context.fillText('参考モデルの近似型紙です。紙で仮合わせしてください。', MARGIN + 65, rulerY + 1);
    context.restore();
  }
  return canvas;
}
