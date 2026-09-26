import { describe, expect, it } from 'vitest';
import { neighborsFor } from './neighborManifest.js';

describe('neighborsFor', () => {
  it('한국어 이름대기 낱말의 이웃 3개를 준다(실측에 쓴 이웃과 같다)', () => {
    expect(neighborsFor('사탕', 'ko-KR')).toEqual(['사자', '낙타', '수달']);
    expect(neighborsFor('가위', 'ko-KR')).toEqual(['거위', '바위', '가재']);
  });

  it('목록의 로케일이 아니면 null이다 — 영어는 이 채점이 검증되지 않았다(설계 10절)', () => {
    expect(neighborsFor('사탕', 'en-US')).toBeNull();
    expect(neighborsFor('사탕', 'ko')).toBeNull();
    expect(neighborsFor('사탕', '')).toBeNull();
  });

  it('목록에 없는 낱말은 null이다 — 호출한 쪽이 이전 채점으로 간다', () => {
    expect(neighborsFor('없는낱말', 'ko-KR')).toBeNull();
    expect(neighborsFor('', 'ko-KR')).toBeNull();
  });

  it('Object 프로토타입 키를 낱말로 오인하지 않는다', () => {
    // 목록을 객체로 조회하므로 'constructor' 같은 낱말이 상속 속성에 걸리면 안 된다.
    expect(neighborsFor('constructor', 'ko-KR')).toBeNull();
    expect(neighborsFor('toString', 'ko-KR')).toBeNull();
  });
});
