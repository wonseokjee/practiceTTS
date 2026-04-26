/**
 * Whisper 기반 STT 훅.
 *
 * 설계 결정:
 * - 자체 MediaRecorder를 관리한다. useAudioRecorder는 Blob URL만 반환하고 Blob 자체를
 *   외부로 노출하지 않기 때문. (useAudioRecorder는 수정하지 않는다)
 * - 상태 전이: idle → recording → transcribing → idle
 * - 최대 녹음 시간(maxDurationMs) 도달 시 자동 종료 + 변환.
 * - 최소 녹음 시간(minDurationMs) 미만이면 변환을 건너뛰고 에러 메시지를 표시한다.
 * - 30초 타임아웃: AbortController로 SttApi 호출을 취소한다.
 * - 언마운트 시 마이크 스트림, MediaRecorder, setTimeout을 모두 정리한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SttApi, SttApiError } from '../infrastructure/SttApi.js';

/** 네트워크 타임아웃 (30초). */
const API_TIMEOUT_MS = 30_000;
/** 최대 녹음 시간 기본값 (60초). */
const DEFAULT_MAX_DURATION_MS = 60_000;
/** 최소 녹음 시간 기본값 (500ms). 너무 짧은 녹음은 잡음 확률이 높아 서버 호출을 차단. */
const DEFAULT_MIN_DURATION_MS = 500;

export interface UseWhisperSTTOptions {
  /** 언어 코드. 기본 "ko". */
  language?: string;
  /** 최대 녹음 시간(ms). 초과 시 자동 종료 + 변환. 기본 60000. */
  maxDurationMs?: number;
  /** 최소 녹음 시간(ms). 미만이면 서버 호출 차단. 기본 500. */
  minDurationMs?: number;
  /** 변환 완료 시 호출되는 콜백. 빈 문자열인 경우에도 호출한다. */
  onTranscribed?: (text: string) => void;
}

export interface UseWhisperSTTReturn {
  /** 녹음 중 여부. */
  isRecording: boolean;
  /** 서버 변환 중 여부. */
  isTranscribing: boolean;
  /** 최근 변환된 텍스트. reset() 호출 또는 새 녹음 시작 시 초기화된다. */
  transcript: string;
  /** 최근 에러 메시지. null이면 에러 없음. */
  error: string | null;
  /** 녹음 시작. 이미 녹음 중이면 no-op. */
  startRecording: () => Promise<void>;
  /** 녹음 종료 후 Whisper 변환. 변환 결과 텍스트 또는 null(차단/실패)을 반환. */
  stopAndTranscribe: () => Promise<string | null>;
  /** 상태 전체 초기화 (transcript, error 제거). */
  reset: () => void;
}

/**
 * MediaRecorder + SttApi를 결합한 Whisper STT 훅.
 */
export function useWhisperSTT(
  options: UseWhisperSTTOptions = {},
): UseWhisperSTTReturn {
  const {
    language = 'ko',
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    minDurationMs = DEFAULT_MIN_DURATION_MS,
    onTranscribed,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 내부 참조들: 상태로 관리하면 불필요한 리렌더가 발생하므로 ref 사용.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 비동기 stop 흐름에서 Blob을 반환하기 위한 resolver 참조.
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  // 최신 옵션/콜백을 동기 ref로 보관 (setTimeout 콜백이 stale closure를 참조하지 않도록)
  const onTranscribedRef = useRef(onTranscribed);
  useEffect(() => {
    onTranscribedRef.current = onTranscribed;
  }, [onTranscribed]);

  /** 마이크 스트림과 타임아웃을 정리한다 (MediaRecorder는 상태에 따라 별도). */
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  /**
   * MediaRecorder를 종료하고 onstop에서 만들어지는 Blob을 Promise로 반환한다.
   * 녹음 중이 아니면 즉시 null을 resolve.
   */
  const stopMediaRecorder = useCallback((): Promise<Blob | null> => {
    return new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      // onstop 내부에서 resolve 호출
      stopResolverRef.current = resolve;
      recorder.stop();
    });
  }, []);

  /**
   * 오디오 Blob을 서버로 전송하여 변환 결과를 받는다.
   * 타임아웃, 최소 녹음 시간, API 에러 등을 처리한다.
   */
  const transcribeBlob = useCallback(
    async (blob: Blob, durationMs: number): Promise<string | null> => {
      if (durationMs < minDurationMs) {
        setError(
          `녹음이 너무 짧습니다 (최소 ${minDurationMs}ms 필요). 다시 시도해주세요.`,
        );
        return null;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      setIsTranscribing(true);
      try {
        const result = await SttApi.transcribe(blob, language, controller.signal);
        setTranscript(result.text);
        onTranscribedRef.current?.(result.text);
        return result.text;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          setError('변환 시간이 초과되었습니다. 다시 시도해주세요.');
        } else if (cause instanceof SttApiError) {
          setError(`변환 실패: ${cause.detail || cause.message}`);
        } else if (cause instanceof Error) {
          setError(`변환 실패: ${cause.message}`);
        } else {
          setError('변환 실패: 알 수 없는 오류');
        }
        return null;
      } finally {
        clearTimeout(timeoutId);
        setIsTranscribing(false);
      }
    },
    [language, minDurationMs],
  );

  const startRecording = useCallback(async (): Promise<void> => {
    // 이미 녹음 중이면 no-op (중복 시작 방지)
    if (isRecording || mediaRecorderRef.current?.state === 'recording') {
      return;
    }

    setError(null);
    setTranscript('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`마이크 권한이 필요합니다: ${message}`);
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];

    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const chunks = audioChunksRef.current;
      // MediaRecorder의 첫 번째 청크 타입을 기준으로 Blob 생성.
      // 브라우저별 기본 출력이 다르므로 chunks[0]?.type에 의존한다. (Chrome: audio/webm;codecs=opus)
      const mimeType = chunks[0]?.type || 'audio/webm';
      const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;

      // 스트림/타임아웃 정리는 여기서 수행 (stopMediaRecorder 호출과 무관하게 일관되도록)
      cleanupStream();

      const resolver = stopResolverRef.current;
      stopResolverRef.current = null;
      setIsRecording(false);
      resolver?.(blob);
    };

    recordingStartTimeRef.current = performance.now();
    recorder.start();
    setIsRecording(true);

    // 최대 녹음 시간 도달 시 자동 종료 + 변환 (자동 종료 경로)
    autoStopTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const durationMs = performance.now() - recordingStartTimeRef.current;
        const blob = await stopMediaRecorder();
        if (blob) {
          await transcribeBlob(blob, durationMs);
        }
      })();
    }, maxDurationMs);
  }, [
    isRecording,
    maxDurationMs,
    cleanupStream,
    stopMediaRecorder,
    transcribeBlob,
  ]);

  const stopAndTranscribe = useCallback(async (): Promise<string | null> => {
    // 녹음 중이 아니면 변환 대상이 없음
    if (!isRecording && mediaRecorderRef.current?.state !== 'recording') {
      return null;
    }

    const durationMs = performance.now() - recordingStartTimeRef.current;
    const blob = await stopMediaRecorder();
    if (!blob) {
      return null;
    }
    return transcribeBlob(blob, durationMs);
  }, [isRecording, stopMediaRecorder, transcribeBlob]);

  // 언마운트 시 리소스 정리 (마이크 스트림 해제 필수)
  useEffect(() => {
    return () => {
      // 녹음 중이라면 먼저 MediaRecorder 종료 (onstop 콜백이 resolver를 정리함)
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // 이미 종료된 경우 등 무시
        }
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopAndTranscribe,
    reset,
  };
}
