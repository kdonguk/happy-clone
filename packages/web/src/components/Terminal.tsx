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
