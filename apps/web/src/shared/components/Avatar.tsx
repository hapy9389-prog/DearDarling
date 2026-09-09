export function Avatar({ emoji, size = 36 }: { emoji: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
