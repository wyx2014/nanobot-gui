import { create } from 'zustand';

type CustomizeTab = 'skills' | 'agents' | 'mcp' | 'models';

interface CustomizeState {
  showCustomize: boolean;
  activeTab: CustomizeTab;
  installingItem: string | null;
  searchQuery: string;
}

interface CustomizeActions {
  openCustomize: (tab?: CustomizeTab) => void;
  closeCustomize: () => void;
  toggleCustomize: () => void;
  setActiveTab: (tab: CustomizeTab) => void;
  setInstallingItem: (itemId: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export type CustomizeStore = CustomizeState & CustomizeActions;

export const useCustomizeStore = create<CustomizeStore>()((set) => ({
  showCustomize: false,
  activeTab: 'skills',
  installingItem: null,
  searchQuery: '',

  openCustomize: (tab) =>
    set((s) => ({
      showCustomize: true,
      activeTab: tab ?? s.activeTab,
      searchQuery: '',
    })),

  closeCustomize: () =>
    set({
      showCustomize: false,
      installingItem: null,
      searchQuery: '',
    }),

  toggleCustomize: () =>
    set((s) => ({
      showCustomize: !s.showCustomize,
      searchQuery: '',
    })),

  setActiveTab: (tab) => set({ activeTab: tab, searchQuery: '' }),

  setInstallingItem: (itemId) => set({ installingItem: itemId }),

  setSearchQuery: (query) => set({ searchQuery: query }),
}));
