/**
 * Debug Panel Component
 * 
 * Displays debug information and allows exporting debug data
 */

import { useState } from 'react';
import { useSnapshot } from 'valtio';
import { store, actions } from '../store';
import './DebugPanel.css';

export function DebugPanel() {
  const snap = useSnapshot(store);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleDownloadDebug = () => {
    const debugData = actions.exportDebugData();
    const blob = new Blob([JSON.stringify(debugData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sndbrd-debug-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyDebug = async () => {
    try {
      const debugData = actions.exportDebugData();
      const jsonString = JSON.stringify(debugData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  };

  const handleClearDebug = () => {
    if (confirm('Clear debug log?')) {
      actions.clearDebugLog();
    }
  };

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <h3>🐛 Debug Panel</h3>
        <div className="debug-stats">
          <span className="stat">
            Events: <strong>{snap.debugLog.length}</strong>
          </span>
          <span className="stat">
            Messages: <strong>{snap.transcript.length}</strong>
          </span>
        </div>
      </div>

      <div className="debug-actions">
        <button
          className="btn btn-debug"
          onClick={handleCopyDebug}
          title="Copy debug data to clipboard"
          disabled={copyStatus !== 'idle'}
        >
          {copyStatus === 'idle' && '📋 Copy Debug Log'}
          {copyStatus === 'copied' && '✅ Copied!'}
          {copyStatus === 'error' && '❌ Failed'}
        </button>
        <button
          className="btn btn-debug"
          onClick={handleDownloadDebug}
          title="Download debug data as JSON"
        >
          📥 Download
        </button>
        <button
          className="btn btn-clear"
          onClick={handleClearDebug}
          title="Clear debug log"
        >
          🗑️ Clear
        </button>
      </div>

      <div className="debug-log">
        <div className="debug-log-header">Recent Events (last 10)</div>
        <div className="debug-log-content">
          {snap.debugLog.slice(-10).reverse().map((event, idx) => (
            <div key={idx} className={`debug-event debug-event-${event.type}`}>
              <span className="debug-time">
                {event.timestamp.toLocaleTimeString()}
              </span>
              <span className="debug-type">[{event.category || event.type}]</span>
              <span className="debug-message">{event.message}</span>
            </div>
          ))}
          {snap.debugLog.length === 0 && (
            <div className="debug-empty">No events yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

