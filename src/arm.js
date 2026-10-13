import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

// Reference dimensions for a simplified adult arm. These are not measurements
// of the person using the stencil.
export const ARM = Object.freeze({
  length: 540,
  elbow: 280,
  shoulderY: 270,
  wristY: -270,
  maxCircumference: 320,
  elbowCircumference: 250,
  forearmCircumference: 270,
  wristCircumference: 170,
  radialSegments: 128,
  lengthSegments: 180,
});

const circumferenceProfile = [
  [0, 306], [65, 320], [160, 302], [235, 265],
  [ARM.elbow, 250], [335, 268], [360, 270],
  [405, 254], [475, 215], [ARM.length, 170],
];
const ellipseProfile = [[0, 1.06], [120, 1.11], [280, 1.14], [360, 1.23], [540, 1.42]];
const centerProfile = [[0, 0], [130, 3], [280, -4], [370, -1], [540, 0]];

function clampDistance(value) {
  if (!Number.isFinite(value)) throw new TypeError('Arm distance must be finite.');
  return Math.min(ARM.length, Math.max(0, value));
}

function interpolate(profile, yMm) {
  for (let i = 1; i < profile.length; i += 1) {
    const [end, endValue] = profile[i];
    if (yMm <= end) {
      const [start, startValue] = profile[i - 1];
      const t = (yMm - start) / (end - start);
      const smooth = t * t * (3 - 2 * t);
      return startValue + (endValue - startValue) * smooth;
    }
  }
  return profile.at(-1)[1];
}

/** Circumference in mm at a distance measured from the shoulder. */
export function circumferenceAt(yMm) {
  return interpolate(circumferenceProfile, clampDistance(yMm));
}

function crossSectionAt(yMm) {
  const distance = clampDistance(yMm);
  const ratio = interpolate(ellipseProfile, distance);
  const h = ((ratio - 1) / (ratio + 1)) ** 2;
  // Ramanujan's approximation scales an ellipse to the reference perimeter.
  const unitPerimeter = Math.PI * (ratio + 1) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const radius = circumferenceAt(distance) / unitPerimeter;
  return { rx: radius * ratio, rz: radius, z: interpolate(centerProfile, distance) };
}

/** u=0 and u=1 meet on the inside of the arm (negative X). */
export function pointOnArm(u, yMm) {
  if (!Number.isFinite(u)) throw new TypeError('Arm u coordinate must be finite.');
  const distance = clampDistance(yMm);
  const section = crossSectionAt(distance);
  const angle = Math.PI + u * Math.PI * 2;
  return new Vector3(
    section.rx * Math.cos(angle),
    ARM.shoulderY - distance,
    section.z + section.rz * Math.sin(angle),
  );
}

/**
 * Smooth shoulder-to-wrist geometry, with no hand or fingers.
 * Group/material 0 is the paintable side; group/material 1 closes the ends.
 * Side UVs use v=1-distance/540, matching a top-to-bottom texture canvas.
 */
export function createArmGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const radial = ARM.radialSegments;
  const rings = ARM.lengthSegments;
  const stride = radial + 1;

  for (let row = 0; row <= rings; row += 1) {
    const yMm = (row / rings) * ARM.length;
    for (let column = 0; column <= radial; column += 1) {
      const u = column / radial;
      const point = pointOnArm(u, yMm);
      positions.push(point.x, point.y, point.z);
      uvs.push(u, 1 - yMm / ARM.length);
    }
  }

  for (let row = 0; row < rings; row += 1) {
    for (let column = 0; column < radial; column += 1) {
      const a = row * stride + column;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const sideIndexCount = indices.length;

  // Separate vertices keep the end normals flat and prevent UV painting there.
  for (const yMm of [0, ARM.length]) {
    const center = positions.length / 3;
    const section = crossSectionAt(yMm);
    positions.push(0, ARM.shoulderY - yMm, section.z);
    uvs.push(0.5, 0.5);
    for (let column = 0; column <= radial; column += 1) {
      const angle = Math.PI + (column / radial) * Math.PI * 2;
      const point = pointOnArm(column / radial, yMm);
      positions.push(point.x, point.y, point.z);
      uvs.push(0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2);
    }
    for (let column = 0; column < radial; column += 1) {
      const a = center + 1 + column;
      const b = a + 1;
      if (yMm === 0) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, sideIndexCount, 0);
  geometry.addGroup(sideIndexCount, indices.length - sideIndexCount, 1);
  geometry.computeVertexNormals();

  // Duplicated UV seam vertices must share a normal for continuous lighting.
  const normals = geometry.getAttribute('normal');
  const normal = new Vector3();
  for (let row = 0; row <= rings; row += 1) {
    const left = row * stride;
    const right = left + radial;
    normal.set(
      normals.getX(left) + normals.getX(right),
      normals.getY(left) + normals.getY(right),
      normals.getZ(left) + normals.getZ(right),
    ).normalize();
    normals.setXYZ(left, normal.x, normal.y, normal.z);
    normals.setXYZ(right, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.paintableMaterialIndex = 0;
  geometry.userData.referenceLengthMm = ARM.length;
  return geometry;
}
