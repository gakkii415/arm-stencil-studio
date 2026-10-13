import { modelRecords } from '../assets/model-catalog.js';

const descriptions = {
  arm: { label: '右腕', endpoints: ['肩', '肘', '手首'], sections: ['上腕', '前腕'], ids: ['upper', 'forearm'] },
  leg: { label: '右脚', endpoints: ['付け根', '膝', '足首'], sections: ['太もも', 'すね'], ids: ['thigh', 'lower-leg'] },
  back: { label: '背中', endpoints: ['背中上部', '腰'], sections: ['背中'], ids: ['back'] },
};

function createModel({ metadata, circumferences, filename }) {
  const description = descriptions[metadata.part];
  const widthAt = (distanceMm) => {
    if (!Number.isFinite(distanceMm)) throw new TypeError('Model distance must be finite.');
    if (metadata.type === 'flat') return metadata.width;
    const distance = Math.min(metadata.length, Math.max(0, distanceMm));
    for (let index = 1; index < circumferences.length; index += 1) {
      const [end, endValue] = circumferences[index];
      if (distance <= end) {
        const [start, startValue] = circumferences[index - 1];
        return startValue + (distance - start) / (end - start) * (endValue - startValue);
      }
    }
    return circumferences.at(-1)[1];
  };
  const distances = metadata.type === 'flat' ? [0, metadata.length] : [0, metadata.split, metadata.length];
  const panels = description.sections.map((label, index) => Object.freeze({
    id: description.ids[index], label, startMm: distances[index], endMm: distances[index + 1],
    startLabel: description.endpoints[index], endLabel: description.endpoints[index + 1],
  }));
  return Object.freeze({
    id: metadata.id, sex: metadata.sex, sexLabel: metadata.sex === 'male' ? '男性' : '女性',
    part: metadata.part, label: description.label, type: metadata.type,
    length: metadata.length, width: metadata.width ?? undefined, split: metadata.split,
    topY: metadata.topY, bottomY: metadata.bottomY,
    shoulderY: metadata.topY, wristY: metadata.bottomY,
    elbow: metadata.part === 'arm' ? metadata.split : undefined,
    panels: Object.freeze(panels),
    landmarks: Object.freeze(description.endpoints.map((label, index) => Object.freeze({ label, distance: distances[index] }))),
    modelUrl: new URL(`../assets/${filename}`, import.meta.url).href,
    widthAt, circumferenceAt: widthAt,
    maxCircumference: metadata.type === 'flat' ? metadata.width : Math.max(...circumferences.map((row) => row[1])),
    cameraFrontZ: -1,
    source: metadata,
    contextLabel: metadata.part === 'arm' ? '手・指・肩の切断面は表示用' : metadata.part === 'leg' ? '足・つま先・付け根の切断面は表示用' : '胸・腹・切断面は表示用',
  });
}

export const MODEL_CATALOG = Object.freeze(modelRecords.map(createModel));
export const DEFAULT_MODEL = MODEL_CATALOG.find((model) => model.id === 'male-arm');

export function getModelById(id) {
  const model = MODEL_CATALOG.find((item) => item.id === id);
  if (!model) throw new RangeError(`Unknown model: ${id}`);
  return model;
}

export function getModel(sex = 'male', part = 'arm') {
  return getModelById(`${sex}-${part}`);
}
