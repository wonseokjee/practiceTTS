/**
 * 정적 TTS 오디오 에셋 텍스트→URL 매핑 모듈
 *
 * key  : 정확한 텍스트 문자열 (공백·마침표 포함, 대소문자 구분)
 * value: Vite public/ 기준 절대 경로 (브라우저에서 직접 fetch 가능)
 *
 * 새 음성 파일 추가 방법:
 *   1. 이 상수에 키-값 쌍을 추가한다.
 *   2. scripts/generate-static-tts.mjs 를 재실행하여 MP3 파일을 생성한다.
 *   StaticFileTtsService 코드는 수정하지 않아도 된다. (개방-폐쇄 원칙)
 */

/**
 * 텍스트 → 정적 오디오 파일 URL 매핑 타입
 *
 * Readonly<Record>로 정의하여 런타임 변경을 방지한다.
 */
export type StaticTtsManifest = Readonly<Record<string, string>>;

/**
 * 사전 생성된 정적 오디오 에셋의 텍스트→URL 매핑 상수
 *
 * scripts/generate-static-tts.mjs 로 생성한 파일들에 대응한다.
 * Azure TTS(ko-KR-SunHiNeural)로 생성된 MP3 파일을 참조한다.
 */
export const STATIC_TTS_MANIFEST: StaticTtsManifest = {
  // LOC 검사 지시문 (모든 시도에 동일한 지시문 사용)
  '화면을 눌러주세요.': '/assets/audio/loc/loc_prompt.mp3',
} as const;
