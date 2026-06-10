/**
 * Popup script — shows connection status, auth info, and recent operation logs.
 */

const statusDot = document.getElementById('statusDot')!;
const statusLabel = document.getElementById('statusLabel')!;
const statusDetail = document.getElementById('statusDetail')!;
const reconnectBtn = document.getElementById('reconnectBtn')!;
const infoRow = document.getElementById('infoRow')!;
const logList = document.getElementById('logList')!;

interface StatusResponse {
  connected: boolean;
  lastConnected: number | null;
  reconnecting: boolean;
  port: number | null;
  error: string | null;
  discoveryOk: boolean;
  authenticated: boolean;
  recentOps: { action: string; success: boolean; time: number }[];
}

function updateUI(s: StatusResponse): void {
  statusDot.className = 'status-dot';

  if (s.connected) {
    statusDot.classList.add('connected');
    statusLabel.textContent = 'Connected';
    statusDetail.textContent = `Port ${s.port ?? '?'}`;
  } else if (s.reconnecting) {
    statusDot.classList.add('reconnecting');
    statusLabel.textContent = 'Reconnecting...';
    statusDetail.textContent = s.error
      ? s.error
      : (s.discoveryOk ? 'Bridge found, connecting...' : 'Looking for ruyi-browser-bridge...');
  } else {
    statusDot.classList.add('disconnected');
    statusLabel.textContent = 'Disconnected';
    statusDetail.textContent = s.error ?? 'Make sure ruyi-browser-bridge is running';
  }

  // Info tags
  const tags: string[] = [];
  if (s.discoveryOk) {
    tags.push(`<span class="tag ok">Discovery OK</span>`);
  } else {
    tags.push(`<span class="tag err">No Discovery</span>`);
  }
  if (s.connected) {
    tags.push(s.authenticated
      ? `<span class="tag ok">Auth OK</span>`
      : `<span class="tag warn">No Auth</span>`);
  }
  infoRow.innerHTML = tags.join('');

  // Recent operations log
  const ops = s.recentOps ?? [];
  if (ops.length === 0) {
    logList.innerHTML = '<div class="log-empty">No operations yet</div>';
  } else {
    logList.innerHTML = ops.map(op => {
      const cls = op.success ? 'success' : 'error';
      const icon = op.success ? '✓' : '✗';
      const timeStr = formatTime(op.time);
      return `<div class="log-item ${cls}"><span class="action">${icon} ${escapeHtml(op.action)}</span><span class="time">${timeStr}</span></div>`;
    }).join('');
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    if (response) updateUI(response as StatusResponse);
  });
}

reconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    setTimeout(refreshStatus, 1000);
  });
});

refreshStatus();
setInterval(refreshStatus, 2000);
