'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-center space-y-3">
            <p className="text-lg text-primary">出现了一些问题</p>
            <p className="text-sm text-tertiary">{this.state.error?.message}</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="rounded-full bg-accent px-6 py-2 text-sm text-white"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
