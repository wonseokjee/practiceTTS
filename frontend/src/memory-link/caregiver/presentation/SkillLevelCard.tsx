// 보호자용 스킬 눈높이(적응 레벨) 카드
//
// 환자별×스킬별 적응 레벨(1~5)을 "지금 어느 눈높이에서 연습 중인지"로 보여준다.
// 설계 확정(plan-design-review): 성적표가 아니라 **방향**이다. 상태색(빨강/초록)·
// "낮다/못한다" 판단을 붙이지 않는다 — 눈높이는 난이도 조절값일 뿐, 등급이 아니다.
// 환자에겐 이 레벨을 노출하지 않는다(강등 비가시). 보호자에게만 담담히 보여준다.

import { useEffect, useState } from 'react';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { SkillLevels } from '../../patient/quiz/domain/QabResult.js';
import {
  LEVELED_SUBTESTS,
  NON_LEVELED_SUBTESTS,
  subtestLabel,
} from '../../patient/quiz/domain/qabSubtestLabels.js';

interface SkillLevelCardProps {
  /** 레벨 조회 함수(테스트 주입용). 없으면 quizApi.getSkillLevels. */
  fetchLevels?: () => Promise<SkillLevels>;
}

const MAX_LEVEL = 5;


type LoadState = 'loading' | 'ready' | 'error';

/** 눈높이 5단계 점 표시(현재 레벨까지 세이지, 나머지 테두리). danger 색 없음. */
function LevelDots({ level, label }: { level: number; label: string }) {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={`${label} 눈높이 ${clamped}단계 / ${MAX_LEVEL}`}
    >
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${
            i < clamped ? 'bg-primary' : 'border border-[#D8DAD6]'
          }`}
        />
      ))}
    </span>
  );
}

export function SkillLevelCard({ fetchLevels }: SkillLevelCardProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [levels, setLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    const run = fetchLevels ?? quizApi.getSkillLevels;
    run()
      .then((data) => {
        if (!alive) return;
        setLevels(data.levels);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [fetchLevels]);

  // 로딩/에러는 카드를 숨긴다(대시보드를 어지럽히지 않음).
  if (state !== 'ready') return null;

  return (
    <section
      className="mb-6 rounded-2xl border border-line-soft bg-white p-5"
      aria-label="스킬별 연습 눈높이"
    >
      <h2 className="mb-1 text-base font-bold text-ink-sage">연습 눈높이</h2>
      <p className="mb-4 text-sm text-muted-sage">
        스킬마다 지금 어느 난이도에서 연습 중인지예요. 잘하는 만큼 눈높이가
        올라가고, 어려우면 부드럽게 내려가 늘 알맞은 난이도로 맞춰져요.
      </p>

      {/*
        빠진 검사를 말해 준다.
        
        바로 위 '발화 검사 진행' 카드는 8개를 보여주는데 여기는 6개다. 이유를
        안 적어두면 보호자는 "이름대기가 빠졌네"로 읽는다 — 실제로는 그 검사에
        난이도 축이 없어서 눈높이라는 개념 자체가 성립하지 않는 것이다(E1).
        
        이름을 하드코딩하지 않고 목록에서 끌어온다. 검사가 비레벨로 바뀌거나
        축이 생겨 되돌아올 때 이 문장만 옛말이 되는 것을 막는다.

        조사를 안 쓰는 문장으로 짰다. 목록에서 이름을 끌어오면 마지막 낱말의
        받침이 그때그때 달라져 `은/는`이 틀어진다.
      */}
      {NON_LEVELED_SUBTESTS.length > 0 && (
        <p className="mb-4 text-sm text-muted-sage">
          난이도를 단계로 나눌 수 있는 검사만 여기 나와요. (
          {NON_LEVELED_SUBTESTS.map(subtestLabel).join(' · ')} 제외)
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {LEVELED_SUBTESTS.map((key) => {
          const label = subtestLabel(key);
          // 백엔드가 모든 스킬을 콜드스타트로 채워 보내므로 값은 항상 있다. 혹시
          // 누락되면 없는 레벨을 지어내지 않고 그 줄을 건너뛴다(조작 방지). 표시값은
          // 점·숫자·aria가 어긋나지 않게 한 번만 클램프한다.
          const raw = levels[key];
          if (raw === undefined) return null;
          const lvl = Math.max(1, Math.min(MAX_LEVEL, raw));
          return (
            <li key={key} className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-sage">{label}</span>
              <span className="flex items-center gap-2">
                <LevelDots level={lvl} label={label} />
                <span className="w-14 text-right text-sm tabular-nums text-muted-sage">
                  {lvl}단계
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
