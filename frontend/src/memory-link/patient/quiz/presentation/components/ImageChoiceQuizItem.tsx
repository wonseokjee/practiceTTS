// QAB 이미지 선택형 문항 렌더러 (kind 'qab')
//
// 들려주는 단어/문장(promptText)을 듣고 그에 맞는 그림을 고른다(QAB wordComp/sentComp 공용).
// 음성은 mp3 대신 TTS(WebSpeechTtsService)로 발음한다 → 문항 확장이 자유롭다.
// 피드백 단계: 정답 카드 초록 + ✓, 내가 고른 오답 카드 빨강 + ✗.

import { useEffect, useMemo, useRef } from 'react';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { WebSpeechTtsService } from '../../../../../shared/infrastructure/WebSpeechTtsService.js';
import type { QabImageItem } from '../../domain/MixedQuiz.js';

interface ImageChoiceQuizItemProps {
  item: QabImageItem;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 사용자가 고른 선택지 id (피드백 단계 강조용) */
  selectedChoiceId: string | null;
  onSelect: (choiceId: string) => void;
}

/** 단어/문장 이해(듣고 그림 고르기) 문항 */
export function ImageChoiceQuizItem({
  item,
  isSelectable,
  showFeedback,
  selectedChoiceId,
  onSelect,
}: ImageChoiceQuizItemProps) {
  const ttsService = useMemo(() => new WebSpeechTtsService(), []);
  const { isPlaying, speak } = useTTS(ttsService);

  // 문항 진입 시 1회 자동 발음 (브라우저 정책상 막히면 버튼으로 재생).
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void speak(item.promptText);
  }, [speak, item.promptText]);

  const listenLabel = item.category === 'sentence' ? '문장 듣기' : '단어 듣기';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      <button
        type="button"
        onClick={() => void speak(item.promptText)}
        disabled={isPlaying}
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-lg font-medium text-[#2D6A56] ring-1 ring-inset ring-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:cursor-not-allowed disabled:text-[#A8AFA9] disabled:ring-[#C5C8C5]"
        aria-label={`${listenLabel} 다시 듣기`}
      >
        <span aria-hidden="true" className="text-2xl">🔊</span>
        {isPlaying ? '재생 중…' : listenLabel}
      </button>

      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label="그림 선택지"
      >
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 피드백 단계 강조: 정답=초록, 내가 고른 오답=빨강.
          let ring = 'border-[#E5E5E0]';
          let icon: string | null = null;
          if (showFeedback) {
            if (choice.isCorrect) {
              ring = 'border-[#2D6A56]';
              icon = '✓';
            } else if (isChosen) {
              ring = 'border-[#E07B54]';
              icon = '✗';
            } else {
              ring = 'border-[#E5E5E0] opacity-60';
            }
          } else if (isChosen) {
            ring = 'border-[#2D6A56]';
          }

          return (
            <button
              key={choice.choiceId}
              type="button"
              disabled={!isSelectable}
              onClick={() => {
                if (isSelectable) onSelect(choice.choiceId);
              }}
              aria-label={`${choice.label} 선택`}
              className={`relative aspect-square w-full overflow-hidden rounded-2xl border-4 transition-all duration-150 disabled:cursor-default ${ring} ${
                isSelectable ? 'hover:border-[#A8AFA9] active:scale-[0.97]' : ''
              }`}
            >
              {/* 이미지 로드 실패 폴백 */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center bg-[#F2F1ED] px-2 text-center text-sm font-medium text-[#5C6661]"
                aria-hidden="true"
                style={{ zIndex: 0 }}
              >
                <span className="mb-1 text-2xl">🖼️</span>
                <span>{choice.label}</span>
              </div>
              <img
                src={choice.imageUrl}
                alt={choice.label}
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                style={{ zIndex: 1 }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              {/* 피드백 아이콘 */}
              {icon !== null && (
                <span
                  className="absolute right-2 top-2 text-3xl drop-shadow"
                  style={{ zIndex: 3 }}
                  aria-hidden="true"
                >
                  {icon}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
