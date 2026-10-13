import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM, circumferenceAt, createArmGeometry, pointOnArm } from '../src/arm.js';
import { stencilDimensions, projectStencilPoint } from '../src/stencil.js';

function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

test('the reference arm keeps anatomical circumference anchors and a smooth taper', () => {
  near(circumferenceAt(65), 320);
  near(circumferenceAt(ARM.elbow), 250);
  near(circumferenceAt(360), 270);
  near(circumferenceAt(ARM.length), 170);
  for (let y = 0; y < ARM.length; y += 1) {
    assert.ok(circumferenceAt(y) >= 170 && circumferenceAt(y) <= 320);
    assert.ok(Math.abs(circumferenceAt(y + 1) - circumferenceAt(y)) < 1.4);
  }
  near(circumferenceAt(-20), circumferenceAt(0));
  near(circumferenceAt(700), circumferenceAt(ARM.length));
});

test('3D UVs meet at the inside seam and keep the shoulder at the top', () => {
  for (const y of [0, ARM.elbow, ARM.length]) {
    const left = pointOnArm(0, y);
    const right = pointOnArm(1, y);
    assert.ok(left.x < 0);
    near(left.distanceTo(right), 0);
    near(left.y, ARM.shoulderY - y);
  }
  const geometry = createArmGeometry();
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const normals = geometry.getAttribute('normal');
  const lastRing = ARM.lengthSegments * (ARM.radialSegments + 1);
  near(positions.getY(0), 270);
  near(positions.getY(lastRing), -270);
  near(uv.getY(0), 1);
  near(uv.getY(lastRing), 0);
  near(uv.getX(0), 0);
  near(uv.getX(ARM.radialSegments), 1);
  assert.equal(geometry.groups[0].materialIndex, 0);
  assert.equal(geometry.groups[1].materialIndex, 1);
  assert.ok(normals.getX(0) < -0.9, 'side normals point outward');
  near(normals.getX(0), normals.getX(ARM.radialSegments));
  near(normals.getZ(0), normals.getZ(ARM.radialSegments));
  geometry.dispose();
});

test('each stencil row has the physical circumference and a fixed panel center', () => {
  const layout = stencilDimensions();
  assert.equal(layout.panels[0].height + layout.panels[1].height, ARM.length);
  assert.equal(layout.panels[0].width, 320);
  assert.equal(layout.panels[1].width, 270);
  for (const y of [0, 65, 230, 280, 360, 540]) {
    const left = projectStencilPoint(0, y);
    const middle = projectStencilPoint(0.5, y);
    const right = projectStencilPoint(1, y);
    const panel = layout.panels.find((item) => item.id === middle.section);
    near(right.x - left.x, circumferenceAt(y));
    near(middle.x, panel.centerX);
    near(middle.y, panel.y + y - panel.startMm);
  }
});

test('the elbow is one shared arm location and two separate stencil edges', () => {
  const layout = stencilDimensions();
  const upperEdge = projectStencilPoint(0.5, ARM.elbow, { section: 'upper' });
  const forearmEdge = projectStencilPoint(0.5, ARM.elbow);
  assert.equal(upperEdge.section, 'upper');
  assert.equal(forearmEdge.section, 'forearm');
  near(upperEdge.y, layout.panels[0].y + layout.panels[0].height);
  near(forearmEdge.y, layout.panels[1].y);
  near(upperEdge.width, forearmEdge.width);
  assert.equal(projectStencilPoint(0.5, ARM.elbow - 0.01).section, 'upper');
  assert.throws(() => projectStencilPoint(0.5, 281, { section: 'upper' }), RangeError);
});

test('mirroring exchanges seam edges without moving the center or elbow', () => {
  for (const y of [0, 150, ARM.elbow, 470, ARM.length]) {
    const left = projectStencilPoint(0, y);
    const right = projectStencilPoint(1, y);
    const mirroredLeft = projectStencilPoint(0, y, { mirror: true });
    const normal = projectStencilPoint(0.23, y);
    const mirrored = projectStencilPoint(0.23, y, { mirror: true });
    near(mirroredLeft.x, right.x);
    near(normal.x + mirrored.x, normal.centerX * 2);
    near(normal.y, mirrored.y);
    assert.ok(right.x > left.x, 'the two seam ends remain distinct on paper');
  }
});
