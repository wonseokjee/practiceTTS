import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConductLocTrialUseCase } from './ConductLocTrialUseCase.js';
import { LocAssessmentErrorCode } from './LocAssessmentError.js';
import type { ITtsService, TtsPlaybackResult } from '../../../shared/domain/ITtsService.js';

// Mock TTS 서비스
function makeMockTtsService(
  speakResult: TtsPlaybackResult = { startTime: 500, endTime: 1000, durationMs: 500 },
): ITtsService {
  return {
    speak: vi.fn().mockResolvedValue(speakResult),
    cancel: vi.fn(),
  };
}

describe('ConductLocTrialUseCase.execute()', () => {
  let useCase: ConductLocTrialUseCase;
  let ttsService: ITtsService;

  beforeEach(() => {
    ttsService = makeMockTtsService();
    useCase = new ConductLocTrialUseCase(ttsService);
  });

  it('유효한 입력 시 trial과 responseDTO를 반환한다', async () => {
    const { trial, responseDTO } = await useCase.execute(
      {
        trialNumber: 1,
        audioEndTime: 1000,
        touchTime: 2000,
        touchX: 100,
        touchY: 100,
        buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
      },
      [],
    );
    expect(trial.trialNumber).toBe(1);
    expect(trial.latency).toBe(1000);
    expect(responseDTO.score).toBeDefined();
    expect(responseDTO.scoreLabel).toBeDefined();
  });

  it('trialNumber가 범위 밖이면 LocAssessmentError를 던진다', async () => {
    await expect(
      useCase.execute(
        {
          trialNumber: 0 as 1 | 2 | 3,
          audioEndTime: 1000,
          touchTime: null,
          touchX: 0,
          touchY: 0,
          buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
        },
        [],
      ),
    ).rejects.toMatchObject({ code: LocAssessmentErrorCode.INVALID_TRIAL_NUMBER });
  });

  it('touchTime=null이면 touchInBounds=false, score=0', async () => {
    const { trial, responseDTO } = await useCase.execute(
      {
        trialNumber: 1,
        audioEndTime: 1000,
        touchTime: null,
        touchX: 0,
        touchY: 0,
        buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
      },
      [],
    );
    expect(trial.touchInBounds).toBe(false);
    expect(trial.score).toBe(0);
    expect(responseDTO.score).toBe(0);
  });

  it('터치 좌표가 버튼 영역 밖이면 touchInBounds=false', async () => {
    const { trial } = await useCase.execute(
      {
        trialNumber: 1,
        audioEndTime: 1000,
        touchTime: 1500,
        touchX: 300, // 영역 밖 (bounds.x + bounds.width = 200)
        touchY: 100,
        buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
      },
      [],
    );
    expect(trial.touchInBounds).toBe(false);
    expect(trial.score).toBe(0);
  });

  it('score=3 달성 시 isComplete=true (조기 종료)', async () => {
    const { responseDTO } = await useCase.execute(
      {
        trialNumber: 1,
        audioEndTime: 1000,
        touchTime: 1500, // latency=500ms → score=3
        touchX: 100,
        touchY: 100,
        buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
      },
      [],
    );
    expect(responseDTO.score).toBe(3);
    expect(responseDTO.isComplete).toBe(true);
  });

  it('3번째 시도이면 isComplete=true', async () => {
    const prevTrial = { score: 1 } as Parameters<typeof useCase.execute>[1][number];
    const { responseDTO } = await useCase.execute(
      {
        trialNumber: 3,
        audioEndTime: 1000,
        touchTime: null,
        touchX: 0,
        touchY: 0,
        buttonBounds: { x: 0, y: 0, width: 200, height: 200 },
      },
      [prevTrial, prevTrial], // 이미 2개 있음 → 3번째
    );
    expect(responseDTO.isComplete).toBe(true);
  });
});

describe('ConductLocTrialUseCase.playInstruction()', () => {
  it('TTS speak()를 올바른 텍스트로 호출하고 endTime을 반환한다', async () => {
    const ttsService = makeMockTtsService({ startTime: 100, endTime: 2000, durationMs: 1900 });
    const useCase = new ConductLocTrialUseCase(ttsService);

    const endTime = await useCase.playInstruction(1);
    expect(endTime).toBe(2000);
    expect(ttsService.speak).toHaveBeenCalledWith('화면을 눌러주세요.');
  });

  it('모든 시도 번호에 동일한 지시문을 사용한다 (순수 반응시간 측정)', async () => {
    const ttsService = makeMockTtsService();
    const useCase = new ConductLocTrialUseCase(ttsService);

    await useCase.playInstruction(1);
    await useCase.playInstruction(2);
    await useCase.playInstruction(3);

    expect(ttsService.speak).toHaveBeenNthCalledWith(1, '화면을 눌러주세요.');
    expect(ttsService.speak).toHaveBeenNthCalledWith(2, '화면을 눌러주세요.');
    expect(ttsService.speak).toHaveBeenNthCalledWith(3, '화면을 눌러주세요.');
  });

  it('TTS speak() 실패 시 LocAssessmentError(TTS_PLAYBACK_FAILED)를 던진다', async () => {
    const ttsService: ITtsService = {
      speak: vi.fn().mockRejectedValue(new Error('network error')),
      cancel: vi.fn(),
    };
    const useCase = new ConductLocTrialUseCase(ttsService);

    await expect(useCase.playInstruction(1)).rejects.toMatchObject({
      code: LocAssessmentErrorCode.TTS_PLAYBACK_FAILED,
    });
  });
});
