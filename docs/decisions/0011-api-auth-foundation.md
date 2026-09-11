# 0011 — apps/api 인증·저장 기반 (실제 Cognito 연동 이전)

날짜: 2026-09-11

## 배경

실제 인증·DB·서버 연결을 준비하는 과정에서 회사 AWS(`tunibaws`, 서울 리전) 사용이
확정됐고, EC2 한 대에 웹·API·PostgreSQL을 함께 두고 Amazon Cognito로 인증하는 구성으로
방향을 잡았다(회사 AWS 사용 가능 여부·비용·IAM 권한 확인 과정은 별도 계획 문서로 정리했고
이 저장소 파일로는 옮기지 않았다). 이번 ADR은 그 중 **AWS 자원을 하나도 만들지 않고 지금
바로 시작할 수 있는 로컬 구현 범위**를 기록한다 — 프로필·초대·커플 연결·동의 이력의 저장과
동시성 안전성, 그리고 실제 Cognito가 붙기 전까지 이 로직을 검증할 임시 인증 수단이다.

## 결정

### 1. 스키마와 도메인 로직은 `apps/web/src/mocks/domain/*`을 그대로 이식

`invite.ts`(72시간 TTL, Crockford base32 코드), `auth.ts`(이메일·비밀번호 형식 검증),
`consent.ts`(양측 동의 시에만 커플 분석 활성화) 규칙은 이미 mock 단계에서 결정·테스트된
내용이라 그대로 `apps/api/src/domain/`에 옮겼다. 비밀번호는 여전히 서버가 저장하지 않는다
— Cognito 연동 후에도 서버는 이를 그대로 전달만 하고 저장·기록하지 않을 예정이다.

### 2. 초대·커플 연결의 동시성 안전장치 (mock에는 없던 부분)

mock은 "확인 후 처리" 순서라 동시 요청에 안전하지 않다. 실제 DB에서는:

- `invites`에 `UNIQUE (inviter_user_id) WHERE status='pending'`(부분 유니크 인덱스)로
  "사용자당 활성 초대 1개"를 강제한다. **`users.couple_id`에는 유니크 제약을 걸지 않는다**
  — 커플은 두 사용자가 같은 `couple_id`를 공유해야 하므로 그 컬럼 자체를 유니크로 만들면
  커플당 사용자 1명만 허용되는 잘못된 설계가 된다.
- 초대 발급 직전 지연 만료 처리(`expireStalePendingInvites`)로, 만료됐지만 DB에는 여전히
  `pending`으로 남아 있는 초대가 새 초대 발급을 막지 않게 한다.
- 초대 수락은 `SELECT ... FOR UPDATE`로 해당 초대 행을 잠근 뒤 상태를 재확인하고, 두
  사용자 행을 id 오름차순으로 잠가 `couple_id IS NULL`을 조건부로 갱신한다. 영향받은 행
  수가 기대와 다르면(서로 다른 코드로 같은 사용자를 동시에 연결하려는 경합 등) 트랜잭션
  전체를 롤백한다.
- 직렬화 오류(`40001`)·교착상태(`40P01`)는 `withRetry`가 짧은 backoff 후 자동 재시도한다.
- 연결이 끝나면 양쪽의 남은 pending 초대를 모두 무효화한다.

### 3. 동의는 이력으로 저장

`users.analysis_consent`(현재값, 조회 편의용)와 `consent_events`(변경 이력)를 함께 갱신한다.
동의는 기본 꺼짐이며 어떤 흐름도 막지 않는다 — API 레벨에서 가드를 두지 않았다. 철회 후
기존 관찰·의견 데이터의 보존/삭제 정책은 여전히 미정(0004·0005·0007과 동일 상태).

### 4. 실제 Cognito 대신 로컬 테스트 모드 전용 인증

`LOCAL_TEST_AUTH=true`일 때만 `X-Test-User-Id` 헤더로 인증을 대체한다. 이중으로 막아 둔다:
① 미들웨어가 이 플래그가 꺼져 있으면 헤더를 아예 읽지 않고, ② `/api/test/*` 라우트 자체가
플래그가 꺼져 있으면 앱에 등록되지 않는다. `src/config/env.ts`의
`assertTestAuthNotEnabledInProduction`이 `NODE_ENV=production`이면서 `LOCAL_TEST_AUTH=true`인
조합을 서버 기동 시점에 에러로 막는다 — 배포 설정 실수로 이 경로가 살아있는 상태로 나가는
것을 코드로 차단한다.

### 5. 격리된 테스트 DB

`test/setup.ts`가 `TEST_DATABASE_URL`의 데이터베이스 이름이 `_test`로 끝나는지 확인하고
아니면 테스트 전체를 즉시 중단한다 — 개발 DB나 향후 실제 참여자 데이터가 있는 DB를 실수로
초기화하는 사고를 막기 위해서다.

### 6. `apps/web`은 건드리지 않음

기존 화면과 가상 데이터 흐름은 그대로 유지한다. mock 서비스를 실제 API 클라이언트로
교체하는 작업은 Cognito 연동과 AWS 배포 이후, 별도 단계로 분리한다.

## 이번 범위가 아닌 것

- 실제 Cognito 연동(별도 테스트용 User Pool 생성 검토 후 진행), 이메일 인증·비밀번호 재설정.
- AWS 자원 생성·배포(EC2·도메인·백업 등) — 견적·생성 목록을 검토받은 뒤 진행.
- 실제 대화 송수신, AI 코칭 검증.
- `sessions`(서버 세션)·`rate_limit_counters`(요청 제한) 테이블 — 실제 로그인·요청 제한
  로직이 붙는 시점에 추가한다.

## 검증

`apps/api/test/`: 도메인 단위 테스트(`invite`, `auth`, `consent`, `retry`, `env` 가드),
통합 테스트(`profile`, `consent`, `invites`의 동시성 시나리오, `testAuthGuard`)를 별도
`_test` DB에 대해 실행한다. 구체적인 실행 결과는 이 ADR이 아니라 작업 보고에 남긴다.

## 보완 (2026-09-11 추가)

첫 구현을 실제로 돌려보며 확인된 4가지를 고쳤다 — 전부 로컬 API 수정 범위이며 Cognito·AWS
배포·`apps/web` 연결로는 넘어가지 않는다.

1. **AI 분석 동의 입력 검증·원자적 저장**: `PUT /api/consent`가 `Boolean(req.body.granted)`로
   아무 값이나 강제 변환하던 것을 없애고 `typeof granted === 'boolean'`만 허용한다(그 외엔 400,
   아무것도 바꾸지 않음). `users.analysis_consent` 갱신과 `consent_events` 삽입을 같은
   커넥션의 단일 트랜잭션으로 묶고(`applyConsentChangeInTransaction`), 사용자 행을
   `FOR UPDATE`로 잠가 동시 요청에서도 현재값과 마지막 이력 행이 항상 일치하게 한다.
2. **초대 발급의 중복·충돌 처리**: 이미 활성 초대가 있는 상태에서 다시 발급을 요청해도 더 이상
   500이 나지 않는다 — 기존 활성 초대를 그대로 돌려준다(멱등). 유니크 위반(23505)을 PostgreSQL
   오류의 `constraint` 이름으로 구분해 "이미 활성 초대 있음"(`invites_one_pending_per_inviter`)과
   "무작위 코드 충돌"(`invites_code_key`)을 분리했다. 실패한 문장 이후 같은 트랜잭션에 더 쓸 수
   없다는 PostgreSQL 규칙 때문에, 코드 충돌 재시도마다 `SAVEPOINT`를 찍고 실패 시 그 지점으로만
   롤백한다(트랜잭션 자체를 실패시키지 않음).
3. **README 실행 절차·환경변수 로딩**: `.env`를 아무도 읽지 않아 README 그대로 따라 하면
   `DATABASE_URL`이 적용되지 않던 문제를 고쳤다. `src/config/loadDotEnv.ts`(의존성 추가 없는
   최소 파서)를 `dev`/`migrate`/`test` 진입점 각각에서 호출한다 — 이미 셸에 설정된 값은
   덮어쓰지 않는다. `.env`는 `apps/api/.env`에 두고, 실행은 `apps/api` 안에서(또는
   `pnpm --filter @deardarling/api`로) 한다.
4. **연애 시작일 수정의 누락·삭제·오류 구분**: `PATCH /api/couple`에서
   `relationshipStartDate` 필드가 아예 없으면 기존 값을 유지하고, 명시적 `null`일 때만
   지운다(이전엔 필드가 없어도 `null`로 취급해 조용히 지워지고 있었다). `src/domain/date.ts`의
   `isValidCalendarDate`로 `YYYY-MM-DD` 형식과 실존 여부(2025-02-30 같은 날짜 포함)를 검사해
   잘못된 값은 400으로 거부하고 기존 값을 그대로 둔다. 초대 수락(`POST
/api/invites/:code/accept`) 시 전달하는 시작일에도 같은 검증을 적용한다.

## 보완 2 (2026-09-11 추가) — 동의 이력 순서·롤백 검증 마무리

1. **동의 이력 순서를 트랜잭션 시작 시각이 아니라 버전으로 보장**: `changed_at`이 쓰던
   `now()`는 트랜잭션이 _시작된_ 시각을 돌려준다 — 행 잠금으로 실제 처리(커밋) 순서는
   보장돼도, 나중에 시작한 요청이 먼저 커밋되면 `changed_at` 기준 정렬이 실제 순서와
   어긋날 수 있었다. `users.consent_version`(현재 버전)과 `consent_events.version`(그
   변경이 몇 번째인지)을 추가해, 사용자 행을 `FOR UPDATE`로 잠근 **뒤** 다음 버전 번호를
   계산하고 현재값·이력에 같은 트랜잭션으로 함께 기록한다(`applyConsentChangeInTransaction`).
   이력 조회는 `ORDER BY version`으로 바꿨고, `changed_at`도 트랜잭션 시작 시각 대신 실제
   실행 시점을 반영하는 `clock_timestamp()`로 기록한다. 마이그레이션
   `0002_consent_history_versioning.sql`이 기존 `consent_events`를 지우지 않고
   `changed_at` 순서를 최선으로 버전을 소급 부여한다. 테스트는 "먼저 시작한 요청이 나중에
   커밋되는" 상황을 두 개의 `pg` 클라이언트로 직접 재현해 현재값이 마지막(최고 버전) 이력과
   일치하는지 확인한다(`orders history by version ...`).
2. **롤백 테스트를 실제 서비스 경로로**: 이전엔 테스트가 트랜잭션을 직접 열고 실패시킨 뒤
   `ROLLBACK`도 테스트가 호출했다. 이제는 `(user_id, version)` 유니크 인덱스를 이용해
   `recordConsentChange`가 계산할 다음 버전과 같은 값으로 이력 행을 미리 심어 두고,
   `recordConsentChange`를 그대로 호출해 **그 함수 자신의 INSERT**가 실제 유니크 위반으로
   실패하게 만든다 — 함수 내부의 `catch`/`ROLLBACK`이 실제로 시험대에 오르고, 호출 뒤
   현재값·버전·이력이 모두 원래 상태로 남아 있는지 확인한다.
