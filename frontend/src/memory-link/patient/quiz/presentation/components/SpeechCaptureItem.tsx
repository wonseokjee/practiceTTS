// 발화 입력 문항 렌더러 (kind 'repeat' / 'reading')
//
// 공통 흐름: 안내 → 문장/단어 표시 → (따라말하기만) 🔊 들어보기(모범) → 🎤 말하기 → STT 제출.
//  - 따라말하기(검사6): TTS로 모범을 들려준 뒤 따라 말한다(showModel=true).
//  - 소리 내어 읽기(검사7): 모범 없이 스스로 읽는다(showModel=false).
//  - 막히면 "넘어가기"로 보호자가 통과 처리(목표 텍스트 제출 → WER 0 → 정답).
// STT/TTS는 검증된 WebSpeechSttService/WebSpeechTtsService를 재사용한다.

import { useEffect, useMemo, useState } from 'react';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { TtsFailureNotice } from './TtsFailureNotice.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import { createSpeechCaptureService } from '../../infrastructure/SpeechCaptureService.js';
import type { AzurePronunciationScores } from '../../domain/pronunciationScore.js';

interface SpeechCaptureItemProps {
  /** 보여줄/들려줄 내용 */
  text: string;
  /** 화면 안내 문구 */
  instruction: string;
  /** 🔊 모범 발음(TTS) 버튼 노출 여부 (따라말하기=true, 읽기=false) */
  showModel: boolean;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  /** 채점 제출. azure는 음소 점수(가능할 때), 없으면 null(문자열 채점 폴백). */
  onSubmit: (transcript: string, azure: AzurePronunciationScores | null) => void;
  /** 보호자 통과 처리(도움받음). 없으면 목표 텍스트 제출로 폴백. */
  onSkip?: () => void;
  /** 보호자가 자동 채점을 정정(피드백 단계). 발음 평가 불가 시 문자열 채점(불신뢰
   *  STT)으로 폴백하므로, 경계 사례에서 옆의 보호자가 최종 판정한다. */
  onOverride?: (isCorrect: boolean) => void;
}

// 'processing' = 녹음 종료 후 서버 발음평가/인식 응답을 기다리는 구간(1~2초).
// 이 상태가 없으면 "다 말했어요"를 눌러도 화면이 그대로라 무반응처럼 보인다.
type CaptureStatus = 'idle' | 'listening' | 'processing' | 'recognized' | 'error';

/** 따라말하기/소리내어읽기 음성 입력 */
export function SpeechCaptureItem({
  text,
  instruction,
  showModel,
  isSelectable,
  showFeedback,
  isCorrect,
  onSubmit,
  onSkip,
  onOverride,
}: SpeechCaptureItemProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [azure, setAzure] = useState<AzurePronunciationScores | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const stt = useMemo(() => createSpeechCaptureService(), []);
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, error: ttsError, speak } = useTTS(ttsService);

  // 캡처 콜백 프로퍼티 할당(TrainingScreen 등과 동일한 코드베이스 공통 패턴).
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

  const handleListenModel = (): void => {
    if (text.length === 0) return;
    void speak(text);
  };

  const handleStartRecord = (): void => {
    if (!isSelectable) return;
    setErrorMessage('');
    setStatus('listening');
    // 목표 텍스트를 발음 평가 기준(reference) 겸 phrase hint로 전달.
    stt.start(text);
  };

  // 서버 STT는 자동 종료되지 않으므로 사용자가 발화 종료를 알린다(→ 인식 실행).
  // Web Speech는 stop()이 최종 결과를 확정한다. 두 구현 모두에서 안전.
  // stop() 직후 서버 응답까지 1~2초가 걸리므로 즉시 'processing'으로 바꿔
  // 진행 중임을 보여준다(무반응 오해 방지). onResult/onError가 상태를 넘긴다.
  const handleStopRecord = (): void => {
    setStatus('processing');
    stt.stop();
  };

  const handleSubmitTranscript = (): void => {
    if (transcript.trim().length === 0) return;
    onSubmit(transcript.trim(), azure);
  };

  // "넘어가기": 보호자가 했다고 보고 통과 처리(도움받음).
  const handleSkip = (): void => {
    if (!isSelectable || text.length === 0) return;
    if (onSkip) {
      onSkip();
      return;
    }
    // onSkip이 없는 경우(테스트 등)의 최소 동작. 음소 점수가 없으므로 상위는
    // 이것을 **채점 불가**로 받는다 — 예전처럼 문자열 채점으로 정답 처리되지
    // 않는다. 앱에서는 QuizScreen이 항상 onSkip을 넘기므로 이 줄은 안 탄다.
    onSubmit(text, null);
  };

  // 피드백 단계의 isCorrect === null은 **채점 불가**다(미응답이 아니다 —
  // 미응답이면 showFeedback이 false다). 정답도 오답도 아니므로 중립색으로 둔다.
  const isUnscored = showFeedback && isCorrect === null;
  let resultBoxClass = 'border-[#D4D8D4] bg-white text-[#1F2A26]';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]'
        : isCorrect === false
          ? 'border-[#E07B54] bg-[#FBE9E2] text-[#7A2E15]'
          : 'border-[#D4D8D4] bg-[#F2F1ED] text-[#5C6661]';
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{instruction}</p>

      {/* 보여줄/들려줄 내용 */}
      <div
        className="flex min-h-[96px] items-center justify-center rounded-md border-2 border-[#D4D8D4] bg-white px-5 py-6 text-center"
        aria-label={`내용: ${text}`}
      >
        <span className="text-3xl font-bold leading-snug tracking-wide text-[#1F2A26]">
          {text || '—'}
        </span>
      </div>

      {/* 소리가 안 났으면 알린다 — 못 들은 발음은 따라 할 수 없다. */}
      {showModel && !showFeedback && ttsError !== null && <TtsFailureNotice />}

      {/* 모범 발음 듣기 (따라말하기 전용) — 피드백 단계엔 숨김 */}
      {showModel && !showFeedback && (
        <button
          type="button"
          onClick={handleListenModel}
          disabled={isPlaying || text.length === 0}
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-base font-medium text-[#2D6A56] ring-1 ring-inset ring-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:cursor-not-allowed disabled:text-[#A8AFA9] disabled:ring-[#C5C8C5]"
          aria-label="모범 발음 들어보기"
        >
          <span aria-hidden="true" className="text-xl">🔊</span>
          {isPlaying ? '재생 중…' : '들어보기'}
        </button>
      )}

      {/* 인식 결과 표시 */}
      {(showFeedback || status === 'recognized') && (
        <div
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-md border-2 px-5 py-3 transition-colors duration-[180ms] ease-out ${resultBoxClass}`}
          aria-live="polite"
          aria-label={transcript ? `내가 말한 것: ${transcript}` : '인식 결과 없음'}
        >
          <span className="text-lg font-bold">{transcript || '—'}</span>
          {showFeedback && (
            <span className="text-2xl" aria-hidden="true">
              {isCorrect === true ? '✓' : isCorrect === false ? '✗' : '…'}
            </span>
          )}
        </div>
      )}

      {/* 피드백: 오답이면 목표 텍스트 노출 */}
      {showFeedback && isCorrect === false && (
        <p className="text-base text-[#5C6661]">
          정답: <span className="font-bold text-[#2D6A56]">{text}</span>
        </p>
      )}

      {/* 보호자 정정 — 경계 사례에서 옆의 보호자가 최종 판정한다.
          채점 불가(isCorrect === null)일 때도 낸다. 그때는 정정이 아니라
          **유일하게 남은 잣대**다 — 기계가 판정을 못 냈으니 사람이 낸다. */}
      {showFeedback && onOverride && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-[#F2F1ED] px-4 py-2.5">
          <span className="text-sm text-[#5C6661]">
            {isUnscored
              ? '보호자님, 이번엔 확인하지 못했어요. 맞게 말씀하셨나요?'
              : '보호자님, 자동 채점이 맞나요?'}
          </span>
          <button
            type="button"
            onClick={() => onOverride(!isCorrect)}
            className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-medium text-[#5C6661] ring-1 ring-inset ring-[#D4D8D4] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6]"
            aria-label={isCorrect ? '오답으로 정정' : '정답으로 정정'}
          >
            {isCorrect ? '✗ 오답으로 정정' : '✓ 정답으로 정정'}
          </button>
        </div>
      )}

      {/* 안내/에러 메시지 (피드백 단계 제외) */}
      {!showFeedback && status === 'listening' && (
        <p className="text-base text-[#2D6A56]" role="status">
          듣고 있어요… 또박또박 말씀해주세요.
        </p>
      )}
      {!showFeedback && status === 'processing' && (
        <p className="text-base text-[#2D6A56]" role="status">
          발음을 확인하고 있어요…
        </p>
      )}
      {!showFeedback && status === 'error' && errorMessage.length > 0 && (
        <p className="text-base text-[#7A2E15]" role="alert">
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
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-[#E07B54] bg-white px-6 py-4 text-xl font-medium text-[#7A2E15] transition-colors duration-[180ms] ease-out hover:bg-[#FBE9E2]"
              aria-label="다 말했어요"
            >
              <span aria-hidden="true" className="text-2xl">✓</span>
              다 말했어요
            </button>
          ) : status === 'processing' ? (
            <button
              type="button"
              disabled
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-[#C5C8C5] bg-white px-6 py-4 text-xl font-medium text-[#A8AFA9]"
              aria-label="발음 확인 중"
            >
              <span aria-hidden="true" className="animate-pulse text-2xl">⏳</span>
              확인 중…
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartRecord}
              disabled={!isSelectable}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-[#2D6A56] bg-white px-6 py-4 text-xl font-medium text-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:cursor-not-allowed disabled:border-[#C5C8C5] disabled:text-[#A8AFA9]"
              aria-label={status === 'idle' ? '말하기' : '다시 말하기'}
            >
              <span aria-hidden="true" className="text-2xl">🎤</span>
              {status === 'idle' ? '말하기' : '다시 말하기'}
            </button>
          )}

          {status === 'recognized' && (
            <button
              type="button"
              onClick={handleSubmitTranscript}
              disabled={!isSelectable || transcript.trim().length === 0}
              className="min-h-[56px] rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:bg-[#C5C8C5] disabled:text-[#7A7E7A]"
              aria-label="제출"
            >
              제출
            </button>
          )}

          <button
            type="button"
            onClick={handleSkip}
            disabled={!isSelectable || text.length === 0}
            className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-[#5C6661] ring-1 ring-inset ring-[#D4D8D4] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6] disabled:cursor-not-allowed disabled:text-[#C5C8C5]"
            aria-label="넘어가기"
          >
            넘어가기
          </button>
        </div>
      )}
    </div>
  );
}
