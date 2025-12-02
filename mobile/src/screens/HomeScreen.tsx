// mobile/src/screens/HomeScreen.tsx
import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>RecallSmith – JS Core Starter</Text>
        <Text style={styles.subtitle}>
          Minimal navigation test screen.
        </Text>

        <Pressable
          onPress={() => navigation.navigate('Review')}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>Go to Review</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#e5e7eb',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});