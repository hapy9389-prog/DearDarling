# apps/api

프로필 저장, 초대 코드 생성·만료·수락, 커플 연결, AI 분석 동의 이력을 실제 PostgreSQL에
저장하는 TypeScript API 서버. **실제 인증(Amazon Cognito)은 아직 연결하지 않았다** —
로컬 개발·테스트에서는 `LOCAL_TEST_AUTH=true`일 때만 동작하는 헤더 기반 임시 인증
(`X-Test-User-Id`)으로 대체한다. 자세한 설계 배경은
[`docs/decisions/0011-api-auth-foundation.md`](../../docs/decisions/0011-api-auth-foundation.md) 참고.

## 로컬에서 실행하기

**`.env` 파일 위치**: 반드시 `apps/api/.env`(이 README와 같은 폴더, `.env.example` 바로 옆)에
둔다. 아래 명령들은 실행 기준 폴더가 `apps/api`여야 한다 — 저장소 루트에서 실행한다면
`pnpm --filter @deardarling/api <script>` 형태를 쓴다(pnpm이 실행 폴더를 `apps/api`로 맞춰준다).
`apps/api` 안에서 직접 `pnpm <script>`를 실행해도 동일하다. `.env`는 `.gitignore`에 이미
포함돼 있어 커밋되지 않는다 — 값을 로그로 출력하는 곳도 없다.

각 스크립트(`dev`/`migrate`/`test`)는 시작할 때 이 `.env`를 직접 읽어 `DATABASE_URL` 등을
채운다(`src/config/loadDotEnv.ts`). **이미 셸에서 `export`해 둔 값이 있으면 그 값이 항상
우선하고 `.env` 값으로 덮어쓰지 않는다.**

```bash
cd apps/api                    # 또는 저장소 루트에서 pnpm --filter @deardarling/api <script>
cp .env.example .env           # 값은 로컬 개발용 기본값 그대로 써도 된다
pnpm db:up                     # 127.0.0.1:5432에만 바인딩된 PostgreSQL 기동
pnpm migrate                   # DATABASE_URL(개발 DB) 스키마 적용
pnpm dev                       # http://127.0.0.1:3000 (외부에 노출되지 않음)
```

## 테스트

```bash
cd apps/api
pnpm test
```

`pretest`도 같은 `.env`를 읽는다. `TEST_DATABASE_URL`이 가리키는 DB(반드시 `_test`로 끝나야
함)를 필요하면 만들고 마이그레이션을 적용한다. `test/setup.ts`가 실행 중인 DB 이름이 `_test`로
끝나지 않으면 테스트 전체를 즉시 중단시켜, 개발 DB나 실제 참여자 데이터를 실수로 지우는 사고를
막는다 — 실제 `.env`나 비밀정보는 테스트 로그에도 출력하지 않는다.

## 지금 단계에서 하지 않는 것

- 실제 Cognito 연동, 이메일 인증·비밀번호 재설정 — 다음 단계에서 별도 검토 후 연결.
- AWS 자원 생성·배포 — 견적·생성 목록을 검토받은 뒤 진행.
- 실제 대화 송수신·AI 코칭 — 이번 범위는 인증·저장 기반까지다.
- `apps/web`은 이번 작업에서 건드리지 않았다 — 여전히 가상 데이터로 동작한다.
