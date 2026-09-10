import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { createMockAuthService } from '../../mocks/services/authService';
import { DEFAULT_TRIAL_AVATAR, TRIAL_AVATARS } from '../../mocks/fixtures/trial';
import { Avatar } from '../../shared/components/Avatar';

const authService = createMockAuthService();
const NICKNAME_MAX = 12;

/** 내 프로필(0010) — 닉네임 + 아바타. 실제 사진 업로드는 범위 밖(0005). 연결 전·후 모두 접근 가능. */
export function ProfileScreen() {
  const navigate = useNavigate();
  const { session, trialUser, refreshTrialUser } = useSession();
  const userId = session?.kind === 'trial' ? session.userId : '';

  const [nickname, setNickname] = useState(trialUser?.nickname ?? '');
  const [avatar, setAvatar] = useState(trialUser?.avatarEmoji ?? DEFAULT_TRIAL_AVATAR);
  const [error, setError] = useState<string>();

  const alreadyConnected = Boolean(trialUser?.coupleId);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    if (trimmed.length > NICKNAME_MAX) {
      setError(`닉네임은 ${NICKNAME_MAX}자 이하로 입력해 주세요.`);
      return;
    }
    authService.updateProfile(userId, { nickname: trimmed, avatarEmoji: avatar });
    refreshTrialUser();
    navigate(alreadyConnected ? '/app/settings' : '/connect', { replace: true });
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">내 프로필</p>
      <p className="mt-1 text-sm text-ink-soft">상대에게 보일 이름과 아바타를 정해요.</p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5" noValidate>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">닉네임</span>
          <input
            aria-label="닉네임"
            value={nickname}
            maxLength={NICKNAME_MAX}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
        </label>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">아바타</span>
          <div className="flex flex-wrap gap-2">
            {TRIAL_AVATARS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`아바타 ${emoji}`}
                aria-pressed={avatar === emoji}
                onClick={() => setAvatar(emoji)}
                className={`rounded-full border p-1 ${
                  avatar === emoji ? 'border-accent bg-accent-soft' : 'border-border'
                }`}
              >
                <Avatar emoji={emoji} size={32} />
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          {alreadyConnected ? '저장' : '저장하고 계속하기'}
        </button>
      </form>
    </div>
  );
}
