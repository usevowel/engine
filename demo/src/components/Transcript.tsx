/**
 * Transcript Component
 * 
 * Displays the conversation transcript
 */

import { useEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';
import { store } from '../store';
import './Transcript.css';

export function Transcript() {
  const snap = useSnapshot(store);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [snap.transcript.length]);

  if (snap.transcript.length === 0) {
    return (
      <div className="transcript">
        <div className="transcript-empty">
          <p>No messages yet. Connect and start speaking!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript" ref={listRef}>
      {snap.transcript.map((message) => (
        <div key={message.id} className={`transcript-message role-${message.role}`}>
          <div className="message-role">{message.role}</div>
          <div className="message-text">{message.text}</div>
          <div className="message-time">
            {message.timestamp.toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}

