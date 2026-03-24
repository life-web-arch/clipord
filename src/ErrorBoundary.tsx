import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', backgroundColor: '#1a0000', color: '#ffcdd2', minHeight: '100vh', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h1 style={{ color: '#ef5350', fontSize: '24px' }}>Application Crashed</h1>
          <p style={{ color: '#e57373' }}>A critical error occurred. Please screenshot this entire page and report it.</p>
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#2a0000', border: '1px solid #ef5350', borderRadius: '8px' }}>
            <h2 style={{ color: '#ef9a9a', fontSize: '18px' }}>Error Details:</h2>
            <p style={{ color: '#ffcdd2', fontSize: '16px' }}>
              <strong>Message:</strong> {this.state.error?.toString()}
            </p>
            <div style={{ marginTop: '15px', color: '#f48fb1', fontSize: '14px', overflowWrap: 'break-word' }}>
              <strong>Stack Trace:</strong>
              <details>
                <summary>Click to expand</summary>
                <p>{this.state.errorInfo?.componentStack}</p>
              </details>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
