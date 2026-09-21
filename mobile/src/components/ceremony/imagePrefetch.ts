// imagePrefetch — warms RN's image cache for the ceremony's bitmaps before the tear
// is interactive, so the first draw of a card back / rarity frame / pack cover does
// not pay its decode during a phase transition. Every step is guarded: the
// integration test's react-native mock has no Image, a bundled asset may resolve to
// a bare bundle name that prefetch rejects, and none of that may throw.
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';

type ImageLike = {
  resolveAssetSource?: (source: unknown) => { uri?: string } | null | undefined;
  prefetch?: (uri: string) => Promise<unknown>;
};

function readImage(): ImageLike | null {
  try {
    const img = (RN as any).Image;
    return img && typeof img === 'object' ? (img as ImageLike) : typeof img === 'function' ? (img as unknown as ImageLike) : null;
  } catch {
    return null;
  }
}

/** Resolves each source to a URI and prefetches it. Returns the number of prefetches started. */
export function prefetchCeremonyImages(sources: ReadonlyArray<ImageSourcePropType | undefined | null>): number {
  const Image = readImage();
  if (!Image || typeof Image.prefetch !== 'function') return 0;
  const seen = new Set<string>();
  let started = 0;
  for (const source of sources) {
    if (source == null) continue;
    let uri: string | undefined;
    try {
      if (typeof source === 'object' && !Array.isArray(source) && typeof (source as { uri?: unknown }).uri === 'string') {
        uri = (source as { uri: string }).uri;
      } else if (typeof Image.resolveAssetSource === 'function') {
        uri = Image.resolveAssetSource(source)?.uri;
      }
    } catch {
      uri = undefined;
    }
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    try {
      Promise.resolve(Image.prefetch(uri)).catch(() => {});
      started += 1;
    } catch {}
  }
  return started;
}
