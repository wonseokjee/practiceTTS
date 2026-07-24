/**
 * 단어 이해 (WordComp) 검사 ViewModel 훅
 *
 * Composition Root: 이 훅 내부에서 모든 의존성을 생성한다.
 *
 * FSM 상태 전이 흐름 (피드백 없음):
 * 마운트 → LOADING(문항+오디오 로드) → PLAYING → AWAITING
 * → SUBMITTING → TRANSITIONING(0.5초) → LOADING(반복) | COMPLETED
 *
 * 재청취: AWAITING + REPLAY → PLAYING → AWAITING (replayCount 갱신)
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
  wordCompSessionReducer,
  type WordCompPhase,
} from '../wordCompSessionReducer.js';
import type { WordComprehensionItemDTO } from '../../application/dtos/WordComprehensionItemDTO.js';
import type { SessionSummaryDTO } from '../../application/dtos/SessionSummaryDTO.js';
import { HtmlAudioPlayer } from '../../../../shared/infrastructure/HtmlAudioPlayer.js';
import { JsonWordComprehensionItemRepository } from '../../infrastructure/repositories/JsonWordComprehensionItemRepository.js';
import { LocalStorageWordComprehensionRepository } from '../../infrastructure/repositories/LocalStorageWordComprehensionRepository.js';
import { StartWordComprehensionSessionUseCase } from '../../application/useCases/StartWordComprehensionSessionUseCase.js';
import { SubmitItemAnswerUseCase } from '../../application/useCases/SubmitItemAnswerUseCase.js';
import { CalculateSessionSummaryUseCase } from '../../application/useCases/CalculateSessionSummaryUseCase.js';
import { WordComprehensionAppError, WcAppErrorCode } from '../../application/errors/WordComprehensionAppError.js';
import wordCompItemsData from '../../infrastructure/data/wordComprehensionItems.json';
import {
  ServerAssessmentResultSubmitter,
  createAssessmentSessionToken,
  toQabResults,
} from '../../../shared/infrastructure/AssessmentResultSubmitter.js';

const TRANSITION_DURATION_MS = 500;

function mapErrorToMessage(error: unknown): string {
  if (error instanceof WordComprehensionAppError) {
    switch (error.code) {
      case WcAppErrorCode.ITEM_LOAD_FAILED:
        return '문항 데이터를 불러오지 못했습니다. 다시 시도해주세요.';
      case WcAppErrorCode.AUDIO_PLAY_FAILED:
        return '음성을 재생할 수 없습니다. 기기 음량을 확인해주세요.';
      case WcAppErrorCode.SESSION_NOT_FOUND:
        return '검사 세션을 찾을 수 없습니다. 검사를 다시 시작해주세요.';
      case WcAppErrorCode.INVALID_CHOICE:
        return '선택된 항목을 처리할 수 없습니다. 다시 시도해주세요.';
      case WcAppErrorCode.ALREADY_ANSWERED:
        return '이미 답변한 문항입니다.';
      case WcAppErrorCode.INVALID_PATIENT:
        return '환자 정보가 유효하지 않습니다.';
    }
  }
  if (error instanceof Error) return error.message;
  return '오류가 발생했습니다. 다시 시도해주세요.';
}

export interface WordCompViewState {
  phase: WordCompPhase;
  currentItemIndex: number;
  totalItems: number;
  currentItem: WordComprehensionItemDTO | null;
  isSelectable: boolean;
  isAudioPlaying: boolean;
  replayCount: number;
  summary: SessionSummaryDTO | null;
  errorMessage: string | null;
}

export interface WordCompViewActions {
  onChoiceSelected: (choiceId: string) => void;
  onReplayRequested: () => void;
  onRetry: () => void;
}

// JSON 파일 타입 정의 (distractorType이 null | string으로 올 수 있음)
interface RawChoice {
  choiceId: string;
  word: string;
  imageUrl: string;
  isCorrect: boolean;
  distractorType: string | null;
}
interface RawItem {
  itemId: string;
  targetWord: string;
  targetAudioUrl: string;
  category: string;
  choices: RawChoice[];
}

export function useWordComprehensionViewModel(
  patientId: string,
  onComplete?: (summary: SessionSummaryDTO) => void,
): { viewState: WordCompViewState; actions: WordCompViewActions } {
  const [phase, dispatch] = useReducer(wordCompSessionReducer, { type: 'LOADING' });
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [currentItem, setCurrentItem] = useState<WordComprehensionItemDTO | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [summary, setSummary] = useState<SessionSummaryDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stale closure 방지 refs
  const phaseRef = useRef<WordCompPhase>({ type: 'LOADING' });
  const currentItemRef = useRef<WordComprehensionItemDTO | null>(null);
  const currentItemIndexRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const replayCountRef = useRef(0);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { currentItemRef.current = currentItem; }, [currentItem]);
  useEffect(() => { currentItemIndexRef.current = currentItemIndex; }, [currentItemIndex]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // === Composition Root ===
  const audioPlayer = useMemo(() => new HtmlAudioPlayer(), []);

  const itemRepository = useMemo(() => {
    const rawItems = (wordCompItemsData as { items: RawItem[] }).items;
    // JSON의 null → undefined 변환 (도메인 타입 준수)
    const items = rawItems.map((item) => ({
      ...item,
      choices: item.choices.map((c) => ({
        ...c,
        distractorType: (c.distractorType ?? undefined) as
          | 'semantic'
          | 'phonemic'
          | 'unrelated'
          | undefined,
      })),
    }));
    return new JsonWordComprehensionItemRepository(items);
  }, []);

  const sessionRepository = useMemo(
    () => new LocalStorageWordComprehensionRepository(),
    [],
  );

  const startUseCase = useMemo(
    () => new StartWordComprehensionSessionUseCase(itemRepository, sessionRepository),
    [itemRepository, sessionRepository],
  );

  const submitUseCase = useMemo(
    () => new SubmitItemAnswerUseCase(sessionRepository, itemRepository),
    [sessionRepository, itemRepository],
  );

  // 재청취는 onReplayRequested에서 audioPlayer를 직접 사용한다
  // (ReplayAudioUseCase 미사용 — 도메인 use case 경유 없이 load/play 직접 제어)
  const resultSubmitter = useMemo(
    () => new ServerAssessmentResultSubmitter(),
    [],
  );

  const summaryUseCase = useMemo(
    () => new CalculateSessionSummaryUseCase(sessionRepository),
    [sessionRepository],
  );

  // === LOADING 상태: 세션 시작 또는 다음 문항 로드 ===
  useEffect(() => {
    if (phase.type !== 'LOADING') return;

    let cancelled = false;

    const load = async () => {
      try {
        // 첫 로딩: 세션 시작
        if (sessionIdRef.current === null) {
          const response = await startUseCase.execute({ patientId });
          if (cancelled) return;

          sessionIdRef.current = response.sessionId;
          setTotalItems(response.totalItems);
          setCurrentItem(response.firstItem);
          setCurrentItemIndex(0);
          replayCountRef.current = 0;

          // 오디오 로드
          try {
            await audioPlayer.load(response.firstItem.targetAudioUrl);
          } catch {
            console.warn('[WordComp] 오디오 로드 실패:', response.firstItem.targetAudioUrl);
          }

          if (cancelled) return;
          dispatch({ type: 'ITEMS_LOADED' });
        } else {
          // 이후 문항: currentItem이 이미 SUBMITTING 결과로 설정됨
          const item = currentItemRef.current;
          if (item === null) {
            dispatch({ type: 'ERROR_OCCURRED', message: '다음 문항을 불러오지 못했습니다.' });
            return;
          }

          try {
            await audioPlayer.load(item.targetAudioUrl);
          } catch {
            console.warn('[WordComp] 오디오 로드 실패:', item.targetAudioUrl);
          }

          if (cancelled) return;
          dispatch({ type: 'ITEMS_LOADED' });
        }
      } catch (err) {
        if (cancelled) return;
        const message = mapErrorToMessage(err);
        setErrorMessage(message);
        dispatch({ type: 'ERROR_OCCURRED', message });
      }
    };

    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.type]);

  // === PLAYING 상태: 오디오 재생 ===
  useEffect(() => {
    if (phase.type !== 'PLAYING') return;

    let cancelled = false;

    const play = async () => {
      try {
        const endTimestamp = await audioPlayer.play();
        if (cancelled) return;
        dispatch({ type: 'AUDIO_ENDED', audioEndTimestamp: endTimestamp });
      } catch {
        if (cancelled) return;
        const fallback = performance.now();
        console.warn('[WordComp] 오디오 재생 실패. 현재 타임스탬프 사용.');
        dispatch({ type: 'AUDIO_ENDED', audioEndTimestamp: fallback });
      }
    };

    void play();
    return () => {
      cancelled = true;
      audioPlayer.stop();
    };
  }, [phase.type, audioPlayer]);

  // === TRANSITIONING 상태: 0.5초 후 다음 문항으로 ===
  useEffect(() => {
    if (phase.type !== 'TRANSITIONING') return;

    const timerId = setTimeout(() => {
      replayCountRef.current = 0;
      dispatch({ type: 'TRANSITION_DONE' });
    }, TRANSITION_DURATION_MS);

    return () => clearTimeout(timerId);
  }, [phase.type]);

  // === COMPLETED 상태: 요약 계산 ===
  useEffect(() => {
    if (phase.type !== 'COMPLETED') return;
    if (sessionIdRef.current === null) return;

    const finalize = async () => {
      try {
        const result = await summaryUseCase.execute(sessionIdRef.current!);
        setSummary(result);

        // 서버 저장 — 보호자의 회복 추이에 반영된다. 로컬에만 두면 캐시를
        // 지우는 순간 임상 기록이 사라지고 보호자가 볼 수 없다.
        // 실패해도 던지지 않는다(검사는 이미 끝났다).
        const session = await sessionRepository.loadSession(
          sessionIdRef.current!,
        );
        if (session !== null) {
          await resultSubmitter.submit({
            sessionToken: createAssessmentSessionToken(),
            results: toQabResults(
              'word',
              session.itemResults.map((item) => ({
                itemRef: item.itemId,
                isCorrect: item.score.isCorrect,
              })),
            ),
          });
        }

        onCompleteRef.current?.(result);
      } catch (err) {
        console.error('[WordComp] 요약 계산 실패:', err);
        setErrorMessage(mapErrorToMessage(err));
      }
    };

    void finalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.type]);

  // === 선택지 선택 핸들러 ===
  const onChoiceSelected = useCallback(
    (choiceId: string) => {
      if (phaseRef.current.type !== 'AWAITING') return;

      const currentPhase = phaseRef.current;
      const item = currentItemRef.current;
      if (item === null || sessionIdRef.current === null) return;

      const selectionTimestamp = performance.now();
      dispatch({ type: 'CHOICE_SELECTED' });

      void (async () => {
        try {
          const response = await submitUseCase.execute({
            sessionId: sessionIdRef.current!,
            itemId: item.itemId,
            choiceId,
            audioEndTimestamp: currentPhase.audioEndTimestamp,
            selectionTimestamp,
            replayCount: replayCountRef.current,
          });

          // 다음 문항을 미리 설정
          if (response.nextItem !== null) {
            setCurrentItem(response.nextItem);
            setCurrentItemIndex((prev) => prev + 1);
          }

          dispatch({
            type: 'ANSWER_SUBMITTED',
            sessionStatus: response.sessionStatus,
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
  const onReplayRequested = useCallback(() => {
    if (phaseRef.current.type !== 'AWAITING') return;

    const item = currentItemRef.current;
    if (item === null) return;

    replayCountRef.current += 1;
    dispatch({ type: 'REPLAY' });

    // PLAYING useEffect에서 재생 처리
    // ReplayAudioUseCase는 내부적으로 load+play를 수행하므로
    // 여기서는 audioPlayer에 새 URL 로드가 필요함
    void audioPlayer.load(item.targetAudioUrl).catch(() => {
      console.warn('[WordComp] 재청취 로드 실패:', item.targetAudioUrl);
    });
  }, [audioPlayer]);

  // === 재시도 핸들러 ===
  const onRetry = useCallback(() => {
    if (phaseRef.current.type !== 'ERROR') return;
    setErrorMessage(null);
    dispatch({ type: 'RETRY' });
  }, []);

  const isSelectable = phase.type === 'AWAITING';
  const isAudioPlaying = phase.type === 'PLAYING';
  const replayCount =
    phase.type === 'AWAITING' ? replayCountRef.current : 0;

  const viewState: WordCompViewState = {
    phase,
    currentItemIndex,
    totalItems,
    currentItem,
    isSelectable,
    isAudioPlaying,
    replayCount,
    summary,
    errorMessage,
  };

  const actions: WordCompViewActions = useMemo(
    () => ({ onChoiceSelected, onReplayRequested, onRetry }),
    [onChoiceSelected, onReplayRequested, onRetry],
  );

  return { viewState, actions };
}
