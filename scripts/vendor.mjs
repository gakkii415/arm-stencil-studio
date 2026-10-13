import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
for (const [source, target] of [
  ['node_modules/three/build/three.module.js', 'vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three.core.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/OrbitControls.js'],
  ['node_modules/three/LICENSE', 'vendor/THREE-LICENSE.txt'],
]) await copyFile(source, target);
console.log('Three.js を同一オリジン用に配置しました。');
