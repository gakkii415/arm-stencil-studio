import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARM, ARM_MODEL_URL, circumferenceAt } from '../src/arm.js';
import { stencilDimensions, projectStencilPoint } from '../src/stencil.js';

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

const glb = readFileSync(new URL(ARM_MODEL_URL));
assert.equal(glb.toString('ascii', 0, 4), 'glTF');
assert.equal(glb.readUInt32LE(4), 2);
assert.equal(glb.readUInt32LE(8), glb.length);
const jsonLength = glb.readUInt32LE(12);
assert.equal(glb.toString('ascii', 16, 20), 'JSON');
const document = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
const binHeader = 20 + jsonLength;
assert.equal(glb.toString('ascii', binHeader + 4, binHeader + 8), 'BIN\0');
const binaryOffset = binHeader + 8;

function accessor(index) {
  const value = document.accessors[index];
  assert.ok(!value.sparse, 'the standard asset has no sparse accessors');
  const view = document.bufferViews[value.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[value.type];
  const bytes = value.componentType === 5123 ? 2 : 4;
  const stride = view.byteStride ?? components * bytes;
  const start = binaryOffset + (view.byteOffset ?? 0) + (value.byteOffset ?? 0);
  const reader = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE' }[value.componentType];
  assert.ok(reader && components, 'supported, uncompressed standard accessor');
  return Array.from({ length: value.count }, (_, row) => Array.from({ length: components }, (_, column) => glb[reader](start + row * stride + column * bytes)));
}

const meshes = document.nodes.map((node) => {
  assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, 'mm positions are baked with identity node transforms');
  const primitive = document.meshes[node.mesh].primitives[0];
  assert.equal(primitive.mode, 4);
  const positions = accessor(primitive.attributes.POSITION);
  const normals = accessor(primitive.attributes.NORMAL);
  const uv = accessor(primitive.attributes.TEXCOORD_0);
  const indices = accessor(primitive.indices).map(([index]) => index);
  assert.equal(positions.length, uv.length);
  assert.equal(indices.length % 3, 0);
  assert.ok(indices.every((index) => index >= 0 && index < positions.length));
  return { name: node.name, paintable: node.extras.paintable, positions, normals, uv, indices };
});
const paintable = meshes.find((mesh) => mesh.name === 'paintable');
const context = meshes.find((mesh) => mesh.name === 'context');

function triangles(mesh) {
  const result = [];
  for (let i = 0; i < mesh.indices.length; i += 3) result.push(mesh.indices.slice(i, i + 3));
  return result;
}

function sliceSegments(y, meshList = meshes) {
  const segments = [];
  for (const mesh of meshList) {
    for (const indices of triangles(mesh)) {
      const points = indices.map((index) => mesh.positions[index]);
      if (Math.min(...points.map((p) => p[1])) > y || Math.max(...points.map((p) => p[1])) < y) continue;
      const cuts = [];
      for (let i = 0; i < 3; i += 1) {
        const a = points[i], b = points[(i + 1) % 3];
        if ((a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1])) {
          const t = (y - a[1]) / (b[1] - a[1]);
          cuts.push([a[0] + t * (b[0] - a[0]), a[2] + t * (b[2] - a[2])]);
        }
      }
      if (cuts.length === 2) segments.push(cuts);
    }
  }
  return segments;
}

function measuredPerimeter(y, meshList = meshes) {
  // Independent plane/triangle intersections of the shipped GLB; neither the
  // generator's contour ordering nor the saved profile is reused here.
  return sliceSegments(y, meshList).reduce((sum, [a, b]) => sum + Math.hypot(a[0] - b[0], a[1] - b[1]), 0);
}

test('the shipped GLB retains scan provenance, natural anatomy, and context hand', () => {
  assert.equal(document.asset.extras.author, 'Dan Ulrich');
  assert.equal(document.asset.extras.license, 'CC0-1.0');
  assert.equal(document.asset.extras.sourceObject, 'GEO-body_male_realistic');
  assert.equal(paintable.paintable, true);
  assert.equal(context.paintable, false);
  assert.ok(paintable.indices.length / 3 > 15000, 'source sculpt detail is retained');
  assert.ok(context.indices.length / 3 > 20000, 'original detailed hand/fingers remain');
  assert.ok(Math.min(...context.positions.map((p) => p[1])) < -400, 'hand extends beyond the wrist');
  assert.ok(Math.max(...context.positions.map((p) => p[1])) > 300, 'source shoulder context remains');
  const upperXs = paintable.positions.filter((p) => p[1] > 50 && p[1] < 70).map((p) => p[0]);
  const elbowXs = paintable.positions.filter((p) => p[1] > -25 && p[1] < -10).map((p) => p[0]);
  assert.ok(Math.max(...upperXs) - Math.min(...upperXs) > Math.max(...elbowXs) - Math.min(...elbowXs), 'the original muscular taper is preserved');
});

test('all drawable UVs match shoulder/wrist distances and exclude context regions', () => {
  near(Math.max(...paintable.positions.map((p) => p[1])), 270, 1e-4);
  near(Math.min(...paintable.positions.map((p) => p[1])), -270, 1e-4);
  for (let i = 0; i < paintable.positions.length; i += 1) {
    const position = paintable.positions[i], uv = paintable.uv[i];
    assert.ok(position.every(Number.isFinite) && uv.every(Number.isFinite));
    assert.ok(uv[0] >= -1e-7 && uv[0] <= 1 + 1e-7);
    assert.ok(uv[1] >= -1e-7 && uv[1] <= 1 + 1e-7);
    near(uv[1], (position[1] + 270) / 540, 1e-6);
  }
});

test('the original shoulder opening is capped with outward triangle winding', () => {
  // The added fan is flat shaded; the artist's shoulder is smooth shaded.
  const cap = triangles(context).filter((indices) =>
    indices.every((i) => context.positions[i][1] > 150)
    && indices.every((i) => context.normals[i].every((value, axis) => Math.abs(value - context.normals[indices[0]][axis]) < 1e-7)));
  assert.equal(cap.length, 128, 'every original shoulder border edge has a cap triangle');
  for (const indices of cap) {
    const [a, b, c] = indices.map((i) => context.positions[i]);
    const ab = b.map((value, i) => value - a[i]);
    const ac = c.map((value, i) => value - a[i]);
    const geometricNormal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    assert.ok(geometricNormal[0] < 0, 'cap fronts face the body-facing opening, rather than being culled');
    assert.ok(context.normals[indices[0]][0] < 0, 'outward cap shading agrees with winding');
  }
});

test('the tilted source wrist border does not leave a gap before the horizontal wrist cut', () => {
  for (const y of [-260, -265, -269.9]) {
    near(measuredPerimeter(y, [paintable]), measuredPerimeter(y), 0.01);
  }
});

test('seam triangles are split, with coincident u=0/1 edges on the inside', () => {
  for (const indices of triangles(paintable)) {
    const values = indices.map((index) => paintable.uv[index][0]);
    assert.ok(Math.max(...values) - Math.min(...values) < 0.5, 'no triangle interpolates across the texture wrap');
  }
  const edgeKey = (p) => p.map((v) => v.toFixed(3)).join(',');
  const left = new Map(), right = new Map();
  for (let i = 0; i < paintable.uv.length; i += 1) {
    if (Math.abs(paintable.uv[i][0]) < 1e-7) left.set(edgeKey(paintable.positions[i]), paintable.positions[i]);
    if (Math.abs(paintable.uv[i][0] - 1) < 1e-7) right.set(edgeKey(paintable.positions[i]), paintable.positions[i]);
  }
  assert.ok(left.size > 100 && right.size > 100, 'the scan has an explicit longitudinal UV split');
  for (const [key, position] of left) {
    assert.ok(right.has(key), 'both paper edges share exactly the same 3D seam');
    assert.ok(position[0] < 0, 'the seam is on the body-facing negative X side');
  }
});

test('reference circumferences come from independent intersections of the actual GLB', () => {
  for (const distance of [0.01, 25, 100, 200, 285, 350, 450, 535]) {
    near(circumferenceAt(distance), measuredPerimeter(ARM.shoulderY - distance), 0.8);
  }
  assert.equal(ARM.length, 540);
  assert.equal(ARM.elbow, 287);
  near(ARM.source.sourceElbowDistanceMm, 286.8022, 0.001);
  assert.ok(circumferenceAt(350) > circumferenceAt(ARM.elbow), 'source forearm muscle belly remains');
  assert.ok(circumferenceAt(ARM.elbow) > circumferenceAt(540));
});

test('each stencil row uses measured circumference and a fixed panel center', () => {
  const layout = stencilDimensions();
  assert.equal(layout.panels[0].height + layout.panels[1].height, ARM.length);
  for (const y of [0, 65, 230, ARM.elbow, 360, 540]) {
    const left = projectStencilPoint(0, y);
    const middle = projectStencilPoint(0.5, y);
    const right = projectStencilPoint(1, y);
    const panel = layout.panels.find((item) => item.id === middle.section);
    near(right.x - left.x, circumferenceAt(y));
    near(middle.x, panel.centerX);
    near(middle.y, panel.y + y - panel.startMm);
  }
});

test('the measured elbow is one arm location and two separate stencil edges', () => {
  const layout = stencilDimensions();
  const upperEdge = projectStencilPoint(0.5, ARM.elbow, { section: 'upper' });
  const forearmEdge = projectStencilPoint(0.5, ARM.elbow);
  assert.equal(upperEdge.section, 'upper');
  assert.equal(forearmEdge.section, 'forearm');
  near(upperEdge.y, layout.panels[0].y + layout.panels[0].height);
  near(forearmEdge.y, layout.panels[1].y);
  near(upperEdge.width, forearmEdge.width);
  assert.throws(() => projectStencilPoint(0.5, ARM.elbow + 1, { section: 'upper' }), RangeError);
});

test('mirroring exchanges paper seam edges while keeping the center and elbow', () => {
  for (const y of [0, 150, ARM.elbow, 470, ARM.length]) {
    const left = projectStencilPoint(0, y);
    const right = projectStencilPoint(1, y);
    const mirroredLeft = projectStencilPoint(0, y, { mirror: true });
    const normal = projectStencilPoint(0.23, y);
    const mirrored = projectStencilPoint(0.23, y, { mirror: true });
    near(mirroredLeft.x, right.x);
    near(normal.x + mirrored.x, normal.centerX * 2);
    near(normal.y, mirrored.y);
    assert.ok(right.x > left.x);
  }
});
