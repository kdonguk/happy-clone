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
