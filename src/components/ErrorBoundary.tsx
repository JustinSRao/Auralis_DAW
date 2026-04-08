import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; info: ErrorInfo | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (error) {
      return (
        <div style={{
          background: '#1a1a1a', color: '#ff6b6b', fontFamily: 'monospace',
          padding: '32px', height: '100vh', overflow: 'auto',
        }}>
          <h2 style={{ color: '#ff4444', marginBottom: 16 }}>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 24 }}>
            {error.message}
          </pre>
          <details open>
            <summary style={{ cursor: 'pointer', color: '#aaa', marginBottom: 8 }}>Component stack</summary>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#888', fontSize: 12 }}>
              {info?.componentStack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
