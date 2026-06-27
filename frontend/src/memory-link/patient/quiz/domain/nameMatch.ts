// 그림 이름대기(naming) 로컬 채점 — STT 인식 텍스트와 정답 이름의 관대한 비교.
//
// 실어증 환자 + 브라우저 STT 특성상 정확 일치는 비현실적이라 관대하게 본다.
//  - 공백 제거, NFC 정규화, 소문자화 후
//  - 완전 일치, 혹은 한쪽이 다른 쪽을 포함하면 정답으로 본다
//    (예: "사과요" / "사과입니다" → "사과" 정답 처리).

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

/** STT 인식 텍스트가 정답 이름과 일치하는지(관대) 판정. */
export function isNameMatch(transcript: string, targetWord: string): boolean {
  const said = normalizeName(transcript);
  const target = normalizeName(targetWord);
  if (said.length === 0 || target.length === 0) return false;
  // 완전 일치, 혹은 조사/어미가 붙은 경우(said가 target을 포함).
  if (said === target || said.includes(target)) return true;
  // 부분 발화(target이 said를 포함)는 said가 정답의 충분한 비율일 때만 인정.
  return target.includes(said) && said.length >= target.length * PARTIAL_MIN_RATIO;
}
