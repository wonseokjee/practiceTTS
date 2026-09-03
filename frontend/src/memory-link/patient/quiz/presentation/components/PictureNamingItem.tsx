// 그림 이름대기 문항 렌더러 (kind 'naming')
//
// QAB 검사5: 그림 한 장을 보여주고 환자가 "말로" 이름을 답한다(회상·이름대기 훈련).
//  - **정답은 끝까지 들려주지 않는다.** 들려준 뒤의 발화는 이름대기가 아니라
//    따라말하기고, 그 검사는 로테이션에 따로 있다. 단서는 정답에 못 미치는
//    것만 준다(무리 이름, 첫 소리).
//  - 흐름: 그림 표시 → (막히면 💡 힌트) → 🎤 말하기 → 발음 평가 채점.
//  - 끝내 막히면 "넘어가기" — 정답을 알려주고 사다리 꼭대기(4)로 기록한다.
//
// **단서 위계(E18).** 예전에는 도움이 두 단계뿐이었다 — 없음, 또는 넘어가기.
// 그 사이가 비어서 "첫 소리만 들으면 말하는 환자"와 "아무리 해도 못 하는
// 환자"가 같은 기록을 남겼다. 이제 몇 단계까지 받았는지를 남긴다(namingCue).
//
// 힌트는 **환자가 직접** 누른다. 보호자가 옆에 있다는 보장이 없고(솔로 홈),
// 사람이 주면 기준이 달라져 기록이 사람을 재게 된다. 누른 것 자체가 "막혔다"는
// 신호라 측정에 필요한 값이기도 하다.
//
// 채점 경로: repeat/reading과 동일하게 서버 발음 평가(/pronunciation)를 쓴다.
// 예전엔 자유 STT 전사를 목표어와 문자열 매칭했는데, 단어 수준 구음장애 발화는
// STT가 매우 불신뢰(608 실측 CER ≈ 0.70)라 맞게 말해도 오답 처리되는 문제가 있었다.
// 발음 평가는 목표 음소에 정렬해 채점하므로 자유 STT보다 훨씬 견고하다. 발음 평가가
// 불가한 환경에서는 azure=null로 오고, 상위는 **채점 불가**로 남긴다 — 문자열
// 채점(isNameMatch) 폴백은 없앴다(다른 자로 재면 회차 비교가 무너진다).

import { useEffect, useMemo, useState } from 'react';
import { createSpeechCaptureService } from '../../infrastructure/SpeechCaptureService.js';
import {
  CUE_GIVEN,
  CUE_NONE,
  cueForLevel,
  nextCueLevel,
  type Cue,
} from '../../domain/namingCue.js';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import type { AzurePronunciationScores } from '../../domain/pronunciationScore.js';
import type { QabNamingItem } from '../../domain/MixedQuiz.js';

interface PictureNamingItemProps {
  item: QabNamingItem;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  /** azure는 음소 점수(가능할 때), 없으면 null(문자열 채점 폴백). */
  onSubmit: (
    transcript: string,
    azure: AzurePronunciationScores | null,
    /** 몇 단계까지 단서를 받고 답했나(E18). */
    cueLevel: number,
  ) => void;
  /** 보호자 통과 처리(도움받음). 없으면 목표 이름 제출로 폴백. */
  onSkip?: () => void;
  /** 보호자가 자동 채점을 정정(피드백 단계). 발음 평가는 '무슨 단어인지'는 못
   *  가리므로 경계 사례에서 옆의 보호자가 최종 판정한다. */
  onOverride?: (isCorrect: boolean) => void;
}

// 'processing' = 녹음 종료 후 서버 인식 응답 대기(1~2초). 무반응 오해 방지용.
type NamingStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'recognized'
  | 'error';

/** 그림 이름대기(보고 말하기) 문항 */
export function PictureNamingItem({
  item,
  isSelectable,
  showFeedback,
  isCorrect,
  onSubmit,
  onSkip,
  onOverride,
}: PictureNamingItemProps) {
  const [status, setStatus] = useState<NamingStatus>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [azure, setAzure] = useState<AzurePronunciationScores | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  /**
   * 지금까지 받은 단서. **지우지 않고 쌓는다** — 1단계를 받고 2단계로 갔는데
   * 앞의 것이 사라지면 환자가 방금 들은 말을 기억해야 해서, 이름대기에
   * 작업기억 과제가 섞인다.
   */
  const [cues, setCues] = useState<Cue[]>([]);
  const cueLevel = cues.length === 0 ? CUE_NONE : cues[cues.length - 1].level;

  const ttsService = useMemo(() => createTtsService(), []);
  const { speak } = useTTS(ttsService);

  // 캡처 인스턴스 (컴포넌트 생명주기와 동일). 문제 전환 시 부모가 key로 리마운트.
  const stt = useMemo(() => createSpeechCaptureService(), []);

  // 콜백 프로퍼티 할당(SpeechCaptureItem 등과 동일한 공통 패턴).
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    stt.onResult = (result) => {
      setTranscript(result.transcript);
      setAzure(result.azure);
      setStatus('recognized');
    };
    stt.onError = (message) => {
      setErrorMessage(message);
      setStatus('error');
    };
    return () => {
      stt.onResult = null;
      stt.onError = null;
      // 이탈 시 취소: 녹음된 환자 음성을 서버로 업로드하지 않고 마이크만 해제한다.
      stt.cancel();
    };
  }, [stt]);
  /* eslint-enable react-hooks/immutability */

  const handleStartRecord = (): void => {
    if (!isSelectable) return;
    setErrorMessage('');
    setStatus('listening');
    // 정답 이름을 발음 평가 기준(reference) 겸 STT 폴백 phrase hint로 전달.
    stt.start(item.targetWord);
  };

  // 서버 STT는 자동 종료되지 않으므로 사용자가 발화 종료를 알린다(→ 인식 실행).
  // Web Speech는 stop()이 최종 결과를 확정한다. 두 구현 모두에서 안전.
  const handleStopRecord = (): void => {
    setStatus('processing');
    stt.stop();
  };

  const handleSubmitTranscript = (): void => {
    if (transcript.trim().length === 0) return;
    onSubmit(transcript.trim(), azure, cueLevel);
  };

  // 사다리를 한 칸 오른다. 줄 수 없는 칸(범주 없는 자극의 의미 단서)은
  // nextCueLevel이 건너뛴다.
  const category = item.category ?? null;
  const nextLevel = nextCueLevel(item.targetWord, category, cueLevel);
  /** 통과는 힌트가 아니라 문항을 끝내는 동작이라 아래 넘어가기가 맡는다. */
  const canHint = isSelectable && nextLevel !== CUE_GIVEN;

  const handleHint = (): void => {
    if (!canHint) return;
    const cue = cueForLevel(item.targetWord, category, nextLevel);
    if (cue === null) return;
    setCues((prev) => [...prev, cue]);
    if (cue.speak !== null) void speak(cue.speak);
  };

  // "넘어가기": 정답을 알려주고 통과 처리 — 사다리의 꼭대기(4)다.
  const handleSkip = (): void => {
    if (!isSelectable) return;
    if (onSkip) {
      onSkip();
      return;
    }
    onSubmit(item.targetWord, null, CUE_GIVEN);
  };

  // 인식 결과 박스 색상 (피드백 단계).
  // 피드백 단계의 isCorrect === null은 **채점 불가**다(미응답이 아니다).
  // 정답도 오답도 아니므로 중립색으로 둔다.
  const isUnscored = showFeedback && isCorrect === null;
  let resultBoxClass = 'border-line-strong bg-white text-ink-sage';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-primary bg-primary-light text-primary-dark'
        : isCorrect === false
          ? 'border-accent bg-accent-soft text-accent-ink'
          : 'border-line-strong bg-surface-dim text-muted-sage';
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-sage">{item.instruction}</p>

      {/* 이름을 말해야 하는 그림 */}
      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border-4 border-line-soft bg-surface-dim">
        <div
          className="absolute inset-0 flex items-center justify-center text-4xl"
          aria-hidden="true"
          style={{ zIndex: 0 }}
        >
          🖼️
        </div>
        <img
          src={item.imageUrl}
          alt="이름을 말할 그림"
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          style={{ zIndex: 1 }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>

      {/* 인식 결과 표시 (인식 완료 또는 피드백 단계) */}
      {(showFeedback || status === 'recognized') && (
        <div
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-md border-2 px-5 py-3 transition-colors duration-[180ms] ease-out ${resultBoxClass}`}
          aria-live="polite"
          aria-label={transcript ? `내가 말한 것: ${transcript}` : '인식 결과 없음'}
        >
          <span className="text-xl font-bold">{transcript || '—'}</span>
          {showFeedback && (
            <span className="text-2xl" aria-hidden="true">
              {isCorrect === true ? '✓' : isCorrect === false ? '✗' : '…'}
            </span>
          )}
        </div>
      )}

      {/* 피드백: 오답이면 정답 이름 노출 */}
      {showFeedback && isCorrect === false && (
        <p className="text-base text-muted-sage">
          정답:{' '}
          <span className="font-bold text-primary">{item.targetWord}</span>
        </p>
      )}

      {/* 보호자 정정 — 발음 평가는 '무슨 단어인지'는 못 가리므로 경계 사례에서
          옆의 보호자가 최종 판정한다. 채점 불가일 때도 낸다: 그때는 정정이
          아니라 **유일하게 남은 잣대**다. */}
      {showFeedback && onOverride && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-dim px-4 py-2.5">
          <span className="text-sm text-muted-sage">
            {isUnscored
              ? '보호자님, 이번엔 확인하지 못했어요. 맞게 말씀하셨나요?'
              : '보호자님, 자동 채점이 맞나요?'}
          </span>
          <button
            type="button"
            onClick={() => onOverride(!isCorrect)}
            className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover"
            aria-label={isCorrect ? '오답으로 정정' : '정답으로 정정'}
          >
            {isCorrect ? '✗ 오답으로 정정' : '✓ 정답으로 정정'}
          </button>
        </div>
      )}

      {/*
        받은 단서 — 쌓아서 보여준다. 화면 글과 들려주는 말이 다를 수 있다
        (자모는 "ㅅ"이 아니라 "시옷"으로 읽어야 TTS가 읽는다).
      */}
      {!showFeedback && cues.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="받은 힌트">
          {cues.map((cue) => (
            <li
              key={cue.level}
              className="rounded-md bg-accent-soft px-4 py-3 text-lg text-accent-ink"
              role="status"
            >
              {cue.text}
            </li>
          ))}
        </ul>
      )}

      {/* 안내/에러 메시지 (피드백 단계 제외) */}
      {!showFeedback && status === 'listening' && (
        <p className="text-base text-primary" role="status">
          듣고 있어요… 그림의 이름을 또박또박 말씀해주세요.
        </p>
      )}
      {!showFeedback && status === 'processing' && (
        <p className="text-base text-primary" role="status">
          인식하고 있어요…
        </p>
      )}
      {!showFeedback && status === 'error' && errorMessage.length > 0 && (
        <p className="text-base text-accent-ink" role="alert">
          {errorMessage}
        </p>
      )}

      {/* 컨트롤 (피드백 단계에선 숨김) */}
      {!showFeedback && (
        <div className="flex flex-col gap-3">
          {status === 'listening' ? (
            <button
              type="button"
              onClick={handleStopRecord}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-accent-strong bg-white px-6 py-4 text-xl font-medium text-accent-ink transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
              aria-label="다 말했어요"
            >
              <span aria-hidden="true" className="text-2xl">✓</span>
              다 말했어요
            </button>
          ) : status === 'processing' ? (
            <button
              type="button"
              disabled
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-disabled-surface bg-white px-6 py-4 text-xl font-medium text-muted-faint"
              aria-label="인식 중"
            >
              <span aria-hidden="true" className="animate-pulse text-2xl">⏳</span>
              인식 중…
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartRecord}
              disabled={!isSelectable}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-primary bg-white px-6 py-4 text-xl font-medium text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:cursor-not-allowed disabled:border-disabled-surface disabled:text-muted-faint"
              aria-label={status === 'idle' ? '이름 말하기' : '다시 말하기'}
            >
              <span aria-hidden="true" className="text-2xl">🎤</span>
              {status === 'idle' ? '이름 말하기' : '다시 말하기'}
            </button>
          )}

          {status === 'recognized' && (
            <button
              type="button"
              onClick={handleSubmitTranscript}
              disabled={!isSelectable || transcript.trim().length === 0}
              className="min-h-[56px] rounded-md bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
              aria-label="제출"
            >
              제출
            </button>
          )}

          {/*
            힌트 — 사다리를 한 칸 오른다. 꼭대기(통과)에 닿으면 사라진다:
            그때 남는 동작은 아래 넘어가기 하나뿐이다.
          */}
          {canHint && (
            <button
              type="button"
              onClick={handleHint}
              className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-accent-ink ring-1 ring-inset ring-accent-line transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
              aria-label={cues.length === 0 ? '힌트 보기' : '힌트 하나 더 보기'}
            >
              <span aria-hidden="true">💡</span>{' '}
              {cues.length === 0 ? '힌트' : '힌트 하나 더'}
            </button>
          )}

          {/* 보호자가 옆에서 통과 처리 — 인식 실패해도 막히지 않게 */}
          <button
            type="button"
            onClick={handleSkip}
            disabled={!isSelectable}
            className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover disabled:cursor-not-allowed disabled:text-disabled-surface"
            aria-label="넘어가기"
          >
            넘어가기
          </button>
        </div>
      )}
    </div>
  );
}
