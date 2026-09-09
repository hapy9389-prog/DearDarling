/** 실제 서버 왕복처럼 상태 전이(전송 중 → 저장 완료 등)가 눈에 보이도록 인위적 지연을 준다. */
export function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
