// PictureNamingItem.tsx — 그림 이름대기 테스트
//
// 발음 평가 캡처 서비스를 목으로 대체해 흐름을 제어한다.
// 검증 포인트:
//  - 안내/그림 표시
//  - 🎤 이름 말하기 → capture.start
//  - 인식 성공 → 제출 → onSubmit(인식 텍스트, azure)
//  - 발음 점수(azure)가 있으면 그대로 상위로 전달
//  - 넘어가기 → onSubmit(targetWord, null, 4) (정답을 알려준 통과)
//  - 피드백: ✓/✗ + 오답 시 정답 노출, 컨트롤 숨김
//  - 💡 단서 사다리(E18): 무단서 → 의미 → 음소, 그리고 몇 단계까지 갔는지 제출

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PictureNamingItem } from './PictureNamingItem.js';
import type { QabNamingItem } from '../../domain/MixedQuiz.js';
import type { AzurePronunciationScores } from '../../domain/pronunciationScore.js';

interface CaptureResult {
  transcript: string;
  azure: AzurePronunciationScores | null;
}
interface MockCaptureInstance {
  onResult: ((r: CaptureResult) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

// 단서를 소리로도 들려주므로 TTS를 목으로 대체한다. jsdom에는 speechSynthesis가
// 없어서, 안 막으면 언마운트 훅이 ReferenceError로 죽는다.
const ttsSpeak = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
);
vi.mock('../../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({ speak: ttsSpeak, cancel: vi.fn() }),
}));

const { sttInstances } = vi.hoisted(() => ({
  sttInstances: [] as MockCaptureInstance[],
}));

vi.mock('../../infrastructure/SpeechCaptureService.js', () => {
  class MockCapture implements MockCaptureInstance {
    onResult: MockCaptureInstance['onResult'] = null;
    onError: MockCaptureInstance['onError'] = null;
    start = vi.fn();
    stop = vi.fn();
    cancel = vi.fn();
    constructor() {
      sttInstances.push(this);
    }
  }
  return { createSpeechCaptureService: () => new MockCapture() };
});

const ITEM: QabNamingItem = {
  itemId: 'naming_q1',
  imageUrl: '/apple.svg',
  targetWord: '사과',
  instruction: '그림을 보고 이름을 말해주세요',
};

interface Overrides {
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
  item?: QabNamingItem;
}

function renderItem(overrides?: Overrides) {
  const onSubmit = vi.fn();
  const onOverride = vi.fn();
  render(
    <PictureNamingItem
      item={overrides?.item ?? ITEM}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
      onOverride={onOverride}
    />,
  );
  return { onSubmit, onOverride };
}

describe('PictureNamingItem', () => {
  beforeEach(() => {
    sttInstances.length = 0;
  });

  it('안내와 그림을 표시한다', () => {
    renderItem();
    expect(screen.getByText('그림을 보고 이름을 말해주세요')).toBeInTheDocument();
    expect(screen.getByAltText('이름을 말할 그림')).toBeInTheDocument();
  });

  it('이름 말하기를 누르면 캡처(발음 평가)를 시작한다', () => {
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    // 목표어를 발음 평가 기준으로 넘긴다
    expect(sttInstances[0].start).toHaveBeenCalledWith('사과');
  });

  it('인식 성공 후 제출하면 onSubmit이 (전사, azure)로 호출된다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사과', azure: null });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    // 힌트를 안 눌렀으므로 무단서(0)로 간다.
    expect(onSubmit).toHaveBeenCalledWith('사과', null, 0);
  });

  it('발음 점수(azure)가 있으면 그대로 상위로 전달한다', () => {
    const azure: AzurePronunciationScores = {
      accuracyScore: 82,
      fluencyScore: 90,
      completenessScore: 100,
      pronunciationScore: 84,
      prosodyScore: null,
    };
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사가', azure });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    // STT 전사가 '사가'로 어긋나도 azure가 함께 전달돼 상위가 음소로 채점할 수 있다
    expect(onSubmit).toHaveBeenCalledWith('사가', azure, 0);
  });

  it('넘어가기를 누르면 정답 이름으로 통과 처리한다 — 사다리 꼭대기(4)', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('사과', null, 4);
  });

  // ── 단서 사다리 (E18) ──────────────────────────────────────────
  //
  // 재는 값이 "맞혔나"에서 "얼마나 도와야 맞혔나"로 바뀐다. 그 값이 제출까지
  // 실려 가지 않으면 이 기능이 만든 정보가 화면에서 끝난다.

  it('힌트를 누르면 의미 단서가 뜨고, 한 번 더 누르면 음소 단서가 쌓인다', () => {
    const { onSubmit } = renderItem({
      item: { ...ITEM, category: 'food' },
    });

    fireEvent.click(screen.getByRole('button', { name: '힌트 보기' }));
    expect(screen.getByText('먹는 거예요.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '힌트 하나 더 보기' }));
    expect(screen.getByText('사…')).toBeInTheDocument();
    // **앞의 단서를 지우지 않는다** — 지우면 환자가 방금 들은 말을 기억해야 해서
    // 이름대기에 작업기억 과제가 섞인다.
    expect(screen.getByText('먹는 거예요.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사과', azure: null });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith('사과', null, 3);
  });

  it('범주가 없는 자극은 의미 단서를 건너뛴다', () => {
    // 91개 중 9개가 그렇다(가방·풍선·바구니 등). 없는 단서를 빈 칸으로
    // 보여주느니 다음 칸으로 간다.
    renderItem({ item: { ...ITEM, targetWord: '가방', category: null } });

    fireEvent.click(screen.getByRole('button', { name: '힌트 보기' }));
    expect(screen.getByText('가…')).toBeInTheDocument();
  });

  it('한 글자 낱말은 초성만 준다 — 정답을 통째로 주지 않는다', () => {
    renderItem({ item: { ...ITEM, targetWord: '책', category: null } });

    fireEvent.click(screen.getByRole('button', { name: '힌트 보기' }));
    expect(screen.getByText('첫소리는 ㅊ')).toBeInTheDocument();
    expect(screen.queryByText('책')).toBeNull();
  });

  it('사다리 꼭대기에 닿으면 힌트 버튼이 사라진다', () => {
    // 그때 남는 동작은 넘어가기 하나뿐이다 — 정답을 알려주는 자리는 거기다.
    renderItem({ item: { ...ITEM, category: 'food' } });

    fireEvent.click(screen.getByRole('button', { name: '힌트 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '힌트 하나 더 보기' }));
    expect(screen.queryByRole('button', { name: /힌트/ })).toBeNull();
    expect(screen.getByRole('button', { name: '넘어가기' })).toBeInTheDocument();
  });

  it('피드백 단계: 정답이면 ✓, 컨트롤 숨김', () => {
    renderItem({ showFeedback: true, isCorrect: true });
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '이름 말하기' }),
    ).not.toBeInTheDocument();
  });

  it('피드백 단계: 오답이면 ✗와 정답을 노출', () => {
    renderItem({ showFeedback: true, isCorrect: false });
    expect(screen.getByText('✗')).toBeInTheDocument();
    expect(screen.getByText('사과')).toBeInTheDocument();
  });

  it('보호자 정정: 오답 판정을 정답으로 뒤집는다', () => {
    const { onOverride } = renderItem({ showFeedback: true, isCorrect: false });
    fireEvent.click(screen.getByRole('button', { name: '정답으로 정정' }));
    expect(onOverride).toHaveBeenCalledWith(true);
  });

  it('보호자 정정: 정답 판정을 오답으로 뒤집는다', () => {
    const { onOverride } = renderItem({ showFeedback: true, isCorrect: true });
    fireEvent.click(screen.getByRole('button', { name: '오답으로 정정' }));
    expect(onOverride).toHaveBeenCalledWith(false);
  });
});
