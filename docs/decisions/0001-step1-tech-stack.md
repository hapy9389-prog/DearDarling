# 0001 — 화면 검토 단계 기술 스택

날짜: 2026-09-09

## 배경

화면 검토 단계(가상 데이터로 화면 흐름 확인)의 웹 화면을 React + TypeScript, pnpm workspaces로 만들기로 확정했다. "화면 프레임워크·패키지 버전은 구현 시작 시 고정한다"는 설계 문서 원칙에 따라 실제 npm 레지스트리에서 각 패키지의 최신 버전과 `peerDependencies`를 조회해 호환성을 확인한 뒤 고정했다(추측이나 발표일 기준 판단이 아니라 실제 설치 가능 여부 확인).

## 확정 버전

| 패키지                           | 버전      | 확인 방법                                                                     |
| -------------------------------- | --------- | ----------------------------------------------------------------------------- |
| Node.js                          | 24.x      | 로컬 설치 버전(`v24.19.0`)과 일치, Active LTS                                 |
| pnpm                             | 12.3.4    | `npm view pnpm dist-tags.latest`                                              |
| React / react-dom                | 19.2.8    | 최신 안정 버전                                                                |
| TypeScript                       | **6.0.3** | 아래 "TypeScript 7.0을 쓰지 않은 이유" 참고                                   |
| Vite                             | 8.2.2     | 최신 안정 버전                                                                |
| @vitejs/plugin-react             | 6.1.1     | `peerDependencies.vite: "^8.0.0"` — Vite 8과 호환 확인                        |
| Tailwind CSS / @tailwindcss/vite | 4.3.3     | `peerDependencies.vite`가 `^5.2 \|\| ^6 \|\| ^7 \|\| ^8` — Vite 8과 호환 확인 |
| ESLint                           | 10.10.0   | 최신 안정 버전(9는 EOL)                                                       |
| typescript-eslint                | 8.70.0    | 아래 참고                                                                     |
| eslint-plugin-react-hooks        | 7.1.1     | `peerDependencies.eslint`에 `^10.0.0` 포함                                    |
| eslint-plugin-react-refresh      | 0.5.6     | `peerDependencies.eslint: "^9 \|\| ^10"`                                      |
| eslint-config-prettier           | 10.1.8    | `peerDependencies.eslint: ">=7.0.0"`                                          |
| Prettier                         | 3.9.6     | 최신 안정 버전                                                                |
| Vitest                           | 5.0.0     | `peerDependencies.vite`가 `^6.4 \|\| ^7 \|\| ^8` — Vite 8과 호환 확인         |
| @testing-library/react           | 16.3.3    | `peerDependencies.react: "^18 \|\| ^19"`                                      |

## TypeScript 7.0을 쓰지 않은 이유

npm 레지스트리 기준 TypeScript 최신 버전은 `7.0.2`이지만, `typescript-eslint@8.70.0`의 `peerDependencies`를 실제로 조회한 결과:

```
typescript: '>=4.8.4 <6.1.0'
```

즉 TypeScript 7.0.x는 아직 typescript-eslint와 호환되지 않는다(설치는 되어도 타입 인식 린트 규칙이 깨질 수 있음). 따라서 이 범위 안의 최신 버전인 **TypeScript 6.0.3**을 사용한다. typescript-eslint가 TS 7.0을 지원하는 버전을 내면 재검토한다.

## react-router는 아직 설치하지 않았다 (정정)

계획 단계에서는 react-router 8.3.1을 쓰기로 검토했지만, 1단계 실제 구현은 **대화 화면 하나뿐**이라 실제 코드에는 아직 추가하지 않았다(화면 전환이 하단 탭 자체를 비활성 상태로 보여주는 정적 UI로만 되어 있고, 실제 라우팅은 없음). `apps/web/package.json`에도 의존성으로 들어 있지 않다.

2단계에서 가입·로그인·연인 연결처럼 여러 화면 사이를 실제로 이동해야 하는 시점에 추가하고, 그때 다시 최신 버전과 `peerDependencies`를 확인한다. (이 문서가 한동안 "react-router 8.3.1을 쓴다"고 잘못 적어 두고 있었다 — 실제 설치 여부와 문서가 어긋나 있었던 것을 바로잡았다.)

## pnpm 전역 설치를 하지 않은 이유

이 환경에서 `corepack enable`이 `/usr/local/bin`에 대한 쓰기 권한 부족(EACCES)으로 실패했다(시스템 Node 설치가 관리자 권한 디렉터리에 있음). sudo 없이 진행하기 위해 pnpm을 전역 설치하지 않고, `npx pnpm@12.3.4 <command>`로 실행한다. `package.json`의 `packageManager` 필드는 문서화 목적으로 버전을 고정해 둔다. 이후 사용자가 별도로 pnpm을 전역 설치하면 `pnpm <command>`로 그대로 대체할 수 있다.

## 아직 안정성을 조금 더 지켜보는 버전

Vitest 5.0.0은 출시 초기 버전이라 향후 사용 중 이슈가 발견되면 이 문서에 갱신 이력을 남기고 다운그레이드할 수 있다.
