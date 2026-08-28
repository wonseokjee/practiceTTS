import { HEALING_MESSAGES_SEED } from './healing-messages.seed';

/**
 * 이 풀은 **환자와 보호자가 같은 날 같은 문장을 읽는다**(healing-message.service.ts의
 * "함께 읽는" 컨셉). 그래서 한쪽에만 말을 거는 문장이 섞이면 다른 쪽은 자기 얘기가
 * 아닌 글을 읽는다. 회전이 날짜 기반 결정적이라 그날이 오면 반드시 그렇게 된다.
 *
 * 실제로 두 문장이 그랬다(M24에서 고쳤다):
 *   '당신의 돌봄이 누군가에겐 가장 큰 위로예요.'  → 환자는 돌봄을 하지 않는다
 *   '오늘 하루, 당신도 돌봄이 필요해요.'          → "당신도"가 돌보는 사람을 전제
 */
describe('HEALING_MESSAGES_SEED', () => {
  it('문구가 중복되지 않는다', () => {
    // 멱등 키가 text다. 중복이 있으면 시드가 하나를 건너뛰고, 회전에서는 그
    // 문장만 두 배로 자주 나온다.
    const seen = new Set(HEALING_MESSAGES_SEED);
    expect(seen.size).toBe(HEALING_MESSAGES_SEED.length);
  });

  it('빈 문자열이 없다', () => {
    for (const text of HEALING_MESSAGES_SEED) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('보호자에게만 말을 거는 문장이 없다', () => {
    // **좁은 그물이다.** "환자가 읽어도 자기 얘기인가"를 기계가 판정할 수는 없다.
    // 실제로 걸렸던 두 표현만 막는다 — 같은 실수를 복사해 넣는 것을 잡는 것이
    // 목적이지, 이 테스트가 통과한다고 전부 공용이라는 뜻은 아니다.
    const 보호자전용 = /당신의\s*돌봄|당신도\s*돌봄/;
    const 걸린것 = HEALING_MESSAGES_SEED.filter((t) => 보호자전용.test(t));
    expect(걸린것).toEqual([]);
  });

  it('M24에서 고친 두 문장이 새 문구로 남아 있다', () => {
    // 시드 배열과 마이그레이션이 갈라지면, 새로 설치한 환경만 옛 문구를 갖게 된다.
    expect(HEALING_MESSAGES_SEED).toContain(
      '서로의 곁에 있는 것이 가장 큰 위로예요.',
    );
    expect(HEALING_MESSAGES_SEED).toContain(
      '오늘 하루, 당신의 마음도 돌봐 주세요.',
    );
  });
});
