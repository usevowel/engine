/**
 * Controls Component
 * 
 * Connect and disconnect buttons
 */

import { useSnapshot } from 'valtio';
import { store } from '../store';
import './Controls.css';

interface ControlsProps {
  onConnect: () => void;
  onDisconnect: () => void;
}

export function Controls({ onConnect, onDisconnect }: ControlsProps) {
  const snap = useSnapshot(store);
  
  return (
    <div className="controls">
      <button
        className="btn btn-primary"
        onClick={onConnect}
        disabled={snap.isConnected}
      >
        {snap.isConnected ? 'Connected' : 'Connect'}
      </button>
      <button
        className="btn btn-secondary"
        onClick={onDisconnect}
        disabled={!snap.isConnected}
      >
        Disconnect
      </button>
    </div>
  );
}

