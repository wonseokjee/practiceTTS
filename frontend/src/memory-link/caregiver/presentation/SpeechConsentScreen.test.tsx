// SpeechConsentScreen — 동의 토글·저장 건수·삭제 흐름

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../shared/MemoryLinkApi.js', () => ({
  memoryLinkApi: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

import { SpeechConsentScreen } from './SpeechConsentScreen.js';

describe('SpeechConsentScreen', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    del.mockReset();
  });

  it('동의하지 않은 상태 + 0건이면 삭제 버튼이 없다', async () => {
    get.mockResolvedValue({ data: { consent: false, consentAt: null, count: 0 } });
    render(<SpeechConsentScreen onBack={() => {}} />);

    expect(await screen.findByText('지금은 저장하지 않습니다')).toBeInTheDocument();
    expect(screen.queryByText('전부 삭제')).toBeNull();
  });

  it('동의 상태 + 건수가 있으면 삭제 버튼이 있고, 클릭하면 확인 문구가 뜬다', async () => {
    get.mockResolvedValue({
      data: { consent: true, consentAt: '2026-01-01T00:00:00Z', count: 3 },
    });
    render(<SpeechConsentScreen onBack={() => {}} />);

    expect(await screen.findByText('3건 보관 중')).toBeInTheDocument();
    fireEvent.click(screen.getByText('전부 삭제'));
    expect(
      screen.getByText('보관된 음성 3건을 모두 삭제할까요? 되돌릴 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('동의 스위치를 누르면 PUT 요청 후 다시 불러온다', async () => {
    get
      .mockResolvedValueOnce({ data: { consent: false, consentAt: null, count: 0 } })
      .mockResolvedValueOnce({ data: { consent: true, consentAt: null, count: 0 } });
    put.mockResolvedValue({ data: {} });
    render(<SpeechConsentScreen onBack={() => {}} />);

    await screen.findByText('지금은 저장하지 않습니다');
    fireEvent.click(screen.getByRole('switch', { name: '음성 데이터 저장 동의' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/speech-data/consent', { consent: true }),
    );
    expect(await screen.findByText('저장 중')).toBeInTheDocument();
  });

  it('삭제 확인 → DELETE 요청 후 목록을 다시 불러온다', async () => {
    get
      .mockResolvedValueOnce({ data: { consent: true, consentAt: null, count: 2 } })
      .mockResolvedValueOnce({ data: { consent: true, consentAt: null, count: 0 } });
    del.mockResolvedValue({ data: {} });
    render(<SpeechConsentScreen onBack={() => {}} />);

    await screen.findByText('2건 보관 중');
    fireEvent.click(screen.getByText('전부 삭제'));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/speech-data'));
    expect(await screen.findByText('0건 보관 중')).toBeInTheDocument();
  });

  it('뒤로가기 버튼은 backLabel이 없으면 기본값 "설정"을 쓴다', async () => {
    get.mockResolvedValue({ data: { consent: false, consentAt: null, count: 0 } });
    render(<SpeechConsentScreen onBack={() => {}} />);

    expect(await screen.findByRole('button', { name: '설정(으)로 돌아가기' })).toBeInTheDocument();
  });
});
