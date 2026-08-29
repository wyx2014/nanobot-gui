import { describe, expect, it } from 'vitest';

import { resolveTitlebarLayout } from './titlebarLayout';

describe('resolveTitlebarLayout', () => {
  it('places a collapsed macOS conversation after the title-bar navigation', () => {
    expect(resolveTitlebarLayout({
      isMac: true,
      isWindows: false,
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
      isWindows: false,
      isFullScreen: false,
      sidebarCollapsed: false,
      sidebarVisible: true,
    }).conversationLeadingInset).toBe(12);
  });

  it('accounts for fullscreen and Linux overlay layouts', () => {
    expect(resolveTitlebarLayout({
      isMac: true,
      isWindows: false,
      isFullScreen: true,
      sidebarCollapsed: true,
      sidebarVisible: false,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 116,
    });

    expect(resolveTitlebarLayout({
      isMac: false,
      isWindows: false,
      isFullScreen: false,
      sidebarCollapsed: false,
      sidebarVisible: true,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 12,
    });

    expect(resolveTitlebarLayout({
      isMac: false,
      isWindows: false,
      isFullScreen: false,
      sidebarCollapsed: true,
      sidebarVisible: false,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 116,
    });
  });

  it('keeps Windows controls in the upper-left overlay without shifting content headers', () => {
    expect(resolveTitlebarLayout({
      isMac: false,
      isWindows: true,
      isFullScreen: false,
      sidebarCollapsed: false,
      sidebarVisible: true,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 12,
    });

    expect(resolveTitlebarLayout({
      isMac: false,
      isWindows: true,
      isFullScreen: false,
      sidebarCollapsed: true,
      sidebarVisible: false,
    })).toEqual({
      navigationLeft: 12,
      conversationLeadingInset: 12,
    });
  });
});
