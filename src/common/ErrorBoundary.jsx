import React from 'react';
import SafeIcon from './SafeIcon';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload() {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] p-8 text-center space-y-6">
          <div className="w-24 h-24 rounded-full bg-red-600/10 border border-red-500/30 flex items-center justify-center">
            <SafeIcon name="AlertTriangle" className="text-5xl text-red-500" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-red-500 font-mono tracking-widest uppercase shadow-red-500/50">
              [SYSTEM_ANOMALY] Component Render Interrupted
            </h2>
            <p className="text-sm text-gray-400 max-w-lg mx-auto font-mono">
              A runtime exception breached the presentation layer. The interface has been shielded to prevent cascading failures.
            </p>
          </div>

          <div className="p-4 bg-[#111827] border border-red-500/20 rounded-lg max-w-2xl w-full text-left overflow-hidden">
            <p className="text-xs font-mono text-red-400 break-words">
              {this.state.error?.toString()}
            </p>
          </div>

          <button
            onClick={this.handleReload}
            className="px-6 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-400 rounded-lg text-xs font-bold transition-all uppercase tracking-widest flex items-center gap-2"
          >
            <SafeIcon name="RefreshCw" className="text-sm" />
            Reload View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
