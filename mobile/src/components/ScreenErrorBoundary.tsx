import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reportClientError } from '../telemetry/clientErrorReporter';

type Props = {
  screen: string;
  onGoHome: () => void;
  children: React.ReactNode;
};
type State = { error: Error | null };

/**
 * Wraps a single stack screen (installed on the navigator via `screenLayout`) so
 * one broken secondary screen no longer blanks the whole app. On a render error
 * it shows a small fallback offering "Try again" (remount this screen) and
 * "Back to Home" (reset navigation), and reports the error to the interim client
 * error reporter (MSHELL-12).
 */
export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[recallsmith] screen error boundary', this.props.screen, error, info.componentStack ?? '');
    reportClientError(error, { screen: this.props.screen, kind: 'boundary' });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private goHome = () => {
    this.setState({ error: null });
    this.props.onGoHome();
  };

  render() {
    if (this.state.error) {
      return (
        <View testID="screen-error-boundary" style={styles.root}>
          <Text style={styles.title}>Something went wrong on this screen.</Text>
          <Pressable
            testID="screen-error-retry"
            accessibilityRole="button"
            onPress={this.reset}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
          <Pressable
            testID="screen-error-home"
            accessibilityRole="button"
            onPress={this.goHome}
            style={styles.buttonSecondary}
          >
            <Text style={styles.buttonSecondaryText}>Back to Home</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FBF7EF',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#3F3323',
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#8A6D3B',
  },
  buttonText: {
    color: '#FFFDF7',
    fontWeight: '700',
  },
  buttonSecondary: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#8A6D3B',
  },
  buttonSecondaryText: {
    color: '#8A6D3B',
    fontWeight: '700',
  },
});

export default ScreenErrorBoundary;
