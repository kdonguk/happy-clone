import { randomUUID } from 'node:crypto'
import type { SessionInfo, SessionStatus } from '@happy/shared'
import { ProcessBridge } from './process-bridge.js'

interface SessionEntry {
  info: SessionInfo
  bridge: ProcessBridge
}

interface CreateOptions {
  name?: string
  cwd?: string
  command?: string
  args?: string[]
}

type SessionEventHandler = (sessionId: string, event: string, data?: unknown) => void

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
  private eventHandler?: SessionEventHandler

  onEvent(handler: SessionEventHandler): void {
    this.eventHandler = handler
  }

  create(opts: CreateOptions = {}): SessionInfo {
    const id = randomUUID()
    const name = opts.name ?? `session-${this.sessions.size + 1}`
    const command = opts.command ?? 'claude'
    const args = opts.args ?? []
    const cwd = opts.cwd ?? process.cwd()

    const bridge = new ProcessBridge(command, args, cwd)

    const info: SessionInfo = {
      id,
      name,
      status: 'running',
      createdAt: new Date().toISOString(),
      cwd,
    }

    bridge.onOutput((data) => {
      info.lastOutput = data.slice(-200)
      this.eventHandler?.(id, 'output', data)
    })

    bridge.onExit(() => {
      info.status = 'ended'
      this.eventHandler?.(id, 'ended')
      this.sessions.delete(id)
    })

    this.sessions.set(id, { info, bridge })
    return { ...info }
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }))
  }

  get(id: string): SessionInfo | undefined {
    const entry = this.sessions.get(id)
    return entry ? { ...entry.info } : undefined
  }

  write(id: string, text: string): void {
    const entry = this.sessions.get(id)
    if (!entry) throw new Error(`Session ${id} not found`)
    entry.bridge.write(text)
  }

  kill(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    entry.bridge.kill()
    this.sessions.delete(id)
  }

  killAll(): void {
    for (const [id] of this.sessions) this.kill(id)
  }
}
