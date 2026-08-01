import WebSocket from 'ws'

export { WebSocket as MainProcessWebSocket }
export type MainProcessWebSocket = WebSocket

export function createMainProcessWebSocket(url: string): WebSocket {
  return new WebSocket(url)
}
