// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  createMainProcessWebSocket,
  MainProcessWebSocket,
} from './nodeWebSocket'

const servers: WebSocketServer[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('main-process WebSocket', () => {
  it('connects without a browser WebSocket global', async () => {
    vi.stubGlobal('WebSocket', undefined)
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('WebSocket test server did not bind to a TCP port')
    }

    const socket = createMainProcessWebSocket(`ws://127.0.0.1:${address.port}`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    expect(socket.readyState).toBe(MainProcessWebSocket.OPEN)
    socket.close()
    await new Promise<void>((resolve) => socket.once('close', resolve))
  })

  it('can observe a handshake failure without recursively closing the socket', async () => {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      verifyClient: () => false,
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('WebSocket test server did not bind to a TCP port')
    }

    const socket = createMainProcessWebSocket(`ws://127.0.0.1:${address.port}`)
    const error = await new Promise<Error>((resolve, reject) => {
      let connectionError: Error | null = null
      socket.once('error', (value) => {
        connectionError = value
      })
      socket.once('close', () => {
        if (connectionError) resolve(connectionError)
        else reject(new Error('Socket closed without reporting the handshake failure'))
      })
    })

    expect(error.message).toContain('Unexpected server response')
    expect(socket.readyState).toBe(MainProcessWebSocket.CLOSED)
  })
})
