// PictureNamingItem.tsx — 이웃 비교 채점 흐름(계획 PR 5)
//
// 검증 포인트:
//  - 플래그가 꺼져 있으면 예전과 똑같이 호출한다(start 인자 하나, onSubmit 인자 셋)
//  - 켜져 있고 이웃 목록이 있는 낱말이면 이웃을 캡처 서비스에 넘긴다
//  - 가르면 바로 제출, 모호하면 "한 번만 더"(단서는 그대로, 도움으로 기록하지 않음)
//  - 다시 말했는데도 모호하면 채점 불가(모호)로 제출, 다시 말해 가려지면 그 결과로 제출
//  - 이웃 목록이 없는 낱말은 이전 채점 + 버전 v1만 찍는다

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PictureNamingItem } from './PictureNamingItem.js';
import type { QabNamingItem } from '../../domain/MixedQuiz.js';
import type { AzurePronunciationScores } from '../../domain/pronunciationScore.js';
import type {
  CompetitorInfo,
  CompetitorScore,
} from '../../domain/neighborScoring.js';

interface CaptureResult {
  transcript: string;
  azure: AzurePronunciationScores | null;
  competitors?: CompetitorInfo | null;
}
interface MockCaptureInstance {
  onResult: ((r: CaptureResult) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

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

// 이웃 목록에 있는 낱말(neighborManifest.test.ts가 이웃을 고정한다)
const ITEM: QabNamingItem = {
  itemId: 'naming_candy',
  imageUrl: '/candy.svg',
  targetWord: '사탕',
  instruction: '그림을 보고 이름을 말해주세요',
  category: 'food',
};
const NEIGHBORS = ['사자', '낙타', '수달'];
// 이웃 목록에 없는 낱말
const UNLISTED: QabNamingItem = { ...ITEM, itemId: 'naming_x', targetWord: '미확인낱말' };

const azure = (accuracyScore: number): AzurePronunciationScores => ({
  accuracyScore,
  fluencyScore: 90,
  completenessScore: 100,
  pronunciationScore: accuracyScore,
  prosodyScore: null,
});

const rival = (text: string, accuracyScore: number): CompetitorScore => ({
  text,
  source: 'neighbor',
  accuracyScore,
  recognizedText: text,
  status: 'ok',
});

const info = (scores: CompetitorScore[]): CompetitorInfo => ({
  scores,
  sttTranscript: null,
  sttStatus: 'ok',
  skipped: null,
});

/** 목표(90점)를 가리는 결과 / 이웃이 더 높아 못 가리는 결과 */
const CLEAR: CaptureResult = {
  transcript: '사탕',
  azure: azure(90),
  competitors: info([rival('사자', 40), rival('낙타', 30), rival('수달', 20)]),
};
const AMBIGUOUS: CaptureResult = {
  transcript: '사탕',
  azure: azure(80),
  competitors: info([rival('사자', 92), rival('낙타', 30), rival('수달', 20)]),
};

function renderItem(item: QabNamingItem = ITEM) {
  const onSubmit = vi.fn();
  render(
    <PictureNamingItem
      item={item}
      isSelectable
      showFeedback={false}
      isCorrect={null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

/** 말하기 → 인식 결과 도착 → 제출 */
function speakAndSubmit(result: CaptureResult): void {
  fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
  act(() => {
    sttInstances[0].onResult?.(result);
  });
  fireEvent.click(screen.getByRole('button', { name: '제출' }));
}

const RETRY_TEXT = '한 번만 더 말씀해 주시겠어요?';

describe('PictureNamingItem — 이웃 비교 채점', () => {
  beforeEach(() => {
    sttInstances.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('플래그가 꺼져 있으면 예전과 똑같다', () => {
    it('start는 인자 하나, onSubmit은 인자 셋으로 호출한다', () => {
      vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', '');
      const { onSubmit } = renderItem();
      speakAndSubmit(CLEAR);
      expect(sttInstances[0].start).toHaveBeenCalledWith('사탕');
      expect(onSubmit).toHaveBeenCalledWith('사탕', azure(90), 0);
    });

    it('모호한 결과여도 재시도를 청하지 않고 그대로 제출한다', () => {
      vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', '');
      const { onSubmit } = renderItem();
      speakAndSubmit(AMBIGUOUS);
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('플래그가 켜져 있고 이웃 목록이 있는 낱말', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', 'true');
    });

    it('이웃을 캡처 서비스에 넘긴다 — 처음에는 "한 번 더" 안내가 없다', () => {
      renderItem();
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
      expect(sttInstances[0].start).toHaveBeenCalledWith('사탕', { neighbors: NEIGHBORS });
    });

    it('가려지면 바로 제출한다 — 판정·버전·재시도 횟수(0)와 함께', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit(CLEAR);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [text, az, cue, scoring] = onSubmit.mock.calls[0];
      expect([text, az, cue]).toEqual(['사탕', azure(90), 0]);
      expect(scoring).toMatchObject({
        scorerVersion: 'azure-pa-nbr-v1',
        ambiguousRetries: 0,
      });
      expect(scoring.assessment).toMatchObject({ scored: true, isCorrect: true });
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
    });

    it('가까운 다른 단어와 못 가리면 제출하지 않고 "한 번만 더"를 청한다', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit(AMBIGUOUS);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(RETRY_TEXT)).toBeInTheDocument();
      // 다시 말할 수 있는 상태다 — 이전 인식 결과·제출 버튼은 치운다
      expect(screen.getByRole('button', { name: '이름 말하기' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '제출' })).not.toBeInTheDocument();
    });

    it('다시 말하기 시작하면 안내가 사라진다', () => {
      renderItem();
      speakAndSubmit(AMBIGUOUS);
      fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
    });

    it('다시 말해서 가려지면 그 결과로 제출하고 재시도 횟수(1)를 남긴다', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit(AMBIGUOUS);
      // 두 번째 시도
      fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
      act(() => {
        sttInstances[0].onResult?.(CLEAR);
      });
      fireEvent.click(screen.getByRole('button', { name: '제출' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const scoring = onSubmit.mock.calls[0][3];
      expect(scoring).toMatchObject({ scorerVersion: 'azure-pa-nbr-v1', ambiguousRetries: 1 });
      expect(scoring.assessment).toMatchObject({ scored: true, isCorrect: true });
    });

    it('다시 말했는데도 못 가리면 채점 불가(모호)로 제출한다 — 세 번째는 청하지 않는다', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit(AMBIGUOUS);
      fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
      act(() => {
        sttInstances[0].onResult?.(AMBIGUOUS);
      });
      fireEvent.click(screen.getByRole('button', { name: '제출' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const scoring = onSubmit.mock.calls[0][3];
      expect(scoring).toMatchObject({
        scorerVersion: 'azure-pa-nbr-v1',
        unscoredReason: 'ambiguous',
        ambiguousRetries: 1,
      });
      expect(scoring.assessment).toMatchObject({ scored: false });
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
    });

    it('재시도는 도움이 아니다 — 받은 단서가 그대로이고 단서 단계도 안 바뀐다', () => {
      const { onSubmit } = renderItem();
      // 힌트를 하나 받은 뒤 시도한다
      fireEvent.click(screen.getByRole('button', { name: /힌트/ }));
      const cueList = screen.getByRole('list', { name: '받은 힌트' });
      const cueText = cueList.textContent;
      expect(cueText).toBeTruthy();

      speakAndSubmit(AMBIGUOUS);
      expect(screen.getByRole('list', { name: '받은 힌트' }).textContent).toBe(cueText);

      fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
      act(() => {
        sttInstances[0].onResult?.(CLEAR);
      });
      fireEvent.click(screen.getByRole('button', { name: '제출' }));
      // 단서 단계는 힌트를 누른 만큼이다(재시도가 올리지 않는다)
      const cueLevel = onSubmit.mock.calls[0][2];
      expect(cueLevel).toBeGreaterThan(0);
      expect(onSubmit.mock.calls[0][3].ambiguousRetries).toBe(1);
    });

    it('경쟁자 결과를 못 얻은 시도(옛 서버·인식 폴백)는 채점 불가(no_score)이고 재시도를 청하지 않는다', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit({ transcript: '사탕', azure: azure(90), competitors: null });
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][3]).toMatchObject({
        scorerVersion: 'azure-pa-nbr-v1',
        unscoredReason: 'no_score',
        ambiguousRetries: 0,
      });
    });

    it('넘어가기는 채점하지 않는다 — 판정도 버전도 안 붙는다', () => {
      const { onSubmit } = renderItem();
      speakAndSubmit(AMBIGUOUS); // 한 번 재시도를 청한 뒤에도
      fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
      expect(onSubmit).toHaveBeenCalledWith('사탕', null, 4); // 정답을 알려준 통과(기존 계약)
    });
  });

  describe('플래그가 켜져 있어도 이웃 목록이 없는 낱말', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_ENABLE_NEIGHBOR_SCORING', 'true');
    });

    it('이웃 없이 예전처럼 요청하고, 버전 v1만 명시해 제출한다', () => {
      const { onSubmit } = renderItem(UNLISTED);
      speakAndSubmit({ transcript: '미확인낱말', azure: azure(90) });
      expect(sttInstances[0].start).toHaveBeenCalledWith('미확인낱말');
      // 이웃 비교를 안 거쳤으니 재시도 횟수는 없다(0이 아니다)
      expect(onSubmit).toHaveBeenCalledWith('미확인낱말', azure(90), 0, {
        scorerVersion: 'azure-pa-v1',
      });
    });

    it('모호한 점수여도 재시도를 청하지 않는다(비교할 이웃이 없다)', () => {
      const { onSubmit } = renderItem(UNLISTED);
      speakAndSubmit({ transcript: '미확인낱말', azure: azure(65) });
      expect(screen.queryByText(RETRY_TEXT)).not.toBeInTheDocument();
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
