// SkillLevelCard 테스트 — 방향 프레이밍(danger 금지)·눈높이 표시·접근성
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  NON_LEVELED_SUBTESTS,
  subtestLabel,
} from '../../patient/quiz/domain/qabSubtestLabels.js';
import { SkillLevelCard } from './SkillLevelCard.js';
import type { SkillLevels } from '../../patient/quiz/domain/QabResult.js';
import { i18n } from '../../../shared/i18n/i18n.js';

const t = (key: string) => i18n.t(`caregiver:${key}`);

const LEVELS: SkillLevels = {
  levels: {
    word: 4, sentence: 2, naming: 1, repeat: 3, reading: 2, spell: 3, ddk: 5,
    loc: 2,
  },
  manifestVersion: 1,
};

describe('SkillLevelCard', () => {
  it('여기 없는 검사를 왜 없는지와 함께 말한다', async () => {
    // 바로 위 '발화 검사 진행' 카드는 8개를 보여주는데 이 카드는 6개다. 이유를
    // 안 적으면 보호자는 "이름대기가 빠졌네"로 읽는다 — 실제로는 그 검사에
    // 난이도 축이 없어서 눈높이라는 개념이 성립하지 않는 것이다(E1).
    const { getByText, findByText } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());

    const 안내 = await findByText(/난이도를 단계로 나눌 수 있는 검사만/);
    // 이름을 하드코딩하지 않고 목록에서 끌어온다 — 목록이 바뀌면 문구도 따라 바뀐다.
    for (const key of NON_LEVELED_SUBTESTS) {
      expect(안내.textContent).toContain(subtestLabel(key, t));
    }
  });

  it('스킬별 눈높이(단계)를 표시한다', async () => {
    const { getByText, getByLabelText } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());
    expect(getByText('4단계')).toBeTruthy();
    // 눈높이 점 표시에 접근성 라벨
    expect(getByLabelText('단어 이해 눈높이 4단계 / 5')).toBeTruthy();
    expect(getByLabelText('말운동(퍼터커) 눈높이 5단계 / 5')).toBeTruthy();
  });

  it('loc(진단성)은 눈높이 목록에 넣지 않는다', async () => {
    const { getByText, getByRole } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());
    // **목록 안**에 없어야 한다. 카드 전체에서 찾으면 안 된다 — 왜 없는지
    // 설명하는 안내 문구가 그 이름을 정당하게 담고 있다.
    const 목록 = getByRole('list');
    expect(목록.textContent).not.toContain('의식 수준');
  });

  it('danger 색·"못한다/낮다" 판단 어휘를 쓰지 않는다(방향 프레이밍)', async () => {
    const { container, getByText } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());
    const html = container.innerHTML;
    expect(html).not.toContain('C94040'); // danger 토큰
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/못한다|못함|낮음|부족|나쁨|실패/);
  });

  it('조회 실패면 카드를 숨긴다', async () => {
    const { container } = render(
      <SkillLevelCard fetchLevels={() => Promise.reject(new Error('x'))} />,
    );
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});

describe('새 검사 노출', () => {
  it('글자 조합 눈높이가 화면에 보인다', async () => {
    // 2026-08-17: spell을 추가하면서 표시 목록을 빠뜨려 보호자에게만 안 보였다.
    // 라벨 표는 타입이 잡지만 "목록에 넣었는가"는 타입이 못 잡는다.
    const { getByText, getByLabelText } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());

    expect(getByText('글자 조합')).toBeTruthy();
    expect(getByLabelText('글자 조합 눈높이 3단계 / 5')).toBeTruthy();
  });
});

