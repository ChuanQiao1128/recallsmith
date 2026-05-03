/** @v7 deck install gate only */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import {
  checkManifestForUpdates,
  installDeckFromUrl,
  listManifestDecks,
  resolveDeckBySlug,
  type ManifestDeckEntry,
  type UpdateInfo,
} from '../content/deckRepository';
import { fetchPremiumDeckUrl } from '../content/premiumDeckApi';
import { useAuthUser, useAuthStore } from '../auth/authStore';
import { usePremiumUser } from '../premium/premiumStore';
import { isPremiumActive, rcGetCustomerInfoSafe } from '../premium/revenuecat';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'Deck'>;

type GateActionKind =
  | 'open-library'
  | 'install'
  | 'update'
  | 'trial-start'
  | 'paywall'
  | 'sign-in'
  | 'coming'
  | 'none';

type DeckGateState = {
  loading: boolean;
  error: string | null;
  slug: string | null;
  deckTitle: string;
  deckCardCount: number;
  manifestEntry: ManifestDeckEntry | null;
  updateInfo: UpdateInfo | null;
};

const INITIAL_STATE: DeckGateState = {
  loading: true,
  error: null,
  slug: null,
  deckTitle: 'Deck',
  deckCardCount: 0,
  manifestEntry: null,
  updateInfo: null,
};

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function isPremiumDeck(entry: ManifestDeckEntry | null): boolean {
  if (!entry) return false;
  return Number(entry.deckType ?? 1) !== 1 || lower(entry.tier) === 'premium';
}

function resolveGateAction(params: {
  hasLocalDeck: boolean;
  manifestEntry: ManifestDeckEntry | null;
  updateInfo: UpdateInfo | null;
  premium: boolean;
  signedIn: boolean;
}): GateActionKind {
  const { hasLocalDeck, manifestEntry, updateInfo, premium, signedIn } = params;

  if (lower(manifestEntry?.availability ?? 'live') === 'coming') {
    return 'coming';
  }

  const premiumDeck = isPremiumDeck(manifestEntry);
  const hasRemote = !!updateInfo?.remoteUrl && !!updateInfo.remoteVersion;

  if (premiumDeck && !premium) {
    if (hasLocalDeck) {
      return 'open-library';
    }
    if (!signedIn) {
      return 'sign-in';
    }
    return hasRemote ? 'trial-start' : 'paywall';
  }

  if (!hasLocalDeck) {
    return hasRemote ? 'install' : 'none';
  }

  if (updateInfo?.hasUpdate && hasRemote) {
    return 'update';
  }

  return 'open-library';
}

function actionCopy(kind: GateActionKind): { title: string; body: string; primary: string } {
  if (kind === 'install') {
    return {
      title: 'Install required',
      body: 'Install this deck once, then browse and review from Library.',
      primary: 'Install deck',
    };
  }
  if (kind === 'update') {
    return {
      title: 'Update available',
      body: 'Apply the latest deck update before your next challenge run.',
      primary: 'Update deck',
    };
  }
  if (kind === 'trial-start') {
    return {
      title: 'Premium trial preview',
      body: 'Install the free preview to review sample cards while premium stays locked.',
      primary: 'Start free trial',
    };
  }
  if (kind === 'paywall') {
    return {
      title: 'Premium required',
      body: 'Upgrade to unlock this full deck.',
      primary: 'Upgrade',
    };
  }
  if (kind === 'sign-in') {
    return {
      title: 'Sign in required',
      body: 'Sign in first to access the premium trial preview.',
      primary: 'Sign in',
    };
  }
  if (kind === 'coming') {
    return {
      title: 'Coming soon',
      body: 'This deck is announced but not published yet.',
      primary: 'Back',
    };
  }
  if (kind === 'none') {
    return {
      title: 'Deck not ready',
      body: 'No install package is available yet for this deck.',
      primary: 'Back',
    };
  }
  return {
    title: 'Ready',
    body: 'This deck is installed. Continue in Library.',
    primary: 'Open library',
  };
}

export function DeckScreen({ navigation, route }: Props) {
  const [state, setState] = useState<DeckGateState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);

  const authInit = useAuthStore((s) => s.init);
  const { status: authStatus, isSignedIn } = useAuthUser();
  const premium = usePremiumUser();

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      if (authStatus === 'unknown') {
        await authInit();
      }

      if (isSignedIn) {
        try {
          const info = await rcGetCustomerInfoSafe();
          void isPremiumActive(info);
        } catch {
          // Entitlement check is best effort for this screen.
        }
      }

      const manifest = await listManifestDecks();
      const liveEntries = manifest.filter((entry) => lower(entry.availability ?? 'live') !== 'retired');

      const chosenSlug =
        route.params?.slug ?? (await loadActiveDeckSlug()) ?? liveEntries[0]?.slug ?? null;

      if (!chosenSlug) {
        throw new Error('No deck available.');
      }

      const [deck, updates] = await Promise.all([
        resolveDeckBySlug(chosenSlug),
        checkManifestForUpdates(premium).catch(() => ({} as Record<string, UpdateInfo>)),
      ]);

      const entry = liveEntries.find((item) => item.slug === chosenSlug) ?? null;
      const title = deck?.Title ?? entry?.title ?? chosenSlug;
      const count = deck?.Cards?.length ?? deck?.TotalCards ?? entry?.totalCards ?? 0;

      await setActiveDeckSlug(chosenSlug);

      setState({
        loading: false,
        error: null,
        slug: chosenSlug,
        deckTitle: title,
        deckCardCount: count,
        manifestEntry: entry,
        updateInfo: updates[chosenSlug] ?? null,
      });
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e?.message ?? 'Failed to load deck gate.',
      }));
    }
  }, [authInit, authStatus, isSignedIn, premium, route.params?.slug]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const gateAction = useMemo(() => {
    const hasLocalDeck = state.deckCardCount > 0;
    return resolveGateAction({
      hasLocalDeck,
      manifestEntry: state.manifestEntry,
      updateInfo: state.updateInfo,
      premium,
      signedIn: isSignedIn,
    });
  }, [isSignedIn, premium, state.deckCardCount, state.manifestEntry, state.updateInfo]);

  const copy = actionCopy(gateAction);

  const runInstall = useCallback(async () => {
    if (!state.slug || !state.updateInfo?.remoteVersion) {
      Alert.alert('Install unavailable', 'This deck package is not ready yet.');
      return;
    }

    let remoteUrl = state.updateInfo.remoteUrl;
    if (!remoteUrl && isPremiumDeck(state.manifestEntry) && isSignedIn) {
      const premiumPayload = await fetchPremiumDeckUrl(state.slug);
      remoteUrl = premiumPayload.url;
    }

    if (!remoteUrl) {
      Alert.alert('Install unavailable', 'Unable to resolve a download URL right now.');
      return;
    }

    const ok = await installDeckFromUrl(
      state.slug,
      remoteUrl,
      state.updateInfo.remoteVersion,
      state.updateInfo.remoteSha256,
    );

    if (!ok) {
      Alert.alert('Install failed', 'Please try again in a moment.');
      return;
    }

    await setActiveDeckSlug(state.slug);
    await refresh();
    navigation.navigate('Library');
  }, [isSignedIn, navigation, refresh, state.manifestEntry, state.slug, state.updateInfo]);

  const handlePrimary = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (gateAction === 'open-library') {
        if (state.slug) {
          await setActiveDeckSlug(state.slug);
        }
        navigation.navigate('Library');
        return;
      }

      if (gateAction === 'install' || gateAction === 'update' || gateAction === 'trial-start') {
        await runInstall();
        return;
      }

      if (gateAction === 'paywall') {
        navigation.navigate('Paywall');
        return;
      }

      if (gateAction === 'sign-in') {
        navigation.navigate('SignIn');
        return;
      }

      navigation.goBack();
    } finally {
      setBusy(false);
    }
  }, [busy, gateAction, navigation, runInstall, state.slug]);

  if (state.loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading deck gate...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (state.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <Text style={styles.errorTitle} numberOfLines={2}>
              Deck unavailable
            </Text>
            <Text style={styles.errorBody} numberOfLines={2}>
              {state.error}
            </Text>
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => void refresh()}>
              <Text style={styles.secondaryButtonText} numberOfLines={1}>
                Retry
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
            <Text style={styles.backText} numberOfLines={1}>
              ← Back
            </Text>
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              Deck gate
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {state.deckTitle}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {state.deckCardCount} cards
            </Text>

            <View style={styles.rule} />

            <Text style={styles.stateTitle} numberOfLines={1}>
              {copy.title}
            </Text>
            <Text style={styles.stateBody} numberOfLines={2}>
              {copy.body}
            </Text>

            {state.updateInfo?.remoteVersion ? (
              <Text style={styles.versionLine} numberOfLines={1}>
                Remote version: {state.updateInfo.remoteVersion}
              </Text>
            ) : null}

            <Pressable
              testID="deck-gate-primary-cta"
              style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}
              onPress={() => void handlePrimary()}
              disabled={busy}
            >
              <Text style={styles.primaryButtonText} numberOfLines={1}>
                {busy ? 'Working...' : copy.primary}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DeckScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  errorTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '900',
  },
  errorBody: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
  backButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  backText: {
    color: colors.ink,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  card: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  eyebrow: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    marginTop: spacing.xs,
    fontSize: typography.title2,
    color: colors.ink,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  rule: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    height: 1,
    backgroundColor: 'rgba(42,34,24,0.14)',
  },
  stateTitle: {
    fontSize: typography.body,
    color: colors.ink,
    fontWeight: '800',
  },
  stateBody: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    lineHeight: 18,
  },
  versionLine: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  primaryButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '900',
  },
  secondaryButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '700',
  },
  pressed: { opacity: 0.9 },
});
