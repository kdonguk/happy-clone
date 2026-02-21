# Happy Clone - 모바일 Claude Code 원격 제어 PWA

## 개요

Happy Engineering(happy.engineering)과 유사한 도구. 여러 Claude Code 세션을 웹 PWA에서 모니터링하고 제어.

## 아키텍처: 모놀리식 (CLI + 웹서버 통합)

```
[Claude Code 1] ←pty→ [CLI Daemon] ←WebSocket→ [PWA 브라우저]
[Claude Code 2] ←pty→   (내장 웹서버)
[Claude Code N] ←pty→
```

- CLI 하나가 WebSocket 서버(3777) + PWA 정적 파일 서빙(3778)
- 로컬 모드: localhost 전용
- 릴레이 모드(2차): 외부 릴레이 서버 경유 + E2E 암호화

## 기술 스택

- **Monorepo**: pnpm workspace + turbo
- **CLI**: Node.js + TypeScript, node-pty, ws
- **Web**: Next.js + TypeScript, PWA (next-pwa)
- **Shared**: 공유 타입/프로토콜 패키지

## 프로젝트 구조

```
happy/
├── packages/
│   ├── cli/
│   │   ├── src/
│   │   │   ├── index.ts           # 진입점, 명령어 파싱
│   │   │   ├── session-manager.ts # Claude Code 세션 생성/관리
│   │   │   ├── process-bridge.ts  # pty로 Claude Code 프로세스 제어
│   │   │   ├── ws-server.ts       # WebSocket 서버
│   │   │   └── relay-client.ts    # 릴레이 서버 연결 (2차)
│   │   └── package.json
│   ├── web/
│   │   ├── src/app/
│   │   │   ├── page.tsx           # 세션 대시보드
│   │   │   └── session/[id]/page.tsx
│   │   ├── components/
│   │   │   ├── SessionList.tsx
│   │   │   ├── Terminal.tsx
│   │   │   └── InputBar.tsx
│   │   └── package.json
│   └── shared/
│       ├── src/types.ts
│       └── package.json
├── package.json
└── turbo.json
```

## WebSocket 프로토콜

### 클라이언트 → 서버

| type | 설명 | 추가 필드 |
|------|------|-----------|
| session:list | 세션 목록 요청 | - |
| session:create | 새 세션 생성 | name?, cwd? |
| session:kill | 세션 종료 | sessionId |
| session:subscribe | 세션 출력 구독 | sessionId |
| session:unsubscribe | 구독 해제 | sessionId |
| session:input | 텍스트 입력 전송 | sessionId, text |
| session:approve | 도구 실행 승인 | sessionId |
| session:deny | 도구 실행 거부 | sessionId |

### 서버 → 클라이언트

| type | 설명 | 추가 필드 |
|------|------|-----------|
| session:list | 세션 목록 응답 | sessions[] |
| session:created | 세션 생성 완료 | session |
| session:output | 세션 출력 스트림 | sessionId, text |
| session:status | 상태 변경 알림 | sessionId, status |
| session:ended | 세션 종료 알림 | sessionId |
| session:approval-needed | 도구 승인 요청 | sessionId, tool, description |
| error | 에러 | message |

### 세션 상태

```
idle → running → waiting_approval → running → idle
              → waiting_input → running → idle
```

## UI 레이아웃

```
┌──────────────────────────────────────────────┐
│  🟢 Happy Clone                   ⚙️  +세션  │
├──────────┬───────────────────────────────────┤
│ Sessions │  Session: "name"       [status]    │
│          │                                    │
│ ● name1  │  (터미널 출력 영역)                │
│ ○ name2  │                                    │
│ ○ name3  │  [승인] [거부]  ← 도구 승인 시     │
│          │───────────────────────────────────│
│          │  [입력...]                 🎤  ➤   │
└──────────┴───────────────────────────────────┘
```

## MVP 스코프 (1차)

1. CLI 데몬: WebSocket 서버 + PWA 정적 서빙
2. 세션 CRUD: 생성/종료/목록
3. 실시간 출력 스트리밍 (pty → WebSocket)
4. 텍스트 입력 + 도구 승인/거부
5. PWA: manifest + service worker + 반응형

## 2차 스코프

- 음성 입력 (Web Speech API)
- 릴레이 서버 + E2E 암호화 (libsodium)
- 푸시 알림 (Web Push API)
- 세션 히스토리/로그 저장
