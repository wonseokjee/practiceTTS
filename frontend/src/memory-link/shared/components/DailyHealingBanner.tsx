// 오늘의 치유 메시지 배너 (Phase 6 Pattern 2) — 환자·보호자 대시보드 상단 공통.
//
// 같은 날 양측이 같은 메시지를 본다("함께 읽는 메시지" 컨셉).
// 조회 실패/빈 풀이면 조용히 렌더하지 않는다 — 대시보드 진입을 막지 않는다.

import { useEffect, useRef, useState } from 'react';
import { healingMessageApi } from '../HealingMessageApi.js';
import type { IHealingMessageApi } from '../HealingMessageApi.js';

interface DailyHealingBannerProps {
  /** 테스트용 주입 (선택) */
  api?: IHealingMessageApi;
}

export function DailyHealingBanner({ api }: DailyHealingBannerProps) {
  const apiRef = useRef<IHealingMessageApi>(api ?? healingMessageApi);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRef.current
      .fetchToday()
      .then((m) => {
        if (!cancelled) setText(m.text);
      })
      .catch(() => {
        // 실패는 무시 — 배너는 부가 요소이므로 대시보드를 막지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (text === null) {
    return null;
  }

  return (
    <section
      className="font-pretendard mb-6 flex items-start gap-3 rounded-xl bg-primary-light p-5"
      role="note"
      aria-label="오늘의 메시지"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        🌿
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary">
          오늘의 메시지
        </p>
        <p className="mt-1 text-lg font-medium leading-relaxed text-ink-sage">
          {text}
        </p>
      </div>
    </section>
  );
}
