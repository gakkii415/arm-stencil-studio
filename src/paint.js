import { ARM, circumferenceAt } from './arm.js';

// A compact operation log makes Undo independent of expensive image snapshots.
export class SurfacePainter {
  constructor(canvas, { deferred = false, model = ARM } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('描画用キャンバスを作成できません。');
    this.operations = [];
    this.active = null;
    this.previous = null;
    this.deferred = deferred;
    this.inkDirty = false;
    this.preview = null;
    this.model = model;
  }

  setModel(model, operations = []) {
    this.model = model;
    this.operations = operations;
    this.active = null;
    this.previous = null;
    this.inkDirty = true;
    this.redrawPreview();
    if (!this.deferred) this.rasterize();
  }

  widthAt(y) {
    return (this.model.widthAt || this.model.circumferenceAt || circumferenceAt)(y);
  }

  attachPreview(canvas) {
    this.preview = { canvas, context: canvas.getContext('2d', { alpha: false }) };
    this.redrawPreview();
  }

  redrawPreview() {
    if (!this.preview) return;
    const { context, canvas } = this.preview;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const operation of this.operations) {
      for (const point of operation.points) this.stampOn(point, operation, canvas, context, true);
    }
  }

  begin(mode, width, color = '#000000') {
    this.active = { mode, width, color, points: [] };
    this.previous = null;
  }

  stamp(point, operation) {
    if (!this.deferred) this.stampOn(point, operation, this.canvas, this.context);
    if (this.preview) this.stampOn(point, operation, this.preview.canvas, this.preview.context, true);
    this.inkDirty = true;
  }

  stampOn(point, operation, canvas, ctx, opaque = false) {
    const radiusX = operation.width / this.widthAt(point.y) * canvas.width / 2;
    const radiusY = operation.width / this.model.length * canvas.height / 2;
    ctx.globalCompositeOperation = !opaque && operation.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = opaque && operation.mode === 'erase' ? '#fff' : (operation.color || '#000000');
    // Repeat on both sides to preserve ink/eraser continuity at the wrap seam.
    for (const offset of this.model.type === 'flat' ? [0] : [-1, 0, 1]) {
      const x = (point.u + offset) * canvas.width;
      if (x + radiusX < 0 || x - radiusX > canvas.width) continue;
      ctx.beginPath();
      ctx.ellipse(x, point.y / this.model.length * canvas.height, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  add(point) {
    if (!this.active) return;
    if (!point) { this.previous = null; return; }
    if (this.previous) {
      const du = point.u - this.previous.u;
      const wrapped = this.model.type === 'flat' ? du : du - Math.round(du);
      const dy = point.y - this.previous.y;
      const length = Math.hypot(wrapped * this.widthAt((point.y + this.previous.y) / 2), dy);
      const steps = Math.max(1, Math.ceil(length / (this.active.width * 0.28)));
      for (let i = 1; i <= steps; i += 1) {
        const u = this.previous.u + wrapped * i / steps;
        const p = { u: this.model.type === 'flat' ? Math.min(1, Math.max(0, u)) : ((u % 1 + 1) % 1), y: this.previous.y + dy * i / steps };
        this.active.points.push(p);
        this.stamp(p, this.active);
      }
    } else {
      this.active.points.push(point);
      this.stamp(point, this.active);
    }
    this.previous = point;
  }

  end() {
    const changed = !!this.active?.points.length;
    if (changed) this.operations.push(this.active);
    this.active = null;
    this.previous = null;
    return changed;
  }

  // A second finger placed immediately must not leave a provisional ink dot.
  cancel() {
    if (!this.active) return false;
    const changed = !!this.active.points.length;
    this.active = null;
    this.previous = null;
    this.inkDirty = true;
    this.redrawPreview();
    if (!this.deferred) this.rasterize();
    return changed;
  }

  undo() {
    if (!this.operations.length) return false;
    this.operations.pop();
    this.inkDirty = true;
    this.redrawPreview();
    if (!this.deferred) this.rasterize();
    return true;
  }

  // Keep full-resolution work off the input/render path. Only conversion needs it.
  rasterize() {
    if (!this.inkDirty) return this.canvas;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const operation of this.active ? [...this.operations, this.active] : this.operations) {
      for (const point of operation.points) this.stampOn(point, operation, this.canvas, this.context);
    }
    this.inkDirty = false;
    return this.canvas;
  }
}
