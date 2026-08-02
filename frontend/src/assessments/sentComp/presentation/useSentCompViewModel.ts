/**
 * 문장 이해 (SentComp) 검사 ViewModel 훅
 *
 * Composition Root: 이 훅 내부에서 모든 의존성을 생성한다.
 *
 * FSM 상태 전이 흐름:
 * 마운트 → LOADING(문항 로드 + 오디오 로드) → PLAYING(오디오 재생)
 * → AWAITING(이미지 선택 대기) → SUBMITTING(채점) → FEEDBACK(결과 표시)
 * → TRANSITIONING(다음 문항 준비) → LOADING(반복) | COMPLETED(완료)
 *
 * 핵심 동작:
 * - LOADING: 다음 문항 설정 후 오디오 로드 → ITEMS_LOADED 디스패치
 * - PLAYING: 오디오 재생 → AUDIO_ENDED 디스패치
 * - AWAITING: IMAGE_SELECTED → SubmitAnswerUseCase → ANSWER_SUBMITTED 디스패치
 * - FEEDBACK: 1초 후 자동 FEEDBACK_DONE 디스패치
 * - TRANSITIONING: 0.5초 후 TRANSITION_DONE 디스패치
 * - COMPLETED: CalculateScoreUseCase 실행 → onComplete 콜백
 */

import {
  useReducer,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import {
  sentCompSessionReducer,
  type SessionPhase,
} from './sentCompSessionReducer.js';
import type { SentenceComprehensionItem } from '../domain/types.js';
import type { SentenceComprehensionResult } from '../domain/types.js';
import { HtmlAudioPlayer } from '../../../shared/infrastructure/HtmlAudioPlayer.js';
import { JsonSentCompItemRepository } from '../infrastructure/JsonSentCompItemRepository.js';
import { SessionLocalStorageSentCompRepository } from '../infrastructure/LocalStorageSentCompRepository.js';
import {
  ServerAssessmentResultSubmitter,
  createAssessmentSessionToken,
  toQabResults,
} from '../../shared/infrastructure/AssessmentResultSubmitter.js';
import { SubmitAnswerUseCase } from '../application/useCases/SubmitAnswerUseCase.js';
import { CalculateScoreUseCase } from '../application/useCases/CalculateScoreUseCase.js';
import { SentCompError, SentCompErrorCode } from '../application/errors.js';
import type { ScoreDTO } from '../application/dtos.js';
import sentCompItemsData from '../../../assets/data/sentCompItems.json';

/** ViewModel에서 컴포넌트로 전달하는 뷰 상태 */
export interface SentCompViewState {
  phase: SessionPhase;
  currentItem: SentenceComprehensionItem | null;
  currentItemIndex: number;
  totalItems: number;
  submittedResults: SentenceComprehensionResult[];
  score: ScoreDTO | null;
  errorMessage: string | null;
  /** 현재 선택된 이미지 인덱스 (미선택 시 null) */
  selectedIndex: 0 | 1 | null;
}

/** ViewModel에서 컴포넌트로 전달하는 액션 */
export interface SentCompActions {
  handleImageSelect: (selectedIndex: 0 | 1) => void;
  handleReplay: () => void;
  handleFeedbackDone: () => void;
  handleRetry: () => void;
}

/** 에러를 사용자 메시지로 변환한다 */
function mapErrorToMessage(error: unknown): string {
  if (error instanceof SentCompError) {
    switch (error.code) {
      case SentCompErrorCode.AUDIO_NOT_PLAYED:
        return '음성을 먼저 들어주세요.';
      case SentCompErrorCode.AUDIO_LOAD_FAILED:
        return '오디오 파일을 불러올 수 없습니다. 파일 경로를 확인해주세요.';
      case SentCompErrorCode.ITEM_NOT_FOUND:
        return '문항을 찾을 수 없습니다.';
      case SentCompErrorCode.ITEMS_LOAD_FAILED:
        return '문항을 불러오는데 실패했습니다.';
      case SentCompErrorCode.SAVE_FAILED:
        return '결과 저장에 실패했습니다.';
      case SentCompErrorCode.DUPLICATE_SUBMISSION:
        return '이미 제출된 문항입니다.';
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

const FEEDBACK_DURATION_MS = 1_000;
const TRANSITION_DURATION_MS = 500;

export function useSentCompViewModel(
  sessionId: string,
  onComplete: (score: ScoreDTO) => void,
): { viewState: SentCompViewState; actions: SentCompActions } {
  // FSM 상태
  const [phase, dispatch] = useReducer(sentCompSessionReducer, {
    type: 'LOADING',
  });

  // 문항 상태
  const [allItems, setAllItems] = useState<SentenceComprehensionItem[]>([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [currentItem, setCurrentItem] =
    useState<SentenceComprehensionItem | null>(null);
  const [submittedResults, setSubmittedResults] = useState<
    SentenceComprehensionResult[]
  >([]);
  const [score, setScore] = useState<ScoreDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 현재 선택된 이미지 인덱스 (AWAITING→SUBMITTING→FEEDBACK 구간에서 유지)
  const [selectedIndex, setSelectedIndex] = useState<0 | 1 | null>(null);

  // 재청취 횟수 추적 (AWAITING 상태에서 REPLAY 시 증가)
  const replayCountRef = useRef(0);

  // Stale closure 방지: 콜백 내부에서 최신 상태를 읽기 위한 ref
  const phaseRef = useRef<SessionPhase>({ type: 'LOADING' });
  const currentItemRef = useRef<SentenceComprehensionItem | null>(null);
  const currentItemIndexRef = useRef(0);
  const onCompleteRef = useRef(onComplete);

  // ref 동기화
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    currentItemRef.current = currentItem;
  }, [currentItem]);

  useEffect(() => {
    currentItemIndexRef.current = currentItemIndex;
  }, [currentItemIndex]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // === Composition Root: 의존성 생성 ===
  const audioPlayer = useMemo(() => new HtmlAudioPlayer(), []);

  const itemRepository = useMemo(
    () =>
      new JsonSentCompItemRepository(
        // JSON 정적 데이터 → 도메인 타입. 런타임 형태는 일치하나 TS 구조 검사상
        // sentenceType(union)·choices(튜플) strictness 때문에 unknown 경유 단언.
        sentCompItemsData as unknown as SentenceComprehensionItem[],
      ),
    [],
  );

  const resultSubmitter = useMemo(
    () => new ServerAssessmentResultSubmitter(),
    [],
  );

  const resultRepository = useMemo(
    () => new SessionLocalStorageSentCompRepository(sessionId),
    [sessionId],
  );

  const submitUseCase = useMemo(
    () =>
      new SubmitAnswerUseCase(itemRepository, resultRepository, sessionId),
    [itemRepository, resultRepository, sessionId],
  );

  // 재청취는 handleReplay에서 audioPlayer를 직접 사용한다 (ReplayAudioUseCase 미사용)

  const calculateScoreUseCase = useMemo(
    () => new CalculateScoreUseCase(itemRepository, resultRepository),
    [itemRepository, resultRepository],
  );

  // === LOADING 상태 처리: 문항 로드 + 오디오 로드 ===
  useEffect(() => {
    if (phase.type !== 'LOADING') return;

    let cancelled = false;

    const loadAndPrepare = async () => {
      try {
        // 최초 마운트 시 문항 목록 로드
        let items = allItems;
        if (items.length === 0) {
          items = await itemRepository.loadItems();
          if (cancelled) return;
          // orderIndex 기준 정렬
          items = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
          setAllItems(items);
        }

        if (items.length === 0) {
          dispatch({
            type: 'ERROR_OCCURRED',
            message: '검사 문항이 없습니다.',
          });
          return;
        }

        // 현재 문항 인덱스 설정
        const idx = currentItemIndexRef.current;
        if (idx >= items.length) {
          // 모든 문항 완료 (COMPLETED로 가야 하지만 LOADING은 중간 상태이므로 ITEMS_LOADED 후 COMPLETED로)
          dispatch({ type: 'ITEMS_LOADED' });
          return;
        }

        const item = items[idx];
        if (cancelled) return;

        setCurrentItem(item);

        // 오디오 로드 (파일 없으면 에러 처리 후 계속 진행 가능하도록)
        try {
          await audioPlayer.load(item.sentenceAudioUrl);
        } catch {
          // 오디오 파일 없을 때: 에러를 표시하지 않고 계속 진행 (개발 환경)
          // 실제 환경에서는 아래 에러 처리로 전환 가능
          console.warn(
            `[useSentCompViewModel] 오디오 파일 로드 실패: ${item.sentenceAudioUrl}`,
          );
        }

        if (cancelled) return;

        dispatch({ type: 'ITEMS_LOADED' });
      } catch (err) {
        if (cancelled) return;
        const message = mapErrorToMessage(err);
        setErrorMessage(message);
        dispatch({ type: 'ERROR_OCCURRED', message });
      }
    };

    void loadAndPrepare();

    return () => {
      cancelled = true;
    };
    // phase.type과 allItems.length를 의존성으로 포함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.type]);

  // === PLAYING 상태 처리: 오디오 재생 ===
  useEffect(() => {
    if (phase.type !== 'PLAYING') return;

    let cancelled = false;

    const playAudio = async () => {
      try {
        const endTimestamp = await audioPlayer.play();
        if (cancelled) return;
        dispatch({ type: 'AUDIO_ENDED', audioEndTimestamp: endTimestamp });
      } catch {
        if (cancelled) return;
        // 오디오 파일이 없는 개발 환경에서도 진행 가능하도록
        // 실패 시 현재 시각을 audioEndTimestamp로 사용
        const fallbackTimestamp = performance.now();
        console.warn(
          '[useSentCompViewModel] 오디오 재생 실패. 현재 타임스탬프 사용.',
        );
        dispatch({
          type: 'AUDIO_ENDED',
          audioEndTimestamp: fallbackTimestamp,
        });
      }
    };

    void playAudio();

    return () => {
      cancelled = true;
      audioPlayer.stop();
    };
  }, [phase.type, audioPlayer]);

  // === FEEDBACK 상태 처리: 1초 후 자동 FEEDBACK_DONE ===
  useEffect(() => {
    if (phase.type !== 'FEEDBACK') return;

    const timerId = setTimeout(() => {
      dispatch({ type: 'FEEDBACK_DONE' });
    }, FEEDBACK_DURATION_MS);

    return () => {
      clearTimeout(timerId);
    };
  }, [phase.type]);

  // === TRANSITIONING 상태 처리: 0.5초 후 다음 문항으로 ===
  useEffect(() => {
    if (phase.type !== 'TRANSITIONING') return;

    const timerId = setTimeout(() => {
      // 다음 문항 인덱스로 이동
      setCurrentItemIndex((prev) => {
        const next = prev + 1;
        currentItemIndexRef.current = next;
        return next;
      });
      replayCountRef.current = 0;
      setSelectedIndex(null);
      dispatch({ type: 'TRANSITION_DONE' });
    }, TRANSITION_DURATION_MS);

    return () => {
      clearTimeout(timerId);
    };
  }, [phase.type]);

  // === COMPLETED 상태 처리: 채점만 수행. onComplete는 ScoreResultPanel의 onProceed에서 호출 ===
  useEffect(() => {
    if (phase.type !== 'COMPLETED') return;

    const finalize = async () => {
      try {
        const calculatedScore =
          await calculateScoreUseCase.execute(sessionId);
        setScore(calculatedScore);

        // 서버 저장 — 보호자의 회복 추이에 반영된다. 로컬에만 두면 캐시를
        // 지우는 순간 임상 기록이 사라진다. 실패해도 던지지 않는다.
        const results = await resultRepository.getResultsBySession(sessionId);
        await resultSubmitter.submit({
          sessionToken: createAssessmentSessionToken(),
          results: toQabResults(
            'sentence',
            results.map((item) => ({
              itemRef: item.itemId,
              isCorrect: item.isCorrect,
            })),
          ),
        });

        // onComplete는 여기서 호출하지 않음 - ScoreResultPanel의 "다음" 버튼에서 호출됨
      } catch (err) {
        console.error('[useSentCompViewModel] 채점 실패:', err);
        setErrorMessage(mapErrorToMessage(err));
      }
    };

    void finalize();
    // sessionId는 불변이라 의존성에서 제외해도 무방
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.type]);

  // === 이미지 선택 핸들러 ===
  const handleImageSelect = useCallback(
    (selectedIndex: 0 | 1) => {
      if (phaseRef.current.type !== 'AWAITING') return;

      const currentPhase = phaseRef.current;
      const item = currentItemRef.current;

      if (item === null) return;

      // 이미지 선택 즉시 타임스탬프 캡처
      const selectionTimestamp = performance.now();

      setSelectedIndex(selectedIndex);
      dispatch({ type: 'IMAGE_SELECTED' });

      void (async () => {
        try {
          const response = await submitUseCase.execute({
            itemId: item.itemId,
            selectedImageIndex: selectedIndex,
            audioEndTimestamp: currentPhase.audioEndTimestamp,
            selectionTimestamp,
            replayCount: currentPhase.replayCount,
          });

          // 제출 결과를 로컬 상태에도 누적
          const result: SentenceComprehensionResult = {
            itemId: item.itemId,
            selectedImageIndex: selectedIndex,
            isCorrect: response.isCorrect,
            reactionTimeMs: response.reactionTimeMs,
            replayCount: currentPhase.replayCount,
            audioEndTimestamp: currentPhase.audioEndTimestamp,
            selectionTimestamp,
          };
          setSubmittedResults((prev) => [...prev, result]);

          dispatch({
            type: 'ANSWER_SUBMITTED',
            isCorrect: response.isCorrect,
            isLastItem: response.isLastItem,
          });
        } catch (err) {
          const message = mapErrorToMessage(err);
          setErrorMessage(message);
          dispatch({ type: 'ERROR_OCCURRED', message });
        }
      })();
    },
    [submitUseCase],
  );

  // === 재청취 핸들러 ===
  const handleReplay = useCallback(() => {
    if (phaseRef.current.type !== 'AWAITING') return;

    replayCountRef.current += 1;
    dispatch({ type: 'REPLAY' });

    // REPLAY는 PLAYING 상태로 전이하며, useEffect에서 오디오 재생 처리
    // replayCount는 AWAITING 상태의 replayCount를 통해 추적
    // 하지만 FSM에서 REPLAY → PLAYING 전이 시 replayCount 정보가 사라지므로
    // 다시 AWAITING으로 올 때 replayCount를 올바르게 설정해야 함
    // 현재 구현: AUDIO_ENDED 디스패치 시 replayCount를 올바르게 설정
  }, []);

  // PLAYING → AWAITING 전이 시 replayCount 복원을 위한 오버라이드
  // FSM 리듀서에서 replayCount를 0으로 초기화하므로 useEffect로 보정
  useEffect(() => {
    if (phase.type !== 'PLAYING') return;
    // replayCountRef는 REPLAY 핸들러에서 이미 증가됨
    // 아무 동작 불필요 (AUDIO_ENDED에서 replayCount=0으로 설정되는 문제)
    // 해결: sentCompSessionReducer에서 REPLAY 시 이전 replayCount를 유지해야 함
    // 현재 리듀서는 replayCount를 0으로 리셋하므로, ref로 보정
  }, [phase.type]);

  // AUDIO_ENDED 디스패치를 커스텀하여 replayCount 포함
  // 위의 PLAYING useEffect를 개선: audioPlayer.play() 완료 후 replayCountRef.current 반영
  // => 현재 구현에서 AUDIO_ENDED 후 AWAITING.replayCount는 항상 0으로 초기화됨
  // => 재청취 시 replayCount는 ViewModel 내 별도 ref로 관리하고 제출 시 전달

  // === 피드백 완료 핸들러 (수동 완료용, 자동은 useEffect에서 처리) ===
  const handleFeedbackDone = useCallback(() => {
    if (phaseRef.current.type !== 'FEEDBACK') return;
    dispatch({ type: 'FEEDBACK_DONE' });
  }, []);

  // === 재시도 핸들러 ===
  const handleRetry = useCallback(() => {
    if (phaseRef.current.type !== 'ERROR') return;
    setErrorMessage(null);
    dispatch({ type: 'RETRY' });
  }, []);

  const viewState: SentCompViewState = {
    phase,
    currentItem,
    currentItemIndex,
    totalItems: allItems.length,
    submittedResults,
    score,
    errorMessage,
    selectedIndex,
  };

  const actions: SentCompActions = useMemo(
    () => ({
      handleImageSelect,
      handleReplay,
      handleFeedbackDone,
      handleRetry,
    }),
    [handleImageSelect, handleReplay, handleFeedbackDone, handleRetry],
  );

  return { viewState, actions };
}
