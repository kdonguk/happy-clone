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
