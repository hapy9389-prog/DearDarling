import type { ExampleImageRef } from '../../mocks/types';

/**
 * 화면 검토용 예시 이미지. 실제 업로드 사진이 아니라 variant로 결정되는 일러스트(그라데이션 + 글리프)이며,
 * 항상 '예시 이미지' 라벨을 함께 보여줘 사용자의 실제 추억으로 오해하지 않게 한다.
 * 실제 사진 업로드·사진 내용 AI 분석·AI 이미지 생성은 후속 기능(docs/decisions/0008).
 */
const VARIANTS: Record<ExampleImageRef['variant'], { glyph: string; from: string; to: string }> = {
  walk: { glyph: '🚶‍♀️', from: '#f3dce2', to: '#e7dcd3' },
  coffee: { glyph: '☕️', from: '#f4e9d6', to: '#f3e1da' },
  'night-talk': { glyph: '🌙', from: '#f1edf7', to: '#e7dcd3' },
  sea: { glyph: '🌊', from: '#e3edf1', to: '#f1edf7' },
  home: { glyph: '🏠', from: '#e6ede6', to: '#f3dce2' },
  trip: { glyph: '🧳', from: '#f4e9d6', to: '#e6ede6' },
};

const SIZE_CLASS: Record<'card' | 'thumb' | 'full', string> = {
  card: 'aspect-[16/10] w-full text-4xl',
  thumb: 'h-16 w-16 text-2xl',
  full: 'aspect-[4/3] w-full text-5xl',
};

export function ExampleImage({
  image,
  size = 'card',
}: {
  image: ExampleImageRef;
  size?: 'card' | 'thumb' | 'full';
}) {
  const variant = VARIANTS[image.variant];

  return (
    <div
      role="img"
      aria-label={`${image.alt} · 예시 이미지`}
      className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-border ${SIZE_CLASS[size]}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${variant.from}, ${variant.to})` }}
    >
      <span aria-hidden="true" className="opacity-80">
        {variant.glyph}
      </span>
      <span className="absolute right-1.5 bottom-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-medium text-canvas">
        예시 이미지
      </span>
    </div>
  );
}
