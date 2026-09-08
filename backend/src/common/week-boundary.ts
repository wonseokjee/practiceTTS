/**
 * 주·일 버킷 경계식을 만드는 곳 — **여기 하나뿐이다.**
 *
 * ## 왜 헬퍼인가
 *
 * `getQabTrend` 한 쿼리 안에만 `date_trunc('week', …)`가 **네 번** 있었다
 * (select·where·groupBy·orderBy). 셋만 고쳐도 컴파일되고 테스트도 통과하는데,
 * 그러면 **버킷과 창의 기준점이 어긋나 첫 주와 마지막 주가 반쪽 데이터**가 된다.
 * 증상이 사나운 이유는 틀려도 숫자가 그럴듯하게 나오기 때문이다 — 보호자는 그
 * 숫자로 환자가 나아졌는지 판단하는데, 틀렸다는 신호가 어디에도 안 뜬다.
 *
 * ## 두 가지를 함께 다뤄야 하는 이유
 *
 * 1. **`date_trunc('week')`는 ISO 월요일 고정이다.** 타임존을 씌워도 월요일에
 *    잘린다. 일요일 시작(미국 관습)은 **식 자체**를 바꿔야 한다 — 하루 밀어
 *    자르고 되돌린다.
 * 2. **`created_at`은 `timestamptz`라 `date_trunc`가 서버 TZ로 해석한다.**
 *    코드 어디에도 TZ 설정이 없어 환경에 의존한다. 서버가 KST면 미국 환자의
 *    "오늘"이 KST 자정으로 잘려 현지 오전에 푼 문항이 전날로 집계된다.
 *
 * 마이그레이션 `align-timestamptz-and-indexes`가 남긴 교훈과 같은 계열이다:
 * *"KST면 9시간 전체가 밀린다."*
 */

/**
 * 시간 축의 기본값 — **`users` 컬럼 기본값과 같아야 한다**(M27).
 *
 * 행을 못 찾았을 때 쓴다. 값이 갈리면 "사용자를 못 찾은 경우"만 조용히 다른
 * 주에 묶여, 틀린 티가 안 나는 종류의 오차가 생긴다.
 */
export const DEFAULT_TIMEZONE = 'Asia/Seoul';
export const DEFAULT_WEEK_START = 1;

/** 주 시작 요일. **0=일요일 … 6=토요일** — JS `getDay()`·PG `EXTRACT(DOW)`와 같은 축. */
export const WEEK_START_MIN = 0;
export const WEEK_START_MAX = 6;

/**
 * IANA 타임존 이름만 통과시킨다 (`Asia/Seoul`, `America/Argentina/Buenos_Aires`,
 * `UTC`, `Etc/GMT+9`).
 *
 * 이 값은 결국 SQL 리터럴로 들어간다. 프로필에서 오는 값이라 **사용자가 정하는
 * 문자열**이고, 따옴표가 섞이면 인젝션이 된다. 파라미터 바인딩을 못 쓰는 자리가
 * 있어(`groupBy`·`orderBy`) 여기서 막는다.
 */
const IANA_TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export function assertTimezone(timezone: string): string {
  if (!IANA_TIMEZONE.test(timezone) || timezone.length > 64) {
    throw new Error(`허용되지 않는 타임존: ${JSON.stringify(timezone)}`);
  }
  return timezone;
}

export function assertWeekStart(weekStart: number): number {
  if (
    !Number.isInteger(weekStart) ||
    weekStart < WEEK_START_MIN ||
    weekStart > WEEK_START_MAX
  ) {
    throw new Error(`허용되지 않는 주 시작 요일: ${String(weekStart)}`);
  }
  return weekStart;
}

/**
 * `date_trunc('week')`를 원하는 요일에 맞추려면 며칠 밀어야 하는가.
 *
 * `date_trunc('week')`는 월요일(dow=1)에 자른다. `weekStart + shift ≡ 1 (mod 7)`이
 * 되도록 밀어 자른 뒤 되돌린다.
 *
 *   월요일 시작(1) → 0일  (지금 동작 그대로, 식이 안 바뀐다)
 *   일요일 시작(0) → 1일
 *   토요일 시작(6) → 2일
 */
export function weekShiftDays(weekStart: number): number {
  return (1 - assertWeekStart(weekStart) + 7) % 7;
}

/** `<expr> AT TIME ZONE '<tz>'` — timestamptz를 그 지역의 벽시계 시각으로 옮긴다. */
function atLocal(expr: string, timezone: string): string {
  return `(${expr} AT TIME ZONE '${assertTimezone(timezone)}')`;
}

/**
 * 주 버킷 — 컬럼을 **그 주의 시작(환자 로컬 벽시계)**으로 자른다.
 *
 * 결과는 timezone 없는 timestamp다. `to_char(…, 'YYYY-MM-DD')`로 라벨을 만들거나
 * `GROUP BY`에 그대로 쓴다.
 */
export function weekBucket(
  columnExpr: string,
  timezone: string,
  weekStart: number,
): string {
  const shift = weekShiftDays(weekStart);
  const local = atLocal(columnExpr, timezone);
  if (shift === 0) {
    return `date_trunc('week', ${local})`;
  }
  return `(date_trunc('week', ${local} + interval '${shift} days') - interval '${shift} days')`;
}

/**
 * 조회 창의 하한 — **버킷과 같은 기준점**으로 만든 `timestamptz`.
 *
 * 이걸 버킷과 따로 만들면(예전처럼 `date_trunc('week', now())`) 창이 서버 TZ·
 * 월요일 기준이 되어 **첫 주와 마지막 주가 반쪽**이 된다. 그래서 같은
 * {@link weekBucket}을 `now()`에 적용한 뒤 주를 빼고, 마지막에 다시
 * `AT TIME ZONE`으로 timestamptz로 되돌려 `created_at`과 같은 자로 비교한다.
 */
export function weekWindowStart(
  timezone: string,
  weekStart: number,
  weeksBack: number,
): string {
  if (!Number.isInteger(weeksBack) || weeksBack < 0) {
    throw new Error(`허용되지 않는 주 수: ${String(weeksBack)}`);
  }
  const bucketOfNow = weekBucket('now()', timezone, weekStart);
  const tz = assertTimezone(timezone);
  return `((${bucketOfNow} - make_interval(weeks => ${weeksBack})) AT TIME ZONE '${tz}')`;
}

/** 일 버킷 — 컬럼을 환자 로컬 벽시계의 그날 0시로 자른다. */
export function dayBucket(columnExpr: string, timezone: string): string {
  return `date_trunc('day', ${atLocal(columnExpr, timezone)})`;
}

/**
 * 일 조회 창의 하한. {@link weekWindowStart}와 같은 이유로 버킷과 짝을 맞춘다.
 */
export function dayWindowStart(timezone: string, daysBack: number): string {
  if (!Number.isInteger(daysBack) || daysBack < 0) {
    throw new Error(`허용되지 않는 일 수: ${String(daysBack)}`);
  }
  const tz = assertTimezone(timezone);
  return `((${dayBucket('now()', tz)} - make_interval(days => ${daysBack})) AT TIME ZONE '${tz}')`;
}
