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
