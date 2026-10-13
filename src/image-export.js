// iPadOS may identify itself as a Mac, so include its touch-capable desktop UA.
export function isPhotoLibraryDevice(navigator = globalThis.navigator) {
  return /iPhone|iPad|iPod/i.test(navigator?.userAgent || '')
    || (navigator?.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function supportsPhotoShare(file, navigator = globalThis.navigator) {
  if (typeof navigator?.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function imagePreview(file, urlApi, reason, error) {
  const url = urlApi.createObjectURL(file);
  let released = false;
  return {
    mode: 'preview',
    file,
    url,
    reason,
    error,
    // Keep this URL alive while the image is visible and can be long-pressed.
    cleanup() {
      if (released) return;
      released = true;
      urlApi.revokeObjectURL(url);
    },
  };
}

/**
 * Call from the click handler with an already prepared JPEG File. The native
 * share call runs before the first await to preserve transient user activation.
 * A resolved share promise confirms handoff, not that Photos saved the image.
 */
export async function saveImage(file, {
  navigator = globalThis.navigator,
  document = globalThis.document,
  urlApi = globalThis.URL,
  schedule = globalThis.setTimeout,
  photoLibrary = isPhotoLibraryDevice(navigator),
} = {}) {
  if (photoLibrary) {
    if (!supportsPhotoShare(file, navigator)) return imagePreview(file, urlApi, 'unsupported');
    try {
      await navigator.share({ files: [file] });
      return { mode: 'shared' };
    } catch (error) {
      // Closing the share sheet is a deliberate cancellation, not a failure.
      if (error?.name === 'AbortError') return { mode: 'canceled' };
      return imagePreview(file, urlApi, 'share-failed', error);
    }
  }

  const url = urlApi.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Leave time for the browser to consume the download before releasing it.
    schedule(() => urlApi.revokeObjectURL(url), 60000);
  }
  return { mode: 'download' };
}
