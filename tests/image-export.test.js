import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhotoLibraryDevice, saveImage, supportsPhotoShare } from '../src/image-export.js';

const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'arm-stencil.jpg', { type: 'image/jpeg' });
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };

function objectUrls() {
  const created = [];
  const revoked = [];
  return {
    created,
    revoked,
    createObjectURL(file) { created.push(file); return `blob:jpeg-${created.length}`; },
    revokeObjectURL(url) { revoked.push(url); },
  };
}

function downloadDocument() {
  const links = [];
  return {
    links,
    body: { append(link) { link.attached = true; } },
    createElement(tag) {
      assert.equal(tag, 'a');
      const link = {
        clicked: false,
        attached: false,
        click() { this.clicked = true; },
        remove() { this.attached = false; },
      };
      links.push(link);
      return link;
    },
  };
}

test('recognizes iPhone and iPadOS without changing desktop or Android downloads', () => {
  assert.equal(isPhotoLibraryDevice(iphone), true);
  assert.equal(isPhotoLibraryDevice({ userAgent: 'iPad' }), true);
  assert.equal(isPhotoLibraryDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isPhotoLibraryDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isPhotoLibraryDevice({ userAgent: 'Android' }), false);
  assert.equal(isPhotoLibraryDevice(undefined), false);
});

test('checks file sharing capability with the exact prepared JPEG File', () => {
  assert.equal(supportsPhotoShare(jpeg, {
    share() {},
    canShare(data) {
      assert.deepEqual(Object.keys(data), ['files']);
      assert.deepEqual(data.files, [jpeg]);
      assert.equal(data.files[0].type, 'image/jpeg');
      assert.equal(data.files[0].name, 'arm-stencil.jpg');
      return true;
    },
  }), true);
  assert.equal(supportsPhotoShare(jpeg, { share() {}, canShare: () => false }), false);
  assert.equal(supportsPhotoShare(jpeg, { share() {} }), false);
  assert.equal(supportsPhotoShare(jpeg, { canShare: () => true }), false);
  assert.equal(supportsPhotoShare(jpeg, { share() {}, canShare() { throw new TypeError(); } }), false);
});

test('opens native image sharing synchronously during the click activation', async () => {
  let active = true;
  let shareCalls = 0;
  let completeShare;
  const urlApi = objectUrls();
  const pending = saveImage(jpeg, {
    navigator: {
      ...iphone,
      canShare: () => true,
      share(data) {
        assert.equal(active, true, 'share must run before the click handler returns');
        shareCalls += 1;
        assert.deepEqual(data, { files: [jpeg] });
        return new Promise((resolve) => { completeShare = resolve; });
      },
    },
    urlApi,
  });
  assert.equal(shareCalls, 1, 'share is called before awaiting saveImage');
  active = false;
  completeShare();
  assert.deepEqual(await pending, { mode: 'shared' });
  assert.deepEqual(urlApi.created, []);
});

test('canceling the native sheet does not show a preview or download', async () => {
  const urlApi = objectUrls();
  const document = downloadDocument();
  const result = await saveImage(jpeg, {
    navigator: {
      ...iphone,
      canShare: () => true,
      share: () => Promise.reject(new DOMException('Canceled', 'AbortError')),
    },
    urlApi,
    document,
  });
  assert.deepEqual(result, { mode: 'canceled' });
  assert.deepEqual(urlApi.created, []);
  assert.deepEqual(document.links, []);
});

test('unsupported iPhone sharing returns a live image URL until preview is closed', async () => {
  const urlApi = objectUrls();
  const document = downloadDocument();
  const result = await saveImage(jpeg, { navigator: iphone, urlApi, document });
  assert.equal(result.mode, 'preview');
  assert.equal(result.reason, 'unsupported');
  assert.equal(result.file, jpeg);
  assert.equal(result.url, 'blob:jpeg-1');
  assert.deepEqual(urlApi.created, [jpeg]);
  assert.deepEqual(urlApi.revoked, []);
  assert.deepEqual(document.links, []);
  result.cleanup();
  result.cleanup();
  assert.deepEqual(urlApi.revoked, ['blob:jpeg-1']);
});

test('a rejected or synchronously blocked share falls back to the image preview', async () => {
  for (const synchronous of [false, true]) {
    const urlApi = objectUrls();
    const error = new DOMException('Sharing blocked', 'NotAllowedError');
    const result = await saveImage(jpeg, {
      navigator: {
        ...iphone,
        canShare: () => true,
        share() {
          if (synchronous) throw error;
          return Promise.reject(error);
        },
      },
      urlApi,
    });
    assert.equal(result.mode, 'preview');
    assert.equal(result.reason, 'share-failed');
    assert.equal(result.error, error);
    assert.deepEqual(urlApi.revoked, []);
    result.cleanup();
  }
});

test('desktop and Android keep JPEG downloads even when native sharing exists', async () => {
  for (const userAgent of ['Mozilla/5.0 (Windows NT 10.0)', 'Mozilla/5.0 (Linux; Android 15)']) {
    const urlApi = objectUrls();
    const document = downloadDocument();
    let cleanup;
    const result = await saveImage(jpeg, {
      navigator: { userAgent, canShare: () => true, share() { assert.fail('download must not open native sharing'); } },
      document,
      urlApi,
      schedule(callback, delay) { assert.equal(delay, 60000); cleanup = callback; },
    });
    assert.deepEqual(result, { mode: 'download' });
    assert.equal(document.links[0].href, 'blob:jpeg-1');
    assert.equal(document.links[0].download, 'arm-stencil.jpg');
    assert.equal(document.links[0].clicked, true);
    assert.equal(document.links[0].attached, false);
    assert.deepEqual(urlApi.revoked, []);
    cleanup();
    assert.deepEqual(urlApi.revoked, ['blob:jpeg-1']);
  }
});
