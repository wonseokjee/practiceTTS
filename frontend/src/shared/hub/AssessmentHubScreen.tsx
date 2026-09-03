/**
 * 검사 허브 화면
 *
 * LOC 완료 후 진입. SentComp / WordComp 선택 가능.
 * 두 검사 모두 완료 시 세션 종료 유도 메시지 표시.
 */

import type React from 'react';
import { useSessionContext } from '../session/SessionContext.js';
import { AssessmentCard } from './AssessmentCard.js';

type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}

interface AssessmentHubScreenProps {
  completedAssessments: CompletedAssessments;
  onSelect: (id: AssessmentId) => void;
}

interface HubAssessmentConfig {
  id: AssessmentId;
  title: string;
  subtitle: string;
  description: string;
}

const ASSESSMENT_CONFIGS: HubAssessmentConfig[] = [
  {
    id: 'sentComp',
    title: '문장 이해',
    subtitle: 'QAB 하위검사 4번',
    description: '복잡한 구문 이해력 평가',
  },
  {
    id: 'wordComp',
    title: '단어 이해',
    subtitle: 'QAB 하위검사 3번',
    description: '단어 수준의 청각적 이해 평가',
  },
];

export function AssessmentHubScreen({
  completedAssessments,
  onSelect,
}: AssessmentHubScreenProps): React.JSX.Element {
  const { session, endSession } = useSessionContext();
  const allCompleted = completedAssessments.sentComp && completedAssessments.wordComp;

  return (
    <div className="h-full bg-canvas overflow-y-auto p-4">
      <div className="max-w-md mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 pt-2">
          <div>
            <p className="text-xs text-muted mb-0.5">환자 ID</p>
            <p className="text-sm font-semibold text-ink">{session?.patientId ?? '-'}</p>
          </div>
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-muted bg-white border border-line rounded-xl hover:bg-primary-light transition-colors"
            onClick={endSession}
          >
            세션 종료
          </button>
        </div>

        {/* 타이틀 */}
        <h1 className="text-xl font-bold text-ink mb-1">검사 선택</h1>
        <p className="text-sm text-muted mb-6">수행할 검사를 선택하세요</p>

        {/* LOC 완료 배너 */}
        <div className="bg-surface-dim rounded-2xl p-4 mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted">의식 수준 (LOC)</p>
            <p className="text-xs text-muted">QAB 하위검사 1번</p>
          </div>
          <span className="text-xs font-medium text-muted bg-line px-2 py-0.5 rounded-full">
            완료
          </span>
        </div>

        {/* 검사 카드 목록 */}
        <div className="flex flex-col gap-3">
          {ASSESSMENT_CONFIGS.map((config) => (
            <AssessmentCard
              key={config.id}
              title={config.title}
              subtitle={config.subtitle}
              description={config.description}
              isCompleted={completedAssessments[config.id]}
              onStart={() => onSelect(config.id)}
            />
          ))}
        </div>

        {/* 전체 완료 메시지 */}
        {allCompleted && (
          <div className="mt-6 bg-primary-light border border-[#c8e6d9] rounded-2xl p-4 text-center">
            <p className="text-sm font-medium text-primary">
              모든 검사가 완료되었습니다.
            </p>
            <p className="text-xs text-primary mt-1">세션을 종료해 주세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
