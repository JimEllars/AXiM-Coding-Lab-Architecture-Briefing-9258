import React from 'react';
import SafeIcon from './SafeIcon';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught exception:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[#0a0f1c] border border-red-500/30 rounded-2xl">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
            <SafeIcon name="AlertTriangle" className="text-red-400 text-3xl" />
          </div>
          <h2 className="text-xl font-bold text-red-400 mb-2 font-mono uppercase tracking-widest">
            [SYSTEM_ANOMALY] Component Render Interrupted
          </h2>
          <p className="text-gray-400 text-sm max-w-md mb-8">
            The autonomous interface caught an unhandled exception. State recovery mechanisms are standing by.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-bold uppercase tracking-widest transition-all"
          >
            Reload Dashboard Workspace
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
