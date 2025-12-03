// mobile/App.tsx
import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Linking,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Constants from 'expo-constants';

import type { RootStackParamList } from './src/navigation/types';
import { HomeScreen } from './src/screens/HomeScreen';
import { DeckScreen } from './src/screens/DeckScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';

// TODO: 换成你真实的 S3 / 静态网站地址
// 例如： https://your-bucket.s3.us-east-1.amazonaws.com/recallsmith-config.json
const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';

const Stack = createNativeStackNavigator<RootStackParamList>();

interface RemoteConfig {
  latestVersion?: string;
  minSupportedVersion?: string;
  iosAppStoreUrl?: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(x => parseInt(x, 10) || 0);
  const pb = b.split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export default function App() {
  const [checkingUpdate, setCheckingUpdate] = useState(true);
  const [mustUpdate, setMustUpdate] = useState(false);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [softUpdateAvailable, setSoftUpdateAvailable] = useState(false);

  // 从 expo 的配置中读当前 app 版本（app.json 里的 expo.version）
  const appVersion: string =
    (Constants.expoConfig as any)?.version ?? '1.0.0';

  useEffect(() => {
    let cancelled = false;

    async function checkUpdate() {
      try {
        const res = await fetch(REMOTE_CONFIG_URL, {
          // 尽量不要缓存
          cache: 'no-store' as any,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as RemoteConfig;

        if (cancelled) return;

        const minSupported = json.minSupportedVersion;
        const latest = json.latestVersion;
        const url = json.iosAppStoreUrl ?? null;

        if (minSupported && compareVersions(appVersion, minSupported) < 0) {
          // 当前版本 < 最低支持版本 → 必须更新
          setMustUpdate(true);
          setStoreUrl(url);
        } else if (latest && compareVersions(appVersion, latest) < 0) {
          // 当前版本 < 最新版本 → 有可选更新（只提示，不强制）
          setSoftUpdateAvailable(true);
          setStoreUrl(url);
        }
      } catch (e) {
        // 拉配置失败：静默忽略，不打断使用
        console.log('Update check failed:', e);
      } finally {
        if (!cancelled) {
          setCheckingUpdate(false);
        }
      }
    }

    checkUpdate();

    return () => {
      cancelled = true;
    };
  }, [appVersion]);

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerShown: false, // 一定是 boolean
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Deck" component={DeckScreen} />
          <Stack.Screen name="Review" component={ReviewScreen} />
        </Stack.Navigator>
      </NavigationContainer>

      {/* 强制更新遮罩 */}
      {mustUpdate && (
        <UpdateRequiredOverlay
          appVersion={appVersion}
          storeUrl={storeUrl}
        />
      )}

      {/* 可选更新的小提示（页底的小条，非必须） */}
      {!mustUpdate && softUpdateAvailable && (
        <SoftUpdateBanner
          storeUrl={storeUrl}
          onClose={() => setSoftUpdateAvailable(false)}
        />
      )}
    </View>
  );
}

interface UpdateRequiredProps {
  appVersion: string;
  storeUrl: string | null;
}

function UpdateRequiredOverlay({ appVersion, storeUrl }: UpdateRequiredProps) {
  const handlePress = () => {
    if (storeUrl) {
      Linking.openURL(storeUrl).catch(() => {});
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayRoot]}>
      <View style={styles.overlayCard}>
        <Text style={styles.overlayTitle}>Update required</Text>
        <Text style={styles.overlayBody}>
          A newer version of RecallSmith is now available. To keep using
          this app, please update to the latest version in the App Store.
        </Text>
        <Text style={styles.overlayMeta}>Current version: {appVersion}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.overlayButton,
            pressed && styles.overlayButtonPressed,
          ]}
          onPress={handlePress}
        >
          <Text style={styles.overlayButtonText}>Update in App Store</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface SoftUpdateBannerProps {
  storeUrl: string | null;
  onClose: () => void;
}

function SoftUpdateBanner({ storeUrl, onClose }: SoftUpdateBannerProps) {
  const handlePress = () => {
    if (storeUrl) {
      Linking.openURL(storeUrl).catch(() => {});
    }
  };

  return (
    <View style={styles.bannerWrapper} pointerEvents="box-none">
      <View style={styles.bannerCard}>
        <Text style={styles.bannerText}>
          A newer version is available. Enjoy the latest improvements.
        </Text>
        <View style={styles.bannerActions}>
          <Pressable onPress={onClose}>
            <Text style={styles.bannerSkip}>Later</Text>
          </Pressable>
          <Pressable onPress={handlePress}>
            <Text style={styles.bannerUpdate}>Update</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    width: '82%',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  overlayBody: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 10,
  },
  overlayMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 16,
  },
  overlayButton: {
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 10,
    alignItems: 'center',
  },
  overlayButtonPressed: {
    opacity: 0.9,
  },
  overlayButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  bannerWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bannerCard: {
    marginBottom: 10,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    color: '#E5E7EB',
    marginRight: 8,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerSkip: {
    fontSize: 12,
    color: '#9CA3AF',
    marginRight: 8,
  },
  bannerUpdate: {
    fontSize: 12,
    color: '#A5B4FC',
    fontWeight: '600',
  },
});