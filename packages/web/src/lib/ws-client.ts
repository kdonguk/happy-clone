import type { ClientMessage, ServerMessage } from '@happy/shared'

type MessageHandler = (msg: ServerMessage) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers: MessageHandler[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private url: string) {}

  connect(): void {
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(e.data)
      for (const h of this.handlers) h(msg)
    }
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 2000)
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}
