import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthedImage } from './AuthedImage.js';
import { ML_TOKEN_KEY } from './MemoryLinkApi.js';

/**
 * 인증 이미지 로딩 회귀 테스트.
 *
 * 고정하는 불변식:
 *  - 사진 요청에 Authorization 헤더가 실린다 (토큰을 URL에 넣지 않는다)
 *  - Blob URL이 언마운트·src 교체 시 해제된다 (장시간 세션 누수 방지)
 *  - 늦게 도착한 응답이 이미 정리된 뒤여도 누수하지 않는다
 *  - blob:/data: 미리보기는 fetch 없이 그대로 쓴다
 */
describe('AuthedImage', () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    let seq = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock-${(seq += 1)}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    localStorage.setItem(ML_TOKEN_KEY, 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function stubFetch(impl: () => Promise<Response>) {
    const spy = vi.fn(impl);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  const okResponse = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })),
    } as unknown as Response);

  it('Authorization 헤더로 사진을 요청한다 (URL에 토큰을 넣지 않는다)', async () => {
    const fetchSpy = stubFetch(okResponse);

    render(<AuthedImage src="/uploads/memory-images/a.jpg" alt="사진" />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.headers).toEqual({ Authorization: 'Bearer test-token' });
    // 토큰이 URL로 새면 액세스 로그·Referer에 남는다.
    expect(url).not.toContain('test-token');
    expect(url).not.toContain('token=');
  });

  it('받아온 Blob을 렌더한다', async () => {
    stubFetch(okResponse);

    render(<AuthedImage src="/uploads/memory-images/a.jpg" alt="할머니 사진" />);

    const img = await screen.findByAltText('할머니 사진');
    expect(img.getAttribute('src')).toBe('blob:mock-1');
  });

  it('언마운트 시 Blob URL을 해제한다', async () => {
    stubFetch(okResponse);

    const { unmount } = render(
      <AuthedImage src="/uploads/memory-images/a.jpg" alt="사진" />,
    );
    await screen.findByAltText('사진');

    unmount();

    expect(revoked).toContain('blob:mock-1');
  });

  it('src가 바뀌면 이전 Blob URL을 해제한다', async () => {
    stubFetch(okResponse);

    const { rerender } = render(
      <AuthedImage src="/uploads/memory-images/a.jpg" alt="사진" />,
    );
    await screen.findByAltText('사진');

    rerender(<AuthedImage src="/uploads/memory-images/b.jpg" alt="사진" />);

    await waitFor(() => expect(revoked).toContain('blob:mock-1'));
  });

  it('언마운트 후 늦게 도착한 응답도 Blob URL을 누수하지 않는다', async () => {
    // 느린 네트워크에서 사진 화면을 빠르게 넘기면 발생한다. 응답이 도착했을
    // 때 이미 정리된 상태라면 만들어진 URL을 즉시 해제해야 한다.
    let resolveBlob: (b: Blob) => void = () => {};
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () =>
          new Promise<Blob>((resolve) => {
            resolveBlob = resolve;
          }),
      } as unknown as Response),
    );

    const { unmount } = render(
      <AuthedImage src="/uploads/memory-images/a.jpg" alt="사진" />,
    );
    await waitFor(() => expect(resolveBlob).not.toBe(undefined));

    unmount();
    resolveBlob(new Blob(['x']));

    await waitFor(() => {
      expect(created).toHaveLength(1);
      expect(revoked).toContain(created[0]);
    });
  });

  it('403/404면 fallback을 보여준다 (깨진 아이콘 대신)', async () => {
    stubFetch(() =>
      Promise.resolve({ ok: false, status: 404 } as unknown as Response),
    );

    render(
      <AuthedImage
        src="/uploads/memory-images/a.jpg"
        alt="사진"
        fallback={<span>사진 없음</span>}
      />,
    );

    expect(await screen.findByText('사진 없음')).toBeTruthy();
  });

  it('blob: 미리보기는 fetch 없이 그대로 쓴다', () => {
    const fetchSpy = stubFetch(okResponse);

    render(<AuthedImage src="blob:local-preview" alt="미리보기" />);

    expect(screen.getByAltText('미리보기').getAttribute('src')).toBe(
      'blob:local-preview',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lazy면 화면에 들어오기 전까지 요청하지 않는다', async () => {
    // 목록 화면 회귀 방지: <img loading="lazy">를 걷어냈으므로 지연을
    // 컴포넌트가 대신 해야 한다. 안 그러면 엔트리 수만큼 동시 요청이 나간다.
    let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null =
      null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          trigger = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const fetchSpy = stubFetch(okResponse);

    render(<AuthedImage src="/uploads/memory-images/a.jpg" alt="사진" lazy />);

    expect(fetchSpy).not.toHaveBeenCalled();

    // 스크롤로 화면에 들어온 시점
    act(() => trigger?.([{ isIntersecting: true }]));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it('src가 null이면 아무것도 렌더하지 않는다', () => {
    const fetchSpy = stubFetch(okResponse);

    const { container } = render(<AuthedImage src={null} alt="사진" />);

    expect(container.innerHTML).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
