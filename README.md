# TestAnchor 핀 리뷰 보드

동욱 님을 위한 **화면 시안 + 서버 흐름도 통합 핀 리뷰 보드**입니다.
웹에서 시안과 흐름도를 보고, 의견을 남길 자리를 톡 누른 뒤 한 줄만 적으면 됩니다.

- 구성: `index.html` · `styles.css` · `app.js` (빌드 없음, 의존성 없음)
- 로그인 없음. 아이폰 Safari 와 PC 브라우저에서 바로 열립니다.
- 배포: GitHub Pages — 저장소 `kdonguk/happy-clone` 의 `review-board` 브랜치
  - 주소: **https://kdonguk.github.io/happy-clone/**
  - 바로가기: 흐름도만 보기 `…/happy-clone/#flow`

## 쓰는 법

1. 위 탭에서 **① 화면 시안** 또는 **② 서버 흐름도**를 고릅니다.
2. `📌 핀 찍기` 로 바꾸고 의견을 남길 자리를 **짧게 탭**합니다.
3. 뜬 시트에 한 줄 적고 **저장** (빠른 문구 버튼을 눌러도 됩니다).
4. 오른쪽 아래 **의견 제출** → 피클에게 전달됩니다.
5. `📌 남긴 의견` 목록에서 행을 누르면 그 핀으로 이동합니다. ✏️ 수정 / 🗑 삭제.
6. 헤더의 리뷰 ID 칩을 누르면 프로젝트·버전 ID를 바꿀 수 있습니다(예: `testanchor-sample-v1`).

흐름도 탭은 `+ / − / ⤢` 버튼, 두 손가락 확대, 끌어서 이동을 지원합니다.
핀 모드에서도 끌면 화면이 움직이고, 짧게 탭할 때만 핀이 꽂힙니다.

## 제출은 어디로 가나

- `[의견 제출]` → `https://ntfy.sh/pk-ta-rb-9f24c1d7a3be5e60` 로 JSON POST (로그인·키 없음)
- 15분마다 도는 수집 액션이 이 채널을 읽어 **구글 시트**에 영구 보관합니다.
  - 시트: `TestAnchor 리뷰 보드 의견 (자동 수집)`
    https://docs.google.com/spreadsheets/d/1LctCwOkhoxoYg427cCFDPYSzEgdr7NY3TBHpIgiZ3s0/edit
  - 열: 수집시각 · 리뷰ID · 핀 · 탭 · 대상 · x · y · 의견 · 제출시각(KST) · 출처
- 무료 채널은 메시지를 12시간만 보관하므로, 그 사이에 수집해야 합니다.

```bash
# 채널에서 직접 읽기 (최근 12시간)
curl -s 'https://ntfy.sh/pk-ta-rb-9f24c1d7a3be5e60/json?poll=1&since=12h'
```

메시지 본문 `message` 필드가 제출 JSON 입니다.

```json
{
  "app": "ta-review-board",
  "v": 1,
  "review_id": "testanchor-sample-v1",
  "submitted_at": "2026-11-15T02:21:14.765Z",
  "tz": "Asia/Seoul",
  "count": 2,
  "pins": [
    { "no": 1, "tab": "screen", "target": "S1 대상 카드 · 배치 스케줄러", "x": 0.546, "y": 0.201, "comment": "…" },
    { "no": 2, "tab": "flow", "target": "흐름 2 · 요청 스키마 검증", "x": 0.507, "y": 0.129, "comment": "…" }
  ]
}
```

## 보안

사내 실제 DB 호스트·계정·내부 도메인·테이블 원문은 넣지 않았습니다.
시안과 흐름도는 전부 추상 명칭(개발 DB(읽기 전용), 배치 스케줄러, 14단계 검증, allowWrite,
차단 시간대 06:20~08:00, WHERE 절 검사)만 사용합니다.

## 고칠 때

- 문구·시안 마크업: `index.html`
- 동작·좌표·전송: `app.js` (`TOPIC` 상수만 바꾸면 다른 채널로 보냅니다)
- 모양: `styles.css`
- 아이폰 크기 확인용: `_preview.html` (390 / 430 폭 iframe 미리보기)
