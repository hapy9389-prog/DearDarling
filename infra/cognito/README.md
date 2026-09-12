# DearDarling 개발용 Cognito 준비 (infra/cognito)

apps/api는 이미 Cognito를 호출하는 코드(`apps/api/src/cognito/*`)를 갖추고 있고
`COGNITO_REGION`/`COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID`/`COGNITO_CLIENT_SECRET`/
`SESSION_TOKEN_ENCRYPTION_KEY`가 `apps/api/.env`에 채워지기를 기다리는 상태다. 이 디렉터리는
그 값을 안전하게 채우기 위한 준비 파일이며, **여기 있는 스크립트를 실행하기 전까지 AWS 자원은
하나도 만들어지지 않는다.**

**권한 상태(2026-09-12 갱신)**: Path A(`create-dev-pool.sh`)가 필요로 하는 "필요 권한" 6개
액션은 admin이 부여했다고 확인됐다 — `cognito-idp:ListUserPools`를 실제 읽기 전용 호출로
재확인함(계정에 DearDarling 이름의 Pool은 아직 없고, 다른 사내 프로젝트의 Pool만 존재 —
이름 충돌 없음). 즉 더 이상 "권한 승인 대기" 상태가 아니며 Path A 실행 준비가 끝났다 — 단,
이번엔 실제로 Pool·Client를 생성하지 않았다(범위 밖, EC2·PostgreSQL 구축을 먼저 완료한 뒤
진행하기로 함). 실행 순서는 아래와 동일하다.

## 두 가지 경로

- **Path A — 자동 생성 스크립트 (`create-dev-pool.sh`)**: 이 저장소를 다루는 사람의 IAM
  사용자가 직접 Cognito API를 호출해 Pool·Client를 만들거나 재사용한다. 아래 "필요 권한"이
  전부 있어야 한다.
- **Path B — 수동 연결 (`connect-existing.sh`)**: 관리자(또는 콘솔 접근 권한이 있는 사람)가
  Pool·Client를 직접 만들어 ID·Secret만 전달해 주는 경우. **이 경로는 AWS를 전혀 호출하지
  않으므로 실행하는 사람에게 어떤 cognito-idp 권한도 필요 없다** — 전달받은 값을 숨김
  입력으로 받아 `apps/api/.env`에 반영만 한다.

둘 중 하나만 쓰면 된다. 두 경로 모두 `sync-env.mjs`(원자적 `.env` 갱신)를 공유한다.

## Path A에 필요한 권한 (스크립트가 실제로 호출하는 것과 정확히 일치)

`create-dev-pool.sh`는 아래 6개 액션을 **전부** 호출할 수 있어야 끝까지 진행된다 — 하나라도
없으면 "선택"이 아니라 **그 시점에서 중단**한다(재사용/신규 생성 여부와 관계없이):

| 액션 | Resource | 스크립트가 부르는 시점 |
|---|---|---|
| `cognito-idp:CreateUserPool` | `*` (Pool이 아직 없음) | 동일 이름 Pool이 없을 때 |
| `cognito-idp:ListUserPools` | `*` (계정 전체 나열) | 매번 재사용 전 중복 확인(상태 파일에 이미 ID가 있으면 생략) |
| `cognito-idp:DescribeUserPool` | 특정 Pool ARN 가능 | Pool을 재사용할 때마다(출처 불문) 태그 검증 |
| `cognito-idp:CreateUserPoolClient` | 특정 Pool ARN 가능(Pool은 이미 존재) | 동일 이름 Client가 없을 때 |
| `cognito-idp:ListUserPoolClients` | 특정 Pool ARN 가능 | 매번 재사용 전 중복 확인 |
| `cognito-idp:DescribeUserPoolClient` | 특정 Pool ARN 가능 | Client를 재사용할 때마다(출처 불문) 소속 Pool·Secret 확인 — **Secret은 이 호출로만 다시 얻을 수 있다** |

`CreateUserPool`·`ListUserPools`만 계정 전체(`*`) 범위가 불가피하다(대상이 아직 없거나 목록
자체를 나열하기 때문). 나머지 4개는 이미 존재하는 특정 Pool의 ARN
(`arn:aws:cognito-idp:ap-northeast-2:<account>:userpool/<id>`)으로 좁힐 수 있다 — 다만 첫
Pool 생성 시점엔 그 ID를 아직 몰라 좁혀서 미리 요청할 수 없다는 부트스트랩 문제가 있다.
관리자에게 보낼 요청문(두 가지 방식)은 계획 문서(4-2·4-3)에 정리해 뒀다.

`UpdateUserPool`/`UpdateUserPoolClient`/`DeleteUserPool`/`DeleteUserPoolClient`는 이 스크립트가
전혀 호출하지 않는다 — Pool·Client가 만들어진 뒤 설정을 조정하거나 잘못 만든 걸 지워야 할 때만
그 Pool ARN 하나로 한정해 별도로 요청한다.

`.env` 읽기·쓰기 규칙(공백·따옴표·중복 키·빈 값 처리, 같은 키가 여러 번 있으면 "첫 번째" 값이
유효하다는 것)은 `env-lib.mjs`에 한 곳으로 모아 두고 `apps/api/src/config/loadDotEnv.ts`(서버가
`.env`를 읽는 방식)와 정확히 맞췄다 — `create-dev-pool.sh`·`connect-existing.sh`·
`verify-auth-flow.sh`·`sync-env.mjs`가 전부 이 파일을 통해서만 `.env`를 읽는다. 단순
정규식(`^KEY=`)이나 `sed`로 직접 읽으면 `KEY = 값`처럼 공백이 있는 기존 줄을 놓쳐 서버는 계속
기존 값을 쓰는데 이 도구만 새 줄을 추가하는 불일치가 생길 수 있어서다.

## 실행 순서

```bash
# 1) 오프라인 자체 검증(AWS·서버·DB 호출 없음) — 반드시 먼저 통과 확인
bash infra/cognito/test/run-self-test.sh              # create-dev-pool.sh (10개)
bash infra/cognito/test/run-verify-flow-self-test.sh  # verify-auth-flow.sh (11개)
bash infra/cognito/test/run-env-lib-self-test.sh      # .env 읽기/쓰기 규칙 (7개)

# 2-A) 위 권한을 받았다면: 자동 생성/재사용
./infra/cognito/create-dev-pool.sh

# 2-B) 관리자가 대신 만들어 ID·Secret을 전달했다면: 수동 연결(AWS 미호출)
./infra/cognito/connect-existing.sh

# 3) 서버가 뜬 상태에서 실제 인증 흐름 검증
./infra/cognito/verify-auth-flow.sh
```

`state.local.json`(Path A가 만드는 진행 상태 기록)과 `apps/api/.env` 안의 비밀값은 git에 커밋되지
않는다(`.gitignore`, 루트 `.gitignore`의 `.env` 규칙). 스크립트는 ClientSecret·암호화 키 값을
어떤 단계에서도 화면에 출력하지 않는다.

## 오프라인 자체 검증이 실제로 확인하는 것

- **`test/run-self-test.sh`**(10개): 진짜 `aws` 대신 `test/fake-aws`를 PATH에 놓고
  `create-dev-pool.sh`를 실행해, 종료 코드뿐 아니라 실제 AWS 호출 기록(`calls.log`)·중단
  메시지·`state.local.json`·`.env` 내용까지 확인한다 — 목록 조회 거부/응답 유실/이름 중복/태그
  불일치/Client-Pool 소속 불일치를 재사용하지 않고 거르는지, 정상 재사용 시 Describe로 확인한
  실제 Secret이 반영되는지, 기존 유효한 암호화 키를 보존하고 잘못된 형식은 중단하는지.
- **`test/run-verify-flow-self-test.sh`**(11개): 진짜 `curl`·`psql` 대신
  `test/fake-curl`·`test/fake-psql`을 PATH에 놓고 `verify-auth-flow.sh`를 실행한다.
  `/api/auth/logout`·`/api/auth/logout-all`의 실제 계약(204, 본문 없음)에 맞춰 정상 응답이면
  다음 단계로 진행하고 오류 응답(500)이면 그 자리에서 중단하는지, 로그아웃 전 쿠키 재사용이
  거부되는지, 두 번째 세션이 `logout-all`로 즉시 차단되는지, DB 확인(10단계)에서 psql
  미설치·`DATABASE_URL` 누락·쿼리 실행 실패(오류 원문 미노출 포함)·조회 결과 없음·시간 초과를
  전부 "미확인"으로만 표시하고 인증 흐름(1~9단계)의 성공 여부와 분리해서 보고하는지 확인한다.
- **`test/run-env-lib-self-test.sh`**(7개): 공백·따옴표가 섞인 기존 설정을 서버와 같은 값으로
  읽는지, 중복 키가 있으면 첫 번째 값을 쓰는지, `sync-env.mjs`가 그런 기존 줄을 새 줄 추가가
  아니라 교체로 처리하고 무관한 다른 설정은 그대로 두는지, `LOCAL_TEST_AUTH` 판정이 공백·따옴표·
  중복 앞에서도 서버와 같은 결과를 내는지 확인한다.

**여기서 검증하지 못하는 것**(실제 AWS·서버·DB가 필요해 이번 준비 범위 밖): 실제 Cognito
계정에 대한 API 호출 자체(권한·네트워크·서비스 쪽 동작), 실제로 뜬 apps/api 서버에 대한
`verify-auth-flow.sh`의 회원가입~로그인 흐름, 실제 PostgreSQL 접속(`PGDATABASE`에 연결
문자열을 통째로 넣어 `psql`을 부르는 방식은 libpq 표준 동작이지만 이 환경에 `psql`이 없어
실제 접속까지는 시험하지 못했다).
