import AsyncStorage from '@react-native-async-storage/async-storage';

const OWNED_PREFIX = 'devcards:draw-owned:';

async function ownedKey(slug: string): Promise<string> {
  return `${OWNED_PREFIX}${slug}`;
}

export async function loadOwnedSet(slug: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(await ownedKey(slug));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

export async function saveOwnedSet(slug: string, set: Set<string>): Promise<void> {
  await AsyncStorage.setItem(await ownedKey(slug), JSON.stringify([...set]));
}

export async function markCardsOwned(slug: string, stableUids: string[]): Promise<Set<string>> {
  const current = await loadOwnedSet(slug);
  for (const stableUid of stableUids) {
    current.add(stableUid);
  }
  await saveOwnedSet(slug, current);
  return current;
}

export async function isCardOwned(slug: string, stableUid: string): Promise<boolean> {
  const current = await loadOwnedSet(slug);
  return current.has(stableUid);
}

export async function clearOwnedSet(slug: string): Promise<void> {
  await AsyncStorage.removeItem(await ownedKey(slug));
}
