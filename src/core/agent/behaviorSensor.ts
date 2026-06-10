/**
 * Behavior Sensor — window sampling for user work pattern awareness
 *
 * Samples the active window title every 5 minutes.
 * Raw data stored at ~/.ruyi/behavior-log.json (7-day retention).
 * Aggregates injected into system prompt as 3-5 line summary.
 *
 * Privacy: default OFF, only window titles (no content/screenshots),
 * raw data never injected — only aggregated stats.
 */

import { ipc, fsBridge, osBridge } from '@/lib/ipc-factory';
import { ensureParentDir, joinPath } from '../../utils/pathUtils';

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RETENTION_DAYS = 7;

interface ActiveWindowInfo {
  app_name: string;
  window_title: string;
}

export interface BehaviorSample {
  appName: string;
  timestamp: number;
  hour: number; // 0-23
}

// --- Storage ---

let cachedHome: string | null = null;

async function getLogPath(): Promise<string> {
  if (!cachedHome) cachedHome = await osBridge.homeDir();
  return joinPath(cachedHome, '.ruyi', 'behavior-log.json');
}

async function readBehaviorLog(): Promise<BehaviorSample[]> {
  try {
    const path = await getLogPath();
    const raw = await fsBridge.readTextFile(path);
    return JSON.parse(raw) as BehaviorSample[];
  } catch {
    return [];
  }
}

async function writeBehaviorLog(samples: BehaviorSample[]): Promise<void> {
  const path = await getLogPath();
  await ensureParentDir(path);
  await fsBridge.writeTextFile(path, JSON.stringify(samples));
}

/**
 * Remove samples older than RETENTION_DAYS.
 */
function pruneOldSamples(samples: BehaviorSample[]): BehaviorSample[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return samples.filter((s) => s.timestamp > cutoff);
}

// --- Sampling ---

let samplingTimer: ReturnType<typeof setInterval> | null = null;

async function takeSample(): Promise<void> {
  try {
    const info = await ipc.invoke<ActiveWindowInfo>('get_active_window');
    if (!info.app_name) return;

    const now = Date.now();
    const hour = new Date(now).getHours();

    const sample: BehaviorSample = {
      appName: info.app_name,
      timestamp: now,
      hour,
    };

    const samples = await readBehaviorLog();
    const pruned = pruneOldSamples(samples);
    pruned.push(sample);
    await writeBehaviorLog(pruned);
  } catch (err) {
    // Silently fail — sensor is non-critical
    console.debug('[BehaviorSensor] Sample failed:', err);
  }
}

/**
 * Test if we have permission to read the active window.
 * Returns true if accessible, false if denied.
 */
export async function testWindowPermission(): Promise<boolean> {
  try {
    await ipc.invoke<ActiveWindowInfo>('get_active_window');
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the behavior sensor (periodic sampling).
 */
export function startBehaviorSensor(): void {
  if (samplingTimer) return;
  // Take an initial sample
  takeSample().catch(() => {});
  samplingTimer = setInterval(() => {
    takeSample().catch(() => {});
  }, SAMPLE_INTERVAL_MS);
  console.log('[BehaviorSensor] Started (5min interval)');
}

/**
 * Stop the behavior sensor.
 */
export function stopBehaviorSensor(): void {
  if (samplingTimer) {
    clearInterval(samplingTimer);
    samplingTimer = null;
    console.log('[BehaviorSensor] Stopped');
  }
}

/**
 * Clear all behavior data.
 */
export async function clearBehaviorData(): Promise<void> {
  await writeBehaviorLog([]);
}

// --- Aggregation ---

interface AppUsage {
  appName: string;
  minutes: number;
}

/**
 * Build a concise work pattern summary for system prompt injection.
 * Returns empty string if no data or sensor disabled.
 */
export async function buildBehaviorSummary(): Promise<string> {
  const samples = await readBehaviorLog();
  if (samples.length === 0) return '';

  const now = Date.now();
  const todaySamples = samples.filter(
    (s) => now - s.timestamp < 24 * 60 * 60 * 1000
  );

  // App usage today (each sample ≈ 5 min)
  const appMinutes = new Map<string, number>();
  for (const s of todaySamples) {
    appMinutes.set(s.appName, (appMinutes.get(s.appName) ?? 0) + 5);
  }

  const topApps: AppUsage[] = [...appMinutes.entries()]
    .map(([appName, minutes]) => ({ appName, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  // Active hours (from all data)
  const hourCounts = new Map<number, number>();
  for (const s of samples) {
    hourCounts.set(s.hour, (hourCounts.get(s.hour) ?? 0) + 1);
  }

  // Find peak hours (top 40% of activity)
  const sortedHours = [...hourCounts.entries()].sort((a, b) => b[1] - a[1]);
  const peakCount = Math.max(1, Math.ceil(sortedHours.length * 0.4));
  const peakHours = sortedHours
    .slice(0, peakCount)
    .map(([h]) => h)
    .sort((a, b) => a - b);

  // Format peak hours into ranges
  const hourRanges = formatHourRanges(peakHours);

  // Current app
  const latestSample = todaySamples[todaySamples.length - 1];

  const lines: string[] = [];

  if (topApps.length > 0) {
    const appStr = topApps
      .map((a) => `${a.appName} ${formatMinutes(a.minutes)}`)
      .join(', ');
    lines.push(`- 今日: ${appStr}`);
  }

  if (latestSample) {
    lines.push(`- 当前: 正在使用 ${latestSample.appName}`);
  }

  if (hourRanges) {
    lines.push(`- 常用时段: ${hourRanges}`);
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = (minutes / 60).toFixed(1);
    return `${h}h`;
  }
  return `${minutes}min`;
}

function formatHourRanges(hours: number[]): string {
  if (hours.length === 0) return '';

  const ranges: string[] = [];
  let start = hours[0];
  let end = hours[0];

  for (let i = 1; i < hours.length; i++) {
    if (hours[i] === end + 1) {
      end = hours[i];
    } else {
      ranges.push(start === end ? `${start}:00` : `${start}-${end + 1}`);
      start = hours[i];
      end = hours[i];
    }
  }
  ranges.push(start === end ? `${start}:00` : `${start}-${end + 1}`);

  return ranges.join(', ');
}
