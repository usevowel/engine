/**
 * Environment Selector Component
 * 
 * Allows users to select the deployment environment for the voice agent.
 */

import { useSnapshot } from 'valtio';
import { store, actions } from '../store';
import { ENVIRONMENTS } from '../config';
import './EnvironmentSelector.css';

export function EnvironmentSelector() {
  const snap = useSnapshot(store);
  
  const handleEnvironmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const environmentId = e.target.value;
    actions.setEnvironment(environmentId);
    
    // Clear custom URL when switching away from custom
    if (environmentId !== 'custom') {
      actions.setCustomEnvironmentUrl('');
    }
  };
  
  const handleCustomUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    actions.setCustomEnvironmentUrl(e.target.value);
  };
  
  return (
    <div className="environment-selector">
      <label htmlFor="environment-select" className="environment-label">
        Environment:
      </label>
      <select
        id="environment-select"
        className="environment-select"
        value={snap.selectedEnvironment}
        onChange={handleEnvironmentChange}
        disabled={snap.isConnected}
      >
        {Object.values(ENVIRONMENTS).map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
          </option>
        ))}
        <option value="custom">Custom...</option>
      </select>
      
      {snap.selectedEnvironment === 'custom' && (
        <input
          type="text"
          className="environment-custom-input"
          placeholder="Enter base URL (e.g., https://example.com)"
          value={snap.customEnvironmentUrl}
          onChange={handleCustomUrlChange}
          disabled={snap.isConnected}
        />
      )}
      
      {snap.isConnected && (
        <span className="environment-note">
          (Disconnect to change environment)
        </span>
      )}
    </div>
  );
}
