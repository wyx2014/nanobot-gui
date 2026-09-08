/** Local development may skip visual effects; production always retains them. */
export function isDevLowPowerMode(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_LOW_POWER !== '0';
}
