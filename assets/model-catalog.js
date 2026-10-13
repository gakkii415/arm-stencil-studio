import { armMetadata, armCircumferences } from './arm-profile.js';
import { modelMetadata as femaleArmMetadata, modelCircumferences as femaleArmCircumferences } from './female-arm-profile.js';
import { modelMetadata as maleLegMetadata, modelCircumferences as maleLegCircumferences } from './male-leg-profile.js';
import { modelMetadata as femaleLegMetadata, modelCircumferences as femaleLegCircumferences } from './female-leg-profile.js';
import { modelMetadata as maleBackMetadata, modelCircumferences as maleBackCircumferences } from './male-back-profile.js';
import { modelMetadata as femaleBackMetadata, modelCircumferences as femaleBackCircumferences } from './female-back-profile.js';

export const modelRecords = [
  { metadata: { ...armMetadata, id: 'male-arm', sex: 'male', part: 'arm', type: 'wrap', split: armMetadata.elbow, topY: armMetadata.shoulderY, bottomY: armMetadata.wristY }, circumferences: armCircumferences, filename: 'right-arm.glb' },
  { metadata: femaleArmMetadata, circumferences: femaleArmCircumferences, filename: 'female-arm.glb' },
  { metadata: maleLegMetadata, circumferences: maleLegCircumferences, filename: 'male-leg.glb' },
  { metadata: femaleLegMetadata, circumferences: femaleLegCircumferences, filename: 'female-leg.glb' },
  { metadata: maleBackMetadata, circumferences: maleBackCircumferences, filename: 'male-back.glb' },
  { metadata: femaleBackMetadata, circumferences: femaleBackCircumferences, filename: 'female-back.glb' },
];
