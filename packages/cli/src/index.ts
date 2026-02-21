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
