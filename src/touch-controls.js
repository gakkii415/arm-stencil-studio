const FULL_TURN = Math.PI * 2;
const POLAR_EPSILON = 1e-6;
const PROVISIONAL_STROKE_MS = 180;
const PROVISIONAL_STROKE_DISTANCE = 8;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

// Observe painting's first finger, then own navigation until every finger lifts.
// OrbitControls continues to handle mouse/pen and wheel input as before.
export function installTouchControls({ element, camera, controls, getMode, onGestureStart, onChange }) {
  const pointers = new Map();
  const captured = new Set();
  let phase = 'idle';
  let firstTouch = null;
  let previous = null;
  let gestureHeight = 1;
  let disposed = false;

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function capture(pointerId) {
    try {
      element.setPointerCapture(pointerId);
      captured.add(pointerId);
    } catch {
      // A canceled pointer may already have been removed by the browser.
    }
  }

  function release(pointerId) {
    captured.delete(pointerId);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  function sample() {
    const iterator = pointers.values();
    const first = iterator.next().value;
    const second = iterator.next().value;
    return second
      ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, distance: Math.hypot(second.x - first.x, second.y - first.y) }
      : { x: first.x, y: first.y, distance: 0 };
  }

  function startNavigation() {
    phase = 'navigate';
    gestureHeight = Math.max(element.clientHeight || element.getBoundingClientRect().height, 1);
    previous = sample();
    for (const pointerId of pointers.keys()) capture(pointerId);
  }

  function navigate() {
    const next = sample();
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const scale = previous.distance > 0 && next.distance > 0 ? previous.distance / next.distance : 1;
    previous = next;
    if (!dx && !dy && scale === 1) return;

    const target = controls.target;
    const offsetX = camera.position.x - target.x;
    const offsetY = camera.position.y - target.y;
    const offsetZ = camera.position.z - target.z;
    const radius = Math.hypot(offsetX, offsetY, offsetZ);
    if (!radius) return;
    let theta = Math.atan2(offsetX, offsetZ);
    let phi = Math.acos(clamp(offsetY / radius, -1, 1));
    let nextRadius = radius;
    if (controls.enableRotate !== false) {
      const rotation = FULL_TURN * (controls.rotateSpeed ?? 1) / gestureHeight;
      theta -= dx * rotation;
      phi -= dy * rotation;
      phi = clamp(phi, controls.minPolarAngle ?? 0, controls.maxPolarAngle ?? Math.PI);
      phi = clamp(phi, POLAR_EPSILON, Math.PI - POLAR_EPSILON);
    }
    if (controls.enableZoom !== false) {
      nextRadius = clamp(radius * scale ** (controls.zoomSpeed ?? 1), controls.minDistance ?? 0, controls.maxDistance ?? Infinity);
    }
    if (theta === Math.atan2(offsetX, offsetZ)
      && phi === Math.acos(clamp(offsetY / radius, -1, 1)) && nextRadius === radius) return;
    const sinPhiRadius = Math.sin(phi) * nextRadius;
    camera.position.set(
      target.x + sinPhiRadius * Math.sin(theta),
      target.y + Math.cos(phi) * nextRadius,
      target.z + sinPhiRadius * Math.cos(theta),
    );
    camera.lookAt(target);
    controls.update();
    onChange?.();
  }

  function pointerDown(event) {
    if (event.pointerType !== 'touch' || disposed) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (phase === 'wait') {
      capture(event.pointerId);
      consume(event);
      return;
    }
    if (pointers.size === 1) {
      firstTouch = { pointerId: event.pointerId, time: event.timeStamp, x: event.clientX, y: event.clientY, distance: 0 };
      if (getMode() === 'view') {
        startNavigation();
        consume(event);
      } else {
        phase = 'paint';
        // Also observe touches that start outside the paintable arm.
        capture(event.pointerId);
      }
      return;
    }
    consume(event);
    if (phase === 'paint') {
      const cancelStroke = event.timeStamp - firstTouch.time <= PROVISIONAL_STROKE_MS
        && firstTouch.distance < PROVISIONAL_STROKE_DISTANCE;
      onGestureStart?.({ cancelStroke });
    }
    startNavigation();
  }

  function pointerMove(event) {
    if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (phase === 'paint') {
      // Use the greatest excursion, so moving away and back still keeps a stroke.
      firstTouch.distance = Math.max(firstTouch.distance, Math.hypot(event.clientX - firstTouch.x, event.clientY - firstTouch.y));
      return;
    }
    consume(event);
    if (phase === 'navigate') navigate();
  }

  function pointerEnd(event) {
    if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
    const wasPainting = phase === 'paint';
    if (!wasPainting) consume(event);
    pointers.delete(event.pointerId);
    release(event.pointerId);
    previous = null;
    firstTouch = null;
    phase = pointers.size ? 'wait' : 'idle';
  }

  function reset() {
    // Keep existing fingers suppressed across mode/view changes until they lift.
    phase = pointers.size ? 'wait' : 'idle';
    previous = null;
    firstTouch = null;
    for (const pointerId of [...captured]) release(pointerId);
  }

  function outsidePointerEnd(event) {
    // reset() releases capture; the last finger may then lift outside the canvas.
    if (event.target === element || element.contains?.(event.target)) return;
    pointerEnd(event);
  }

  const listeners = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd, pointercancel: pointerEnd };
  for (const [name, listener] of Object.entries(listeners)) element.addEventListener(name, listener, { capture: true, passive: false });
  for (const name of ['pointerup', 'pointercancel']) element.ownerDocument?.addEventListener(name, outsidePointerEnd, { capture: true, passive: false });

  return {
    reset,
    dispose() {
      reset();
      disposed = true;
      pointers.clear();
      for (const [name, listener] of Object.entries(listeners)) element.removeEventListener(name, listener, true);
      for (const name of ['pointerup', 'pointercancel']) element.ownerDocument?.removeEventListener(name, outsidePointerEnd, true);
    },
  };
}
