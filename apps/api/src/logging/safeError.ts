import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

// 이 프로젝트가 실제로 구분해서 다뤄야 하는 Postgres SQLSTATE 코드만 명시적으로 허용한다 —
// db/retry.ts가 재시도 대상으로 삼는 두 코드, inviteService.ts가 충돌 판정에 쓰는 코드.
// "5자 영숫자 형식"만으로 허용하지 않는다 — 형식이 같다는 사실은 그 값이 실제로 Postgres가
// 낸 코드라는 것도, 우리가 아는 코드라는 것도 보장하지 않는다(임의의 오류 객체·합성 오류가
// 우연히 또는 의도적으로 같은 형식의 값을 code 필드에 담아 둘 수 있다). 목록에 없는 값은
// Postgres 코드처럼 보여도 로그에 남기지 않고 일반 오류로만 분류한다.
const KNOWN_PG_ERROR_CODES = new Set([
  '40001', // serialization_failure — db/retry.ts가 재시도한다
  '40P01', // deadlock_detected — db/retry.ts가 재시도한다
  '23505', // unique_violation — inviteService.ts가 코드 충돌 판정에 쓴다
]);

/**
 * 오류를 "무엇이었는지" 안전하게, 고정된 어휘로만 분류한다. err.message·err.stack·
 * String(err)는 비밀번호·인증 코드·쿠키·토큰을 담고 있을 수 있어(예: 잘못된 JSON 본문의
 * 파싱 오류 메시지가 그 본문 일부를 그대로 포함하는 경우) 절대 이 함수 밖으로 내보내지 않는다.
 * err.name도 신뢰하지 않는다 — 인스턴스에 자유롭게 설정 가능한 문자열 필드라 err.name에
 * 비밀정보를 담아 두는 실수(또는 그런 필드를 흉내 낸 합성 오류)를 막을 수 없다. instanceof와
 * 위 허용목록에 명시적으로 있는 SQLSTATE 코드처럼, 우리가 값 자체를 직접 정의해 둔 것만 쓴다.
 */
export function classifyError(err: unknown): string {
  if (err instanceof SyntaxError) return 'syntax-error'; // 예: express.json()의 잘못된 JSON 파싱
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && KNOWN_PG_ERROR_CODES.has(code)) return `pg:${code}`;
  if (err instanceof Error) return 'error';
  return 'non-error-thrown';
}

/**
 * 요청을 "어느 라우트였는지"로만 안전하게 남긴다 — req.path나 req.originalUrl(사용자가 보낸
 * 실제 URL, 비밀값이 경로 세그먼트로 들어올 수 있다)은 절대 쓰지 않는다. req.baseUrl(라우터를
 * 마운트할 때 app.ts에 직접 적어 둔 고정 문자열, 예: '/api/invites')과 req.route.path(라우트
 * 정의에 적어 둔 패턴 문자열, 예: '/:code/accept' — 실제 :code 값이 아니라 패턴 자체)만
 * 조합한다 — 둘 다 서버 코드에 있는 고정값이지 사용자 입력이 아니다. 라우팅이 아직 안 끝난
 * 상태(예: express.json()이 라우터 진입 전에 던지는 JSON 파싱 오류)에서는 req.route가 없으므로
 * 고정값 'unmatched'를 남긴다.
 */
export function safeRouteLabel(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string') return 'unmatched';
  return `${req.baseUrl}${routePath}`;
}

export interface SafeLogContext {
  /** 로그 한 줄을 나중에(같은 요청 안에서, 또는 사용자 문의 시) 서로 연결하기 위한 무작위 값 —
   * 비밀정보를 담지 않는다. */
  requestId?: string;
  method?: string;
  /** safeRouteLabel의 결과만 넘긴다 — 사용자가 보낸 실제 경로 값을 조합하지 않는다. */
  route?: string;
}

/** 어디서든 같은 형태로 안전하게 기록한다 — err 자체나 그 message/stack을 넘기지 않는다. */
export function logSafeError(label: string, err: unknown, context: SafeLogContext = {}): void {
  console.error(label, { ...context, category: classifyError(err) });
}

export function newRequestId(): string {
  return randomUUID();
}
