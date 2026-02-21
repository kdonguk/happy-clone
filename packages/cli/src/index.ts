#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionManager } from './session-manager.js'
import { createWsServer } from './ws-server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WS_PORT = Number(process.env.HAPPY_WS_PORT ?? 3777)
const WEB_PORT = Number(process.env.HAPPY_WEB_PORT ?? 3778)

const manager = new SessionManager()
const wsServer = createWsServer(manager, { port: WS_PORT })

// Start Next.js dev server
const webDir = resolve(__dirname, '../../web')
const nextBin = resolve(webDir, 'node_modules/.bin/next')

const nextProc = spawn(nextBin, ['dev', '--port', String(WEB_PORT), '--turbopack'], {
  cwd: webDir,
  env: { ...process.env },
  stdio: 'pipe',
})

nextProc.stdout?.on('data', (data: Buffer) => {
  const text = data.toString()
  if (text.includes('Ready') || text.includes('ready')) {
    console.log(`  Web UI:    http://localhost:${WEB_PORT}`)
  }
})

nextProc.stderr?.on('data', (data: Buffer) => {
  // Suppress noisy Next.js dev output, only show errors
  const text = data.toString()
  if (text.includes('error') || text.includes('Error')) {
    process.stderr.write(data)
  }
})

console.log('Happy Clone')
console.log(`  WebSocket: ws://localhost:${WS_PORT}`)
console.log('  Starting web UI...')

process.on('SIGINT', () => {
  nextProc.kill()
  manager.killAll()
  wsServer.close()
  process.exit(0)
})
