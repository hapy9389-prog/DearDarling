# 0010 — 가입·로그인·연인 연결 진입 흐름 (가상 데이터)

날짜: 2026-09-10

## 배경

대화 화면 하나에서 시작해 홈·우리·추억·설정까지 넓혔지만(0003), 여전히 "앱을 열면 곧바로
민준·서연 커플"이었다. 신규 사용자의 진입 경험(시작 → 가입 → 프로필 → 연인 연결 → 본 앱)을
가상 데이터로 검토하기 위해 온보딩 흐름을 추가한다. 0003 §1 / 0005가 예고한 "이 시점에 react-router
도입" 단계다.

여전히 실제 인증·이메일·DB·AI·AWS·사진 업로드는 연결하지 않는다. 기존 민준·서연 "검토 모드"의
데이터·설정은 건드리지 않고, 신규 체험 흐름과 명확히 구분한다.

## 결정

### 1. react-router 하이브리드

`react-router` 8.3.1(exact)을 도입한다(`peerDependencies`: react/react-dom ≥ 19.2.7 — 프로젝트 19.2.8과
호환). 컴포넌트 API(`<BrowserRouter>`/`<Routes>`/`<Route>`)를 쓰고 데이터 라우터는 쓰지 않는다.
테스트는 `<MemoryRouter>` + `AppRouter`.

- 온보딩(`/`, `/signup`, `/login`, `/reset`, `/onboarding/profile`, `/consent`, `/connect`,
  `/connect/join`)은 라우트로 오간다 — 브라우저 뒤로가기·새로고침·딥링크가 동작한다.
- 기존 4탭 + 하위 화면은 `/app/*` **레이아웃 라우트 하나** 아래 `AppShell`이 담당한다. `/app` 안에
  머무는 동안 `ChatPage`는 마운트를 유지한다(0003 §3의 상시 마운트 그대로). `/app`을 벗어나면
  `AppShell`이 언마운트된다.

### 2. `NavigationContext`는 라우터 어댑터

공개 API(`screen`, `params`, `navigate`, `APP_TABS`, `AppScreen`)는 그대로 두고 내부만 교체했다.
`screen`은 URL(`/app/<screen>`)에서 파생하고, `navigate('chat')`는 `/app/chat`으로 이동한다.
`devKey('screen')` 영속은 URL이 대체한다. `BottomNav`와 탭 화면 컴포넌트는 수정하지 않았다.

### 3. 세션 모델 + 세대(generation) 가드

`SessionContext`가 최상위(`/app` Provider 스택 밖)에 있다. 저장 키 `deardarling:mock:v1:trial:session`.

```
Session = { kind: 'trial'; userId } | { kind: 'review'; accountId }
status  = anonymous | trial-incomplete | trial-unconnected | trial-connected | review
```

세션을 바꾸는 모든 동작(가입·로그인·로그아웃·리뷰 모드 진입·계정/시점 전환)이 `sessionGen`을 올린다.
비동기 작업(가입·로그인·재설정·`acceptInvite`)은 시작 시 세대를, 연결은 세대 + 사용자 id를 캡처하고,
끝났을 때 달라졌으면 결과를 버린다(세션 미설정·내비게이션 없음). "언마운트로 요청이 취소된다"고
가정하지 않는다 — mock 서비스의 `mockDelay`/`writeJSON`은 끝까지 실행되고, 격리는 이 가드와
coupleId/userId 스코프 저장 키로 보장한다.

**이미 전송을 요청한 메시지**는 `chatService.settle`이 700ms 뒤 그 커플의 `coupleKey(...,'messages')`에
`saved`로 저장을 끝낸다. 로그아웃해도 그 커플 저장소에 남고, 재로그인 시 저장됨 상태로 보인다.
다른 세션(검토 커플/다른 체험 커플)은 키가 분리돼 있어 영향받지 않는다.

### 4. 라우트 가드로 단계 강제 (새로고침·직접 URL 안전)

`SessionProvider`는 init 시 세션·사용자 목록을 localStorage에서 동기 로드한다. 가드는 파생 `status`만 본다.

- `RequireAuth` — 익명 → `/`
- `RequireProfileComplete` — `trial-incomplete`(닉네임 없음) → `/onboarding/profile`
- `RedirectIfConnected` — `review`·`trial-connected` → `/app/home` (연결·동의 화면 진입 차단)
- `RequireConnected` — `trial-unconnected` → `/connect` (`/app`만)
- `RedirectIfAuthed` — 로그인 상태면 `/`·`/signup`·`/login` 대신 `landingPathFor(status)`

**AI 분석 동의는 어떤 가드에도 없다** — 선택 단계이고 건너뛰어도 아무 흐름도 막히지 않는다.

### 5. 체험 identity와 시드 격리

|           | 검토 모드 (그대로)             | 체험 모드                              |
| --------- | ------------------------------ | -------------------------------------- |
| user      | `user-minjun` / `user-seoyeon` | `trial-user-xxxxxx` (`authService`)    |
| couple    | `couple-1`                     | `trial-couple-xxxxxx` (`acceptInvite`) |
| 프로필    | `fixtures/accounts.ts`         | `TrialUser` (닉네임·아바타 편집)       |
| 커플 정보 | `SEED_COUPLE_PROFILE`          | `coupleKey(id,'profile')`              |

`fixtures/accounts.ts`의 `isReviewCouple`/`isReviewUser`로 시드 폴백을 게이팅한다:
`chatService`·`patternService`·`memoriesService`·`relationshipService`·`settingsService` 모두
검토 커플·계정에만 시드를 돌려주고, 체험은 빈 상태로 시작한다. `ActiveAccountContext`가
`useSession()`을 읽어 review/trial 모드를 만들고, `lookupMember`로 표시용 계정을 해석한다
(`getAccount` 직접 호출부는 이걸로 교체).

### 6. 신규 체험은 AI 분석·코칭·주간 발견을 제공하지 않는다

"분석했지만 패턴을 못 찾았다"고 말하지 않고 "이번 체험에서는 제공하지 않는다"고 안내한다.

- 대화 화면 코칭 영역: 동의 여부와 무관하게 `{ kind: 'trial-unavailable' }` → "이번 체험에서는 AI
  코칭을 제공하지 않아요." (예시 코칭 검토는 **민준·서연 검토 모드 한정**.)
- 우리 탭: `patternService.getWeeklyReport` → `buildTrialWeeklyReport` — **저장 완료(`saved`) 메시지만**,
  **이번 주(월~일) 범위**로 통계를 계산하고 관찰·대표 발견은 없다. 메시지 0이면 "대화를 시작해 보세요",
  1건 이상이면 통계 스트립 + "이번 체험에서는 AI 분석 결과를 제공하지 않아요".
- 홈: 오늘 대화 여부(`hadSavedMessageToday`)와 주간 통계 기간을 구분한다. 오늘 대화가 있으면
  "오늘도 이야기를 나눴어요 · 이번 체험에서는 AI 요약을 제공하지 않아요", 없으면 "오늘은 아직 나눈
  대화가 없어요". 리포트 미리보기는 항상 "이번 체험에서는 주간 리포트를 제공하지 않아요".

### 7. AI 분석 동의 — 기본 OFF, 필수 아님, 상대 없이 내 설정만

`createDefaultTrialUserSettings`(동의 `false`)를 추가했다. `createDefaultUserSettings`(민준·서연 기본
`true`)는 그대로. `authService.signUp`이 가입 시 동의 OFF를 명시적으로 기록한다(서버 default를
흉내내는 seam). `settingsService` 폴백 default도 `isReviewUser`로 분기한다.

`/consent`는 `useMyConsent(userId)` + 순수 `ConsentToggle`만 쓴다 — 상대·`coupleAnalysisActive`가 없어
`/app` Provider 없이 동작한다. `/app/settings`는 기존 전체 Context로 상대 동의 상태도 함께 보여준다.

### 8. 연인 연결 mock

`inviteService`(`deardarling:mock:v1:trial:invites`) — 코드 `DD-XXXXXX`(Crockford base32, I/L/O/U 제외),
TTL 72시간, 사용자당 활성 초대 1개. `lookupInvite`는 확인 화면용으로 `ok`/`not-found`/`expired`/
`revoked`/`already-accepted`/`self`/`accepter-already-connected`를 돌려주고, `acceptInvite`가
`trial-couple` 생성 → 두 `TrialUser` 연결 → 커플 프로필(`connectedAt` 지금, `relationshipStartDate`
입력값 또는 `null`) 기록 → 초대 `accepted`.

**연애 시작일은 선택**이다. 연결 화면에서 비워도 되고(`null` 유지), 연결일(`connectedAt`)과 분리해
`CoupleProfile` 한 곳에서 관리하며, 연결 후 `/app/settings` "커플 정보" 섹션에서 추가·수정·삭제한다.
홈은 시작일이 있으면 "함께한 지 N일", 없으면 설정 안내를 보여준다.

**솔로 리뷰어 검토 경로 둘 다 지원**: ① DevPanel "가상 상대와 연결 (검토용)" — 가상 `TrialUser`를
만들고 즉시 연결. ② A 가입 → 코드 → 로그아웃 → B 가입 → `/connect/join` → 확인. 이후 DevPanel의
"체험 계정 / 시점 전환"으로 A↔B 시점을 재로그인 없이 오간다.

### 9. DevPanel 분리

전역 `DevPanel`(`DevPanelProvider` 아래, `useSession()`만 사용)은 세션 도구(리뷰 모드 진입, 체험 계정/
시점 전환, 가상 상대 연결, 연결 해제, 데이터 초기화)를 담당한다. `/app` 안에서만 의미 있는 레버
(시나리오·주간 리포트·추억 토글)는 `AppDevTools`가 `/app` Provider 안에서 같은 오버레이의 슬롯으로
포털 렌더한다. "가상 데이터 초기화"는 이제 세션·체험 가입도 지운다(안내 문구 갱신).

## 실제 백엔드로 교체할 seam

| mock                                                           | 실제                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `authService` (localStorage, 비밀번호 없음, 형식만 "검증")     | `apps/api` HTTP 인증·해싱·세션 쿠키·재설정 메일                  |
| `SessionContext` 세션 키 + `sessionGen`                        | httpOnly 쿠키 / 토큰 갱신 / 서버측 요청 취소                     |
| `inviteService` (수동 "연결 상태 확인")                        | 서버 발급 토큰·서버측 만료·실시간/푸시                           |
| 가입 시 동의 OFF 명시 기록                                     | 서버 user 생성 default                                           |
| 시드 폴백 게이팅 (`isReviewCouple`/`isReviewUser`)             | 삭제 — 민준·서연 픽스처 제거                                     |
| `relationshipService` `getCoupleProfile`/`updateCoupleProfile` | `GET`/`PATCH /couples/:id`                                       |
| `buildTrialWeeklyReport` · 체험 분석 미제공 안내               | 실제 리포트·코칭 파이프라인(`apps/worker`) — 이때 안내 문구 제거 |
| 프로필 아바타 이모지                                           | 실제 사진 업로드 (0005)                                          |

## 검증

- 단위: `mocks/domain/__tests__/{auth,invite,weeklyReport}.test.ts`,
  `mocks/services/__tests__/{authService,inviteService,settingsService,relationshipService,patternService,chatService,memoriesService}.test.ts`
  (비밀번호 미영속, 코드 상태 전이, saved·이번 주 통계, 검토 커플 시드 유지, 체험 커플 빈 데이터).
- 통합: `features/onboarding/__tests__/onboardingFlow.test.tsx`(가입·형식 오류·비밀번호 미노출·재설정·
  단계 강제·코드 연결·오류 안내·검토 모드 회귀), `features/chat/__tests__/trialMode.test.tsx`(체험
  미제공 안내 · 검토 모드 코칭 유지 · 로그아웃 세션 격리).
- 기존 통합 7개는 `renderApp({ route, session: seedReviewSession() })`로 마이그레이션(단언 불변).
- 전체: `test`(245) · `typecheck` · `eslint`(0 errors) · `build` · `prettier --check` 통과.
