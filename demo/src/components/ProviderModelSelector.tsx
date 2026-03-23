/**
 * Provider and Model Selector Component
 * 
 * Allows users to select the LLM provider and model for the voice agent.
 */

import { useSnapshot } from 'valtio';
import { store, actions } from '../store';
import './ProviderModelSelector.css';

/**
 * Model definitions for each provider
 */
const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  groq: [
    { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    // Note: QN 235B not available on GROQ
  ],
  cerebras: [
    { value: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
    { value: 'qwen-3-235b-a22b-instruct-2507', label: 'Qwen 3 235B' },
  ],
  openrouter: [
    { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { value: 'qwen/qwen3-235b-a22b-2507', label: 'Qwen 3 235B' },
  ],
};

export function ProviderModelSelector() {
  const snap = useSnapshot(store);
  
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as 'groq' | 'cerebras' | 'openrouter';
    actions.setProvider(provider);
    
    // Reset to first model for the provider
    const models = PROVIDER_MODELS[provider];
    if (models && models.length > 0) {
      actions.setModel(models[0].value);
    }
    actions.setCustomModel('');
  };
  
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    if (model === 'custom') {
      actions.setModel('custom');
    } else {
      actions.setModel(model);
      actions.setCustomModel('');
    }
  };
  
  const handleCustomModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    actions.setCustomModel(e.target.value);
  };
  
  const availableModels = PROVIDER_MODELS[snap.selectedProvider] || [];
  const isCustomModel = snap.selectedModel === 'custom';
  const effectiveModel = isCustomModel ? snap.customModel : snap.selectedModel;
  
  return (
    <div className="provider-model-selector">
      <div className="provider-model-row">
        <label htmlFor="provider-select" className="provider-model-label">
          Provider:
        </label>
        <select
          id="provider-select"
          className="provider-model-select"
          value={snap.selectedProvider}
          onChange={handleProviderChange}
          disabled={snap.isConnected}
        >
          <option value="groq">GROQ</option>
          <option value="cerebras">Cerebras</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>
      
      <div className="provider-model-row">
        <label htmlFor="model-select" className="provider-model-label">
          Model:
        </label>
        <select
          id="model-select"
          className="provider-model-select"
          value={snap.selectedModel}
          onChange={handleModelChange}
          disabled={snap.isConnected}
        >
          {availableModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
          <option value="custom">Custom...</option>
        </select>
      </div>
      
      {isCustomModel && (
        <div className="provider-model-row">
          <input
            type="text"
            className="provider-model-custom-input"
            placeholder={`Enter ${snap.selectedProvider} model name (e.g., ${availableModels[0]?.value || 'model-name'})`}
            value={snap.customModel}
            onChange={handleCustomModelChange}
            disabled={snap.isConnected}
          />
        </div>
      )}
      
      {snap.isConnected && (
        <span className="provider-model-note">
          (Disconnect to change provider/model)
        </span>
      )}
      
      {effectiveModel && !snap.isConnected && (
        <div className="provider-model-info">
          Using: <strong>{snap.selectedProvider}</strong> / <strong>{effectiveModel}</strong>
        </div>
      )}
    </div>
  );
}
