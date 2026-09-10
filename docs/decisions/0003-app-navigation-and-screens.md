# 0003 — 앱 내비게이션과 화면 구성

날짜: 2026-09-09

## 배경

대화 화면 하나만으로는 제품 흐름 검토가 부족하다고 판단해, 화면 검토 단계의 웹 앱을
**홈 / 대화 / 이번 주 우리 / 추억** 4개 탭으로 넓힌다. 설정은 탭이 아니라 홈 상단 버튼으로 연다.
여전히 가상 데이터로만 동작하며 실제 인증·DB·AI·AWS는 연결하지 않는다.

## 구현 상태

| 항목                                                              | 상태                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| 4탭 내비게이션 뼈대(`NavigationContext`, `AppShell`, `BottomNav`) | 구현 완료                                               |
| 홈 화면(함께한 날짜, 오늘 요약, 주간 리포트 안내, 최근 추억 자리) | 구현 완료                                               |
| `daysTogether` / `CoupleProfile` / `relationshipService`          | 구현 완료                                               |
| 설정 화면(AI 분석 동의·코칭 카드 표시)                            | 구현 완료 (Phase C-1)                                   |
| 설정 화면 '작성 중 표현 도움'                                     | 화면 검토용 예시 체험 가능 (0009) — 개인 설정·기본 꺼짐 |
| '우리' 탭(주간 리포트·패턴 관찰·AI 개인 상담)                     | 구현 완료 (0006) — 라벨을 '이번 주 우리'→'우리'로 변경  |
| 추억 화면 · 대화→추억 저장 흐름 · AI 발견 · 그때의 우리           | 구현 완료 (0008) — 가상 데이터·예시 이미지              |
| 채팅 사진·영상 첨부 구조                                          | 구현 예정 (Phase C, 0005)                               |

## 결정

### 1. react-router를 아직 도입하지 않는다

0001의 결정을 유지한다. 화면 전환은 `apps/web/src/state/NavigationContext.tsx`가 담당한다 —
단일 `screen` 상태(`home | chat | week | memories | settings | ask`)와 `navigate(screen)`,
`devKey('screen')`에 저장, 기본값 `'home'`. `ScenarioContext`와 같은 패턴이다.
(`ask` = '우리' 탭에서 여는 AI 개인 상담 하위 화면, 0006. `settings`와 같이 탭이 아니다.)

가입·로그인·연인 연결처럼 브라우저 히스토리·딥링크·뒤로가기가 필요한 여러 화면이 생기는 시점에
react-router를 도입하고, 그때 `NavigationContext`를 재검토한다(0005).

### 2. 설정은 탭이 아니라 홈 상단 버튼

설정은 자주 오가는 곳이 아니고 하단 탭 4개로 이미 폭이 좁다. 홈 우상단 ⚙️ 버튼 → 설정 화면,
설정 화면에는 홈으로 돌아가는 버튼(←)을 둔다. `screen === 'settings'`(또는 `'ask'`)일 때는 어떤
하단 탭도 `aria-current="page"`가 아니다. 상단 배너·하단 탭 크롬은 모든 화면에서 유지한다.
`ask`('우리' 탭 → AI 개인 상담, 0006)도 같은 규칙을 따른다 — ← 버튼으로 '우리' 탭으로 돌아온다.

### 3. 대화 화면은 항상 마운트하고, 나머지 화면은 전환할 때 다시 만든다

`AppShell`은 `ChatPage`를 **항상 렌더**하고 비활성 탭일 때 `hidden` + `inert`로 감춘다.

- **왜 상시 마운트인가**: 전송·재시도는 700ms 뒤에 끝난다(0002 §5). 그 사이 다른 탭에 갔다 오면
  대화 화면이 언마운트됐다 다시 마운트되며 진행 중이던 요청의 완료 콜백을 잃는다. 특히 복귀가
  700ms보다 빠르면 저장소에는 아직 `sending`만 있어, 재마운트된 화면이 `전송 중`에 멈춘다.
  상시 마운트하면 완료 결과(`saved`/`failed`)가 살아있는 컴포넌트 상태에 그대로 반영된다.
- **왜 `hidden` + `inert`인가**: `hidden`으로 렌더 트리·탭 순서에서 빠지고, `inert`로 포커스·
  클릭·스크롤이 현재 탭에 영향을 주지 않는다. `MessageList`의 `scrollIntoView`는 `display:none`
  요소에서 no-op이고 입력창은 자동 포커스가 없지만, 방어적으로 `inert`도 함께 건다.
- **`reconcileToken`(0002 §5)** 로직은 그대로 유효하다. 탭 전환은 `scenario`를 바꾸지 않으므로
  `conversationId`/`visit`도 그대로다.

홈·'우리'·추억·설정·상담은 조건부로 렌더해 **탭을 열 때마다 새로 마운트**되고, 그때 서비스에서
최신 저장값을 다시 읽는다(예: 추억을 추가한 뒤 홈에 가면 홈이 최근 추억을 다시 읽음). 그래서
신규 화면에는 별도 Context가 필요 없고, `ChatPage`처럼 로컬에서 `createMockXService()` +
`useState` 초기화 패턴을 쓴다.

**예외(0006)**: 코칭 활용 중단은 '우리' 탭에서 토글하지만 **상시 마운트된 대화 화면**도 그 상태를
봐야 한다. 재마운트로 갱신되지 않으므로(설정↔대화와 같은 상황) `PatternProvider` 전역 컨텍스트를
둔다 — `SettingsContext`와 같은 이유·같은 패턴이다.

### 4. 신규 화면도 가상 데이터로 검토하고, 상태 레버는 둘로 통일한다

- **DevPanel 시나리오**(`empty` / `ai-warming-up` / `ai-failure` / `disconnected`) — 대화 부족·AI 상태.
- **설정의 AI 분석 동의**(`analysisConsent`, `isCoupleAnalysisActive`) — 커플 분석 활성 여부.

홈의 "오늘의 대화 요약"은 가상 예시임을 뱃지로 표시한다. `scenario === 'empty'`이면 요약 대신
대화 시작 안내를, 커플 분석이 비활성이면(둘 중 한 명이라도 철회) 중단 안내를 보여준다.
`coachingVisible`(코칭 카드 숨기기)은 개인 표시 설정이므로 홈·리포트에 영향을 주지 않는다.
직접 저장한 추억은 분석 동의와 무관하게 유지한다.

## 함께한 날짜

`CoupleProfile.relationshipStartDate`(고정 시드)와 `daysTogether(startDateISO, now?)`
(`apps/web/src/mocks/domain/relationship.ts`)로 계산한다. 한국식으로 **만난 첫날을 1일**로 센다
(`+1`). 예: `2026-09-09` 시작 → 그날 = 1일, 다음 날 = 2일.

## 검증

- `apps/web/src/app-shell/__tests__/Navigation.test.tsx` — 4탭 전환, 홈▸설정▸뒤로,
  숨긴 대화 탭의 `message-list`가 다른 탭에서 보이지 않음(`not.toBeVisible()`).
- `apps/web/src/features/home/__tests__/HomePage.test.tsx` — 함께한 날짜 표기, "예시" 뱃지,
  `empty` 시 대화 시작 안내, 분석 철회 시 홈 요약·리포트 안내가 중단 상태로 전환, 설정 왕복.
- `apps/web/src/features/chat/__tests__/ChatPage.test.tsx` — 전송 중·재시도 중 탭 이동 후 복귀 시
  최종 상태(`저장 완료`) 반영, 이동 순간 대화 목록이 보이지 않고 현재 탭이 정상 표시.
  기존 규칙(시나리오 전환·계정별 표시·분석 철회·`reconcileToken`) 회귀 유지.
- `apps/web/src/mocks/domain/__tests__/relationship.test.ts` — `daysTogether` 경계값.
- `apps/web/src/features/settings/__tests__/SettingsPage.test.tsx` — AI 분석 동의/코칭 카드 표시가
  홈·대화 화면에 반영, 두 설정의 차이(커플 분석 중단 vs 코칭 카드만 숨김), 상대 동의 상태 읽기 전용,
  작성 중 표현 도움 기본 꺼짐·켤 수 있음(0009), 계정별 분리.
