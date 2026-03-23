/**
 * Status Indicator Component
 * 
 * Shows the current connection status with color-coded indicators
 * and animations.
 */

import { useSnapshot } from 'valtio';
import { store } from '../store';
import './StatusIndicator.css';

export function StatusIndicator() {
  const snap = useSnapshot(store);
  
  return (
    <div className={`status-indicator status-${snap.status}`}>
      <div className="status-dot" />
      <div className="status-message">{snap.statusMessage}</div>
    </div>
  );
}

