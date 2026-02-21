import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { SessionInfo } from '@happy/shared'
import { ProcessBridge } from './process-bridge.js'
import { StreamJsonParser, formatStreamJsonInput } from './stream-json-parser.js'

const CLAUDE_PATHS = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  `${process.env.HOME}/.nvm/versions/node/v24.12.0/bin/claude`,
  'claude',
]

function findClaude(): string {
  for (const p of CLAUDE_PATHS) {
    if (existsSync(p)) return p
  }
  return 'claude'
}

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
    const command = opts.command ?? findClaude()
    const args = opts.args ?? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json']
    const cwd = opts.cwd ?? process.cwd()

    let bridge: ProcessBridge
    try {
      bridge = new ProcessBridge(command, args, cwd)
    } catch (err) {
      throw new Error(`Failed to spawn process "${command}": ${err}`)
    }

    const info: SessionInfo = {
      id,
      name,
      status: 'running',
      createdAt: new Date().toISOString(),
      cwd,
    }

    const parser = new StreamJsonParser()
    bridge.onOutput((data) => {
      const events = parser.feed(data)
      for (const event of events) {
        info.lastOutput = event.text.slice(-200)
        this.eventHandler?.(id, 'output', event.text)
      }
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
    entry.bridge.write(formatStreamJsonInput(text))
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
