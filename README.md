# DearDarling

연결된 두 사람의 실제 대화에서 필요한 순간 AI가 소통을 돕는 관계 코칭 메신저. 전체 제품 정의는 [`docs/`](./docs)를 참고한다.

## 현재 상태

**화면 검토 단계 (가상 데이터).** 실제 인증·DB·AI·AWS는 아직 연결되어 있지 않다. 목적은 화면 구성과 사용 흐름을 가상 데이터로 먼저 검토하는 것이며, 검토 후 단계적으로 실제 기능을 연결한다.

| 영역                 | 상태                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | ✅ 진행 중 — 화면(1단계: 대화 화면, 가상 데이터)                           |
| `apps/api`           | ⏳ 예정 — 실제 인증·DB 연결 단계                                           |
| `apps/worker`        | ⏳ 예정 — AI 작업 처리기                                                   |
| `packages/contracts` | ⏳ 예정 — 공유 타입·API 계약 (`apps/web/src/mocks/types.ts`에서 추출 예정) |
| `packages/domain`    | ⏳ 예정 — 공유 도메인 로직                                                 |
| `infra`              | ⏳ 예정 — AWS 배포 구성                                                    |

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
