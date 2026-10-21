import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserScopedKey } from '../../../review/storage';
import type { LibraryFilter } from './libraryMapper';

const FILTERS: readonly LibraryFilter[] = ['owned', 'all', 'new', 'learning', 'mastered', 'rare', 'legendary'];

export async function libraryPreferenceKey(slug: string): Promise<string> {
  return getUserScopedKey(`library-filter:v1:${slug}`);
}

export async function loadLibraryFilter(key: string): Promise<LibraryFilter> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return FILTERS.includes(stored as LibraryFilter) ? stored as LibraryFilter : 'owned';
  } catch {
    return 'owned';
  }
}

/** A display preference never blocks studying if device storage is unavailable. */
export async function saveLibraryFilter(key: string, filter: LibraryFilter): Promise<void> {
  try { await AsyncStorage.setItem(key, filter); } catch { /* keep the in-memory choice */ }
}
