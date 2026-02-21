import { WebSocketServer, WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@happy/shared'
import { SessionManager } from './session-manager.js'

interface WsServerOptions {
  port: number
}

export function createWsServer(manager: SessionManager, opts: WsServerOptions) {
  const wss = new WebSocketServer({ port: opts.port })
  const subscriptions = new Map<WebSocket, Set<string>>()

  function broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data)
    }
  }

  function sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  manager.onEvent((sessionId, event, data) => {
    if (event === 'output') {
      const msg: ServerMessage = { type: 'session:output', sessionId, text: data as string }
      for (const [client, subs] of subscriptions) {
        if (subs.has(sessionId)) sendTo(client, msg)
      }
    } else if (event === 'ended') {
      broadcast({ type: 'session:ended', sessionId })
    }
  })

  wss.on('connection', (ws) => {
    subscriptions.set(ws, new Set())

    ws.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        sendTo(ws, { type: 'error', message: 'Invalid JSON' })
        return
      }

      switch (msg.type) {
        case 'session:list':
          sendTo(ws, { type: 'session:list', sessions: manager.list() })
          break
        case 'session:create': {
          const session = manager.create({ name: msg.name, cwd: msg.cwd })
          broadcast({ type: 'session:created', session })
          subscriptions.get(ws)?.add(session.id)
          break
        }
        case 'session:kill':
          manager.kill(msg.sessionId)
          break
        case 'session:subscribe':
          subscriptions.get(ws)?.add(msg.sessionId)
          break
        case 'session:unsubscribe':
          subscriptions.get(ws)?.delete(msg.sessionId)
          break
        case 'session:input':
          manager.write(msg.sessionId, msg.text)
          break
        case 'session:approve':
          manager.write(msg.sessionId, 'y\n')
          break
        case 'session:deny':
          manager.write(msg.sessionId, 'n\n')
          break
      }
    })

    ws.on('close', () => {
      subscriptions.delete(ws)
    })
  })

  return {
    get port(): number {
      const addr = wss.address()
      return typeof addr === 'object' && addr !== null ? addr.port : opts.port
    },
    close(): Promise<void> {
      return new Promise((resolve) => wss.close(() => resolve()))
    },
  }
}
