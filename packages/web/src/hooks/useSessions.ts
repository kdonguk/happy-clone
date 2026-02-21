'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionInfo, ServerMessage, ChatMessage } from '@happy/shared'
import { useWebSocket } from './useWebSocket'

export function useSessions() {
  const ws = useWebSocket()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [outputs, setOutputs] = useState<Record<string, ChatMessage[]>>({})

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
            [msg.sessionId]: [...(prev[msg.sessionId] ?? []), { role: 'assistant', text: msg.text }],
          }))
          break
        case 'session:approval-needed':
          setOutputs((prev) => ({
            ...prev,
            [msg.sessionId]: [
              ...(prev[msg.sessionId] ?? []),
              { role: 'tool', text: `[Tool: ${msg.tool}] ${msg.description}` },
            ],
          }))
          break
        case 'session:status':
          setSessions((prev) =>
            prev.map((s) => (s.id === msg.sessionId ? { ...s, status: msg.status } : s))
          )
          break
        case 'session:ended':
          setSessions((prev) =>
            prev.map((s) => (s.id === msg.sessionId ? { ...s, status: 'ended' } : s))
          )
          break
      }
    })

    const unsubConnect = ws.onConnect(() => {
      ws.send({ type: 'session:list' })
    })

    return () => {
      unsub()
      unsubConnect()
    }
  }, [ws])

  const createSession = useCallback((name?: string) => {
    ws.send({ type: 'session:create', name })
  }, [ws])

  const sendInput = useCallback((sessionId: string, text: string) => {
    setOutputs((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), { role: 'user', text }],
    }))
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
