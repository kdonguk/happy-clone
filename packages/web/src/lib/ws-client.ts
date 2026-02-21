import type { ClientMessage, ServerMessage } from '@happy/shared'

type MessageHandler = (msg: ServerMessage) => void
type ConnectHandler = () => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers: MessageHandler[] = []
  private connectHandlers: ConnectHandler[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false

  constructor(private url: string) {
    // console.log('[WsClient] created with url:', url)
  }

  connect(): void {
    // console.log('[WsClient] connecting...')
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      // console.log('[WsClient] connected!')
      this._connected = true
      for (const h of this.connectHandlers) h()
    }
    this.ws.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(e.data)
      // console.log('[WsClient] received:', msg.type)
      for (const h of this.handlers) h(msg)
    }
    this.ws.onerror = () => {
      // console.error('[WsClient] error:', e)
    }
    this.ws.onclose = () => {
      // console.log('[WsClient] disconnected, reconnecting in 2s...')
      this._connected = false
      this.reconnectTimer = setTimeout(() => this.connect(), 2000)
    }
  }

  get connected(): boolean {
    return this._connected
  }

  send(msg: ClientMessage): void {
    // console.log('[WsClient] send:', msg.type, 'readyState:', this.ws?.readyState)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      // console.warn('[WsClient] not connected, dropping message:', msg.type)
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }

  onConnect(handler: ConnectHandler): () => void {
    this.connectHandlers.push(handler)
    if (this._connected) handler()
    return () => { this.connectHandlers = this.connectHandlers.filter((h) => h !== handler) }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}
