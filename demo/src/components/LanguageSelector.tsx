/**
 * Language Selector Component
 * 
 * Allows users to select the language for the voice agent.
 * Supports the 6 languages available via AssemblyAI STT.
 */

import { useSnapshot } from 'valtio';
import { store, actions } from '../store';
import './LanguageSelector.css';

/**
 * Supported languages (STT + TTS)
 */
const SUPPORTED_LANGUAGES = [
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'es', label: 'Spanish', flag: '🇪🇸' },
  { value: 'fr', label: 'French', flag: '🇫🇷' },
  { value: 'de', label: 'German', flag: '🇩🇪' },
  { value: 'it', label: 'Italian', flag: '🇮🇹' },
  { value: 'pt', label: 'Portuguese', flag: '🇵🇹' },
] as const;

export function LanguageSelector() {
  const snap = useSnapshot(store);
  
  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const language = e.target.value;
    actions.setLanguage(language);
  };
  
  const handleDetectionToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    actions.setLanguageDetectionEnabled(e.target.checked);
  };
  
  return (
    <div className="language-selector">
      <div className="language-selector-row">
        <label htmlFor="language-select" className="language-selector-label">
          🌍 Language:
        </label>
        <select
          id="language-select"
          className="language-selector-select"
          value={snap.selectedLanguage}
          onChange={handleLanguageChange}
          disabled={snap.isConnected}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
      </div>
      
      <div className="language-selector-row">
        <label className="language-selector-checkbox-label">
          <input
            type="checkbox"
            className="language-selector-checkbox"
            checked={snap.languageDetectionEnabled}
            onChange={handleDetectionToggle}
            disabled={snap.isConnected}
          />
          <span>Auto-detect language from speech</span>
        </label>
      </div>
      
      {snap.isConnected && (
        <span className="language-selector-note">
          (Disconnect to change language settings)
        </span>
      )}
      
      {snap.languageDetectionEnabled && !snap.isConnected && (
        <div className="language-selector-info">
          <span className="info-icon">ℹ️</span>
          <span className="info-text">
            Language detection enabled. The system will automatically switch to the language you speak.
            Selected language ({SUPPORTED_LANGUAGES.find(l => l.value === snap.selectedLanguage)?.label}) will be used as default/fallback.
          </span>
        </div>
      )}
    </div>
  );
}
