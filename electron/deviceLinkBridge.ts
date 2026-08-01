import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  createMainProcessWebSocket,
  MainProcessWebSocket,
  type MainProcessWebSocket as MainProcessWebSocketInstance,
} from './nodeWebSocket'
import { pythonBridge } from './pythonBridge'

type RelayEnvelope = {
  v: number
  kind: string
  id?: string
  src?: string
  dst?: string
  ts: number
  payload?: Record<string, unknown>
}

type BridgeConfig = {
  baseUrl: string
  token: string
}

type ApiResult<T> = {
  code: number
  message: string
  data: T
}

const ALLOWED_INVOKES = new Set([
  'project.list',
  'session.list',
  'session.get',
  'turn.send',
  'turn.correct',
  'turn.stop',
])

export class DeviceLinkBridge {
  private config: BridgeConfig | null = null
  private deviceId = ''
  private relay: MainProcessWebSocketInstance | null = null
  private gateway: MainProcessWebSocketInstance | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private sessionPoll: ReturnType<typeof setInterval> | null = null
  private sessionPollInFlight = false
  private relayConnectPromise: Promise<void> | null = null
  private gatewayConnectPromise: Promise<void> | null = null
  private lifecycle = 0
  private intentionalClosures = new WeakSet<MainProcessWebSocketInstance>()
  private stopped = true
  private subscriptions = new Map<string, Set<string>>()
  private lastSessionsJson = ''

  async configure(config: BridgeConfig | null): Promise<{ ok: boolean; deviceId?: string }> {
    const normalized = config?.baseUrl?.replace(/\/+$/, '') ?? ''
    const token = config?.token?.trim() ?? ''
    if (!normalized || !token) {
      this.stop()
      return { ok: true }
    }
    if (this.config?.baseUrl === normalized && this.config?.token === token && !this.stopped) {
      return { ok: true, deviceId: this.deviceId }
    }
    this.stop()
    const lifecycle = this.lifecycle
    this.config = { baseUrl: normalized, token }
    this.stopped = false
    this.deviceId = await this.loadDeviceId()
    if (!this.isCurrentLifecycle(lifecycle)) return { ok: true }
    await this.registerDevice()
    if (!this.isCurrentLifecycle(lifecycle)) return { ok: true }
    void this.connectRelay(lifecycle)
    return { ok: true, deviceId: this.deviceId }
  }

  stop(): void {
    this.lifecycle += 1
    this.stopped = true
    this.config = null
    this.subscriptions.clear()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.sessionPoll) clearInterval(this.sessionPoll)
    this.reconnectTimer = null
    this.heartbeat = null
    this.sessionPoll = null
    this.sessionPollInFlight = false
    if (this.relay) this.closeSocket(this.relay)
    if (this.gateway) this.closeSocket(this.gateway)
    this.relay = null
    this.gateway = null
    this.relayConnectPromise = null
    this.gatewayConnectPromise = null
  }

  private async loadDeviceId(): Promise<string> {
    const file = path.join(app.getPath('userData'), 'device-link.json')
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { deviceId?: string }
      if (parsed.deviceId && /^[A-Za-z0-9_-]{16,64}$/.test(parsed.deviceId)) return parsed.deviceId
    } catch {
      // First launch or a damaged identity file: create a new local identity.
    }
    const deviceId = `desktop_${crypto.randomBytes(20).toString('hex')}`
    await fs.writeFile(file, JSON.stringify({ deviceId }, null, 2), { mode: 0o600 })
    return deviceId
  }

  private async hubRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
    if (!this.config) throw new Error('PromptHub device link is not configured')
    const response = await fetch(`${this.config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
        ...(init?.headers ?? {}),
      },
    })
    const body = await response.json() as ApiResult<T>
    if (!response.ok || body.code !== 200) {
      throw new Error(body.message || `PromptHub HTTP ${response.status}`)
    }
    return body.data
  }

  private async registerDevice(): Promise<void> {
    await this.hubRequest('/api/device-link/devices', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: this.deviceId,
        name: `${process.platform === 'darwin' ? 'Mac' : process.platform} · TPACowork`,
        platform: process.platform,
        deviceType: 'desktop',
        appVersion: app.getVersion(),
      }),
    })
  }

  private async connectRelay(lifecycle = this.lifecycle): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycle)) return
    if (
      this.relay?.readyState === MainProcessWebSocket.OPEN
      || this.relay?.readyState === MainProcessWebSocket.CONNECTING
    ) return
    if (this.relayConnectPromise) return this.relayConnectPromise
    const connection = this.openRelay(lifecycle)
    this.relayConnectPromise = connection
    try {
      await connection
    } finally {
      if (this.relayConnectPromise === connection) this.relayConnectPromise = null
    }
  }

  private async openRelay(lifecycle: number): Promise<void> {
    try {
      const ticket = await this.hubRequest<{ ticket: string; wsPath: string }>('/api/device-link/ws-ticket', {
        method: 'POST',
        body: JSON.stringify({ deviceId: this.deviceId }),
      })
      if (!this.isCurrentLifecycle(lifecycle) || !this.config) return
      const base = new URL(this.config.baseUrl)
      const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = createMainProcessWebSocket(
        `${scheme}//${base.host}${ticket.wsPath}?ticket=${encodeURIComponent(ticket.ticket)}`,
      )
      this.relay = socket
      socket.addEventListener('open', () => {
        if (!this.isCurrentLifecycle(lifecycle) || this.relay !== socket) {
          this.closeSocket(socket)
          return
        }
        this.reconnectAttempt = 0
        this.sendRelay({ v: 1, kind: 'hello', ts: Date.now(), payload: {} })
        this.heartbeat = setInterval(() => {
          this.sendRelay({ v: 1, kind: 'ping', id: `ping_${Date.now()}`, ts: Date.now(), payload: {} })
        }, 20_000)
        void this.ensureGateway().catch((error) => {
          console.warn('[DeviceLink] Nanobot gateway connect failed:', error)
        })
      })
      socket.addEventListener('message', (event) => {
        try {
          void this.handleRelay(JSON.parse(String(event.data)) as RelayEnvelope)
        } catch (error) {
          console.warn('[DeviceLink] Ignoring malformed relay event:', error)
        }
      })
      socket.addEventListener('error', (event) => {
        if (this.intentionalClosures.has(socket) || !this.isCurrentLifecycle(lifecycle)) return
        console.warn(
          '[DeviceLink] Relay socket error:',
          event.error instanceof Error ? event.error.message : event.message,
        )
      })
      socket.addEventListener('close', () => {
        if (!this.isCurrentLifecycle(lifecycle) || this.relay !== socket) return
        this.relay = null
        if (this.heartbeat) clearInterval(this.heartbeat)
        this.heartbeat = null
        if (this.gateway) this.closeSocket(this.gateway)
        this.gateway = null
        this.scheduleReconnect(lifecycle)
      })
    } catch (error) {
      if (!this.isCurrentLifecycle(lifecycle)) return
      console.warn('[DeviceLink] Relay connect failed:', error)
      this.scheduleReconnect(lifecycle)
    }
  }

  private scheduleReconnect(lifecycle: number): void {
    if (!this.isCurrentLifecycle(lifecycle) || this.reconnectTimer) return
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.isCurrentLifecycle(lifecycle)) void this.connectRelay(lifecycle)
    }, delay)
  }

  private async ensureGateway(): Promise<void> {
    if (
      this.gateway?.readyState === MainProcessWebSocket.OPEN
      || this.gateway?.readyState === MainProcessWebSocket.CONNECTING
    ) return
    if (!pythonBridge.isReady) throw new Error('nanobot is not ready')
    if (this.gatewayConnectPromise) return this.gatewayConnectPromise
    const lifecycle = this.lifecycle
    const connection = this.openGateway(lifecycle)
    this.gatewayConnectPromise = connection
    try {
      await connection
    } finally {
      if (this.gatewayConnectPromise === connection) this.gatewayConnectPromise = null
    }
  }

  private async openGateway(lifecycle: number): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${pythonBridge.port}/webui/bootstrap`, {
      headers: { 'X-Nanobot-Auth': pythonBridge.tokenSecret },
    })
    if (!response.ok) throw new Error(`nanobot bootstrap failed: ${response.status}`)
    const bootstrap = await response.json() as { token: string; ws_path: string; ws_url?: string }
    if (!this.isCurrentLifecycle(lifecycle)) return
    const url = bootstrap.ws_url && /^wss?:\/\//.test(bootstrap.ws_url)
      ? `${bootstrap.ws_url}${bootstrap.ws_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(bootstrap.token)}`
      : `ws://127.0.0.1:${pythonBridge.port}${bootstrap.ws_path}?token=${encodeURIComponent(bootstrap.token)}`
    const socket = createMainProcessWebSocket(url)
    this.gateway = socket
    socket.addEventListener('open', () => {
      if (!this.isCurrentLifecycle(lifecycle) || this.gateway !== socket) {
        this.closeSocket(socket)
        return
      }
      for (const topic of this.subscriptions.keys()) {
        if (topic.startsWith('session:')) {
          socket.send(JSON.stringify({ type: 'attach', chat_id: topic.slice('session:'.length) }))
        }
      }
    })
    socket.addEventListener('message', (event) => this.forwardGatewayEvent(String(event.data)))
    socket.addEventListener('error', (event) => {
      if (this.intentionalClosures.has(socket) || !this.isCurrentLifecycle(lifecycle)) return
      console.warn(
        '[DeviceLink] Nanobot gateway socket error:',
        event.error instanceof Error ? event.error.message : event.message,
      )
    })
    socket.addEventListener('close', () => {
      if (this.isCurrentLifecycle(lifecycle) && this.gateway === socket) this.gateway = null
    })
    if (!this.sessionPoll) {
      this.sessionPoll = setInterval(() => void this.publishSessionListIfChanged(), 3000)
    }
  }

  private isCurrentLifecycle(lifecycle: number): boolean {
    return !this.stopped && lifecycle === this.lifecycle && this.config !== null
  }

  private closeSocket(socket: MainProcessWebSocketInstance): void {
    if (
      socket.readyState === MainProcessWebSocket.CLOSING
      || socket.readyState === MainProcessWebSocket.CLOSED
    ) return
    this.intentionalClosures.add(socket)
    socket.close()
  }

  private async handleRelay(event: RelayEnvelope): Promise<void> {
    if (event.kind === 'presence_changed') {
      const controllerId = String(event.payload?.deviceId ?? '')
      const online = Boolean(event.payload?.online)
      if (controllerId && !online) {
        for (const [topic, subscribers] of this.subscriptions) {
          subscribers.delete(controllerId)
          if (!subscribers.size) this.subscriptions.delete(topic)
        }
      }
      return
    }
    if (!event.src) return
    if (event.kind === 'subscribe' || event.kind === 'unsubscribe') {
      const topic = String(event.payload?.topic ?? '')
      if (!topic || (!topic.startsWith('session:') && topic !== 'sessions')) return
      const subscribers = this.subscriptions.get(topic) ?? new Set<string>()
      if (event.kind === 'subscribe') subscribers.add(event.src)
      else subscribers.delete(event.src)
      if (subscribers.size) this.subscriptions.set(topic, subscribers)
      else this.subscriptions.delete(topic)
      if (event.kind === 'subscribe' && topic.startsWith('session:')) {
        await this.ensureGateway()
        const gateway = await this.waitGatewayOpen()
        gateway.send(JSON.stringify({ type: 'attach', chat_id: topic.slice('session:'.length) }))
      }
      return
    }
    if (event.kind !== 'invoke' || !event.id) return
    const channel = String(event.payload?.channel ?? '')
    if (!ALLOWED_INVOKES.has(channel)) {
      this.invokeResult(event, false, null, 'remote channel denied')
      return
    }
    try {
      const result = await this.invoke(channel, (event.payload?.args ?? {}) as Record<string, unknown>)
      this.invokeResult(event, true, result)
    } catch (error) {
      this.invokeResult(event, false, null, error instanceof Error ? error.message : String(error))
    }
  }

  private async invoke(channel: string, args: Record<string, unknown>): Promise<unknown> {
    if (channel === 'project.list') return this.gatewayGet('/api/projects')
    if (channel === 'session.list') {
      const payload = await this.gatewayGet('/api/sessions')
      return this.limitSessionList(payload, args.limit)
    }
    if (channel === 'session.get') {
      const sessionId = this.requireSessionId(args)
      await this.ensureGateway()
      const gateway = await this.waitGatewayOpen()
      gateway.send(JSON.stringify({ type: 'attach', chat_id: sessionId }))
      const key = sessionId.startsWith('websocket:') ? sessionId : `websocket:${sessionId}`
      const encoded = encodeURIComponent(key)
      const [thread, runtime] = await Promise.all([
        this.gatewayGet(`/api/sessions/${encoded}/webui-thread?direction=latest&limit=100`, true),
        this.gatewayGet(`/api/sessions/${encoded}/runtime-snapshot`, true),
      ])
      return { sessionId, thread, runtime }
    }
    if (channel === 'turn.send' || channel === 'turn.correct') {
      const sessionId = this.requireSessionId(args)
      const content = String(args.content ?? '').trim()
      if (!content || content.length > 20_000) throw new Error('invalid message content')
      await this.ensureGateway()
      const gateway = await this.waitGatewayOpen()
      gateway.send(JSON.stringify({ type: 'attach', chat_id: sessionId }))
      gateway.send(JSON.stringify({ type: 'message', chat_id: sessionId, content, webui: true }))
      return { accepted: true, sessionId }
    }
    if (channel === 'turn.stop') {
      const sessionId = this.requireSessionId(args)
      await this.ensureGateway()
      const gateway = await this.waitGatewayOpen()
      gateway.send(JSON.stringify({ type: 'message', chat_id: sessionId, content: '/stop', webui: true }))
      return { accepted: true, sessionId }
    }
    throw new Error('unsupported remote command')
  }

  private requireSessionId(args: Record<string, unknown>): string {
    const value = String(args.sessionId ?? args.chatId ?? '').trim()
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error('invalid session id')
    return value.startsWith('websocket:') ? value.slice('websocket:'.length) : value
  }

  private async waitGatewayOpen(timeoutMs = 5000): Promise<MainProcessWebSocketInstance> {
    const socket = this.gateway
    if (!socket) throw new Error('nanobot is not connected')
    if (socket.readyState === MainProcessWebSocket.OPEN) return socket
    if (socket.readyState !== MainProcessWebSocket.CONNECTING) throw new Error('nanobot connection is closed')
    return new Promise<MainProcessWebSocketInstance>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('nanobot connection timed out'))
      }, timeoutMs)
      const onOpen = () => {
        cleanup()
        resolve(socket)
      }
      const onClose = () => {
        cleanup()
        reject(new Error('nanobot connection closed during handshake'))
      }
      const cleanup = () => {
        clearTimeout(timeout)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('close', onClose)
      }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('close', onClose)
    })
  }

  private async gatewayGet(pathname: string, allowNotFound = false): Promise<unknown> {
    if (!pythonBridge.isReady) throw new Error('nanobot is not ready')
    const bootstrapResponse = await fetch(`http://127.0.0.1:${pythonBridge.port}/webui/bootstrap`, {
      headers: { 'X-Nanobot-Auth': pythonBridge.tokenSecret },
    })
    if (!bootstrapResponse.ok) throw new Error('nanobot authentication failed')
    const bootstrap = await bootstrapResponse.json() as { token: string }
    const response = await fetch(`http://127.0.0.1:${pythonBridge.port}${pathname}`, {
      headers: { Authorization: `Bearer ${bootstrap.token}` },
    })
    if (allowNotFound && response.status === 404) return null
    if (!response.ok) throw new Error(`nanobot HTTP ${response.status}`)
    return response.json()
  }

  private invokeResult(request: RelayEnvelope, ok: boolean, result?: unknown, error?: string): void {
    this.sendRelay({
      v: 1,
      kind: 'invoke_result',
      id: request.id,
      dst: request.src,
      ts: Date.now(),
      payload: ok ? { ok: true, result } : { ok: false, error },
    })
  }

  private forwardGatewayEvent(raw: string): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const chatId = String(parsed.chat_id ?? '')
    if (!chatId) return
    const subscribers = this.subscriptions.get(`session:${chatId}`)
    if (!subscribers) return
    for (const controllerId of subscribers) {
      this.sendRelay({
        v: 1,
        kind: 'push',
        dst: controllerId,
        ts: Date.now(),
        payload: { channel: 'session.event', event: parsed },
      })
    }
  }

  private async publishSessionListIfChanged(): Promise<void> {
    if (!(this.subscriptions.get('sessions')?.size) || this.sessionPollInFlight) return
    this.sessionPollInFlight = true
    try {
      const sessions = this.limitSessionList(await this.gatewayGet('/api/sessions'), 500)
      const serialized = JSON.stringify(sessions)
      if (serialized === this.lastSessionsJson) return
      this.lastSessionsJson = serialized
      for (const controllerId of this.subscriptions.get('sessions') ?? []) {
        this.sendRelay({
          v: 1,
          kind: 'push',
          dst: controllerId,
          ts: Date.now(),
          payload: { channel: 'sessions.changed', snapshot: sessions },
        })
      }
    } catch {
      // The desktop gateway may be restarting; the next poll will rehydrate state.
    } finally {
      this.sessionPollInFlight = false
    }
  }

  private sendRelay(message: RelayEnvelope): boolean {
    if (!this.relay || this.relay.readyState !== MainProcessWebSocket.OPEN) return false
    this.relay.send(JSON.stringify(message))
    return true
  }

  private limitSessionList(payload: unknown, requestedLimit: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload
    const sessions = (payload as { sessions?: unknown }).sessions
    if (!Array.isArray(sessions)) return payload
    const numericLimit = typeof requestedLimit === 'number' && Number.isFinite(requestedLimit)
      ? Math.trunc(requestedLimit)
      : 10
    const limit = Math.max(1, Math.min(500, numericLimit))
    return {
      ...(payload as Record<string, unknown>),
      sessions: sessions.slice(0, limit),
    }
  }
}

export const deviceLinkBridge = new DeviceLinkBridge()
