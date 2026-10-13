import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { installTouchControls } from '../src/touch-controls.js';

class EventTargetFake {
  listeners = new Map();

  addEventListener(name, listener, options = false) {
    const handlers = this.listeners.get(name) || [];
    handlers.push({ listener, capture: typeof options === 'boolean' ? options : !!options.capture });
    this.listeners.set(name, handlers);
  }

  removeEventListener(name, listener, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(name, (this.listeners.get(name) || []).filter((handler) => handler.listener !== listener || handler.capture !== capture));
  }

  emit(name, event, capture) {
    for (const handler of this.listeners.get(name) || []) {
      if (handler.capture !== capture) continue;
      handler.listener(event);
      if (event.stopped) break;
    }
  }
}

class CanvasFake extends EventTargetFake {
  ownerDocument = new EventTargetFake();
  clientHeight = 600;
  captures = new Set();

  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
    this.dispatch('lostpointercapture', pointerId);
  }

  dispatch(name, pointerId, x = 0, y = 0, timeStamp = 0, pointerType = 'touch', outside = false) {
    const event = {
      pointerId, clientX: x, clientY: y, timeStamp, pointerType,
      target: outside ? {} : this,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    this.ownerDocument.emit(name, event, true);
    if (!outside && !event.stopped) this.emit(name, event, true);
    if (!outside && !event.stopped) this.emit(name, event, false);
    return event;
  }
}

function fixture(initialMode = 'draw') {
  const element = new CanvasFake();
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 1000);
  const controls = {
    target: new Vector3(30, 20, -10),
    minDistance: 390, maxDistance: 2500,
    minPolarAngle: 0, maxPolarAngle: Math.PI,
    enableRotate: true, enableZoom: true,
    updates: 0,
    update() { this.updates += 1; },
  };
  let mode = initialMode;
  const gestures = [];
  const bubbled = [];
  let changed = 0;
  let paintingId = null;
  let lostWhilePainting = 0;
  const controller = installTouchControls({
    element, camera, controls, getMode: () => mode,
    onGestureStart(detail) {
      gestures.push(detail);
      // Paint releases its pointer only after clearing its active stroke ID.
      const oldId = paintingId;
      paintingId = null;
      if (oldId !== null && element.hasPointerCapture(oldId)) element.releasePointerCapture(oldId);
    },
    onChange() { changed += 1; },
  });
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    element.addEventListener(name, (event) => {
      bubbled.push([name, event.pointerId]);
      if (name === 'pointerdown' && event.pointerType === 'touch') paintingId = event.pointerId;
      if (name === 'pointerup' || name === 'pointercancel') paintingId = null;
    });
  }
  element.addEventListener('lostpointercapture', (event) => {
    if (paintingId === event.pointerId) { lostWhilePainting += 1; paintingId = null; }
  });
  return {
    element, camera, controls, gestures, bubbled, controller,
    get changed() { return changed; },
    get lostWhilePainting() { return lostWhilePainting; },
    setMode(next) { mode = next; controller.reset(); },
    distance() { return camera.position.distanceTo(controls.target); },
  };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should be ${expected}`);

test('two finger translation rotates, cancels a provisional dot, and suppresses the remaining finger', () => {
  const state = fixture();
  const { element } = state;
  const before = state.camera.position.clone();
  const distance = state.distance();
  assert.equal(element.dispatch('pointerdown', 1, 100, 100, 10).stopped, false);
  assert.equal(element.dispatch('pointerdown', 2, 200, 100, 50).stopped, true);
  assert.deepEqual(state.gestures, [{ cancelStroke: true }]);
  assert.equal(state.lostWhilePainting, 0);
  assert.deepEqual([...element.captures], [1, 2]);
  element.dispatch('pointermove', 1, 140, 120, 60);
  element.dispatch('pointermove', 2, 240, 120, 65);
  assert.ok(before.distanceTo(state.camera.position) > 100);
  near(state.distance(), distance);
  assert.equal(state.changed, 2);
  element.dispatch('pointerup', 2, 240, 120, 70);
  const after = state.camera.position.clone();
  assert.equal(element.dispatch('pointermove', 1, 180, 200, 75).stopped, true);
  assert.deepEqual(state.camera.position, after);
  element.dispatch('pointerup', 1, 180, 200, 80);
  assert.equal(element.captures.size, 0);
  assert.equal(element.dispatch('pointerdown', 3, 110, 150, 90).stopped, false);
  assert.equal(element.dispatch('pointermove', 3, 120, 170, 100).stopped, false);
  assert.deepEqual(state.bubbled, [['pointerdown', 1], ['pointerdown', 3], ['pointermove', 3]]);
});

test('second finger preserves deliberate strokes including an excursion that returns to its start', () => {
  for (const mode of ['draw', 'erase']) {
    const state = fixture(mode);
    state.element.dispatch('pointerdown', 1, 100, 100, 0);
    state.element.dispatch('pointermove', 1, 109, 100, 20);
    state.element.dispatch('pointermove', 1, 100, 100, 30);
    state.element.dispatch('pointerdown', 2, 200, 100, 40);
    assert.deepEqual(state.gestures, [{ cancelStroke: false }]);
  }
  const held = fixture();
  held.element.dispatch('pointerdown', 1, 100, 100, 0);
  held.element.dispatch('pointerdown', 2, 200, 100, 181);
  assert.deepEqual(held.gestures, [{ cancelStroke: false }]);
});

test('pinch changes camera distance around the existing target and respects distance and polar limits', () => {
  const state = fixture();
  const { element, controls } = state;
  const target = controls.target.clone();
  const initialDistance = state.distance();
  element.dispatch('pointerdown', 1, 100, 100, 0);
  element.dispatch('pointerdown', 2, 200, 100, 20);
  element.dispatch('pointermove', 2, 300, 100, 30);
  near(state.distance(), initialDistance / 2);
  element.dispatch('pointermove', 2, 1100, 100, 40);
  near(state.distance(), controls.minDistance);
  element.dispatch('pointermove', 2, 101, 100, 50);
  near(state.distance(), controls.maxDistance);
  controls.minPolarAngle = 0.4;
  controls.maxPolarAngle = 2.6;
  element.dispatch('pointermove', 1, 100, 10000, 60);
  const offset = state.camera.position.clone().sub(controls.target);
  const phi = Math.acos(offset.y / offset.length());
  assert.ok(phi >= controls.minPolarAngle - 1e-10 && phi <= controls.maxPolarAngle + 1e-10);
  assert.deepEqual(controls.target, target);
  assert.ok(controls.updates > 0);
});

test('view mode owns the first finger; touch never seeds OrbitControls while mouse and pen pass through', () => {
  const state = fixture('view');
  const { element } = state;
  const initial = state.camera.position.clone();
  assert.equal(element.dispatch('pointerdown', 1, 100, 100).stopped, true);
  assert.equal(element.dispatch('pointermove', 1, 160, 130).stopped, true);
  assert.ok(state.camera.position.distanceTo(initial) > 100);
  element.dispatch('pointerup', 1, 160, 130);
  assert.deepEqual(state.gestures, []);
  assert.deepEqual(state.bubbled, []);
  for (const pointerType of ['mouse', 'pen']) {
    for (const name of ['pointerdown', 'pointermove', 'pointerup']) {
      const event = element.dispatch(name, 20, 200, 200, 0, pointerType);
      assert.equal(event.stopped, false);
      assert.equal(event.prevented, false);
    }
  }
  assert.equal(state.bubbled.length, 6);
});

test('cancel and mode reset release captures and allow drawing after every old finger lifts outside canvas', () => {
  const state = fixture();
  const { element } = state;
  element.dispatch('pointerdown', 1, 100, 100);
  element.dispatch('pointerdown', 2, 200, 100);
  state.setMode('erase');
  assert.equal(element.captures.size, 0);
  const before = state.camera.position.clone();
  assert.equal(element.dispatch('pointermove', 1, 150, 200).stopped, true);
  element.dispatch('pointercancel', 2, 200, 100, 0, 'touch', true);
  assert.equal(element.dispatch('pointermove', 1, 200, 300).stopped, true);
  element.dispatch('pointerup', 1, 200, 300, 0, 'touch', true);
  assert.deepEqual(state.camera.position, before);
  assert.equal(element.dispatch('pointerdown', 3, 100, 100).stopped, false);
  element.dispatch('pointercancel', 3, 100, 100);
  assert.equal(element.captures.size, 0);
  assert.equal(element.dispatch('pointerdown', 4, 100, 100).stopped, false);
});

test('lost capture does not end a navigation gesture; dispose removes capture and all observers', () => {
  const state = fixture('view');
  const { element, controller } = state;
  element.dispatch('pointerdown', 1, 100, 100);
  element.dispatch('pointerdown', 2, 200, 100);
  element.releasePointerCapture(1);
  element.dispatch('pointermove', 1, 130, 100);
  assert.equal(state.changed, 1);
  controller.dispose();
  assert.equal(element.captures.size, 0);
  assert.ok([...element.ownerDocument.listeners.values()].every((handlers) => handlers.length === 0));
  assert.equal(element.dispatch('pointermove', 2, 230, 100).stopped, false);
  assert.equal(element.dispatch('pointerdown', 3, 100, 100).stopped, false);
});
