declare const __TPCOWORK_BUILD__: { id: string; revision: string; dirty: boolean; created_at: string };

export const buildIdentity = typeof __TPCOWORK_BUILD__ === 'undefined'
  ? { id: 'development', revision: 'unknown', dirty: true, created_at: '' }
  : __TPCOWORK_BUILD__;
