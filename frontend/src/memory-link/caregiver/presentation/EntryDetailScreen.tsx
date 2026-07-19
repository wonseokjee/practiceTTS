import { useCallback, useEffect, useState } from 'react';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { EMOTION_TAG_LABELS } from '../domain/MemoryEntry.js';
import type { ScenarioStatus } from '../application/useMemoryEntries.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';
import { AuthedImage } from '../../shared/AuthedImage.js';

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

  // 목표 단어 편집 상태
  const [localWords, setLocalWords] = useState<string[]>([]);
  const [wordDraft, setWordDraft] = useState<string>('');
  const [isSavingWords, setIsSavingWords] = useState<boolean>(false);
  const [wordsError, setWordsError] = useState<string | null>(null);

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

  // 엔트리 로드/갱신 시 목표 단어 로컬 상태 동기화
  useEffect(() => {
    if (entry) {
      setLocalWords(entry.targetWords);
    }
  }, [entry]);

  const MAX_TARGET_WORDS = 3;

  const addWord = () => {
    const w = wordDraft.trim();
    if (w && localWords.length < MAX_TARGET_WORDS && !localWords.includes(w)) {
      setLocalWords([...localWords, w]);
    }
    setWordDraft('');
  };

  const removeWord = (word: string) => {
    setLocalWords(localWords.filter((w) => w !== word));
  };

  const saveWords = async () => {
    setIsSavingWords(true);
    setWordsError(null);
    try {
      const updated = await memoryEntryApi.update(entryId, {
        targetWords: localWords,
      });
      setEntry(updated);
    } catch (err) {
      setWordsError(extractErrorMessage(err));
    } finally {
      setIsSavingWords(false);
    }
  };

  const wordsDirty = entry
    ? JSON.stringify(localWords) !== JSON.stringify(entry.targetWords)
    : false;

  if (isLoading) {
    return (
      <div
        className="flex justify-center items-center min-h-[300px]"
        aria-live="polite"
        aria-label="로딩 중"
      >
        <div className="text-[#9AA09B] text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 text-sm text-[#6B6560] hover:text-[#1A1916] flex items-center gap-1"
          aria-label="목록으로 돌아가기"
        >
          ← 돌아가기
        </button>
        <div
          role="alert"
          className="p-4 bg-[#C94040]/10 border border-[#C94040]/30 rounded-2xl text-[#7A2E15] text-sm"
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
        className="mb-4 text-sm text-[#6B6560] hover:text-[#1A1916] flex items-center gap-1 transition-colors"
        aria-label="목록으로 돌아가기"
      >
        ← 목록으로
      </button>

      {/* 사진 */}
      {entry.photoUrl ? (
        <AuthedImage
          src={entry.photoUrl}
          alt={`${dateLabel} 기억 사진`}
          className="w-full rounded-2xl mb-4 max-h-80 object-cover"
        />
      ) : (
        <div className="w-full h-48 bg-[#EBF4F0]/50 rounded-2xl flex items-center justify-center mb-4">
          <span className="text-4xl text-[#9AA09B]" aria-hidden="true">📷</span>
        </div>
      )}

      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl border border-[#E8E4DC] p-4 mb-4">
        <p className="text-xs text-[#9AA09B] mb-3">{dateLabel}</p>

        {/* 장소 태그 */}
        {entry.locationTag && (
          <div className="mb-3">
            <dt className="text-xs text-[#9AA09B] font-medium mb-1">장소</dt>
            <dd className="text-sm text-[#1A1916]">{entry.locationTag}</dd>
          </div>
        )}

        {/* 사물 태그 */}
        {entry.objectTags && entry.objectTags.length > 0 && (
          <div className="mb-3">
            <dt className="text-xs text-[#9AA09B] font-medium mb-1">사물</dt>
            <dd className="flex flex-wrap gap-1">
              {entry.objectTags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-[#F2F1EC] text-[#6B6560] rounded-full text-xs"
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
            <dt className="text-xs text-[#9AA09B] font-medium mb-1">감정</dt>
            <dd>
              <span className="px-2 py-0.5 bg-[#EBF4F0] text-[#2D6A56] rounded-full text-sm font-medium">
                {EMOTION_TAG_LABELS[entry.emotionTag]}
              </span>
            </dd>
          </div>
        )}

      </div>

      {/* 훈련 목표 단어 편집 — 시나리오 생성의 필수 입력 (1~3개) */}
      <div className="bg-white rounded-2xl border border-[#E8E4DC] p-4 mb-4">
        <h3 className="text-sm font-medium text-[#1A1916] mb-1">
          훈련 목표 단어
        </h3>
        <p className="text-xs text-[#9AA09B] mb-3">
          환자분이 스스로 떠올릴 단어예요. 1~3개를 등록해야 시나리오를 생성할 수
          있어요.
        </p>

        {localWords.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {localWords.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 px-3 py-1 bg-[#EBF4F0] text-[#2D6A56] rounded-full text-sm font-medium"
              >
                {word}
                <button
                  type="button"
                  onClick={() => removeWord(word)}
                  className="text-[#9fd0bc] hover:text-[#C94040]"
                  aria-label={`${word} 삭제`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {localWords.length < MAX_TARGET_WORDS && (
          <div className="flex gap-2">
            <input
              type="text"
              value={wordDraft}
              onChange={(e) => setWordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addWord();
                }
              }}
              placeholder="예: 바다 (입력 후 추가)"
              className="flex-1 rounded-full border border-[#E8E4DC] bg-[#F7F6F3] px-4 py-2 text-sm focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56]"
            />
            <button
              type="button"
              onClick={addWord}
              className="rounded-full bg-[#EBF4F0] px-4 text-sm font-medium text-[#2D6A56] hover:bg-[#dcebe4]"
            >
              추가
            </button>
          </div>
        )}

        {wordsError && (
          <p role="alert" className="mt-2 text-xs text-[#C94040]">
            {wordsError}
          </p>
        )}

        {wordsDirty && (
          <button
            type="button"
            onClick={() => void saveWords()}
            disabled={isSavingWords}
            className="mt-3 w-full min-h-[44px] py-2 bg-[#2D6A56] text-white rounded-full text-sm font-medium hover:bg-[#1F5240] disabled:bg-[#E8E4DC] disabled:text-[#9AA09B] transition-colors"
          >
            {isSavingWords ? '저장 중...' : '목표 단어 저장'}
          </button>
        )}
      </div>

      {/* AI 처리 상태 */}
      <div className="bg-white rounded-2xl border border-[#E8E4DC] p-4 mb-4">
        <h3 className="text-sm font-medium text-[#1A1916] mb-3">AI 처리 상태</h3>
        <div className="flex flex-col gap-2">
          <StatusBadge
            label="기억 분석"
            isDone={entry.hasMaskedContext}
            pendingText="AI 분석 대기 중"
          />
          <StatusBadge
            label="시나리오 생성"
            isDone={entry.hasScenario}
            pendingText={
              !entry.hasMaskedContext ? '기억 분석 후 가능' : '시나리오 미생성'
            }
          />
        </div>
      </div>

      {/* 시나리오 생성 버튼 */}
      {scenarioStatus === 'error' && (
        <div
          role="alert"
          className="mb-3 p-3 bg-[#C94040]/10 border border-[#C94040]/30 rounded-2xl text-[#7A2E15] text-sm"
        >
          시나리오 생성에 실패했습니다. 다시 시도해주세요.
        </div>
      )}

      {!entry.hasScenario && (
        <button
          type="button"
          onClick={() => void onTriggerScenario(entry.id)}
          disabled={!canTriggerScenario || isScenarioPending}
          className="w-full min-h-[52px] py-3 bg-[#E07B54] text-white rounded-full font-medium hover:bg-[#c96a45] disabled:bg-[#E8E4DC] disabled:text-[#9AA09B] transition-colors"
          aria-label={
            isScenarioPending ? '시나리오 생성 중' : '시나리오 생성하기'
          }
          aria-busy={isScenarioPending}
        >
          {isScenarioPending ? '시나리오 생성 중...' : '훈련 시나리오 생성'}
        </button>
      )}

      {entry.hasScenario && (
        <div className="w-full py-3 bg-[#EBF4F0] text-[#2D6A56] rounded-full font-medium text-center border border-[#2D6A56]/25">
          훈련 시나리오 준비 완료
        </div>
      )}

      {/* 컨텍스트 분석 미완료 안내 (사진 또는 기록 분석 후 시나리오 가능) */}
      {!entry.hasMaskedContext && (
        <p className="mt-2 text-xs text-[#9AA09B] text-center">
          AI가 기록하신 내용{entry.photoUrl ? '과 사진' : ''}을 분석하면 시나리오를
          생성할 수 있습니다
        </p>
      )}

      {/* 분석은 됐지만 목표 단어가 없어 시나리오 생성이 막힌 경우 안내 */}
      {entry.hasMaskedContext &&
        !entry.hasScenario &&
        entry.targetWords.length === 0 && (
          <p className="mt-2 text-xs text-[#9AA09B] text-center">
            목표 단어를 1개 이상 등록·저장하면 시나리오를 생성할 수 있어요
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
      <span className="text-sm text-[#6B6560]">{label}</span>
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${
          isDone
            ? 'bg-[#EBF4F0] text-[#2D6A56]'
            : 'bg-[#F2F1EC] text-[#6B6560]'
        }`}
      >
        {isDone ? '완료' : pendingText}
      </span>
    </div>
  );
}
