import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 32,
            background: 'var(--bg-main, #f8fafc)',
            color: 'var(--text-primary, #0f172a)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 22, fontWeight: 700, color: 'var(--navy-900, #0f172a)' }}>
            Something went wrong
          </h2>
          <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary, #64748b)', maxWidth: 500, fontSize: 14 }}>
            An unexpected error occurred while rendering this page.
          </p>
          {this.state.error && (
            <div
              style={{
                maxWidth: 600,
                width: '100%',
                padding: '12px 16px',
                marginBottom: 24,
                background: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: 8,
                color: '#e11d48',
                fontSize: 13,
                textAlign: 'left',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.toString()}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '9px 18px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload Page
            </button>
            <button
              onClick={this.handleReset}
              style={{
                padding: '9px 18px',
                borderRadius: 6,
                border: 'none',
                background: '#0ea5e9',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
