import {
  assertTimezone,
  assertWeekStart,
  dayBucket,
  dayWindowStart,
  weekBucket,
  weekShiftDays,
  weekWindowStart,
} from './week-boundary';

/**
 * 주 경계 헬퍼 단위 테스트.
 *
 * 여기서 고정하는 것은 **식의 모양**이다. 그 식을 Postgres가 정말 그렇게
 * 해석하는지는 유닛이 못 본다 — 그건 통합 테스트(quiz.service.week-boundary)가
 * 맡는다. 둘을 나눈 이유는 `date_trunc('week')`가 정말 월요일에 자르는지,
 * `AT TIME ZONE`을 씌운 뒤에도 그러한지는 **Postgres만 알기** 때문이다.
 */
describe('week-boundary', () => {
  describe('weekShiftDays', () => {
    it('월요일 시작은 밀지 않는다 (지금 동작 그대로)', () => {
      expect(weekShiftDays(1)).toBe(0);
    });

    it('일요일 시작은 하루 민다', () => {
      expect(weekShiftDays(0)).toBe(1);
    });

    it('토요일 시작은 이틀 민다', () => {
      expect(weekShiftDays(6)).toBe(2);
    });

    it('모든 요일이 0~6일 안에서 민다', () => {
      for (let d = 0; d <= 6; d += 1) {
        const shift = weekShiftDays(d);
        expect(shift).toBeGreaterThanOrEqual(0);
        expect(shift).toBeLessThanOrEqual(6);
        // 민 뒤에는 월요일(1)에 떨어져야 date_trunc('week')가 맞는 자리를 자른다
        expect((d + shift) % 7).toBe(1);
      }
    });
  });

  describe('입력 검증', () => {
    it('IANA 이름이 아닌 타임존을 거부한다', () => {
      expect(() =>
        assertTimezone("Asia/Seoul'; DROP TABLE users; --"),
      ).toThrow();
      expect(() => assertTimezone('')).toThrow();
      expect(() => assertTimezone('Asia/Seoul ')).toThrow();
    });

    it('정상 IANA 이름을 통과시킨다', () => {
      expect(assertTimezone('Asia/Seoul')).toBe('Asia/Seoul');
      expect(assertTimezone('America/Los_Angeles')).toBe('America/Los_Angeles');
      expect(assertTimezone('America/Argentina/Buenos_Aires')).toBe(
        'America/Argentina/Buenos_Aires',
      );
      expect(assertTimezone('UTC')).toBe('UTC');
      expect(assertTimezone('Etc/GMT+9')).toBe('Etc/GMT+9');
    });

    it('범위 밖 주 시작 요일을 거부한다', () => {
      expect(() => assertWeekStart(7)).toThrow();
      expect(() => assertWeekStart(-1)).toThrow();
      expect(() => assertWeekStart(1.5)).toThrow();
    });
  });

  describe('weekBucket', () => {
    it('월요일 시작이면 미는 항이 아예 없다', () => {
      const sql = weekBucket('r.created_at', 'Asia/Seoul', 1);
      expect(sql).toBe(
        "date_trunc('week', (r.created_at AT TIME ZONE 'Asia/Seoul'))",
      );
      expect(sql).not.toContain('interval');
    });

    it('일요일 시작이면 하루 밀어 자르고 되돌린다', () => {
      const sql = weekBucket('r.created_at', 'America/Los_Angeles', 0);
      expect(sql).toBe(
        "(date_trunc('week', (r.created_at AT TIME ZONE 'America/Los_Angeles')" +
          " + interval '1 days') - interval '1 days')",
      );
    });

    it('타임존이 반드시 들어간다 — 서버 TZ에 기대지 않는다', () => {
      expect(weekBucket('r.created_at', 'America/New_York', 1)).toContain(
        "AT TIME ZONE 'America/New_York'",
      );
    });
  });

  describe('weekWindowStart', () => {
    it('창의 하한이 버킷과 같은 식으로 만들어진다', () => {
      // 이게 어긋나면 첫 주·마지막 주가 반쪽 데이터가 된다.
      const bucket = weekBucket('now()', 'America/Los_Angeles', 0);
      expect(weekWindowStart('America/Los_Angeles', 0, 7)).toContain(bucket);
    });

    it('마지막에 timestamptz로 되돌린다 (created_at과 같은 자로 비교)', () => {
      expect(weekWindowStart('Asia/Seoul', 1, 7)).toMatch(
        /AT TIME ZONE 'Asia\/Seoul'\)$/,
      );
    });

    it('주 수를 그대로 담는다', () => {
      expect(weekWindowStart('Asia/Seoul', 1, 7)).toContain(
        'make_interval(weeks => 7)',
      );
    });

    it('정수가 아닌 주 수를 거부한다', () => {
      expect(() => weekWindowStart('Asia/Seoul', 1, 1.5)).toThrow();
      expect(() => weekWindowStart('Asia/Seoul', 1, -1)).toThrow();
    });
  });

  describe('dayBucket / dayWindowStart', () => {
    it('일 버킷도 환자 타임존으로 자른다', () => {
      expect(dayBucket('p.created_at', 'America/Denver')).toBe(
        "date_trunc('day', (p.created_at AT TIME ZONE 'America/Denver'))",
      );
    });

    it('일 창의 하한도 버킷과 짝이 맞는다', () => {
      const sql = dayWindowStart('America/Denver', 14);
      expect(sql).toContain(dayBucket('now()', 'America/Denver'));
      expect(sql).toContain('make_interval(days => 14)');
    });
  });
});
