import React from 'react';
import { Settings, ArrowLeft } from 'lucide-react';

export function Titlebar({ currentPage, onNavigate }) {
  const showBack = currentPage !== 'home';

  return (
    <div className="titlebar">
      {showBack ? (
        <button
          className="titlebar-btn"
          onClick={() => onNavigate('home')}
          title="Back to recordings"
        >
          <ArrowLeft size={14} />
          <span>Back</span>
        </button>
      ) : (
        <span className="titlebar-title">Recorder</span>
      )}
      <div className="titlebar-nav">
        <button
          className={`titlebar-btn ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate(currentPage === 'settings' ? 'home' : 'settings')}
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
