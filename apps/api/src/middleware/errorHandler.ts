import type { ErrorRequestHandler } from 'express';
import { classifyError, safeRouteLabel } from '../logging/safeError';

/**
 * err.message·err.stack·String(err)는 절대 로그에 쓰지 않는다 — 비밀번호·인증 코드·쿠키·토큰이
 * 그 안에 섞여 들어올 수 있다(예: 잘못된 JSON 요청 본문의 파싱 오류 메시지가 본문 일부를 그대로
 * 담는 경우). err.name도 신뢰하지 않는다(임의로 설정 가능한 문자열이다). req.path/req.originalUrl도
 * 쓰지 않는다 — 사용자가 보낸 실제 URL이라 경로 세그먼트에 비밀값이 들어올 수 있다. 남기는 건
 * 요청 추적용 무작위 ID(requestId), 메서드, safeRouteLabel이 만든 라우트 패턴(서버가 정의한
 * 고정 문자열만 조합 — 실제 경로 파라미터 값은 없음), 그리고 classifyError의 고정 카테고리뿐이다.
 */
// Express는 함수 인자 개수(4개)로 에러 핸들러를 구분하므로 next를 실제로 쓰지 않아도 선언해야 한다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error('[errorHandler]', {
    requestId: req.requestId,
    method: req.method,
    route: safeRouteLabel(req),
    category: classifyError(err),
  });
  res.status(500).json({ error: 'internal-error' });
};
