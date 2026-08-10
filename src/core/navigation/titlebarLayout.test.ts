import { describe, expect, it } from 'vitest';

import { resolveTitlebarLayout } from './titlebarLayout';

describe('resolveTitlebarLayout', () => {
  it('places a collapsed macOS conversation after the title-bar navigation', () => {
    expect(resolveTitlebarLayout({
      isMac: true,
      isFullScreen: false,
      sidebarCollapsed: true,
      sidebarVisible: false,
    })).toEqual({
      navigationLeft: 92,
      conversationLeadingInset: 196,
    });
  });

  it('keeps the normal conversation padding when the macOS sidebar is visible', () => {
    expect(resolveTitlebarLayout({
      isMac: true,
      isFullScreen: false,
      sidebarCollapsed: false,
      sidebarVisible: true,
    }).conversationLeadingInset).toBe(12);
  });

  it('accounts for fullscreen and native-titlebar layouts', () => {
    expect(resolveTitlebarLayout({
      isMac: true,
      isFullScreen: true,
      sidebarCollapsed: true,
      sidebarVisible: false,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 116,
    });

    expect(resolveTitlebarLayout({
      isMac: false,
      isFullScreen: false,
      sidebarCollapsed: false,
      sidebarVisible: true,
    })).toEqual({
      navigationLeft: 232,
      conversationLeadingInset: 76,
    });
  });
});
