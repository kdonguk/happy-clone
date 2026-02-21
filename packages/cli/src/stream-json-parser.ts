/**
 * Parses Claude Code's --output-format stream-json (NDJSON) into readable text.
 * Handles partial lines across chunks.
 */

export interface ParsedEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'system' | 'unknown'
  text: string
}

export class StreamJsonParser {
  private buffer = ''

  /** Feed a raw chunk from stdout, returns parsed events */
  feed(chunk: string): ParsedEvent[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() ?? ''

    const events: ParsedEvent[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = this.parseLine(trimmed)
      if (event) events.push(event)
    }
    return events
  }

  private parseLine(line: string): ParsedEvent | null {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      // Not JSON, pass through as plain text
      return { type: 'text', text: line }
    }

    // Handle different stream-json event types
    const type = obj.type as string

    // Content block delta - streaming text
    if (type === 'stream_event') {
      const event = obj.event as Record<string, unknown> | undefined
      if (!event) return null
      const eventType = event.type as string

      if (eventType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          return { type: 'text', text: delta.text }
        }
      }
      return null
    }

    // Assistant message with content array
    if (type === 'assistant') {
      const message = obj.message as Record<string, unknown> | undefined
      const content = message?.content as Array<Record<string, unknown>> | undefined
      if (content) {
        const texts = content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
        if (texts.length > 0) return { type: 'text', text: texts.join('') }
      }
      return null
    }

    // Result message - skip (duplicate of assistant message)
    if (type === 'result' || type === 'rate_limit_event') {
      return null
    }

    // Tool use events
    if (type === 'tool_use' || (obj.tool_name && typeof obj.tool_name === 'string')) {
      const toolName = (obj.tool_name ?? (obj as Record<string, unknown>).name) as string
      return { type: 'tool_use', text: `[Tool: ${toolName}]` }
    }

    // Tool result
    if (type === 'tool_result') {
      return { type: 'tool_result', text: '[Tool result received]' }
    }

    // System/init messages - suppress
    if (type === 'system' || type === 'init' || type === 'hook_started' || type === 'hook_response') {
      return null
    }

    return null
  }
}

/** Format user text as stream-json input for Claude Code */
export function formatStreamJsonInput(text: string): string {
  const msg = {
    type: 'user',
    message: { role: 'user', content: text },
  }
  return JSON.stringify(msg) + '\n'
}
