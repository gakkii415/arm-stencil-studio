import { ARM, circumferenceAt } from './arm.js';

// A compact operation log makes Undo independent of expensive image snapshots.
export class SurfacePainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('描画用キャンバスを作成できません。');
    this.operations = [];
    this.active = null;
    this.previous = null;
  }

  begin(mode, width) {
    this.active = { mode, width, points: [] };
    this.previous = null;
  }

  stamp(point, operation) {
    const { context: ctx, canvas } = this;
    const radiusX = operation.width / circumferenceAt(point.y) * canvas.width / 2;
    const radiusY = operation.width / ARM.length * canvas.height / 2;
    ctx.globalCompositeOperation = operation.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#000';
    // Repeat on both sides to preserve ink/eraser continuity at the wrap seam.
    for (const offset of [-1, 0, 1]) {
      const x = (point.u + offset) * canvas.width;
      if (x + radiusX < 0 || x - radiusX > canvas.width) continue;
      ctx.beginPath();
      ctx.ellipse(x, point.y / ARM.length * canvas.height, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  add(point) {
    if (!this.active) return;
    if (!point) { this.previous = null; return; }
    if (this.previous) {
      const du = point.u - this.previous.u;
      const wrapped = du - Math.round(du);
      const dy = point.y - this.previous.y;
      const length = Math.hypot(wrapped * circumferenceAt((point.y + this.previous.y) / 2), dy);
      const steps = Math.max(1, Math.ceil(length / (this.active.width * 0.28)));
      for (let i = 1; i <= steps; i += 1) {
        const p = { u: ((this.previous.u + wrapped * i / steps) % 1 + 1) % 1, y: this.previous.y + dy * i / steps };
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

  undo() {
    if (!this.operations.length) return false;
    this.operations.pop();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const operation of this.operations) {
      for (const point of operation.points) this.stamp(point, operation);
    }
    return true;
  }
}
