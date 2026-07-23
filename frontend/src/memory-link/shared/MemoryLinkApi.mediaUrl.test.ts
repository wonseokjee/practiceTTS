import { describe, expect, it } from 'vitest';
import { resolveMediaUrl } from './MemoryLinkApi.js';

/**
 * Regression: ISSUE-002 — 상대 경로 photoUrl을 <img src>에 그대로 넣어
 * 브라우저가 프론트 오리진(:5173)으로 해석, 사진이 전부 깨지던 문제.
 * Found by /qa on 2026-07-19
 * Report: .gstack/qa-reports/qa-report-localhost-2026-07-19.md
 *
 * axios는 baseURL을 붙여주지만 <img src>는 아니다. 그래서 SPA의 index.html이
 * 200 text/html로 돌아오고, 콘솔 에러조차 남지 않아 조용히 깨졌다.
 */
describe('resolveMediaUrl', () => {
  // 테스트 환경 기본값 (VITE_API_URL 미설정 시 MemoryLinkApi의 폴백과 동일)
  const apiOrigin = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

  it('상대 경로를 API 오리진 기준 절대 URL로 바꾼다', () => {
    expect(resolveMediaUrl('/uploads/memory-images/a.jpg')).toBe(
      `${apiOrigin}/uploads/memory-images/a.jpg`,
    );
  });

  it('앞 슬래시가 없어도 오리진을 붙인다', () => {
    expect(resolveMediaUrl('uploads/memory-images/a.jpg')).toBe(
      `${apiOrigin}/uploads/memory-images/a.jpg`,
    );
  });

  it('프론트 오리진으로 해석될 수 있는 상대 경로를 남기지 않는다', () => {
    const resolved = resolveMediaUrl('/uploads/memory-images/a.jpg');

    expect(resolved.startsWith('/')).toBe(false);
    expect(resolved).toMatch(/^https?:\/\//);
  });

  it('이미 절대 URL이면 그대로 둔다', () => {
    const absolute = 'https://cdn.example.com/a.jpg';

    expect(resolveMediaUrl(absolute)).toBe(absolute);
  });

  it('data URI는 그대로 둔다', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';

    expect(resolveMediaUrl(dataUri)).toBe(dataUri);
  });

  it('null·undefined·빈 문자열은 null을 돌려준다 (사진 없는 기억)', () => {
    expect(resolveMediaUrl(null)).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeNull();
    expect(resolveMediaUrl('')).toBeNull();
  });
});
