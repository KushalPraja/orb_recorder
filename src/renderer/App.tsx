import React, { useState, useCallback, useEffect } from 'react';
import { Titlebar } from './components/Titlebar';
import { HomePage } from './pages/HomePage';
import { RecordPage } from './pages/RecordPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import type { Page, ReviewData, NavigateFunction } from './types';

function ThemeApplicator() {
  const { settings } = useSettings();
  useEffect(() => {
    const theme = settings?.theme || 'dark';
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [settings?.theme]);
  return null;
}

function AppContent() {
  const [page, setPage] = useState<Page>('home');
  const [recordingResult, setRecordingResult] = useState<ReviewData | null>(null);

  const navigateTo: NavigateFunction = useCallback((target, data) => {
    if (target === 'review' && data) {
      setRecordingResult(data);
    }
    setPage(target);
  }, []);

  return (
    <>
      <ThemeApplicator />
      <Titlebar currentPage={page} onNavigate={navigateTo} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {page === 'home' && <HomePage onNavigate={navigateTo} />}
        {page === 'record' && <RecordPage onNavigate={navigateTo} />}
        {page === 'review' && (
          <ReviewPage data={recordingResult} onNavigate={navigateTo} />
        )}
        {page === 'settings' && <SettingsPage onNavigate={navigateTo} />}
      </main>
    </>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}
