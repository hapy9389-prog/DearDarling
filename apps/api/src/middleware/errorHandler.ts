import type { ErrorRequestHandler } from 'express';

// Express는 함수 인자 개수(4개)로 에러 핸들러를 구분하므로 next를 실제로 쓰지 않아도 선언해야 한다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal-error' });
};
