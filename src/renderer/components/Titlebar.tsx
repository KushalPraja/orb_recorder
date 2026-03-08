import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Page, NavigateFunction } from '../types';
import logo from '../Document.svg';

interface TitlebarProps {
  currentPage: Page;
  onNavigate: NavigateFunction;
}

export function Titlebar({ currentPage, onNavigate }: TitlebarProps) {
  return (
    <div
      className="h-10 flex items-center justify-between px-4 bg-card/50 backdrop-blur-xl border-b border-border/50 shrink-0 relative z-[100]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex items-center gap-2.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5">
          <img className="w-4 h-4 block" src={logo} alt="Orb" />
          <span className="text-xs font-bold tracking-tight text-foreground uppercase">
            ORB
          </span>
        </div>
        <div className="w-px h-3.5 bg-border/60" />
        <div className="flex items-center gap-0.5">
          <Button
            variant={currentPage === 'home' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onNavigate('home')}
            className={cn(
              'text-xs h-6 rounded-md px-2.5',
              currentPage === 'home'
                ? 'text-foreground bg-secondary/80'
                : 'text-muted-foreground hover:text-foreground'
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            Recordings
          </Button>
          <Button
            variant={currentPage === 'settings' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() =>
              onNavigate(currentPage === 'settings' ? 'home' : 'settings')
            }
            className={cn(
              'text-xs h-6 rounded-md px-2.5',
              currentPage === 'settings'
                ? 'text-foreground bg-secondary/80'
                : 'text-muted-foreground hover:text-foreground'
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            Settings
          </Button>
        </div>
      </div>
      <div className="min-w-[140px] h-full" />
    </div>
  );
}
