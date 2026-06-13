import type { LLMProvider, ApiFormat } from './index';

// ============================================================
// Marketplace Types for Skills, Agents, and model presets
// ============================================================

/** Marketplace item for Skills and Agents */
export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  isBuiltin?: boolean;
  content?: string; // SKILL.md or AGENT.md content
  trigger?: string;  // Display-only trigger summary for marketplace cards
  tags?: string[];   // Display-only tags for marketplace cards
}

/** Model preset for quick switching */
export interface ModelPreset {
  id: string;
  name: string;
  provider: LLMProvider;
  apiFormat: ApiFormat;
  model: string;
  baseUrl?: string;
  description: string;
}

/** Installation source for installed items */
export type InstallSource = 'builtin' | 'user' | 'project';
