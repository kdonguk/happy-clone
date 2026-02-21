'use client'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '@happy/shared'

interface Props {
  messages: ChatMessage[]
}

function ToolMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex justify-start mb-3">
      <div
        className="max-w-[80%] border border-purple-500 rounded-lg overflow-hidden"
      >
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="w-full px-3 py-2 text-left text-sm text-purple-300 hover:bg-purple-900/30 flex items-center gap-2"
        >
          <span className="text-xs">{open ? '▼' : '▶'}</span>
          <span className="font-mono">{text.split(']')[0]}]</span>
        </button>
        {open && (
          <div className="px-3 py-2 text-sm text-gray-300 border-t border-purple-500/50 font-mono whitespace-pre-wrap">
            {text.split('] ').slice(1).join('] ')}
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatView({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 bg-gray-900 p-4 overflow-y-auto">
      {messages.map((msg, i) => {
        if (msg.role === 'tool') {
          return <ToolMessage key={i} text={msg.text} />
        }

        const isUser = msg.role === 'user'

        return (
          <div
            key={i}
            className={`flex mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                isUser
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-100'
              }`}
            >
              {isUser ? (
                <span className="whitespace-pre-wrap">{msg.text}</span>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
