import { SESSION_MAIN_ROUTE_DEFAULT, SESSION_MIN_GOAL } from '../constants';
import type { DeckSummary, HomeVM, RoutePreviewNode, TodayCounts } from '../contracts';

function buildRoutePreview(selectedDeck: DeckSummary | null): RoutePreviewNode[] {
  if (!selectedDeck || !selectedDeck.canStudy) {
    return [
      {
        id: 'empty',
        role: 'warmup',
        title: 'No active route yet',
        subtitle: 'Install or unlock a deck first, then today’s route will appear here.',
      },
    ];
  }

  const due = selectedDeck.dueToday;
  const fresh = Math.min(selectedDeck.newToday, 2);
  const total = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, Math.max(due, 1) + (due === 0 ? fresh : Math.min(fresh, 1))));
  const hasBoss = due >= 3;
  const hasElite = due >= 2 || fresh >= 1;

  const nodes: RoutePreviewNode[] = [];

  for (let i = 0; i < total; i++) {
    const isFirst = i === 0;
    const isLast = i === total - 1;
    const role = isFirst ? 'warmup' : isLast && hasBoss ? 'boss' : hasElite && i === total - 2 ? 'elite' : 'normal';

    const title =
      role === 'warmup'
        ? 'Warm-up node'
        : role === 'boss'
          ? 'Boss check'
          : role === 'elite'
            ? 'Elite review'
            : 'Normal node';

    const subtitle =
      role === 'warmup'
        ? 'Low-friction first win to keep momentum.'
        : role === 'boss'
          ? 'A tougher recall check to close the run.'
          : role === 'elite'
            ? 'One higher-pressure card in the middle.'
            : 'Standard recall / learning step.';

    nodes.push({ id: `${role}-${i}`, role, title, subtitle });
  }

  return nodes;
}

function buildCounts(deckSummaries: DeckSummary[], selectedDeck: DeckSummary | null): TodayCounts {
  const totalDueAllDecks = deckSummaries.reduce((sum, deck) => sum + (deck.canStudy ? deck.dueToday : 0), 0);

  const routePreview = buildRoutePreview(selectedDeck);
  const normalCount = routePreview.filter((node) => node.role === 'warmup' || node.role === 'normal').length;
  const eliteCount = routePreview.filter((node) => node.role === 'elite').length;
  const bossCount = routePreview.filter((node) => node.role === 'boss').length;

  return {
    totalDueAllDecks,
    selectedDue: selectedDeck?.dueToday ?? 0,
    selectedNew: selectedDeck?.newToday ?? 0,
    selectedMastered: selectedDeck?.masteredApprox ?? 0,
    normalCount,
    eliteCount,
    bossCount,
  };
}

export function buildHomeVM(params: {
  deckSummaries: DeckSummary[];
  selectedSlug: string | null;
  hasSignedInUser: boolean;
}): HomeVM {
  const { deckSummaries, selectedSlug, hasSignedInUser } = params;
  const selectedDeck = deckSummaries.find((deck) => deck.slug === selectedSlug) ?? deckSummaries[0] ?? null;
  const counts = buildCounts(deckSummaries, selectedDeck);
  const routePreview = buildRoutePreview(selectedDeck);

  if (!selectedDeck) {
    return {
      hero: {
        eyebrow: 'Today',
        title: 'Get your first deck ready',
        subtitle: 'Once a deck is installed, today’s challenge will show up here.',
        helper: 'Open a deck first, then come back to start a short daily run.',
        ctaLabel: 'No deck available yet',
        ctaAction: 'none',
        ctaDisabled: true,
      },
      counts,
      routePreview,
      selectedDeckTitle: null,
      drawStatusLabel: 'No active deck yet',
    };
  }

  if (!selectedDeck.canStudy) {
    return {
      hero: {
        eyebrow: selectedDeck.title,
        title: 'Finish setup, then start today’s run',
        subtitle: 'This deck is not ready for study yet.',
        helper: 'Download or unlock the deck first. Your challenge button will become available automatically.',
        ctaLabel: 'Open deck',
        ctaAction: 'deck',
        ctaDisabled: false,
      },
      counts,
      routePreview,
      selectedDeckTitle: selectedDeck.title,
      drawStatusLabel: 'Deck not installed yet',
    };
  }

  const hasTodayWork = selectedDeck.dueToday > 0 || selectedDeck.newToday > 0;
  const title =
    selectedDeck.dueToday > 0
      ? `${selectedDeck.dueToday} due today in ${selectedDeck.title}`
      : selectedDeck.newToday > 0
        ? `A short fresh run is ready in ${selectedDeck.title}`
        : `You are clear for now in ${selectedDeck.title}`;

  const subtitle = hasTodayWork
    ? `${counts.normalCount} normal · ${counts.eliteCount} elite · ${counts.bossCount} boss max`
    : 'No pressure day — review later or browse your decks.';

  const helper = hasTodayWork
    ? `Clear ${SESSION_MIN_GOAL} node to keep momentum. A full run is capped at ${SESSION_MAIN_ROUTE_DEFAULT} nodes.`
    : hasSignedInUser
      ? 'You can review again later, or open another deck while today is light.'
      : 'Sign in later for backup and extended planning, but today you are already clear.';

  return {
    hero: {
      eyebrow: 'Today',
      title,
      subtitle,
      helper,
      ctaLabel: hasTodayWork ? 'Start today’s challenge' : 'Open deck',
      ctaAction: hasTodayWork ? 'challenge' : 'deck',
      ctaDisabled: false,
    },
    counts,
    routePreview,
    selectedDeckTitle: selectedDeck.title,
    drawStatusLabel: hasTodayWork ? 'New pulls unlock after you clear today’s work.' : 'No pending pressure right now.',
  };
}
