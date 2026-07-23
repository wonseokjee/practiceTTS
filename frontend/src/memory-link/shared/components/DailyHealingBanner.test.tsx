// DailyHealingBanner 단위 테스트 (Phase 6 Pattern 2)
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DailyHealingBanner } from './DailyHealingBanner.js';
import type { IHealingMessageApi } from '../HealingMessageApi.js';

describe('DailyHealingBanner', () => {
  it('오늘의 메시지를 가져와 렌더링한다', async () => {
    const api: IHealingMessageApi = {
      fetchToday: vi.fn(async () => ({ id: 'm1', text: '오늘도 곁에 있어 고마워요.' })),
    };
    render(<DailyHealingBanner api={api} />);

    await waitFor(() => {
      expect(screen.getByText('오늘도 곁에 있어 고마워요.')).toBeInTheDocument();
    });
    expect(screen.getByText('오늘의 메시지')).toBeInTheDocument();
  });

  it('조회 실패 시 아무것도 렌더하지 않는다 (대시보드 비차단)', async () => {
    const api: IHealingMessageApi = {
      fetchToday: vi.fn(async () => {
        throw new Error('네트워크 오류');
      }),
    };
    const { container } = render(<DailyHealingBanner api={api} />);

    // 비동기 실패가 처리될 시간을 준 뒤에도 배너가 없어야 한다
    await waitFor(() => {
      expect(api.fetchToday).toHaveBeenCalled();
    });
    expect(container.querySelector('[role="note"]')).toBeNull();
  });
});
