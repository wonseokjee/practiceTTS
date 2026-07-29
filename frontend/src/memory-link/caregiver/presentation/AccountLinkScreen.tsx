/**
 * 계정 연결 화면 (계정 병합 2단계)
 *
 * 로그인된 보호자가 카카오·구글 로그인 수단을 자기 계정에 붙이거나 뗀다.
 * "연결하기"는 백엔드에서 1회용 코드를 받아 소셜 인가로 top-level 이동한다
 * (콜백이 현재 계정에 신원을 붙이고 /caregiver?linked=..로 돌아온다).
 *
 * 왜 필요한가: 같은 사람이 카카오·구글을 오가며 로그인하면 계정이 갈라진다.
 * 이메일이 같으면 자동 연결이 되지만, 이메일이 다르거나 없으면(카카오 동의 선택)
 * 자동으로는 못 합친다. 여기서 직접 연결해 하나의 계정으로 모은다.
 */

import { useEffect, useState } from 'react';
import { useAuth, type SocialProvider } from '../../shared/AuthContext.js';
import { API_BASE_URL, memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import {
  GoogleIcon,
  KakaoIcon,
} from '../../shared/components/ProviderIcons.js';

/** 소셜 콜백 복귀 시 대시보드가 URL에서 파싱해 넘겨주는 알림. */
export interface AccountLinkNotice {
  kind: 'success' | 'error';
  text: string;
}

interface AccountLinkScreenProps {
  onBack?: () => void;
  /** ?linked/?linkError 복귀 결과(있으면 배너로 표시). */
  notice?: AccountLinkNotice | null;
  /** 뒤로가기 버튼 라벨(설정 허브에서는 "설정"). 기본 "목록으로". */
  backLabel?: string;
  /** true면 자체 뒤로가기 버튼을 숨긴다(상위가 네비게이션을 소유할 때). */
  embedded?: boolean;
}

const PROVIDER_META: Record<
  SocialProvider,
  { label: string; className: string }
> = {
  kakao: {
    label: '카카오',
    className: 'bg-[#FEE500] text-[#191600]',
  },
  google: {
    label: '구글',
    className: 'border border-[#DADCE0] bg-white text-[#3C4043]',
  },
};

const ALL_PROVIDERS: SocialProvider[] = ['kakao', 'google'];

export function AccountLinkScreen({
  onBack,
  notice,
  backLabel = '목록으로',
  embedded = false,
}: AccountLinkScreenProps) {
  const { user, refreshUser } = useAuth();
  const [banner, setBanner] = useState<AccountLinkNotice | null>(
    notice ?? null,
  );
  const [busyProvider, setBusyProvider] = useState<SocialProvider | null>(null);

  const linked = user?.linkedProviders ?? [];

  // 소셜 연결 복귀 후 컨텍스트가 옛 목록을 들고 있을 수 있어 최신화한다.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const handleConnect = async (provider: SocialProvider): Promise<void> => {
    setBanner(null);
    setBusyProvider(provider);
    try {
      // 1회용 연결 코드를 받아, 소셜 인가로 top-level 이동한다(쿠키가 함께 실림).
      const res = await memoryLinkApi.post<{ code?: unknown }>(
        '/auth/link/start',
        {},
      );
      const code = res.data?.code;
      if (typeof code !== 'string' || code.length === 0) {
        throw new Error('invalid code');
      }
      // 파라미터 이름은 반드시 `ticket` — `code`는 OAuth2 예약어라 passport가
      // 콜백으로 오인해 토큰 교환을 시도한다(500). LinkInitiateGuard와 짝을 맞춘다.
      window.location.href = `${API_BASE_URL}/auth/${provider}/link?ticket=${encodeURIComponent(code)}`;
    } catch {
      setBusyProvider(null);
      setBanner({
        kind: 'error',
        text: '연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }
  };

  const handleDisconnect = async (provider: SocialProvider): Promise<void> => {
    setBanner(null);
    setBusyProvider(provider);
    try {
      await memoryLinkApi.delete(`/auth/link/${provider}`);
      await refreshUser();
      setBanner({
        kind: 'success',
        text: `${PROVIDER_META[provider].label} 연결을 해제했어요.`,
      });
    } catch (err) {
      // 403: 마지막 로그인 수단은 해제 불가. 그 외는 일반 오류.
      const status =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      setBanner({
        kind: 'error',
        text:
          status === 403
            ? '마지막 로그인 수단은 해제할 수 없어요.'
            : '연결 해제에 실패했어요. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      {!embedded && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1 text-sm text-[#5C6661] transition-colors hover:text-[#2D6A56]"
          aria-label={`${backLabel}(으)로 돌아가기`}
        >
          ← {backLabel}
        </button>
      )}

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-[#2D6A56]">연결된 계정</h2>
        <p className="mt-2 text-sm text-[#5C6661]">
          카카오·구글을 연결해 두면 어느 걸로 로그인해도 같은 계정으로 들어와요.
          연결이 갈라지면 등록한 기억·기록이 나뉘어 보일 수 있어요.
        </p>
      </header>

      {banner && (
        <div
          role={banner.kind === 'error' ? 'alert' : 'status'}
          className={
            banner.kind === 'error'
              ? 'mb-4 rounded-xl border border-[#C94040]/25 bg-[#FEF0F0] px-4 py-3 text-sm text-[#8b2020]'
              : 'mb-4 rounded-xl border border-[#2D6A56]/25 bg-[#EBF4F0] px-4 py-3 text-sm text-[#1F5240]'
          }
        >
          {banner.text}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {ALL_PROVIDERS.map((provider) => {
          const meta = PROVIDER_META[provider];
          const isLinked = linked.includes(provider);
          const isBusy = busyProvider === provider;
          // 마지막 하나 남은 소셜 연결은 해제 불가(로그인 불능 방지). 비번 계정은
          // 백엔드가 허용하지만, 여기선 소셜 전용 보호자 기준으로 UX 가드만 둔다.
          const isOnlyLink = isLinked && linked.length === 1;

          return (
            <li
              key={provider}
              className="flex items-center justify-between rounded-2xl border border-[#E8E4DC] bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${meta.className}`}
                  aria-hidden="true"
                >
                  {provider === 'kakao' ? (
                    <KakaoIcon className="h-4 w-4" />
                  ) : (
                    <GoogleIcon className="h-4 w-4" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#1F2A26]">
                    {meta.label}
                  </p>
                  <p className="text-xs text-[#6B6560]">
                    {isLinked ? '연결됨' : '연결 안 됨'}
                  </p>
                </div>
              </div>

              {isLinked ? (
                <button
                  type="button"
                  onClick={() => void handleDisconnect(provider)}
                  disabled={isBusy || isOnlyLink}
                  title={
                    isOnlyLink ? '마지막 로그인 수단은 해제할 수 없어요.' : undefined
                  }
                  className="min-h-[40px] rounded-full border border-[#D4D8D4] px-4 text-sm font-medium text-[#5C6661] transition-colors hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? '처리 중…' : '연결 해제'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnect(provider)}
                  disabled={isBusy}
                  className="min-h-[40px] rounded-full bg-[#2D6A56] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? '이동 중…' : '연결하기'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
