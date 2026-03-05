// Renderer-specific shared types

export type Page = 'home' | 'record' | 'review' | 'settings';

export interface ReviewData {
  sessionDir: string;
  name?: string;
  size?: number;
  filePath?: string;
  fromHome?: boolean;
  duration?: number;
}

export type NavigateFunction = (page: Page, data?: ReviewData) => void;
