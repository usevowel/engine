/**
 * Main App Component
 */

import { VoiceAgent } from './components/VoiceAgent';
import { EnvironmentSelector } from './components/EnvironmentSelector';
import { ProviderModelSelector } from './components/ProviderModelSelector';
import { LanguageSelector } from './components/LanguageSelector';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🎙️ sndbrd Voice Agent</h1>
          <p className="subtitle">
            Real-time Voice AI with Multiple LLM Providers
          </p>
        </header>

        <EnvironmentSelector />
        <ProviderModelSelector />
        <LanguageSelector />
        <VoiceAgent />
      </div>
    </div>
  );
}

