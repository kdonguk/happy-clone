# Happy Clone Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Happy Engineering 클론 — 여러 Claude Code 세션을 웹 PWA에서 원격 모니터링/제어하는 도구

**Architecture:** pnpm monorepo. CLI 데몬이 claude 프로세스를 pty로 spawn하고 WebSocket으로 PWA에 중계. Next.js static export로 PWA를 CLI가 직접 서빙.

**Tech Stack:** Node.js 24, TypeScript, pnpm workspaces, node-pty, ws, Next.js 15, Tailwind CSS

---

### Task 1: Monorepo 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/web/package.json`

**Step 1: Initialize git repo**

```bash
cd /Users/donguk.kim/projects/happy
git init
```

**Step 2: Create root package.json and pnpm workspace**

`package.json`:
```json
{
  "name": "happy-clone",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 3: Create shared package with types**

`packages/shared/package.json`:
```json
{
  "name": "@happy/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/types.js",
  "types": "dist/types.d.ts",
  "scripts": {
    "build": "tsc"
  }
}
```

`packages/shared/src/types.ts`:
```typescript
export type SessionStatus = 'running' | 'waiting_input' | 'waiting_approval' | 'idle' | 'ended'

export interface SessionInfo {
  id: string
  name: string
  status: SessionStatus
  createdAt: string
  cwd: string
  lastOutput?: string
}

export type ClientMessage =
  | { type: 'session:list' }
  | { type: 'session:create'; name?: string; cwd?: string }
  | { type: 'session:kill'; sessionId: string }
  | { type: 'session:subscribe'; sessionId: string }
  | { type: 'session:unsubscribe'; sessionId: string }
  | { type: 'session:input'; sessionId: string; text: string }
  | { type: 'session:approve'; sessionId: string }
  | { type: 'session:deny'; sessionId: string }

export type ServerMessage =
  | { type: 'session:list'; sessions: SessionInfo[] }
  | { type: 'session:created'; session: SessionInfo }
  | { type: 'session:output'; sessionId: string; text: string }
  | { type: 'session:status'; sessionId: string; status: SessionStatus }
  | { type: 'session:ended'; sessionId: string }
  | { type: 'session:approval-needed'; sessionId: string; tool: string; description: string }
  | { type: 'error'; message: string }
```

**Step 4: Create CLI package skeleton**

`packages/cli/package.json`:
```json
{
  "name": "@happy/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": { "happy": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@happy/shared": "workspace:*",
    "node-pty": "^1.0.0",
    "ws": "^8.18.0",
    "express": "^5.0.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "@types/express": "^5.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 5: Create Next.js web package**

```bash
cd /Users/donguk.kim/projects/happy/packages
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-pnpm
```

Then add `@happy/shared` dependency to `packages/web/package.json`.

**Step 6: Install all dependencies**

```bash
cd /Users/donguk.kim/projects/happy
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
```

**Step 7: Build shared package**

```bash
pnpm --filter @happy/shared build
```

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with shared, cli, web packages"
```

---

### Task 2: CLI - Process Bridge (pty로 Claude Code 제어)

**Files:**
- Create: `packages/cli/src/process-bridge.ts`
- Create: `packages/cli/src/__tests__/process-bridge.test.ts`

**Step 1: Write the failing test**

`packages/cli/src/__tests__/process-bridge.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'node:test'
import { ProcessBridge } from '../process-bridge.js'

describe('ProcessBridge', () => {
  let bridge: ProcessBridge | null = null

  afterEach(() => {
    bridge?.kill()
    bridge = null
  })

  it('should spawn a process and emit output', async () => {
    bridge = new ProcessBridge('echo', ['hello'])
    const output = await new Promise<string>((resolve) => {
      bridge!.onOutput((data) => resolve(data))
    })
    expect(output).toMatch(/hello/)
  })

  it('should send input to process', async () => {
    bridge = new ProcessBridge('cat', [])
    const output = new Promise<string>((resolve) => {
      bridge!.onOutput((data) => {
        if (data.includes('test-input')) resolve(data)
      })
    })
    bridge.write('test-input\n')
    const result = await output
    expect(result).toMatch(/test-input/)
  })

  it('should emit exit event', async () => {
    bridge = new ProcessBridge('echo', ['done'])
    const code = await new Promise<number>((resolve) => {
      bridge!.onExit((exitCode) => resolve(exitCode))
    })
    expect(code).toBe(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/donguk.kim/projects/happy
pnpm --filter @happy/cli exec node --test src/__tests__/process-bridge.test.ts
```
Expected: FAIL - module not found

**Step 3: Write implementation**

`packages/cli/src/process-bridge.ts`:
```typescript
import * as pty from 'node-pty'

type OutputHandler = (data: string) => void
type ExitHandler = (code: number) => void

export class ProcessBridge {
  private proc: pty.IPty
  private outputHandlers: OutputHandler[] = []
  private exitHandlers: ExitHandler[] = []

  constructor(command: string, args: string[], cwd?: string) {
    this.proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: cwd ?? process.cwd(),
    })

    this.proc.onData((data) => {
      for (const handler of this.outputHandlers) handler(data)
    })

    this.proc.onExit(({ exitCode }) => {
      for (const handler of this.exitHandlers) handler(exitCode)
    })
  }

  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler)
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler)
  }

  write(data: string): void {
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    this.proc.resize(cols, rows)
  }

  kill(): void {
    this.proc.kill()
  }

  get pid(): number {
    return this.proc.pid
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @happy/cli exec node --test src/__tests__/process-bridge.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/process-bridge.ts packages/cli/src/__tests__/
git commit -m "feat(cli): add ProcessBridge for pty-based process control"
```

---

### Task 3: CLI - Session Manager

**Files:**
- Create: `packages/cli/src/session-manager.ts`
- Create: `packages/cli/src/__tests__/session-manager.test.ts`

**Step 1: Write the failing test**

`packages/cli/src/__tests__/session-manager.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'node:test'
import { SessionManager } from '../session-manager.js'

describe('SessionManager', () => {
  let manager: SessionManager

  afterEach(() => {
    manager?.killAll()
  })

  it('should create a session and list it', () => {
    manager = new SessionManager()
    const session = manager.create({ name: 'test', command: 'echo', args: ['hello'] })
    expect(session.name).toBe('test')
    expect(manager.list().length).toBe(1)
  })

  it('should kill a session', () => {
    manager = new SessionManager()
    const session = manager.create({ name: 'test', command: 'cat', args: [] })
    manager.kill(session.id)
    expect(manager.list().length).toBe(0)
  })

  it('should get session by id', () => {
    manager = new SessionManager()
    const session = manager.create({ name: 'test', command: 'echo', args: ['hi'] })
    const found = manager.get(session.id)
    expect(found?.name).toBe('test')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @happy/cli exec node --test src/__tests__/session-manager.test.ts
```

**Step 3: Write implementation**

`packages/cli/src/session-manager.ts`:
```typescript
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
  command?: string  // 기본값: 'claude'
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
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add packages/cli/src/session-manager.ts packages/cli/src/__tests__/session-manager.test.ts
git commit -m "feat(cli): add SessionManager for multi-session lifecycle"
```

---

### Task 4: CLI - WebSocket Server

**Files:**
- Create: `packages/cli/src/ws-server.ts`
- Create: `packages/cli/src/__tests__/ws-server.test.ts`

**Step 1: Write the failing test**

`packages/cli/src/__tests__/ws-server.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'node:test'
import WebSocket from 'ws'
import { createWsServer } from '../ws-server.js'
import { SessionManager } from '../session-manager.js'
import type { ClientMessage, ServerMessage } from '@happy/shared'

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg))
}

function waitMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())))
  })
}

describe('WsServer', () => {
  let server: ReturnType<typeof createWsServer>
  let manager: SessionManager

  afterEach(async () => {
    manager?.killAll()
    await server?.close()
  })

  it('should handle session:list', async () => {
    manager = new SessionManager()
    server = createWsServer(manager, { port: 0 })
    const port = server.port

    const ws = new WebSocket(`ws://localhost:${port}`)
    await new Promise((r) => ws.on('open', r))

    send(ws, { type: 'session:list' })
    const msg = await waitMessage(ws)
    expect(msg.type).toBe('session:list')
    expect((msg as { sessions: unknown[] }).sessions).toEqual([])

    ws.close()
  })

  it('should handle session:create', async () => {
    manager = new SessionManager()
    server = createWsServer(manager, { port: 0 })
    const port = server.port

    const ws = new WebSocket(`ws://localhost:${port}`)
    await new Promise((r) => ws.on('open', r))

    send(ws, { type: 'session:create', name: 'test' })
    const msg = await waitMessage(ws)
    expect(msg.type).toBe('session:created')

    ws.close()
  })
})
```

**Step 2: Run test to verify it fails**

**Step 3: Write implementation**

`packages/cli/src/ws-server.ts`:
```typescript
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
      return typeof addr === 'object' ? addr.port : opts.port
    },
    close(): Promise<void> {
      return new Promise((resolve) => wss.close(() => resolve()))
    },
  }
}
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add packages/cli/src/ws-server.ts packages/cli/src/__tests__/ws-server.test.ts
git commit -m "feat(cli): add WebSocket server for session communication"
```

---

### Task 5: CLI - 진입점 + 정적 파일 서빙

**Files:**
- Create: `packages/cli/src/index.ts`

**Step 1: Write implementation**

`packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node
import express from 'express'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { SessionManager } from './session-manager.js'
import { createWsServer } from './ws-server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WS_PORT = Number(process.env.HAPPY_WS_PORT ?? 3777)
const WEB_PORT = Number(process.env.HAPPY_WEB_PORT ?? 3778)

const manager = new SessionManager()
const wsServer = createWsServer(manager, { port: WS_PORT })

const app = express()
const webDir = resolve(__dirname, '../../web/out')

if (existsSync(webDir)) {
  app.use(express.static(webDir))
  app.get('*', (_req, res) => {
    res.sendFile(resolve(webDir, 'index.html'))
  })
}

app.listen(WEB_PORT, () => {
  console.log('Happy Clone')
  console.log(`  Web UI:    http://localhost:${WEB_PORT}`)
  console.log(`  WebSocket: ws://localhost:${WS_PORT}`)
  console.log('  Press Ctrl+C to stop')
})

process.on('SIGINT', () => {
  manager.killAll()
  wsServer.close()
  process.exit(0)
})
```

**Step 2: Test manually**

```bash
pnpm --filter @happy/cli build
node packages/cli/dist/index.js
```
Expected: "Happy Clone" 메시지와 포트 정보 출력

**Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add entry point with express static serving"
```

---

### Task 6: Web - WebSocket 훅 + 세션 상태 관리

**Files:**
- Create: `packages/web/src/hooks/useWebSocket.ts`
- Create: `packages/web/src/hooks/useSessions.ts`
- Create: `packages/web/src/lib/ws-client.ts`

**Step 1: Write WebSocket client**

`packages/web/src/lib/ws-client.ts`:
```typescript
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
```

**Step 2: Write React hooks**

`packages/web/src/hooks/useWebSocket.ts`:
```typescript
'use client'
import { WsClient } from '../lib/ws-client'

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:3777`
  : ''

let sharedClient: WsClient | null = null

export function useWebSocket() {
  if (!sharedClient && typeof window !== 'undefined') {
    sharedClient = new WsClient(WS_URL)
    sharedClient.connect()
  }
  return sharedClient!
}
```

`packages/web/src/hooks/useSessions.ts`:
```typescript
'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionInfo, ServerMessage } from '@happy/shared'
import { useWebSocket } from './useWebSocket'

export function useSessions() {
  const ws = useWebSocket()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [outputs, setOutputs] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const unsub = ws.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'session:list':
          setSessions(msg.sessions)
          break
        case 'session:created':
          setSessions((prev) => [...prev, msg.session])
          break
        case 'session:output':
          setOutputs((prev) => ({
            ...prev,
            [msg.sessionId]: [...(prev[msg.sessionId] ?? []), msg.text],
          }))
          break
        case 'session:status':
          setSessions((prev) =>
            prev.map((s) => (s.id === msg.sessionId ? { ...s, status: msg.status } : s))
          )
          break
        case 'session:ended':
          setSessions((prev) => prev.filter((s) => s.id !== msg.sessionId))
          break
      }
    })

    ws.send({ type: 'session:list' })
    return unsub
  }, [ws])

  const createSession = useCallback((name?: string) => {
    ws.send({ type: 'session:create', name })
  }, [ws])

  const sendInput = useCallback((sessionId: string, text: string) => {
    ws.send({ type: 'session:input', sessionId, text })
  }, [ws])

  const approve = useCallback((sessionId: string) => {
    ws.send({ type: 'session:approve', sessionId })
  }, [ws])

  const deny = useCallback((sessionId: string) => {
    ws.send({ type: 'session:deny', sessionId })
  }, [ws])

  const killSession = useCallback((sessionId: string) => {
    ws.send({ type: 'session:kill', sessionId })
  }, [ws])

  const subscribe = useCallback((sessionId: string) => {
    ws.send({ type: 'session:subscribe', sessionId })
  }, [ws])

  return { sessions, outputs, createSession, sendInput, approve, deny, killSession, subscribe }
}
```

**Step 3: Commit**

```bash
git add packages/web/src/lib/ packages/web/src/hooks/
git commit -m "feat(web): add WebSocket client and session hooks"
```

---

### Task 7: Web - UI 컴포넌트

**Files:**
- Create: `packages/web/src/components/SessionList.tsx`
- Create: `packages/web/src/components/Terminal.tsx`
- Create: `packages/web/src/components/InputBar.tsx`
- Modify: `packages/web/src/app/page.tsx`

**Step 1: SessionList component**

`packages/web/src/components/SessionList.tsx`:
```tsx
'use client'
import type { SessionInfo } from '@happy/shared'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  waiting_input: 'bg-yellow-500',
  waiting_approval: 'bg-orange-500',
  idle: 'bg-gray-400',
  ended: 'bg-red-500',
}

interface Props {
  sessions: SessionInfo[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

export function SessionList({ sessions, activeId, onSelect, onCreate }: Props) {
  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      <div className="p-4 flex items-center justify-between border-b border-gray-700">
        <span className="font-bold">Sessions</span>
        <button onClick={onCreate} className="px-2 py-1 bg-blue-600 rounded text-sm hover:bg-blue-500">
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 ${
              activeId === s.id ? 'bg-gray-800' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s.status] ?? 'bg-gray-400'}`} />
              <span className="truncate">{s.name}</span>
            </div>
            <div className="text-xs text-gray-500 truncate mt-1">{s.lastOutput ?? 'No output yet'}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Terminal component**

`packages/web/src/components/Terminal.tsx`:
```tsx
'use client'
import { useEffect, useRef } from 'react'

interface Props {
  lines: string[]
}

export function Terminal({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex-1 bg-black text-green-400 font-mono text-sm p-4 overflow-y-auto">
      {lines.map((line, i) => (
        <pre key={i} className="whitespace-pre-wrap break-words">{line}</pre>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

**Step 3: InputBar component**

`packages/web/src/components/InputBar.tsx`:
```tsx
'use client'
import { useState, type FormEvent } from 'react'

interface Props {
  onSend: (text: string) => void
  onApprove?: () => void
  onDeny?: () => void
  showApproval?: boolean
}

export function InputBar({ onSend, onApprove, onDeny, showApproval }: Props) {
  const [text, setText] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    onSend(text)
    setText('')
  }

  return (
    <div className="border-t border-gray-700 bg-gray-900 p-3">
      {showApproval && (
        <div className="flex gap-2 mb-2">
          <button onClick={onApprove} className="px-4 py-1 bg-green-600 text-white rounded hover:bg-green-500">
            Approve
          </button>
          <button onClick={onDeny} className="px-4 py-1 bg-red-600 text-white rounded hover:bg-red-500">
            Deny
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-gray-800 text-white px-3 py-2 rounded outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">
          Send
        </button>
      </form>
    </div>
  )
}
```

**Step 4: Main page**

`packages/web/src/app/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useSessions } from '../hooks/useSessions'
import { SessionList } from '../components/SessionList'
import { Terminal } from '../components/Terminal'
import { InputBar } from '../components/InputBar'

export default function Home() {
  const { sessions, outputs, createSession, sendInput, approve, deny, subscribe } = useSessions()
  const [activeId, setActiveId] = useState<string | null>(null)

  const handleSelect = (id: string) => {
    setActiveId(id)
    subscribe(id)
  }

  const activeSession = sessions.find((s) => s.id === activeId)
  const activeOutput = activeId ? (outputs[activeId] ?? []) : []

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <SessionList
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={() => createSession()}
      />
      <div className="flex-1 flex flex-col">
        {activeSession ? (
          <>
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <span className="font-bold">{activeSession.name}</span>
              <span className="text-sm text-gray-400">{activeSession.status}</span>
            </div>
            <Terminal lines={activeOutput} />
            <InputBar
              onSend={(text) => sendInput(activeSession.id, text)}
              onApprove={() => approve(activeSession.id)}
              onDeny={() => deny(activeSession.id)}
              showApproval={activeSession.status === 'waiting_approval'}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a session or create a new one
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add SessionList, Terminal, InputBar components and main page"
```

---

### Task 8: PWA 설정

**Files:**
- Create: `packages/web/public/manifest.json`
- Create: `packages/web/public/sw.js`
- Modify: `packages/web/src/app/layout.tsx` (manifest link 추가)

**Step 1: Create manifest.json**

`packages/web/public/manifest.json`:
```json
{
  "name": "Happy Clone",
  "short_name": "Happy",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#030712",
  "theme_color": "#2563eb",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Step 2: Create basic service worker**

`packages/web/public/sw.js`:
```javascript
const CACHE_NAME = 'happy-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('ws://')) return
  event.respondWith(
    caches.match(event.request).then((r) => r || fetch(event.request))
  )
})
```

**Step 3: Update layout.tsx**

Add manifest link and theme-color meta tag to the `<head>` in layout.tsx.

Register service worker via a small `<script>` tag or a useEffect in a client component:
```typescript
// In a client component or useEffect:
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}
```

**Step 4: Configure Next.js for static export**

Add to `packages/web/next.config.ts`:
```typescript
const config = { output: 'export' }
```

**Step 5: Build and verify**

```bash
pnpm --filter @happy/web build
ls packages/web/out/
```
Expected: `index.html`, `manifest.json` 등 정적 파일

**Step 6: Commit**

```bash
git add packages/web/
git commit -m "feat(web): add PWA manifest, service worker, static export config"
```

---

### Task 9: 통합 테스트 + 최종 빌드

**Step 1: Build all packages**

```bash
pnpm build
```

**Step 2: Start CLI and verify end-to-end**

```bash
node packages/cli/dist/index.js &
# 브라우저에서 http://localhost:3778 접속
# + New 버튼으로 세션 생성
# 터미널 출력 확인
# 메시지 입력 확인
kill %1
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
out/
.next/
*.tsbuildinfo
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: integration test pass, project ready"
```

---

## 요약

| Task | 내용 |
|------|------|
| 1 | Monorepo 스캐폴딩 |
| 2 | ProcessBridge (pty) |
| 3 | SessionManager |
| 4 | WebSocket 서버 |
| 5 | CLI 진입점 + static 서빙 |
| 6 | WS 훅 + 세션 상태 |
| 7 | UI 컴포넌트 |
| 8 | PWA 설정 |
| 9 | 통합 테스트 |
