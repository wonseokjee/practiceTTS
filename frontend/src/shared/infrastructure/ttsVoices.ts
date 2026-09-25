// 로케일 → 서버 TTS(Azure 뉴럴) 음성 이름.
//
// 서버 화이트리스트(ai-service/infra/azure_tts.py VOICES_BY_LOCALE)와 **같은 이름**이어야 한다.
// 서버에 없는 음성을 보내면 400이라 매번 Web Speech 폴백으로 떨어진다.
//
// 없는 로케일은 null — 조용히 한국어 음성으로 대신하지 않는다. 영어 음성은 서버에
// 음성·말속도(SPEECH_RATE_BY_LOCALE)를 함께 넣는 M2 작업에서 이 맵에 추가한다.

const TTS_VOICE_BY_LOCALE: Readonly<Record<string, string>> = {
  'ko-KR': 'ko-KR-SunHiNeural',
};

export function serverVoiceFor(locale: string): string | null {
  return TTS_VOICE_BY_LOCALE[locale] ?? null;
}
