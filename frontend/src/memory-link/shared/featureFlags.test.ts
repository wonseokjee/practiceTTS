import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isConversationModeEnabled,
  isNeighborScoringEnabled,
} from './featureFlags.js';

/**
 * 대화 모드 플래그 회귀 테스트.
 *
 * 이 플래그는 **기본 꺼짐**이어야 한다. 대화 모드는 자유 발화를 받아야 하는데
 * 지금은 브라우저 내장 인식을 쓴다. 브라우저 STT는 병리 발화(실어증·치매)를
 * 잘 못 알아들어서, 환자가 말해도 인식이 안 되는 좌절 경험이 되기 쉽다.
 *
 * 실수로 기본값이 켜짐이 되면 그 상태가 환자에게 그대로 나간다.
 */
describe('isConversationModeEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('미설정이면 꺼짐 (안전한 기본값)', () => {
    vi.stubEnv('VITE_ENABLE_CONVERSATION', '');

    expect(isConversationModeEnabled()).toBe(false);
  });

  it("'true'일 때만 켜진다", () => {
    vi.stubEnv('VITE_ENABLE_CONVERSATION', 'true');

    expect(isConversationModeEnabled()).toBe(true);
  });

  it.each(['false', '1', 'yes', 'TRUE', 'on'])(
    "'%s'는 켜짐으로 보지 않는다",
    (value) => {
      // 환경변수는 문자열이라 '1'이나 'yes' 같은 값이 실수로 들어오기 쉽다.
      // 애매한 값을 참으로 해석하면 의도치 않게 환자에게 노출된다.
      vi.stubEnv('VITE_ENABLE_CONVERSATION', value);

      expect(isConversationModeEnabled()).toBe(false);
    },
  );
});

/**
 * 이름대기 이웃 비교 채점 플래그 회귀 테스트.
 *
 * 켜면 **채점 규칙이 바뀐다** — 가까운 다른 단어를 말한 시도가 정답에서 모호(재시도)로 옮겨가
 * 정답률이 전환 시점에 내려간다. 실수로 기본값이 켜짐이면 스테이징 관찰(계획 PR 6) 전에 그
 * 전환이 환자에게 그대로 나간다.
 */
describe('isNeighborScoringEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('미설정이면 꺼짐 (안전한 기본값)', () => {
    vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', '');

    expect(isNeighborScoringEnabled()).toBe(false);
  });

  it("'true'일 때만 켜진다", () => {
    vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', 'true');

    expect(isNeighborScoringEnabled()).toBe(true);
  });

  it.each(['false', '1', 'yes', 'TRUE', 'on'])(
    "'%s'는 켜짐으로 보지 않는다",
    (value) => {
      vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', value);

      expect(isNeighborScoringEnabled()).toBe(false);
    },
  );

  it('대화 모드 플래그와 독립이다', () => {
    vi.stubEnv('VITE_ENABLE_CONVERSATION', 'true');
    vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', '');

    expect(isNeighborScoringEnabled()).toBe(false);
  });
});
