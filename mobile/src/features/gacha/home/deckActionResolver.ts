import { loadActiveDeckSlug, setActiveDeckSlug } from '../../../content/activeDeck';
import {
  checkManifestForUpdates,
  installDeckFromUrl,
  type UpdateInfo,
} from '../../../content/deckRepository';
import type { DeckSummary } from '../contracts';
import type { HomeDeckActionHint } from '../selectors/homeSelectors';

export type DeckAction =
  | { kind: 'open'; slug: string }
  | {
      kind: 'install';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | {
      kind: 'update';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | {
      kind: 'trial-start';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | { kind: 'paywall'; slug: string }
  | { kind: 'none'; slug: string };

function isPremiumDeck(deck: DeckSummary): boolean {
  return deck.deckType !== 1 || String(deck.tier ?? '').toLowerCase() === 'premium';
}

function canInstallFromUpdate(updateInfo: UpdateInfo | undefined): updateInfo is UpdateInfo {
  return !!updateInfo?.remoteUrl && typeof updateInfo.remoteVersion === 'string';
}

export function previewDeckAction(input: {
  deck: DeckSummary;
  premium: boolean;
  signedIn: boolean;
  updates: Record<string, UpdateInfo>;
}): HomeDeckActionHint {
  const { deck, premium, signedIn, updates } = input;
  const availability = String(deck.availability ?? 'live').toLowerCase();
  if (availability === 'coming') return 'none';

  const updateInfo = updates[deck.slug];
  const premiumDeck = isPremiumDeck(deck);

  if (!deck.canStudy) {
    if (canInstallFromUpdate(updateInfo)) {
      if (premiumDeck && !premium) {
        return signedIn ? 'trial-start' : 'paywall';
      }
      return 'install';
    }
    return premiumDeck && !premium ? 'paywall' : 'open';
  }

  if (updateInfo?.hasUpdate && canInstallFromUpdate(updateInfo)) {
    return 'update';
  }

  return 'open';
}

export async function resolveDeckAction(input: {
  deck: DeckSummary;
  premium: boolean;
  signedIn: boolean;
  updates: Record<string, UpdateInfo>;
}): Promise<DeckAction> {
  const { deck, premium, signedIn, updates } = input;

  const availability = String(deck.availability ?? 'live').toLowerCase();
  if (availability === 'coming') {
    return { kind: 'none', slug: deck.slug };
  }

  const updateInfo = updates[deck.slug];
  const premiumDeck = isPremiumDeck(deck);

  if (!deck.canStudy) {
    if (canInstallFromUpdate(updateInfo)) {
      if (premiumDeck && !premium) {
        if (!signedIn) {
          return { kind: 'paywall', slug: deck.slug };
        }
        return {
          kind: 'trial-start',
          slug: deck.slug,
          remoteUrl: updateInfo.remoteUrl!,
          remoteVersion: updateInfo.remoteVersion,
          remoteSha256: updateInfo.remoteSha256,
        };
      }

      return {
        kind: 'install',
        slug: deck.slug,
        remoteUrl: updateInfo.remoteUrl!,
        remoteVersion: updateInfo.remoteVersion,
        remoteSha256: updateInfo.remoteSha256,
      };
    }

    return premiumDeck && !premium
      ? { kind: 'paywall', slug: deck.slug }
      : { kind: 'open', slug: deck.slug };
  }

  if (updateInfo?.hasUpdate && canInstallFromUpdate(updateInfo)) {
    return {
      kind: 'update',
      slug: deck.slug,
      remoteUrl: updateInfo.remoteUrl!,
      remoteVersion: updateInfo.remoteVersion,
      remoteSha256: updateInfo.remoteSha256,
    };
  }

  return { kind: 'open', slug: deck.slug };
}

export async function executeDeckAction(action: DeckAction): Promise<{ activeSlug: string }> {
  const ensureActive = async (slug: string): Promise<{ activeSlug: string }> => {
    await setActiveDeckSlug(slug);
    return { activeSlug: slug };
  };

  switch (action.kind) {
    case 'open':
      return ensureActive(action.slug);

    case 'install':
    case 'update':
    case 'trial-start': {
      const ok = await installDeckFromUrl(
        action.slug,
        action.remoteUrl,
        action.remoteVersion,
        action.remoteSha256,
      );
      if (!ok) {
        throw new Error(`deck_action_failed:${action.kind}`);
      }
      return ensureActive(action.slug);
    }

    case 'paywall': {
      const stored = await loadActiveDeckSlug();
      return { activeSlug: stored ?? action.slug };
    }

    case 'none':
    default:
      return { activeSlug: action.slug };
  }
}

export async function loadDeckUpdates(
  premium: boolean,
): Promise<Record<string, UpdateInfo>> {
  return checkManifestForUpdates(premium);
}
