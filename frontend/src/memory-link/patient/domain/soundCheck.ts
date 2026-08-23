// 소리 사전 점검 기록 — "오늘 이 기기에서 소리를 확인했는가".
//
// **왜 기록이 필요한가.** 브라우저는 소리가 실제로 귀에 닿았는지 알려주지 않는다.
// Web Speech는 목소리가 하나도 없거나 기기가 음소거여도 `onend`만 발화하면
// 성공이다(TODO-110). 기계가 알 수 없는 것은 사람에게 물어야 한다.
//
// **왜 매번 묻지 않는가.** 이 앱은 매일 쓰는 앱이다. 세션마다 확인 화면을
// 세우면 어르신에게는 검사가 한 단계 늘어난 것으로 읽힌다. 하루 한 번이면
// 스트릭과 같은 리듬이고, 하루 사이에 기기가 바뀌는 일은 드물다.
//
// **왜 서버가 아니라 localStorage인가.** 소리는 계정이 아니라 **기기**의
// 성질이다. 태블릿에서 확인한 사실이 휴대폰으로 따라가면 안 된다.

import { toLocalYmd } from './streak.js';

/** 마지막으로 "잘 들려요"를 받은 날짜(YYYY-MM-DD, 로컬)를 담는 키. */
const SOUND_CHECK_KEY = 'ml_sound_check_ok';

/**
 * 오늘 이 기기에서 소리 확인을 통과했는가.
 *
 * localStorage를 못 쓰는 환경(사파리 비공개 모드 등)에서는 **묻는 쪽으로**
 * 기운다 — 한 번 더 묻는 비용이 소리 없이 검사를 치르는 비용보다 싸다.
 */
export function isSoundCheckedToday(now: Date = new Date()): boolean {
  try {
    return localStorage.getItem(SOUND_CHECK_KEY) === toLocalYmd(now);
  } catch {
    return false;
  }
}

/**
 * 오늘 소리 확인을 통과했다고 적는다.
 *
 * "안 들려요"를 고르고 그냥 시작한 경우에는 **적지 않는다.** 다음 세션에
 * 다시 물어야 하기 때문이다 — 소리를 켜고 오면 그때 통과한다.
 */
export function markSoundCheckedToday(now: Date = new Date()): void {
  try {
    localStorage.setItem(SOUND_CHECK_KEY, toLocalYmd(now));
  } catch {
    // 저장이 안 되면 매번 묻게 된다. 세션을 막을 이유는 아니다.
  }
}

/** 확인 기록을 지운다(테스트·기기 변경용). */
export function clearSoundCheck(): void {
  try {
    localStorage.removeItem(SOUND_CHECK_KEY);
  } catch {
    // 지울 수 없으면 그대로 둔다.
  }
}
