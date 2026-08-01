import type { ViewMode } from '@/stores/settingsStore';

export interface AppNavigationLocation {
  viewMode: ViewMode;
  conversationId: string | null;
}

export interface AppNavigationAvailability {
  canGoBack: boolean;
  canGoForward: boolean;
}

function locationsMatch(a: AppNavigationLocation, b: AppNavigationLocation): boolean {
  return a.viewMode === b.viewMode && a.conversationId === b.conversationId;
}

export class AppNavigationHistory {
  private entries: AppNavigationLocation[];
  private index = 0;
  private readonly limit: number;

  constructor(
    initialLocation: AppNavigationLocation,
    limit = 100,
  ) {
    this.entries = [initialLocation];
    this.limit = limit;
  }

  reset(location: AppNavigationLocation): void {
    this.entries = [location];
    this.index = 0;
  }

  record(location: AppNavigationLocation): boolean {
    const current = this.entries[this.index];
    if (current && locationsMatch(current, location)) return false;

    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(location);
    this.index = this.entries.length - 1;

    if (this.entries.length > this.limit) {
      const overflow = this.entries.length - this.limit;
      this.entries = this.entries.slice(overflow);
      this.index -= overflow;
    }
    return true;
  }

  back(): AppNavigationLocation | null {
    if (this.index <= 0) return null;
    this.index -= 1;
    return this.entries[this.index] ?? null;
  }

  forward(): AppNavigationLocation | null {
    if (this.index >= this.entries.length - 1) return null;
    this.index += 1;
    return this.entries[this.index] ?? null;
  }

  availability(): AppNavigationAvailability {
    return {
      canGoBack: this.index > 0,
      canGoForward: this.index < this.entries.length - 1,
    };
  }
}
