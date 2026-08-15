// 일일 연습 스트릭 (순수 도메인 로직)
//
// 혼자 매일 하는 적응형 흐름의 진행을 "이번 주 7일 점"으로 보여준다. 설계 원칙
// (plan-design-review 확정): 놓친 날은 **중립**으로 렌더한다 — 빨강·✗·"놓쳤어요"
// 없이. 병·피로·혼란을 눈에 보이는 실패로 만들지 않아야 고령 인지장애 솔로
// 사용자의 복귀를 막지 않는다. "N일 연속" 같은 압박 숫자도 두지 않는다.
//
// 주 경계는 월요일 시작(getQabTrend의 주차 집계와 동일 규칙).

/** 한 날의 스트릭 상태. */
export type DayStatus =
  | 'done' // 지난 날 + 완료
  | 'missed' // 지난 날 + 미완료(중립 렌더, 실패 아님)
  | 'today' // 오늘 + 아직 안 함
  | 'today-done' // 오늘 + 완료
  | 'future'; // 아직 오지 않은 날(잠금 아님, 점선)

export interface StreakDay {
  /** 요일 라벨 '월'..'일' */
  label: string;
  status: DayStatus;
  /** 스크린리더용 라벨. 놓친 날도 '쉼'으로 중립 표현('실패' 아님). */
  ariaLabel: string;
}

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const;

/** 로컬 타임존 기준 YYYY-MM-DD. (UTC 변환으로 날짜가 밀리지 않게 로컬로 만든다.) */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 그 주의 월요일 0시를 반환. */
function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // 월=0 ... 일=6
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  return mon;
}

/**
 * 이번 주(월~일) 스트릭 7일을 만든다.
 *
 * @param completedDates 세션을 완료한 날짜(YYYY-MM-DD, 로컬) 집합
 * @param today 기준 오늘(테스트 주입용, 기본 현재)
 */
export function buildWeekStreak(
  completedDates: ReadonlySet<string>,
  today: Date = new Date(),
): StreakDay[] {
  const monday = mondayOf(today);
  const todayYmd = toLocalYmd(today);

  return WEEKDAY_LABELS.map((label, i) => {
    const date = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + i,
    );
    const ymd = toLocalYmd(date);
    const done = completedDates.has(ymd);

    let status: DayStatus;
    let ariaLabel: string;
    if (ymd === todayYmd) {
      status = done ? 'today-done' : 'today';
      ariaLabel = done ? '오늘 완료' : '오늘';
    } else if (ymd > todayYmd) {
      status = 'future';
      ariaLabel = `${label}요일`;
    } else {
      status = done ? 'done' : 'missed';
      // 놓친 날은 '실패'가 아니라 '쉼' — 중립.
      ariaLabel = done ? `${label}요일 완료` : `${label}요일 쉼`;
    }
    return { label, status, ariaLabel };
  });
}
