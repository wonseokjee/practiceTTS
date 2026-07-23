// 풀 수 있는 퀴즈 목록 조회 훅
//
// GET /quiz/sets?status=ready&limit=20 결과를 로드/재로드한다.
// deps 주입으로 테스트 시 IQuizApi Mock 교체 가능.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizSetSummary } from '../domain/Quiz.js';
import { quizApi } from '../infrastructure/QuizApi.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import { toQuizErrorInfo } from './quizError.js';

/** 목록 조회 기본 limit */
const DEFAULT_LIMIT = 20;

export interface UseQuizListReturn {
  items: QuizSetSummary[];
  isLoading: boolean;
  error: string | null;
  /** 목록을 다시 불러온다 */
  reload: () => Promise<void>;
}

/** 선택적 의존성 주입 (테스트 용이성) */
export interface UseQuizListDeps {
  quizApi?: IQuizApi;
}

/**
 * 'ready' 상태의 퀴즈 세트 목록을 조회하는 훅.
 *
 * @param deps 테스트 시 의존성 주입 (선택)
 */
export function useQuizList(deps?: UseQuizListDeps): UseQuizListReturn {
  // 의존성은 ref에 보관해 매 렌더 새 객체로 주입돼도 effect가 재실행되지 않게 안정화.
  const apiRef = useRef<IQuizApi>(deps?.quizApi ?? quizApi);

  const [items, setItems] = useState<QuizSetSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiRef.current.listSets({
        status: 'ready',
        limit: DEFAULT_LIMIT,
      });
      setItems(result);
    } catch (err) {
      setError(toQuizErrorInfo(err).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, isLoading, error, reload };
}
