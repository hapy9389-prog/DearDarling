# DearDarling

연결된 두 사람의 실제 대화에서 필요한 순간 AI가 소통을 돕는 관계 코칭 메신저. 전체 제품 정의는 [`docs/`](./docs)를 참고한다.

## 현재 상태

**화면 검토 단계 (가상 데이터).** 실제 인증·DB·AI·AWS는 아직 연결되어 있지 않다. 목적은 화면 구성과 사용 흐름을 가상 데이터로 먼저 검토하는 것이며, 검토 후 단계적으로 실제 기능을 연결한다.

| 영역                 | 상태                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | ✅ 진행 중 — 화면(홈·대화·우리·추억·설정, 가상 데이터). 홈('오늘의 우리')·4탭·설정·'우리'(주간 리포트·패턴 관찰·AI 상담)·추억(대표 발견+펼치기·다양한 예시) 완료. 대화 입력창 여러 줄, 접힌 코칭 요점 한 줄, 작성 중 표현 도움(화면 검토용 예시) (0009). 시작·가입·로그인·프로필·연인 연결·AI 분석 동의 진입 흐름 — react-router 도입, 신규 체험 vs 민준·서연 검토 모드 구분 (0010) |
| `apps/api`           | 🚧 진행 중 — 프로필·초대·커플 연결·동의 이력을 PostgreSQL에 저장(동시성 안전장치 포함). 실제 Cognito 연동·AWS 배포는 아직(로컬 테스트 모드 전용 임시 인증) (0011)                                                                                                                                                                                                                   |
| `apps/worker`        | ⏳ 예정 — AI 작업 처리기                                                                                                                                                                                                                                                                                                                                                            |
| `packages/contracts` | ⏳ 예정 — 공유 타입·API 계약 (`apps/web/src/mocks/types.ts`에서 추출 예정)                                                                                                                                                                                                                                                                                                          |
| `packages/domain`    | ⏳ 예정 — 공유 도메인 로직                                                                                                                                                                                                                                                                                                                                                          |
| `infra`              | ⏳ 예정 — AWS 배포 구성                                                                                                                                                                                                                                                                                                                                                             |

## 개발 환경

- Node.js 24.x, pnpm 12.x (workspace)
- pnpm이 전역 설치되어 있지 않다면 `npx pnpm@12.3.4 <command>` 형태로 실행할 수 있다.

```bash
pnpm install
pnpm dev          # apps/web 개발 서버
pnpm build         # apps/web 프로덕션 빌드
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

## 저장소 구조

```
apps/web        웹 화면 (React + TypeScript, 현재 유일한 실동작 코드)
apps/api        API 서버 (placeholder)
apps/worker     AI 작업 처리기 (placeholder)
packages/contracts   공유 타입·API 계약 (placeholder)
packages/domain      공유 도메인 로직 (placeholder)
infra           AWS 배포 구성 (placeholder)
docs             설계 문서, 의사결정 기록
```

## 설계 문서

- [`docs/decisions/0001-step1-tech-stack.md`](./docs/decisions/0001-step1-tech-stack.md) — 화면 검토 단계 기술 스택 선택 이유
- [`docs/decisions/0002-chat-review-behavior-rules.md`](./docs/decisions/0002-chat-review-behavior-rules.md) — 대화 화면이 지키는 동작 규칙(메시지 공개 범위, 시나리오별 저장 분리, 코칭 상태 우선순위, 전송 방식)과 검증 테스트
- [`docs/decisions/0003-app-navigation-and-screens.md`](./docs/decisions/0003-app-navigation-and-screens.md) — 4탭 내비게이션(홈·대화·이번 주 우리·추억), 설정은 홈 상단 버튼, 상태 기반 화면 전환, 대화 화면 상시 마운트
- [`docs/decisions/0004-pattern-observation-and-coaching-use.md`](./docs/decisions/0004-pattern-observation-and-coaching-use.md) — 소통 패턴 관찰·의견·코칭 활용 중단 모델('양측 맞아요 확인' 방식 대체)
- [`docs/decisions/0005-future-requirements-and-follow-ups.md`](./docs/decisions/0005-future-requirements-and-follow-ups.md) — 후속 화면·기능(가입·로그인·연인 연결, 사진·영상 전송·AI 분석 등)과 보류 항목
- [`docs/decisions/0006-us-tab-and-ai-consultation.md`](./docs/decisions/0006-us-tab-and-ai-consultation.md) — '우리' 탭(주간 리포트·패턴 관찰·의견·코칭 활용 중단)과 AI 개인 상담 진입점
- [`docs/decisions/0007-us-tab-weekly-report-redesign.md`](./docs/decisions/0007-us-tab-weekly-report-redesign.md) — '우리' 탭을 통계 상단 + 이번 주 핵심 발견 하나 중심으로 개편(`미확인 가설` 칩 제거, 0006 §3 대체)
- [`docs/decisions/0009-core-screen-polish.md`](./docs/decisions/0009-core-screen-polish.md) — 가입·로그인 전 핵심 화면 보완(접힌 코칭 요점 한 줄, 여러 줄 입력창, 홈 '오늘의 우리', 작성 중 표현 도움 예시, 추억 예시·길이)
- [`docs/decisions/0010-onboarding-auth-partner-connection.md`](./docs/decisions/0010-onboarding-auth-partner-connection.md) — 가입·로그인·연인 연결 진입 흐름(가상), react-router 하이브리드 도입, 세션 모델·세대 가드, 체험 모드 vs 검토 모드 격리, AI 분석 동의 분리·기본 꺼짐
- [`docs/decisions/0011-api-auth-foundation.md`](./docs/decisions/0011-api-auth-foundation.md) — `apps/api` 인증·저장 기반: 프로필·초대·커플 연결·동의 이력의 실제 PostgreSQL 스키마와 동시성 안전장치, 실제 Cognito 연동 전 로컬 테스트 모드 전용 임시 인증
