// 그림 이름대기(naming) 로컬 채점 — STT 인식 텍스트와 정답 이름의 관대한 비교.
//
// 실어증 환자 + 브라우저 STT 특성상 정확 일치는 비현실적이라 관대하게 본다.
//  - 공백 제거, NFC 정규화, 소문자화 후
//  - 완전 일치, 혹은 한쪽이 다른 쪽을 포함하면 정답으로 본다
//    (예: "사과요" / "사과입니다" → "사과" 정답 처리).
//  - 위 조건에 안 걸려도 음소 유사 거리가 임계값 이하이면 정답으로 본다
//    (구음장애·노인의 조음 유사 혼동: "바다"↔"파다" 등).

import { phoneticEditDistance } from './phoneticDistance.js';

/** 비교용 정규화: NFC + 공백 제거 + 소문자. */
function normalizeName(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/**
 * 부분 발화(정답이 인식 텍스트를 포함, 예: "비행"→"비행기")를 인정하되,
 * 인식 텍스트가 정답의 이 비율 미만이면 거부한다.
 * (STT 잡음 1글자가 긴 정답에 매칭돼 정확도가 부풀려지는 것을 방지.)
 */
const PARTIAL_MIN_RATIO = 0.6;

/** 음소 유사 거리 정답 임계값 — 음절당 평균 음소 오류가 이 값 이하이면 정답. */
const PHONETIC_PASS_THRESHOLD = 0.34;

/** STT 인식 텍스트가 정답 이름과 일치하는지(관대) 판정. */
// **채점 경로에서 빠졌다(2026-08-24, 음향 채점기 1단계).** 예전에는 이름대기에서
// 음향 발음 평가가 없을 때 이 함수로 폴백했는데, 문자열 근접도는 음향 채점과
// 같은 것을 재지 않는다(순위상관 −0.376, 0단계 측정 C). 지금은 음향 점수가
// 없으면 채점하지 않는다. 이 함수를 채점에 다시 물리지 말 것.
export function isNameMatch(transcript: string, targetWord: string): boolean {
  const said = normalizeName(transcript);
  const target = normalizeName(targetWord);
  if (said.length === 0 || target.length === 0) return false;
  // 완전 일치, 혹은 조사/어미가 붙은 경우(said가 target을 포함).
  if (said === target || said.includes(target)) return true;
  // 부분 발화(target이 said를 포함)는 said가 정답의 충분한 비율일 때만 인정.
  if (target.includes(said) && said.length >= target.length * PARTIAL_MIN_RATIO) {
    return true;
  }
  // 음소 유사 근접 — 조음 위치가 같은 혼동(파열음 평/경/격, 종성 탈락 등)에 관대.
  const rate = phoneticEditDistance([...said], [...target]) / target.length;
  return rate <= PHONETIC_PASS_THRESHOLD;
}
