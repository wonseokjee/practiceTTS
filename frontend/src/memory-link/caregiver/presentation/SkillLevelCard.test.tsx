// SkillLevelCard 테스트 — 방향 프레이밍(danger 금지)·눈높이 표시·접근성
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SkillLevelCard } from './SkillLevelCard.js';
import type { SkillLevels } from '../../patient/quiz/domain/QabResult.js';

const LEVELS: SkillLevels = {
  levels: {
    word: 4, sentence: 2, naming: 1, repeat: 3, reading: 2, spell: 3, ddk: 5,
    loc: 2,
  },
  manifestVersion: 1,
};

describe('SkillLevelCard', () => {
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
    const { queryByText, getByText } = render(
      <SkillLevelCard fetchLevels={() => Promise.resolve(LEVELS)} />,
    );
    await waitFor(() => expect(getByText('연습 눈높이')).toBeTruthy());
    expect(queryByText('의식 수준')).toBeNull();
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

