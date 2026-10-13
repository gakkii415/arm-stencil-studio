import { armMetadata, armCircumferences } from '../assets/arm-profile.js';

export const ARM_MODEL_URL = new URL('../assets/right-arm.glb', import.meta.url).href;

function interpolateCircumference(distance) {
  for (let index = 1; index < armCircumferences.length; index += 1) {
    const [end, endValue] = armCircumferences[index];
    if (distance <= end) {
      const [start, startValue] = armCircumferences[index - 1];
      const fraction = (distance - start) / (end - start);
      return startValue + fraction * (endValue - startValue);
    }
  }
  return armCircumferences.at(-1)[1];
}

// Dimensions describe this uniformly scaled source scan, not a user's body.
export const ARM = Object.freeze({
  length: armMetadata.length,
  elbow: armMetadata.elbow,
  shoulderY: armMetadata.shoulderY,
  wristY: armMetadata.wristY,
  maxCircumference: Math.max(...armCircumferences.map((row) => row[1])),
  elbowCircumference: interpolateCircumference(armMetadata.elbow),
  forearmCircumference: Math.max(...armCircumferences.filter((row) => row[0] >= armMetadata.elbow).map((row) => row[1])),
  wristCircumference: armCircumferences.at(-1)[1],
  modelUrl: ARM_MODEL_URL,
  source: armMetadata,
});

/** Measured horizontal mesh-section circumference, linearly sampled in mm. */
export function circumferenceAt(yMm) {
  if (!Number.isFinite(yMm)) throw new TypeError('Arm distance must be finite.');
  return interpolateCircumference(Math.min(ARM.length, Math.max(0, yMm)));
}
