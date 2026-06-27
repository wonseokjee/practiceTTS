import { useCallback, useEffect, useState } from 'react';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { EMOTION_TAG_LABELS } from '../domain/MemoryEntry.js';
import type { ScenarioStatus } from '../application/useMemoryEntries.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';

interface EntryDetailScreenProps {
  entryId: string;
  scenarioStatus: ScenarioStatus;
  onTriggerScenario: (id: string) => Promise<void>;
  onBack: () => void;
}

/**
 * 메모리 엔트리 상세 화면
 * - 엔트리 정보 표시
 * - 시나리오 생성 트리거 버튼
 * - 비즈니스 로직 없음 (상위 훅/콜백에 위임)
 */
export function EntryDetailScreen({
  entryId,
  scenarioStatus,
  onTriggerScenario,
  onBack,
}: EntryDetailScreenProps) {
  const [entry, setEntry] = useState<MemoryEntry | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntry = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await memoryEntryApi.getById(entryId);
      setEntry(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  // 시나리오 트리거 완료 후 엔트리 갱신
  useEffect(() => {
    if (scenarioStatus === 'done' && entry && !entry.hasScenario) {
      setEntry((prev) => (prev ? { ...prev, hasScenario: true } : prev));
    }
  }, [scenarioStatus, entry]);

  if (isLoading) {
    return (
      <div
        className="flex justify-center items-center min-h-[300px]"
        aria-live="polite"
        aria-label="로딩 중"
      >
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          aria-label="목록으로 돌아가기"
        >
          ← 돌아가기
        </button>
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"
        >
          {error ?? '메모리 엔트리를 찾을 수 없습니다.'}
        </div>
      </div>
    );
  }

  const dateLabel = new Date(entry.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const isScenarioPending = scenarioStatus === 'pending';
  const canTriggerScenario =
    entry.hasMaskedContext &&
    entry.targetWords.length > 0 &&
    !entry.hasScenario &&
    scenarioStatus !== 'pending';

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* 뒤로가기 */}
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors"
        aria-label="목록으로 돌아가기"
      >
        ← 목록으로
      </button>

      {/* 사진 */}
      {entry.photoUrl ? (
        <img
          src={entry.photoUrl}
          alt={`${dateLabel} 기억 사진`}
          className="w-full rounded-xl mb-4 max-h-80 object-cover"
        />
      ) : (
        <div className="w-full h-48 bg-gray-100 rounded-xl flex items-center justify-center mb-4">
          <span className="text-4xl text-gray-300" aria-hidden="true">📷</span>
        </div>
      )}

      {/* 기본 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <p className="text-xs text-gray-400 mb-3">{dateLabel}</p>

        {/* 장소 태그 */}
        {entry.locationTag && (
          <div className="mb-3">
            <dt className="text-xs text-gray-400 font-medium mb-1">장소</dt>
            <dd className="text-sm text-gray-700">{entry.locationTag}</dd>
          </div>
        )}

        {/* 사물 태그 */}
        {entry.objectTags && entry.objectTags.length > 0 && (
          <div className="mb-3">
            <dt className="text-xs text-gray-400 font-medium mb-1">사물</dt>
            <dd className="flex flex-wrap gap-1">
              {entry.objectTags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
                >
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        )}

        {/* 감정 태그 */}
        {entry.emotionTag && (
          <div className="mb-3">
            <dt className="text-xs text-gray-400 font-medium mb-1">감정</dt>
            <dd>
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-sm font-medium">
                {EMOTION_TAG_LABELS[entry.emotionTag]}
              </span>
            </dd>
          </div>
        )}

        {/* 목표 단어 */}
        {entry.targetWords.length > 0 && (
          <div>
            <dt className="text-xs text-gray-400 font-medium mb-1">
              훈련 목표 단어
            </dt>
            <dd className="flex flex-wrap gap-1">
              {entry.targetWords.map((word) => (
                <span
                  key={word}
                  className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium"
                >
                  {word}
                </span>
              ))}
            </dd>
          </div>
        )}
      </div>

      {/* AI 처리 상태 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">AI 처리 상태</h3>
        <div className="flex flex-col gap-2">
          <StatusBadge
            label="이미지 분석"
            isDone={entry.hasMaskedContext}
            pendingText={!entry.locationTag ? 'AI 분석 대기 중' : '분석 완료'}
          />
          <StatusBadge
            label="시나리오 생성"
            isDone={entry.hasScenario}
            pendingText={
              !entry.hasMaskedContext ? '이미지 분석 후 가능' : '시나리오 미생성'
            }
          />
        </div>
      </div>

      {/* 시나리오 생성 버튼 */}
      {scenarioStatus === 'error' && (
        <div
          role="alert"
          className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          시나리오 생성에 실패했습니다. 다시 시도해주세요.
        </div>
      )}

      {!entry.hasScenario && (
        <button
          type="button"
          onClick={() => void onTriggerScenario(entry.id)}
          disabled={!canTriggerScenario || isScenarioPending}
          className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
          aria-label={
            isScenarioPending ? '시나리오 생성 중' : '시나리오 생성하기'
          }
          aria-busy={isScenarioPending}
        >
          {isScenarioPending ? '시나리오 생성 중...' : '훈련 시나리오 생성'}
        </button>
      )}

      {entry.hasScenario && (
        <div className="w-full py-3 bg-green-50 text-green-700 rounded-xl font-medium text-center border border-green-200">
          훈련 시나리오 준비 완료
        </div>
      )}

      {/* 이미지 분석 미완료 안내 */}
      {!entry.hasMaskedContext && (
        <p className="mt-2 text-xs text-gray-400 text-center">
          AI 이미지 분석이 완료되면 시나리오를 생성할 수 있습니다
        </p>
      )}
    </div>
  );
}

// ─── 상태 배지 컴포넌트 ────────────────────────────────────────

interface StatusBadgeProps {
  label: string;
  isDone: boolean;
  pendingText: string;
}

function StatusBadge({ label, isDone, pendingText }: StatusBadgeProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${
          isDone
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {isDone ? '완료' : pendingText}
      </span>
    </div>
  );
}

