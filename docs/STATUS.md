# Happy Clone - 현재 상태 및 TODO

## 프로젝트 개요
Happy Engineering(happy.engineering) 클론 - 웹 PWA에서 여러 Claude Code 세션을 원격 제어하는 도구.

## GitHub
https://github.com/kdonguk/happy-clone

## 아키텍처
```
pnpm monorepo (packages/shared, packages/cli, packages/web)

[Claude Code] ←child_process pipe→ [CLI Daemon (WS:3777)] ←WebSocket→ [Next.js PWA (:3778)]
```

## 현재 동작하는 것 (완료)

### CLI (packages/cli)
- `ProcessBridge` - child_process.spawn으로 Claude 프로세스 관리 (node-pty 대신, Node v24 호환)
- `SessionManager` - 멀티 세션 생성/삭제/목록
- `StreamJsonParser` - Claude의 `--output-format stream-json` NDJSON 파싱 → 읽기 가능한 텍스트 추출
- `formatStreamJsonInput` - `{"type":"user","message":{"role":"user","content":"..."}}` 포맷으로 입력 전송
- `ws-server` - WebSocket 서버, 세션별 구독 모델
- `index.ts` - 엔트리포인트, Next.js dev 서버도 자식 프로세스로 실행
- Claude 실행 인자: `-p --input-format stream-json --output-format stream-json`
- CLAUDECODE 환경변수 완전 제거 (빈 문자열 X → Object.entries filter)

### Web (packages/web)
- `WsClient` - WebSocket 클라이언트, 자동 재연결, onConnect 핸들러
- `useSessions` - 세션 목록/출력 상태 관리
- `SessionList` - 왼쪽 사이드바, 상태 색상 점
- `Terminal` - 출력 표시 (현재 단순 `<pre>` 태그)
- `InputBar` - 텍스트 입력 + Approve/Deny 버튼
- PWA manifest.json, sw.js

### Shared (packages/shared)
- `SessionInfo`, `ClientMessage`, `ServerMessage` 타입 정의

## 해결된 문제들
1. node-pty Node.js v24 비호환 → child_process.spawn으로 교체
2. WebSocket 타이밍 이슈 → onConnect 핸들러 추가
3. Service Worker 캐시 문제 → Next.js dev 서버로 전환 (정적 빌드 대신)
4. CLAUDECODE 환경변수 → 빈 문자열이 아닌 완전 제거
5. Claude -p 모드 + stream-json → stdin으로 stream-json 포맷 전송
6. 중복 출력 → result 이벤트 필터링 (assistant 이벤트만 사용)
7. Express 5 wildcard 문법 → `/{*splat}`

## TODO - 우선순위 높음

### 1. UI 전면 개선 (가장 시급)
현재 문제:
- 사용자 메시지와 Claude 응답이 구분되지 않음 (전부 녹색 텍스트)
- 어떤 세션에 연결됐는지 명확하지 않음
- 대화 형식이 아닌 단순 텍스트 덤프

해야 할 것:
- **채팅 버블 UI**: 사용자(오른쪽)/Claude(왼쪽) 메시지 구분
- **메시지 히스토리**: 사용자가 보낸 메시지도 화면에 표시 (현재는 Claude 응답만 보임)
- **세션 연결 정보**: 헤더에 cwd, 세션 ID, 연결 상태 표시
- **마크다운 렌더링**: `react-markdown` 설치하여 Claude 응답을 마크다운으로 렌더링
- **코드 블록 하이라이팅**: 코드 블록을 구문 강조로 표시
- **도구 사용 표시**: `[Tool: xxx]` 이벤트를 접이식 패널로 표시

구현 방향:
- `outputs` 데이터 구조 변경: `string[]` → `{role: 'user'|'assistant'|'tool', text: string}[]`
- `useSessions`에서 sendInput 할 때 user 메시지도 outputs에 추가
- `Terminal` 컴포넌트 → `ChatView` 컴포넌트로 교체
- `react-markdown` 패키지 설치 필요 (`pnpm --filter web add react-markdown`)

### 2. 사이드바 lastOutput 표시 개선
- 현재 "No output yet"만 표시됨 (파서가 시스템 이벤트를 필터링하기 때문)
- 의미 있는 마지막 응답 미리보기 표시

### 3. PWA 아이콘 404 에러
- `icon-192.png`, `icon-512.png` 파일 누락
- 실제 아이콘 생성 또는 manifest.json에서 제거

## TODO - 우선순위 중간

### 4. 스트리밍 출력
- 현재 assistant 이벤트가 전체 응답을 한 번에 보냄
- `--include-partial-messages` 플래그 추가하여 토큰별 스트리밍
- content_block_delta 이벤트 처리 (StreamJsonParser에 이미 구현됨)

### 5. 멀티 턴 대화
- 현재 각 메시지가 독립적 (-p 모드)
- Claude --resume 또는 세션 유지 방식으로 대화 연속성 확보

### 6. 세션 종료/재시작
- Kill 버튼 UI
- 세션 재시작 기능

## TODO - 우선순위 낮음

### 7. 모바일 최적화
- 터치 인터페이스
- 반응형 레이아웃 (사이드바 토글)

### 8. 릴레이 모드
- 외부 접속용 릴레이 서버
- E2E 암호화

### 9. 인증
- PIN/비밀번호 보호

## 실행 방법
```bash
cd /Users/donguk.kim/projects/happy

# 빌드 & 실행
pnpm --filter @happy/cli build && node packages/cli/dist/index.js

# 또는 포트 충돌 시 기존 프로세스 정리 후
lsof -ti:3777,3778 | xargs kill -9 2>/dev/null
sleep 2
pnpm --filter @happy/cli build && node packages/cli/dist/index.js

# 접속
# http://localhost:3778
```

## 핵심 파일
- `packages/cli/src/index.ts` - CLI 엔트리포인트
- `packages/cli/src/session-manager.ts` - 세션 관리
- `packages/cli/src/process-bridge.ts` - Claude 프로세스 제어
- `packages/cli/src/stream-json-parser.ts` - stream-json 파싱
- `packages/cli/src/ws-server.ts` - WebSocket 서버
- `packages/web/src/app/page.tsx` - 메인 페이지
- `packages/web/src/components/Terminal.tsx` - 출력 표시 (개선 필요)
- `packages/web/src/components/InputBar.tsx` - 입력 바
- `packages/web/src/components/SessionList.tsx` - 세션 목록
- `packages/web/src/hooks/useSessions.ts` - 세션 상태 관리
- `packages/web/src/lib/ws-client.ts` - WebSocket 클라이언트
- `packages/shared/src/types.ts` - 공유 타입
