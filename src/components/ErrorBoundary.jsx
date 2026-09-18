import React from 'react';
import SafeIcon from '@/common/SafeIcon';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 bg-slate-900/90 border border-red-500/20 rounded-xl m-4 text-center">
          <SafeIcon name="AlertTriangle" className="text-red-400 text-3xl mb-3" />
          <h2 className="text-red-400 font-bold mb-2">Component Crashed</h2>
          <p className="text-gray-400 text-sm font-mono">{this.state.error?.message || 'An unexpected rendering error occurred.'}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
