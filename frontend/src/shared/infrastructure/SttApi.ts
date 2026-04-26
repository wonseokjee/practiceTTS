/**
 * ai-service의 Whisper STT 엔드포인트 호출 어댑터.
 *
 * 설계 원칙:
 * - Infrastructure 레이어: 외부 시스템(HTTP) 의존성을 캡슐화한다.
 * - 에러는 SttApiError로 타입화하여 상위 레이어가 구분 처리할 수 있도록 한다.
 * - fetch + FormData 사용 (axios 의존성 불필요). AbortController 지원으로 상위 훅에서
 *   타임아웃을 제어한다.
 */

/**
 * POST /stt/transcribe 응답 DTO.
 * ai-service TranscribeResponse와 1:1 매핑된다.
 */
export interface SttResponse {
  readonly text: string;
  readonly language: string;
  readonly duration: number;
  readonly model_size: string;
}

/**
 * STT API 호출 실패를 나타내는 에러.
 * HTTP status code와 서버가 반환한 detail을 보존하여 디버깅을 돕는다.
 */
export class SttApiError extends Error {
  public readonly status: number;
  public readonly detail: string;

  constructor(status: number, detail: string) {
    super(`STT API 오류 (${status}): ${detail}`);
    this.name = 'SttApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * ai-service의 STT 엔드포인트를 호출하는 정적 어댑터 클래스.
 * 인스턴스 상태가 없어 static 메서드만 노출한다.
 */
export class SttApi {
  /**
   * VITE_AI_SERVICE_URL이 있으면 사용하고 없으면 로컬 기본값을 사용한다.
   * 주의: 모듈 평가 시점에 한 번 계산되므로, 런타임 env 교체는 지원하지 않는다.
   */
  private static readonly BASE_URL: string =
    (import.meta.env.VITE_AI_SERVICE_URL as string | undefined) ??
    'http://localhost:8000';

  /**
   * 오디오 Blob을 ai-service에 업로드하여 변환 결과를 받는다.
   *
   * @param audioBlob 업로드할 오디오 Blob (webm/wav/mp3/m4a/ogg)
   * @param language 언어 코드 (기본 "ko")
   * @param signal 호출 취소용 AbortSignal (타임아웃 제어)
   * @returns SttResponse (text, language, duration, model_size)
   * @throws SttApiError 서버가 2xx 이외 응답을 반환한 경우
   * @throws DOMException AbortError 신호가 발동된 경우
   */
  static async transcribe(
    audioBlob: Blob,
    language: string = 'ko',
    signal?: AbortSignal,
  ): Promise<SttResponse> {
    const formData = new FormData();
    // 파일명은 서버에서 확장자 검증에 사용되므로 반드시 포함시킨다.
    formData.append('file', audioBlob, SttApi.inferFilename(audioBlob));
    formData.append('language', language);

    let response: Response;
    try {
      response = await fetch(`${SttApi.BASE_URL}/stt/transcribe`, {
        method: 'POST',
        body: formData,
        signal,
      });
    } catch (cause) {
      // AbortController에 의한 취소는 DOMException 그대로 전파 (상위에서 구분 가능)
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause;
      }
      // 네트워크 단절, DNS 실패 등
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new SttApiError(0, `네트워크 오류: ${message}`);
    }

    if (!response.ok) {
      const detail = await SttApi.safeReadText(response);
      throw new SttApiError(response.status, detail);
    }

    return (await response.json()) as SttResponse;
  }

  /**
   * Blob MIME 타입에서 적절한 파일 확장자를 유추한다.
   * 서버 확장자 검증에 사용되므로 반드시 허용 확장자 중 하나여야 한다.
   */
  private static inferFilename(blob: Blob): string {
    const type = (blob.type || '').toLowerCase();
    if (type.includes('webm')) return 'recording.webm';
    if (type.includes('wav')) return 'recording.wav';
    if (type.includes('mpeg') || type.includes('mp3')) return 'recording.mp3';
    if (type.includes('mp4') || type.includes('m4a')) return 'recording.m4a';
    if (type.includes('ogg')) return 'recording.ogg';
    // MediaRecorder 기본 출력은 브라우저별로 상이하나 webm이 가장 일반적
    return 'recording.webm';
  }

  /**
   * 에러 응답 본문을 읽되, 읽기 실패 시 상태 텍스트로 폴백한다.
   */
  private static async safeReadText(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text || response.statusText;
    } catch {
      return response.statusText;
    }
  }
}
