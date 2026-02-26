import React, { useState, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { HomePage } from './pages/HomePage';
import { RecordPage } from './pages/RecordPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsProvider } from './contexts/SettingsContext';
import type { Page, ReviewData, NavigateFunction } from './types';

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [recordingResult, setRecordingResult] = useState<ReviewData | null>(null);

  const navigateTo: NavigateFunction = useCallback((target, data) => {
    if (target === 'review' && data) {
      setRecordingResult(data);
    }
    setPage(target);
  }, []);

  return (
    <SettingsProvider>
      <Titlebar currentPage={page} onNavigate={navigateTo} />
      <main
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {page === 'home' && <HomePage onNavigate={navigateTo} />}
        {page === 'record' && <RecordPage onNavigate={navigateTo} />}
        {page === 'review' && (
          <ReviewPage data={recordingResult} onNavigate={navigateTo} />
        )}
        {page === 'settings' && <SettingsPage onNavigate={navigateTo} />}
      </main>
    </SettingsProvider>
  );
}
