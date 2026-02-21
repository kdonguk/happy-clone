export type SessionStatus = 'running' | 'waiting_input' | 'waiting_approval' | 'idle' | 'ended'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  text: string
}

export interface SessionInfo {
  id: string
  name: string
  status: SessionStatus
  createdAt: string
  cwd: string
  lastOutput?: string
}

export type ClientMessage =
  | { type: 'session:list' }
  | { type: 'session:create'; name?: string; cwd?: string }
  | { type: 'session:kill'; sessionId: string }
  | { type: 'session:subscribe'; sessionId: string }
  | { type: 'session:unsubscribe'; sessionId: string }
  | { type: 'session:input'; sessionId: string; text: string }
  | { type: 'session:approve'; sessionId: string }
  | { type: 'session:deny'; sessionId: string }

export type ServerMessage =
  | { type: 'session:list'; sessions: SessionInfo[] }
  | { type: 'session:created'; session: SessionInfo }
  | { type: 'session:output'; sessionId: string; text: string }
  | { type: 'session:status'; sessionId: string; status: SessionStatus }
  | { type: 'session:ended'; sessionId: string }
  | { type: 'session:approval-needed'; sessionId: string; tool: string; description: string }
  | { type: 'error'; message: string }
