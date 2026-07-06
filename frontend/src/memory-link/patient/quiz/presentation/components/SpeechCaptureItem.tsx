// 발화 입력 문항 렌더러 (kind 'repeat' / 'reading')
//
// 공통 흐름: 안내 → 문장/단어 표시 → (따라말하기만) 🔊 들어보기(모범) → 🎤 말하기 → STT 제출.
//  - 따라말하기(검사6): TTS로 모범을 들려준 뒤 따라 말한다(showModel=true).
//  - 소리 내어 읽기(검사7): 모범 없이 스스로 읽는다(showModel=false).
//  - 막히면 "넘어가기"로 보호자가 통과 처리(목표 텍스트 제출 → WER 0 → 정답).
// STT/TTS는 검증된 WebSpeechSttService/WebSpeechTtsService를 재사용한다.

import { useEffect, useMemo, useState } from 'react';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import { createSttService } from '../../infrastructure/sttFactory.js';

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
  onSubmit: (transcript: string) => void;
  /** 보호자 통과 처리(도움받음). 없으면 목표 텍스트 제출로 폴백. */
  onSkip?: () => void;
}

type CaptureStatus = 'idle' | 'listening' | 'recognized' | 'error';

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
}: SpeechCaptureItemProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const stt = useMemo(() => createSttService(), []);
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, speak } = useTTS(ttsService);

  // STT 콜백 프로퍼티 할당(TrainingScreen 등과 동일한 코드베이스 공통 패턴).
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    stt.onResult = (result) => {
      setTranscript(result.transcript);
      setStatus('recognized');
    };
    stt.onError = (message) => {
      setErrorMessage(message);
      setStatus('error');
    };
    return () => {
      stt.onResult = null;
      stt.onError = null;
      stt.stop();
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
    // 따라말하기/읽기 목표 텍스트를 phrase hint로 전달(서버 STT 제약 인식).
    stt.start(text.length > 0 ? [text] : undefined);
  };

  // 서버 STT는 자동 종료되지 않으므로 사용자가 발화 종료를 알린다(→ 인식 실행).
  // Web Speech는 stop()이 최종 결과를 확정한다. 두 구현 모두에서 안전.
  const handleStopRecord = (): void => {
    stt.stop();
  };

  const handleSubmitTranscript = (): void => {
    if (transcript.trim().length === 0) return;
    onSubmit(transcript.trim());
  };

  // "넘어가기": 보호자가 했다고 보고 통과 처리(도움받음).
  const handleSkip = (): void => {
    if (!isSelectable || text.length === 0) return;
    if (onSkip) {
      onSkip();
      return;
    }
    onSubmit(text);
  };

  let resultBoxClass = 'border-[#D4D8D4] bg-white text-[#1F2A26]';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]'
        : 'border-[#E07B54] bg-[#FBE9E2] text-[#7A2E15]';
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
              {isCorrect === true ? '✓' : '✗'}
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

      {/* 안내/에러 메시지 (피드백 단계 제외) */}
      {!showFeedback && status === 'listening' && (
        <p className="text-base text-[#2D6A56]" role="status">
          듣고 있어요… 또박또박 말씀해주세요.
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
