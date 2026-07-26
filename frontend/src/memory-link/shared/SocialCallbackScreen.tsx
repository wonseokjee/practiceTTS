/**
 * 소셜 로그인 콜백 화면 (/auth/callback)
 *
 * 백엔드가 카카오 콜백 처리 후 일회용 코드와 함께 이 경로로 리다이렉트한다.
 * 여기서 코드를 JWT로 교환(loginWithCode)하고, 로그인 상태가 되면 루트로 보낸다.
 * 루트(RootRedirect)가 온보딩 필요 여부에 따라 /onboarding 또는 /caregiver로 라우팅.
 *
 * 코드를 URL에 남기지 않으려 교환 후 즉시 replace 이동한다.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext.js';

export function SocialCallbackScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithCode } = useAuth();
  const [failed, setFailed] = useState(false);
  // React StrictMode의 이중 마운트로 코드가 두 번 교환되지 않게 가드(일회용이라 두 번째는 실패).
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get('code');
    if (!code) {
      setFailed(true);
      return;
    }

    loginWithCode(code)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setFailed(true));
  }, [params, loginWithCode, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] p-6">
      {failed ? (
        <div className="text-center">
          <p className="text-[#C94040]">로그인에 실패했어요. 다시 시도해 주세요.</p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-4 min-h-[44px] rounded-md bg-[#2D6A56] px-6 py-2 text-white"
          >
            로그인 화면으로
          </button>
        </div>
      ) : (
        <p className="text-[#6B6560]">로그인 중이에요...</p>
      )}
    </div>
  );
}
