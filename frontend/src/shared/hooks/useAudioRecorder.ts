import { useState, useRef, useCallback, useEffect } from 'react';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (e) {
      console.error('Failed to start audio recording:', e);
    }
  }, [audioUrl]);

  // 비동기 종료 (LLM 전송 대기를 위해, 브라우저가 Blob URL을 압축하여 생성해낼 때까지 기다렸다가 반환함)
  const stopRecording = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (mediaRecorderRef.current && isRecording && mediaRecorderRef.current.state !== 'inactive') {
        const recorder = mediaRecorderRef.current;
        
        recorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(audioBlob);
          setAudioUrl(url);
          
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          resolve(url);
        };
        
        recorder.stop();
        setIsRecording(false);
      } else {
        // 녹음이 안된 상태면 갖고있던 url이나 일단 뱉음
        resolve(audioUrl || null);
      }
    });
  }, [isRecording, audioUrl]);
  
  const cleanupRecording = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, [audioUrl]);

  // 언마운트 시 메모리 누수 방지 (단, onScored 후 상위 객체로 넘어가야하므로 cleanup 타임 조절이 필요할 수 있음)
  useEffect(() => {
    return () => {
      // 컴포넌트 강제 종료 시 최소한의 마이크 스트림만 해제
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    isRecording,
    audioUrl,
    startRecording,
    stopRecording,
    cleanupRecording
  };
}
