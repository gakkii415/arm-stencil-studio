import { armMetadata, armCircumferences } from './arm-profile.js';
import { modelMetadata as femaleArmMetadata, modelCircumferences as femaleArmCircumferences } from './female-arm-profile.js';
import { modelMetadata as maleLegMetadata, modelCircumferences as maleLegCircumferences } from './male-leg-profile.js';
import { modelMetadata as femaleLegMetadata, modelCircumferences as femaleLegCircumferences } from './female-leg-profile.js';
import { modelMetadata as maleBackMetadata, modelCircumferences as maleBackCircumferences } from './male-back-profile.js';
import { modelMetadata as femaleBackMetadata, modelCircumferences as femaleBackCircumferences } from './female-back-profile.js';
import { modelMetadata as maleArmLeftMetadata, modelCircumferences as maleArmLeftCircumferences } from './male-arm-left-profile.js';
import { modelMetadata as femaleArmLeftMetadata, modelCircumferences as femaleArmLeftCircumferences } from './female-arm-left-profile.js';
import { modelMetadata as maleLegLeftMetadata, modelCircumferences as maleLegLeftCircumferences } from './male-leg-left-profile.js';
import { modelMetadata as femaleLegLeftMetadata, modelCircumferences as femaleLegLeftCircumferences } from './female-leg-left-profile.js';

const records = [
  { metadata: { ...armMetadata, id: 'male-arm', sex: 'male', part: 'arm', type: 'wrap', split: armMetadata.elbow, topY: armMetadata.shoulderY, bottomY: armMetadata.wristY }, circumferences: armCircumferences, filename: 'right-arm.glb' },
  { metadata: femaleArmMetadata, circumferences: femaleArmCircumferences, filename: 'female-arm.glb' },
  { metadata: maleArmLeftMetadata, circumferences: maleArmLeftCircumferences, filename: 'male-arm-left.glb' },
  { metadata: femaleArmLeftMetadata, circumferences: femaleArmLeftCircumferences, filename: 'female-arm-left.glb' },
  { metadata: maleLegMetadata, circumferences: maleLegCircumferences, filename: 'male-leg.glb' },
  { metadata: femaleLegMetadata, circumferences: femaleLegCircumferences, filename: 'female-leg.glb' },
  { metadata: maleLegLeftMetadata, circumferences: maleLegLeftCircumferences, filename: 'male-leg-left.glb' },
  { metadata: femaleLegLeftMetadata, circumferences: femaleLegLeftCircumferences, filename: 'female-leg-left.glb' },
  { metadata: maleBackMetadata, circumferences: maleBackCircumferences, filename: 'male-back.glb' },
  { metadata: femaleBackMetadata, circumferences: femaleBackCircumferences, filename: 'female-back.glb' },
];

export const modelRecords = records.map((record) => ({
  ...record,
  metadata: {
    side: record.metadata.part === 'back' ? null : 'right', sideOrigin: 'original', isMirrored: false,
    ...record.metadata,
  },
}));
