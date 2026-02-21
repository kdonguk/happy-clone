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
