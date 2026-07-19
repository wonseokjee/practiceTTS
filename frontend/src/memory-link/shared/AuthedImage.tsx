import { useEffect, useRef, useState } from 'react';
import { ML_TOKEN_KEY, resolveMediaUrl } from './MemoryLinkApi.js';

/**
 * 인증이 필요한 이미지를 표시한다.
 *
 * 배경: 업로드 사진은 이제 소유권 확인을 거쳐야 받을 수 있다. 그런데
 * `<img src>`는 Authorization 헤더를 실을 수 없다. `?token=`으로 우회하고
 * 싶어지지만 URL은 액세스 로그·Referer·브라우저 히스토리에 남으므로
 * 토큰을 URL에 넣는 건 인증을 붙이는 의미를 없앤다.
 *
 * 그래서 fetch로 받아 Blob URL로 렌더한다 — `AzureTtsService`가 오디오에
 * 쓰는 것과 같은 기법이다. Blob URL은 교체·언마운트 시 revoke한다.
 *
 * blob:·data: (업로드 미리보기)는 이미 로컬 URL이라 그대로 쓴다.
 */
export interface AuthedImageProps {
  /** 백엔드가 내려준 photoUrl. null이면 아무것도 렌더하지 않는다. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** 로딩 중·실패 시 대신 보여줄 요소 */
  fallback?: React.ReactNode;
  /**
   * 화면에 들어올 때까지 요청을 미룬다(`<img loading="lazy">` 대체).
   *
   * `<img>`의 lazy는 브라우저가 해주지만 fetch는 우리가 직접 하므로,
   * 목록 화면에서 이걸 끄면 엔트리 수만큼 동시 요청이 나간다.
   */
  lazy?: boolean;
}

/** 인증 없이 그대로 쓸 수 있는 로컬 URL인가 */
function isLocalUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

export function AuthedImage({
  src,
  alt,
  className,
  fallback = null,
  lazy = false,
}: AuthedImageProps): React.ReactElement | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // lazy가 아니면 처음부터 보이는 것으로 취급한다.
  const [visible, setVisible] = useState(!lazy);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible || !holderRef.current) return;
    // IntersectionObserver가 없는 환경(구형 브라우저·일부 테스트)에서는
    // 지연을 포기하고 바로 받는다 — 사진이 안 뜨는 것보다 낫다.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!src || isLocalUrl(src) || !visible) {
      setObjectUrl(null);
      setFailed(false);
      return;
    }

    // 이 이펙트가 만든 Blob URL만 해제하도록 지역 변수에 잡아둔다. 요청이
    // 늦게 도착해 이미 다른 src로 바뀐 뒤라면 만들자마자 해제해 누수를 막는다.
    let cancelled = false;
    let created: string | null = null;

    setFailed(false);
    void (async () => {
      try {
        const token = localStorage.getItem(ML_TOKEN_KEY);
        const res = await fetch(resolveMediaUrl(src), {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`photo ${res.status}`);
        const blob = await res.blob();
        created = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src, visible]);

  if (!src) return null;

  // 로컬 URL은 fetch 없이 바로 렌더한다.
  const renderUrl = isLocalUrl(src) ? src : objectUrl;
  if (failed || !renderUrl) {
    // lazy일 때 관찰 대상이 필요하므로 자리를 차지하는 요소를 남긴다.
    // className을 그대로 물려 레이아웃이 흔들리지 않게 한다.
    return (
      <div ref={holderRef} className={className}>
        {fallback}
      </div>
    );
  }

  return <img src={renderUrl} alt={alt} className={className} />;
}
