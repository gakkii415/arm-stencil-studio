import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARM, ARM_MODEL_URL, circumferenceAt } from '../src/arm.js';
import { MODEL_CATALOG, DEFAULT_MODEL, getModel, getModelById } from '../src/models.js';
import { stencilDimensions, projectStencilPoint, renderStencil } from '../src/stencil.js';

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

function loadGlb(modelUrl) {
  const glb = readFileSync(new URL(modelUrl));
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
    assert.ok(value && !value.sparse, 'the standard asset has no sparse accessors');
    const view = document.bufferViews[value.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[value.type];
    const bytes = value.componentType === 5123 ? 2 : 4;
    const stride = view.byteStride ?? components * bytes;
    const start = binaryOffset + (view.byteOffset ?? 0) + (value.byteOffset ?? 0);
    const reader = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE' }[value.componentType];
    assert.ok(reader && components, 'supported, uncompressed standard accessor');
    return Array.from({ length: value.count }, (_, row) => Array.from({ length: components }, (_, column) => glb[reader](start + row * stride + column * bytes)));
  }

  const meshes = document.nodes.filter((node) => node.mesh !== undefined).flatMap((node) => {
    assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, 'mm positions are baked with identity node transforms');
    return document.meshes[node.mesh].primitives.map((primitive) => {
      assert.equal(primitive.mode ?? 4, 4);
      const positions = accessor(primitive.attributes.POSITION);
      const normals = accessor(primitive.attributes.NORMAL);
      const uv = accessor(primitive.attributes.TEXCOORD_0);
      const indices = accessor(primitive.indices).map(([index]) => index);
      assert.equal(positions.length, normals.length);
      assert.equal(positions.length, uv.length);
      assert.equal(indices.length % 3, 0);
      assert.ok(indices.every((index) => index >= 0 && index < positions.length));
      return { name: node.name, paintable: node.extras.paintable, positions, normals, uv, indices };
    });
  });
  return { document, meshes };
}

const { document, meshes } = loadGlb(ARM_MODEL_URL);
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

const catalogAssets = new Map();
function assetFor(model) {
  if (!catalogAssets.has(model.id)) catalogAssets.set(model.id, loadGlb(model.modelUrl));
  return catalogAssets.get(model.id);
}

function coordinateRange(points, axis) {
  return points.reduce(([min, max], point) => [Math.min(min, point[axis]), Math.max(max, point[axis])], [Infinity, -Infinity]);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function uvSliceSegments(y, meshList) {
  const segments = [];
  for (const mesh of meshList) {
    for (const indices of triangles(mesh)) {
      const cuts = [];
      for (let edge = 0; edge < 3; edge += 1) {
        const ia = indices[edge], ib = indices[(edge + 1) % 3];
        const a = mesh.positions[ia], b = mesh.positions[ib];
        if ((a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1])) {
          const t = (y - a[1]) / (b[1] - a[1]);
          cuts.push({
            point: [a[0] + t * (b[0] - a[0]), a[2] + t * (b[2] - a[2])],
            u: mesh.uv[ia][0] + t * (mesh.uv[ib][0] - mesh.uv[ia][0]),
          });
        }
      }
      if (cuts.length === 2 && Math.hypot(cuts[0].point[0] - cuts[1].point[0], cuts[0].point[1] - cuts[1].point[1]) > 1e-6) {
        segments.push(cuts.sort((a, b) => a.u - b.u));
      }
    }
  }
  return segments.sort((a, b) => a[0].u - b[0].u);
}

test('the catalog resolves all ten distinct sex/body-part/side selections and preserves the default arm', () => {
  assert.equal(MODEL_CATALOG.length, 10);
  assert.equal(new Set(MODEL_CATALOG.map((model) => model.id)).size, 10);
  assert.equal(new Set(MODEL_CATALOG.map((model) => model.modelUrl)).size, 10);
  assert.equal(DEFAULT_MODEL, getModel());
  assert.equal(DEFAULT_MODEL.id, 'male-arm');
  assert.equal(DEFAULT_MODEL.modelUrl, ARM_MODEL_URL);
  assert.equal(DEFAULT_MODEL.length, ARM.length);
  for (const sex of ['male', 'female']) {
    for (const part of ['arm', 'leg', 'back']) {
      for (const side of part === 'back' ? [null] : ['right', 'left']) {
        const model = getModel(sex, part, side ?? 'right');
        assert.equal(model.id, `${sex}-${part}${side === 'left' ? '-left' : ''}`);
        assert.equal(model.sex, sex);
        assert.equal(model.part, part);
        assert.equal(model.side, side);
        assert.equal(model.source.part, part);
        assert.equal(model.source.side, side);
        assert.equal(getModelById(model.id), model);
        assert.ok(MODEL_CATALOG.includes(model));
        assert.ok(model.label && model.sexLabel);
        if (side !== null) assert.ok(model.label.startsWith(side === 'left' ? '左' : '右'), 'the visible part label identifies the anatomical side');
        assert.equal(model.type, part === 'back' ? 'flat' : 'wrap');
        assert.ok(Number.isFinite(model.length) && model.length > 0);
        near(model.topY - model.bottomY, model.length);
        assert.ok(Number.isFinite(model.cameraFrontZ) && model.cameraFrontZ !== 0);
        assert.ok(model.landmarks.every(({ label, distance }) => label && distance >= 0 && distance <= model.length));
        assert.equal(model.source.license, 'CC0-1.0');
        assert.ok(model.source.sourceObject && model.source.source);
        if (model.type === 'wrap') {
          assert.ok(model.split > 0 && model.split < model.length);
          assert.equal(model.seamXSign, side === 'left' ? 1 : -1);
          assert.equal(model.source.insideSeam, side === 'left' ? '+X' : '-X');
          if (side === 'right') assert.equal(getModel(sex, part), model, 'omitting side preserves the original right selection');
        } else {
          assert.equal(model.split, null);
          assert.equal(getModel(sex, part), model);
          assert.equal(getModel(sex, part, 'left'), model, 'back has one drawing regardless of the limb-side selector');
        }
      }
    }
  }
  assert.throws(() => getModelById('unknown-model'), RangeError);
  assert.throws(() => getModel('unknown-sex', 'arm'), RangeError);
  assert.throws(() => getModel('male', 'unknown-part'), RangeError);
  assert.throws(() => getModel('male', 'arm', 'unknown-side'), RangeError);
});

for (const model of MODEL_CATALOG) {
  test(`${model.id}: actual paintable bounds, UV distances, normals, and source provenance agree with the catalog`, () => {
    const { document, meshes } = assetFor(model);
    const drawable = meshes.filter((mesh) => mesh.paintable === true);
    const context = meshes.filter((mesh) => mesh.paintable === false);
    assert.ok(drawable.length > 0 && context.length > 0, 'each model separates the drawing surface from displayed context');
    assert.equal(document.asset.extras.license, model.source.license);
    assert.equal(document.asset.extras.sourceObject, model.source.sourceObject);
    if (model.side === 'left') {
      assert.equal(document.asset.extras.part, model.part);
      assert.equal(document.asset.extras.side, 'left');
      assert.equal(document.asset.extras.sideOrigin, 'original');
      assert.equal(document.asset.extras.isMirrored, false);
      assert.equal(model.source.sideOrigin, 'original');
      assert.equal(model.source.isMirrored, false);
      assert.match(model.source.sourceRawSha256, /^[a-f0-9]{64}$/, 'left provenance identifies the original extracted source file');
      assert.ok(Number.isInteger(model.source.sourceVertexCount) && model.source.sourceVertexCount > 1000);
      assert.equal(model.source.preservedSourceVertexCount, model.source.sourceVertexCount, 'every original left-side source vertex survives the rigid conversion');
    }
    assert.ok(drawable.reduce((count, mesh) => count + mesh.indices.length / 3, 0) > 1000, 'the drawing surface retains detailed source geometry');
    const positions = drawable.flatMap((mesh) => mesh.positions);
    const [bottom, top] = coordinateRange(positions, 1);
    near(top, model.topY, 1e-3);
    near(bottom, model.bottomY, 1e-3);
    for (const mesh of meshes) {
      for (let index = 0; index < mesh.positions.length; index += 1) {
        const p = mesh.positions[index], n = mesh.normals[index], uv = mesh.uv[index];
        assert.ok(p.every(Number.isFinite) && n.every(Number.isFinite) && uv.every(Number.isFinite));
        near(Math.hypot(...n), 1, 1e-3);
        if (!mesh.paintable) continue;
        assert.ok(uv.every((value) => value >= -1e-6 && value <= 1 + 1e-6), 'drawable UVs stay within the texture');
        near(uv[1], (p[1] - model.bottomY) / model.length, 1e-6);
        if (model.type === 'flat') near(uv[0], (p[0] + model.width / 2) / model.width, 1e-6);
      }
      for (const indices of triangles(mesh)) {
        const [a, b, c] = indices.map((index) => mesh.positions[index]);
        const geometricNormal = cross(b.map((value, axis) => value - a[axis]), c.map((value, axis) => value - a[axis]));
        const area2 = Math.hypot(...geometricNormal);
        if (area2 < 1e-4) continue;
        const smoothNormal = [0, 1, 2].map((axis) => indices.reduce((sum, index) => sum + mesh.normals[index][axis], 0));
        const agreement = geometricNormal.reduce((sum, value, axis) => sum + value * smoothNormal[axis], 0);
        assert.ok(agreement > 0, `${model.id}/${mesh.name} triangle ${indices.join(',')} (area ${area2 / 2} mm²) winding agrees with the outward shading normal`);
        if (mesh.paintable) {
          const [ua, ub, uc] = indices.map((index) => mesh.uv[index]);
          const uvArea2 = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (ub[1] - ua[1]) * (uc[0] - ua[0]);
          assert.ok(Math.abs(uvArea2) > 1e-12, 'nondegenerate source triangles have nondegenerate drawable UVs');
          // U follows the outward wrap contour (or X on the posterior flat
          // surface), while V increases with Y. Both mappings face negative Z.
          assert.ok(uvArea2 < 0, `${model.id}/${mesh.name} triangle ${indices.join(',')} retains the drawable UV orientation without folding`);
        }
      }
    }
    if (model.part === 'arm' || model.part === 'leg') {
      assert.ok(context.some((mesh) => coordinateRange(mesh.positions, 1)[0] < model.bottomY - 10), 'the original hand/foot remains beyond the drawing cutoff');
    }
    if (model.type === 'flat') {
      const [left, right] = coordinateRange(positions, 0);
      assert.ok(right - left > model.width * 0.9, 'the back covers the configured horizontal drawing range');
    }
  });

  test(`${model.id}: stencil panels preserve physical widths, distances, splits, and mirrored coordinates`, () => {
    const layout = stencilDimensions(model);
    assert.equal(layout.panels.length, model.type === 'flat' ? 1 : 2);
    near(layout.panels.reduce((sum, panel) => sum + panel.height, 0), model.length);
    assert.equal(layout.panels.length, model.panels.length);
    for (let index = 0; index < layout.panels.length; index += 1) {
      const panel = layout.panels[index], definition = model.panels[index];
      assert.equal(panel.id, definition.id);
      near(panel.startMm, definition.startMm);
      near(panel.endMm, definition.endMm);
      near(panel.height, panel.endMm - panel.startMm);
      for (const fraction of [0, 0.3, 0.7, 1]) {
        const distance = panel.startMm + panel.height * fraction;
        const options = { model, section: panel.id };
        const left = projectStencilPoint(0, distance, options);
        const center = projectStencilPoint(0.5, distance, options);
        const right = projectStencilPoint(1, distance, options);
        const mirrored = projectStencilPoint(0.2, distance, { ...options, mirror: true });
        const unmirrored = projectStencilPoint(0.2, distance, options);
        near(right.x - left.x, model.widthAt(distance));
        near(center.x, panel.centerX);
        near(center.y, panel.y + distance - panel.startMm);
        near(mirrored.x + unmirrored.x, panel.centerX * 2);
        near(mirrored.y, unmirrored.y);
        assert.ok(left.x >= panel.x - 1e-6 && right.x <= panel.x + panel.width + 1e-6, 'physical rows fit the allocated panel');
      }
    }
    if (model.type === 'wrap') {
      const [upper, lower] = layout.panels;
      const upperEnd = projectStencilPoint(0.5, model.split, { model, section: upper.id });
      const lowerStart = projectStencilPoint(0.5, model.split, { model });
      assert.equal(lowerStart.section, lower.id);
      near(upperEnd.y, upper.y + upper.height);
      near(lowerStart.y, lower.y);
      near(upperEnd.width, lowerStart.width);
      assert.throws(() => projectStencilPoint(0.5, model.split + 1, { model, section: upper.id }), RangeError);
    } else {
      near(layout.panels[0].width, model.width);
      for (const distance of [0, model.length / 2, model.length]) near(model.widthAt(distance), model.width);
    }
    assert.throws(() => projectStencilPoint(NaN, 0, { model }), TypeError);
    assert.throws(() => projectStencilPoint(0.5, Infinity, { model }), TypeError);
  });

  if (model.type !== 'wrap') continue;

  test(`${model.id}: inner seam is duplicated without wrap-crossing triangles`, () => {
    const drawable = assetFor(model).meshes.filter((mesh) => mesh.paintable === true);
    const left = new Map(), right = new Map();
    for (const mesh of drawable) {
      for (const indices of triangles(mesh)) {
        const us = indices.map((index) => mesh.uv[index][0]);
        assert.ok(Math.max(...us) - Math.min(...us) < 0.5, 'no triangle interpolates across the texture seam');
      }
      for (let index = 0; index < mesh.uv.length; index += 1) {
        const p = mesh.positions[index];
        const key = p.map((value) => value.toFixed(3)).join(',');
        if (Math.abs(mesh.uv[index][0]) < 1e-7) left.set(key, p);
        if (Math.abs(mesh.uv[index][0] - 1) < 1e-7) right.set(key, p);
      }
    }
    assert.ok(left.size > 50 && right.size > 50, 'the scan includes a longitudinal seam');
    assert.equal(left.size, right.size);
    for (const [key, p] of left) {
      assert.ok(right.has(key), 'both stencil edges coincide on the original surface');
      assert.ok(p[0] * model.seamXSign > 0, `${model.id} seam stays on its anatomical inner X side`);
    }
  });

  test(`${model.id}: profile circumference matches independent slices including all context/cap meshes`, () => {
    const allMeshes = assetFor(model).meshes;
    const step = model.source.profileStepMm ?? 5;
    const distances = [0.01, 25, ...[0.2, 0.4, 0.6, 0.8].map((fraction) => Math.round(model.length * fraction / step) * step), model.length - 0.01];
    for (const distance of distances) {
      const measured = measuredPerimeter(model.topY - distance, allMeshes);
      assert.ok(measured > 0);
      near(model.circumferenceAt(distance), measured, 0.9);
      near(model.widthAt(distance), model.circumferenceAt(distance));
    }
    assert.throws(() => model.circumferenceAt(NaN), TypeError);
  });

  test(`${model.id}: wrap U measures cumulative surface distance rather than uniform angle`, () => {
    const drawable = assetFor(model).meshes.filter((mesh) => mesh.paintable === true);
    for (const fraction of [0.45, 0.7, 0.9]) {
      const segments = uvSliceSegments(model.topY - model.length * fraction, drawable);
      assert.ok(segments.length > 30, 'the independent plane crosses a detailed contour');
      near(segments[0][0].u, 0, 1e-6);
      near(segments.at(-1)[1].u, 1, 1e-6);
      const lengths = segments.map(([a, b]) => Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]));
      const total = lengths.reduce((sum, length) => sum + length, 0);
      let accumulated = 0;
      for (let index = 0; index < segments.length; index += 1) {
        const [start, end] = segments[index];
        near(start.u, accumulated / total, 0.004);
        accumulated += lengths[index];
        near(end.u, accumulated / total, 0.004);
      }
    }
  });
}

test('male and female selections use independently sourced, distinct geometry for every body part', () => {
  for (const part of ['arm', 'leg', 'back']) {
    for (const side of part === 'back' ? ['right'] : ['right', 'left']) {
      const male = getModel('male', part, side), female = getModel('female', part, side);
      assert.notEqual(male.source.sourceObject, female.source.sourceObject);
      const fingerprint = (model) => {
        const drawable = assetFor(model).meshes.filter((mesh) => mesh.paintable);
        return createHash('sha256').update(JSON.stringify(drawable.map((mesh) => mesh.positions))).digest('hex');
      };
      assert.notEqual(fingerprint(male), fingerprint(female), `${part}/${side} must not reuse the same displayed model`);
      const proportionsDiffer = [0.2, 0.5, 0.8].some((fraction) =>
        Math.abs(male.widthAt(male.length * fraction) / male.length - female.widthAt(female.length * fraction) / female.length) > 0.005);
      assert.ok(proportionsDiffer, `${part}/${side} has distinct scan proportions after accounting for physical length`);
    }
  }
});

function surfaceFingerprint(model, reflectX = false) {
  // Ignore vertex order and UV-seam duplicates, so changing indices or texture
  // coordinates cannot turn a reflected right mesh into an original left mesh.
  const points = new Set(assetFor(model).meshes.flatMap((mesh) => mesh.positions).map((point) =>
    point.map((value, axis) => Math.round(value * (axis === 0 && reflectX ? -1 : 1) * 1000)).join(',')));
  return createHash('sha256').update([...points].sort().join('\n')).digest('hex');
}

for (const sex of ['male', 'female']) {
  for (const part of ['arm', 'leg']) {
    test(`${sex}-${part}: the original left scan is distinct from the right scan and its synthetic reflection`, () => {
      const right = getModel(sex, part, 'right'), left = getModel(sex, part, 'left');
      assert.notEqual(right.id, left.id);
      assert.notEqual(right.modelUrl, left.modelUrl);
      assert.equal(left.source.side, 'left');
      assert.equal(left.source.part, part);
      assert.equal(left.source.sideOrigin, 'original');
      assert.equal(left.source.isMirrored, false);
      assert.notEqual(surfaceFingerprint(left), surfaceFingerprint(right), 'left and right retain different original surface positions');
      assert.notEqual(surfaceFingerprint(left), surfaceFingerprint(right, true), 'left is not produced by reflecting the shipped right surface');
    });
  }
}

const previousBackWidths = { male: 358.7017822265625, female: 336.2050323486328 };
for (const sex of ['male', 'female']) {
  test(`${sex}-back: both original posterior shoulders provide paintable surface beyond the earlier back crop`, () => {
    const model = getModel(sex, 'back');
    const previousWidth = previousBackWidths[sex];
    assert.ok(model.width > previousWidth + 10, 'adding the actual shoulder surface expands the physical drawing width');
    assert.ok(model.source.shoulderPaintTriangles['20'] > 100 && model.source.shoulderPaintTriangles['21'] > 100, 'both original upper-arm shoulder face sets contribute posterior drawing triangles');
    assert.match(model.source.sourceRawSha256, /^[a-f0-9]{64}$/);
    assert.equal(model.source.preservedSourceVertexCount, model.source.sourceVertexCount, 'the expanded torso retains every original source vertex');
    assert.equal(model.source.strictPosteriorOnly, true);
    assert.equal(model.source.anteriorSourceYPaintableFaces, 0, 'original anterior chest/abdomen faces remain context');
    near(model.source.posteriorZBoundMm, 0);
    const shoulderLandmarks = model.source.shoulderLandmarksMm;
    assert.ok(shoulderLandmarks && shoulderLandmarks.right && shoulderLandmarks.left, 'shoulder positions are derived from the original source anatomy');
    const drawable = assetFor(model).meshes.filter((mesh) => mesh.paintable === true);
    for (const mesh of drawable) {
      for (const indices of triangles(mesh)) {
        const centerZ = indices.reduce((sum, index) => sum + mesh.positions[index][2], 0) / 3;
        assert.ok(centerZ < model.source.posteriorZBoundMm + 1e-4,
          `${model.id} drawable triangle ${indices.join(',')} stays behind the source posterior boundary and cannot place artwork on anterior chest/abdomen folds`);
      }
    }
    for (const side of ['right', 'left']) {
      const landmark = shoulderLandmarks[side];
      assert.ok(Array.isArray(landmark) && landmark.length === 3 && landmark.every(Number.isFinite));
      const sign = Math.sign(landmark[0]);
      assert.ok(sign !== 0);
      const points = [];
      let area = 0, count = 0;
      for (const mesh of drawable) {
        for (const indices of triangles(mesh)) {
          const [a, b, c] = indices.map((index) => mesh.positions[index]);
          const center = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
          if (center[0] * sign <= previousWidth / 2 + 5 || Math.abs(center[1] - landmark[1]) >= model.length * 0.2) continue;
          const normal = cross(b.map((value, axis) => value - a[axis]), c.map((value, axis) => value - a[axis]));
          assert.ok(normal[2] < 0, 'shoulder artwork stays on the original posterior surface');
          area += Math.hypot(...normal) / 2;
          count += 1;
          points.push(a, b, c);
          for (const index of indices) {
            const p = mesh.positions[index], uv = mesh.uv[index];
            near(uv[0] * model.width - model.width / 2, p[0], 1e-3);
            const output = projectStencilPoint(uv[0], model.topY - p[1], { model });
            near(output.x - output.centerX, p[0], 1e-3);
          }
        }
      }
      assert.ok(count > 10 && area > 500, `${sex}/${side} shoulder retains a meaningful original drawing patch outside the former back width`);
      const [minX, maxX] = coordinateRange(points, 0), [minY, maxY] = coordinateRange(points, 1);
      assert.ok(maxX - minX >= 15 && maxY - minY >= 25, 'the added shoulder patch spans both drawing directions');
    }
  });
}

function captureStencil(model, { mirror = false, scale = 1.25 } = {}) {
  const draws = [], labels = [], fills = [];
  const state = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const stack = [];
  const context = {
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
    scale(x, y) { state.sx *= x; state.sy *= y; },
    translate(x, y) { state.tx += x * state.sx; state.ty += y * state.sy; },
    fillRect(...args) { fills.push({ color: this.fillStyle, args }); },
    drawImage(...args) { draws.push({ args, state: { ...state } }); },
    fillText(text) { labels.push(text); },
    setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    const texture = { width: 512, height: 1024 };
    const canvas = renderStencil(texture, { model, scale, mirror, guides: false });
    return { canvas, draws, labels, fills, texture, scale };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test('rendering each selection consumes its full texture and physical layout on white paper', () => {
  for (const model of MODEL_CATALOG) {
    const layout = stencilDimensions(model);
    const { canvas, draws, fills, texture, scale } = captureStencil(model);
    assert.equal(canvas.width, Math.ceil(layout.width * scale));
    assert.equal(canvas.height, Math.ceil(layout.height * scale));
    assert.equal(fills[0].color, '#ffffff');
    assert.deepEqual(fills[0].args, [0, 0, canvas.width, canvas.height]);
    assert.ok(draws.length > 0);
    for (const panel of layout.panels) {
      const panelDraws = draws.filter(({ args, state }) => {
        const sourceDistance = args[2] / texture.height * model.length;
        const outputTop = state.ty + args[6] * state.sy;
        return sourceDistance >= panel.startMm - 1e-6 && sourceDistance < panel.endMm - 1e-6
          && outputTop >= panel.y * scale - 1e-6 && outputTop < (panel.y + panel.height) * scale;
      });
      assert.ok(panelDraws.length > 0, `${model.id}/${panel.id} artwork is rendered`);
      const first = panelDraws[0].args, last = panelDraws.at(-1).args;
      near(first[2], panel.startMm / model.length * texture.height);
      near(last[2] + last[4], panel.endMm / model.length * texture.height, 1e-6);
      near(first[6], panel.y * scale);
      near(last[6] + last[8], (panel.y + panel.height) * scale, 1e-6);
      for (const { args } of panelDraws) {
        const distance = (args[2] + args[4] / 2) / texture.height * model.length;
        near(args[1], 0);
        near(args[3], texture.width);
        near(args[7], model.widthAt(distance) * scale, 1e-5);
        near(args[5] + args[7] / 2, panel.centerX * scale, 1e-5);
      }
    }
  }
});

test('rendered flat-back artwork mirrors horizontally while its vertical placement stays fixed', () => {
  for (const sex of ['male', 'female']) {
    const model = getModel(sex, 'back');
    const normal = captureStencil(model), mirrored = captureStencil(model, { mirror: true });
    assert.equal(normal.draws.length, mirrored.draws.length);
    const layout = stencilDimensions(model);
    for (let index = 0; index < normal.draws.length; index += 1) {
      const a = normal.draws[index], b = mirrored.draws[index];
      const position = (draw, u) => draw.state.tx + (draw.args[5] + draw.args[7] * u) * draw.state.sx;
      near(position(a, 0), position(b, 1));
      near(position(a, 1), position(b, 0));
      near(position(a, 0.5), layout.panels[0].centerX * normal.scale);
      near(a.state.ty + a.args[6] * a.state.sy, b.state.ty + b.args[6] * b.state.sy);
    }
  }
});

for (const dpi of [125, 150]) {
  test(`${dpi} DPI wrap artwork uses aligned pixel rows while preserving physical bounds and continuous full texture coverage`, () => {
    const scale = dpi / 25.4;
    for (const model of MODEL_CATALOG.filter((model) => model.type === 'wrap')) {
      const layout = stencilDimensions(model);
      const { draws, texture } = captureStencil(model, { scale });
      for (const panel of layout.panels) {
        const panelDraws = draws.filter(({ args }) => {
          const sourceDistance = args[2] / texture.height * model.length;
          return sourceDistance >= panel.startMm - 1e-6 && sourceDistance < panel.endMm - 1e-6;
        });
        assert.ok(panelDraws.length > 1, `${model.id}/${panel.id} contains output pixel rows`);
        const yStart = Math.round(panel.y * scale);
        const yEnd = (panel.y + panel.height) * scale;
        const renderedExtent = yEnd - yStart;
        assert.equal(panelDraws.length, Math.ceil(renderedExtent));
        assert.ok(Math.abs(yStart - panel.y * scale) <= 0.5, 'alignment moves the upper boundary by at most half a pixel');
        let previousSourceEnd = panel.startMm / model.length * texture.height;
        let previousOutputEnd = yStart;
        for (let row = 0; row < panelDraws.length; row += 1) {
          const { args, state } = panelDraws[row];
          const [, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight] = args;
          const outputY = state.ty + destY * state.sy;
          const outputHeight = destHeight * state.sy;
          assert.equal(outputY, yStart + row, 'every row starts on the pixel grid');
          assert.equal(Number.isInteger(outputY), true);
          near(outputY, previousOutputEnd, 1e-7);
          if (row < panelDraws.length - 1) assert.equal(outputHeight, 1, 'full rows occupy exactly one pixel');
          else assert.ok(outputHeight > 0 && outputHeight <= 1, 'only the final row may have fractional height');
          near(outputHeight, Math.min(1, yEnd - outputY), 1e-7);
          assert.equal(sourceX, 0);
          assert.equal(sourceWidth, texture.width);
          assert.ok(sourceHeight > 0);
          near(sourceY, previousSourceEnd, 1e-7);
          const localStart = row / renderedExtent * panel.height;
          const localEnd = (row + outputHeight) / renderedExtent * panel.height;
          near(sourceY, (panel.startMm + localStart) / model.length * texture.height, 1e-7);
          near(sourceHeight, (localEnd - localStart) / model.length * texture.height, 1e-7);
          const distance = panel.startMm + (localStart + localEnd) / 2;
          near(Math.abs(destWidth * state.sx), model.widthAt(distance) * scale, 1e-5);
          near(state.tx + (destX + destWidth / 2) * state.sx, panel.centerX * scale, 1e-5);
          previousSourceEnd = sourceY + sourceHeight;
          previousOutputEnd = outputY + outputHeight;
        }
        near(previousOutputEnd, yEnd, 1e-7);
        near(previousSourceEnd, panel.endMm / model.length * texture.height, 1e-7);
      }
    }
  });
}
