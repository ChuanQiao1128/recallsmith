import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence above the navigator. Renders a retry screen instead of
 * letting a render error take the whole app down. Logs with console.error only:
 * 1.6.0 ships no crash reporter (no Sentry — see B00 §0), so the log line is what
 * a dev-client / TestFlight console shows.
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[recallsmith] root error boundary', error, info.componentStack ?? '');
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View testID="root-error-boundary" style={styles.root}>
          <Text style={styles.title}>Something went wrong</Text>
          <Pressable testID="root-error-retry" accessibilityRole="button" onPress={this.reset} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
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
    backgroundColor: '#F5F3FF',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  button: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#4F46E5',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
  },
});

export default RootErrorBoundary;
