import { loadActiveDeckSlug, setActiveDeckSlug } from '../../../content/activeDeck';
import {
  checkManifestForUpdates,
  installDeckFromUrl,
  listManifestDecks,
  resolveDeckBySlug,
  type ManifestDeckEntry,
  type UpdateInfo,
} from '../../../content/deckRepository';
import { syncDailyReminders } from '../../../notifications/reminders';
import { loadDeckProgress } from '../../../review/storage';
import { applyCachedRemoteProgress } from '../../../sync/progressSync';
import type { CalendarDay, DeckSummary } from '../contracts';
import type { HomeDeckActionHint } from '../selectors/homeSelectors';
import { buildUpcoming, clamp01, isLearnedProgress } from '../selectors/progressSelectors';

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

export type HomeDeckSummarySnapshot = {
  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;
  allUpcoming30: CalendarDay[];
  asOfISO: string;
};

function toDeckEntriesFromUpdates(rawUpdates: Record<string, unknown>): ManifestDeckEntry[] {
  return Object.entries(rawUpdates ?? {})
    .map(([slug, info]) => ({
      slug,
      title: String((info as any)?.title ?? slug),
      locale: String((info as any)?.locale ?? 'en-US'),
      version: String((info as any)?.remoteVersion ?? 'unknown'),
      deckType: Number((info as any)?.deckType ?? 1),
      tier: (info as any)?.tier ?? null,
      availability: (info as any)?.availability ?? 'live',
      eta: (info as any)?.eta ?? null,
      downloadMode: (info as any)?.downloadMode ?? null,
      totalCards:
        typeof (info as any)?.remoteCardCount === 'number'
          ? (info as any).remoteCardCount
          : undefined,
      buildId: null,
      path: null,
      sha256: null,
      order:
        typeof (info as any)?.order === 'number' ? Number((info as any).order) : undefined,
      retiredAtMs: null,
    }))
    .sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : 9999;
      const bo = typeof b.order === 'number' ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
}

export async function loadHomeDeckSummaries(params: {
  premium: boolean;
}): Promise<HomeDeckSummarySnapshot> {
  const { premium } = params;
  const now = new Date();
  let updates: Record<string, UpdateInfo> = {};
  let manifestDecks: ManifestDeckEntry[] = [];

  try {
    updates = await loadDeckUpdates(premium);
  } catch {
    updates = {};
  }

  try {
    manifestDecks = await listManifestDecks();
  } catch {
    manifestDecks = [];
  }

  const deckEntries =
    manifestDecks.length > 0 ? manifestDecks : toDeckEntriesFromUpdates(updates);

  const allUpcoming30 = buildUpcoming([], now, 30);
  const deckSummaries: DeckSummary[] = [];
  let totalDueAllDecks = 0;

  for (const entry of deckEntries) {
    const availability = String(entry.availability ?? 'live').toLowerCase();
    if (availability === 'retired') {
      continue;
    }

    if (availability === 'coming') {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: entry.totalCards ?? 0,
        localCards: 0,
        studyCards: 0,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      });
      continue;
    }

    const deck = await resolveDeckBySlug(entry.slug);
    const localCards = deck?.Cards?.length ?? (deck as any)?.TotalCards ?? 0;
    const canStudy = !!deck && localCards > 0;
    const declaredTotal =
      typeof entry.totalCards === 'number' && Number.isFinite(entry.totalCards)
        ? entry.totalCards
        : localCards;

    if (!canStudy) {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: declaredTotal,
        localCards,
        studyCards: localCards,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      });
      continue;
    }

    try {
      await applyCachedRemoteProgress((deck as any).Slug);
    } catch {
      // Keep local-only progress if remote cache fails.
    }

    const progress = await loadDeckProgress(deck as any);
    const learned = progress.filter(isLearnedProgress).length;
    const denom = Math.max(1, localCards);
    const upcoming = buildUpcoming(progress, now, 30);
    const dueToday = upcoming[0]?.count ?? 0;
    totalDueAllDecks += dueToday;

    for (let i = 0; i < allUpcoming30.length; i++) {
      allUpcoming30[i].count += upcoming[i]?.count ?? 0;
    }

    deckSummaries.push({
      slug: String((deck as any).Slug),
      title: String((deck as any).Title),
      locale: String((deck as any).Locale),
      version: String((deck as any).Version),
      deckType: Number((deck as any).DeckType ?? 1),
      totalCards: declaredTotal,
      localCards,
      studyCards: localCards,
      canStudy: true,
      tier: entry.tier ?? null,
      availability: entry.availability ?? null,
      eta: entry.eta ?? null,
      downloadMode: entry.downloadMode ?? null,
      order: entry.order,
      dueToday,
      plannedToday: dueToday,
      newToday: Math.max(0, denom - learned),
      masteredApprox: learned,
      percent: clamp01(learned / denom),
    });
  }

  void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });
  return {
    deckSummaries,
    updates,
    allUpcoming30,
    asOfISO: now.toISOString(),
  };
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
