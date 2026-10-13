import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
for (const [source, target] of [
  ['node_modules/three/build/three.module.js', 'vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three.core.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/OrbitControls.js'],
  ['node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'vendor/loaders/GLTFLoader.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/utils/BufferGeometryUtils.js'],
  ['node_modules/three/LICENSE', 'vendor/THREE-LICENSE.txt'],
]) {
  await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  await copyFile(source, target);
}
console.log('Three.js を同一オリジン用に配置しました。');
