import React from 'react';
import type { Page, NavigateFunction } from '../types';
import logo from '../Document.svg';
interface TitlebarProps {
  currentPage: Page;
  onNavigate: NavigateFunction;
}

export function Titlebar({ currentPage, onNavigate }: TitlebarProps) {

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <img className="titlebar-logo" src={logo} alt="Orb" />
        <span className="titlebar-brand">ORB</span>
        <div className="titlebar-nav">
          <button
            className={`titlebar-btn ${currentPage === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}
            title="Recordings"
          >
            <span>Recordings</span>
          </button>
          <button
            className={`titlebar-btn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() =>
              onNavigate(currentPage === 'settings' ? 'home' : 'settings')
            }
            title="Settings"
          >
            <span>Settings</span>
          </button>
        </div>
      </div>
      <div className="titlebar-spacer" />
    </div>
  );
}
