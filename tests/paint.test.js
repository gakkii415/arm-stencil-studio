import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfacePainter } from '../src/paint.js';

function canvas(width = 1000, height = 2000) {
  const calls = [];
  const context = {
    calls,
    clearRect() { calls.length = 0; },
    fillRect() { calls.length = 0; },
    beginPath() {},
    ellipse(...args) { this.ellipseArgs = args; },
    fill() { calls.push({ color: this.fillStyle, composite: this.globalCompositeOperation, ellipse: this.ellipseArgs }); },
  };
  return { width, height, getContext: () => context };
}

const wrap = { type: 'wrap', length: 500, widthAt: () => 200 };
const flat = { type: 'flat', length: 600, widthAt: () => 300 };

test('colored history produces matching preview and full-resolution ink, including erase and Undo', () => {
  const ink = canvas();
  const preview = canvas(500, 1000);
  const painter = new SurfacePainter(ink, { deferred: true, model: wrap });
  painter.attachPreview(preview);
  for (const color of ['#000000', '#52b9e8', '#f28c3a']) {
    painter.begin('draw', 2.5, color);
    painter.add({ u: 0.5, y: 250 });
    painter.end();
  }
  assert.deepEqual(preview.getContext().calls.map((call) => call.color), ['#000000', '#52b9e8', '#f28c3a']);
  assert.equal(ink.getContext().calls.length, 0, 'high-resolution work stays off the drawing path');
  painter.rasterize();
  assert.deepEqual(ink.getContext().calls.map((call) => call.color), ['#000000', '#52b9e8', '#f28c3a']);
  assert.deepEqual(ink.getContext().calls[0].ellipse.slice(2, 4), [6.25, 5], '2.5mm remains physical on both axes');
  painter.begin('erase', 10);
  painter.add({ u: 0.5, y: 250 });
  painter.end();
  assert.equal(preview.getContext().calls.at(-1).color, '#fff');
  painter.rasterize();
  assert.equal(ink.getContext().calls.at(-1).composite, 'destination-out');
  painter.undo();
  assert.equal(preview.getContext().calls.at(-1).color, '#f28c3a');
  painter.rasterize();
  assert.equal(ink.getContext().calls.at(-1).color, '#f28c3a');
});

test('navigation cancels the provisional stroke and restores prior colors without an Undo entry', () => {
  const ink = canvas();
  const preview = canvas();
  const painter = new SurfacePainter(ink, { deferred: true, model: wrap });
  painter.attachPreview(preview);
  painter.begin('draw', 2.5, '#52b9e8');
  painter.add({ u: 0.5, y: 200 });
  painter.end();
  painter.begin('draw', 2.5, '#f28c3a');
  painter.add({ u: 0.6, y: 100 });
  assert.equal(painter.cancel(), true);
  assert.equal(painter.operations.length, 1);
  assert.equal(preview.getContext().calls.length, 1);
  assert.equal(preview.getContext().calls[0].color, '#52b9e8');
  painter.rasterize();
  assert.equal(ink.getContext().calls.length, 1);
});

test('flat backs interpolate across the sheet, wrap models across their seam, and model histories stay separate', () => {
  const painter = new SurfacePainter(canvas(), { deferred: true, model: wrap });
  painter.begin('draw', 2.5);
  painter.add({ u: 0.95, y: 250 });
  painter.add({ u: 0.05, y: 250 });
  painter.end();
  const wrappedHistory = painter.operations;
  assert.ok(wrappedHistory[0].points.every((point) => point.u < 0.1 || point.u > 0.9));
  painter.setModel(flat);
  assert.equal(painter.operations.length, 0);
  painter.begin('draw', 2.5, '#f28c3a');
  painter.add({ u: 0.95, y: 300 });
  painter.add({ u: 0.05, y: 300 });
  painter.end();
  assert.ok(painter.operations[0].points.some((point) => point.u > 0.49 && point.u < 0.51));
  painter.setModel(wrap, wrappedHistory);
  assert.equal(painter.operations, wrappedHistory);
  painter.undo();
  assert.equal(painter.operations.length, 0);
});
