import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import BottomTabBar from '../components/BottomTabBar';
import { getMainTabForRouteName, shouldShowMainTabBar } from './mainTabs';
import type { RouteNameStore } from './routeNameStore';
import { statusBarStyleForRoute } from './statusBarStyle';

// The only part of the shell that re-renders on navigation (MSHELL-21). It
// subscribes to the route-name store and renders both the route-driven status
// bar style (MSHELL-07) and the tab bar block that used to live in App.tsx —
// same visibility rule, same wrapper and styles, same navigate semantics (G04).
export function TabBarHost(props: {
  routeStore: RouteNameStore;
  navigate: (route: string, params?: any) => void;
}) {
  const routeName = useSyncExternalStore(props.routeStore.subscribe, props.routeStore.get);
  const activeMainTab = getMainTabForRouteName(routeName);

  return (
    <>
      <StatusBar style={statusBarStyleForRoute(routeName)} />
      {activeMainTab && shouldShowMainTabBar(routeName) ? (
        <SafeAreaView style={styles.mainTabSafeArea} edges={['bottom']}>
          <View style={styles.mainTabBarShell}>
            <BottomTabBar active={activeMainTab} navigate={props.navigate} />
          </View>
        </SafeAreaView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  mainTabSafeArea: {
    backgroundColor: '#F5F3FF',
  },
  mainTabBarShell: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#F5F3FF',
  },
});
