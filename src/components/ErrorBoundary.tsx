import React, { Component } from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';
import { Logger } from '../utils/Logger';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorText: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorText: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorText: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Logger.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorText: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.subtitle}>
            We encountered an unexpected error. Please try again.
          </Text>
          {/* In dev, we might show the error, but in prod, keep it generic */}
          {__DEV__ && <Text style={styles.devError}>{this.state.errorText}</Text>}
          
          <View style={styles.buttonContainer}>
             <Button title="Try Again" onPress={this.handleRetry} />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0F172A', // Using dark theme background fallback
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
  },
  devError: {
    marginTop: 20,
    color: '#EF4444',
    fontFamily: 'monospace',
    backgroundColor: '#1E293B',
    padding: 10,
    borderRadius: 8,
    width: '100%',
  },
  buttonContainer: {
    marginTop: 20,
  },
});
