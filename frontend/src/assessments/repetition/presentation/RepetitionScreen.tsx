import React, { useRef, useEffect } from 'react';
import { useRepetitionViewModel } from './useRepetitionViewModel';
import type { RepetitionItem, RepetitionResult } from '../domain/RepetitionTypes';

interface RepetitionScreenProps {
  item: RepetitionItem;
  onComplete: (result: RepetitionResult) => void;
}

export const RepetitionScreen: React.FC<RepetitionScreenProps> = ({ item, onComplete }) => {
  const { step, timeLeft, isSpeaking, isSttSupported, handleAudioEnded } = useRepetitionViewModel({
    item,
    onScored: onComplete
  });
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 컴포넌트 파도처럼 렌더링될 때 무조건 첫 오디오(설명)를 자동 재생
  useEffect(() => {
    if (audioRef.current && step === 'playing') {
      audioRef.current.play().catch(e => console.error("Audio playback blocked:", e));
    }
  }, [item, step]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#F7F6F3] p-6 relative overflow-hidden">
      
      {/* 지원되지 않는 브라우저 (Medium Issue 방어용 Fallback) */}
      {!isSttSupported && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#F7F6F3]/95 backdrop-blur-sm">
          <div className="flex flex-col items-center bg-white py-10 px-8 rounded-2xl shadow-xl border-t-8 border-red-500 text-center max-w-sm">
             <span className="text-5xl mb-4">⚠️</span>
             <h2 className="text-2xl font-black text-gray-800 mb-3 break-keep">음성 인식 미지원</h2>
             <p className="text-gray-600 font-medium break-keep">이 브라우저에서는 환자분의 마이크 음성 분석 기능을 지원하지 않습니다. 가급적 Chrome 브라우저를 사용해주세요.</p>
          </div>
        </div>
      )}

      {/* 상태 1단계: 청취 중 (playing) */}
      <div 
        className={`transition-opacity duration-500 w-full max-w-lg text-center flex flex-col items-center justify-center
          ${step === 'playing' ? 'opacity-100 relative' : 'opacity-0 absolute pointer-events-none'}`}
      >
        <h2 className="text-2xl font-bold text-gray-800 mb-8 break-keep">
          잘 듣고, 똑같이 따라 말해보세요.
        </h2>
        
        {/* 리플(Ripple) 애니메이션 효과 */}
        <div className="relative w-48 h-48 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 bg-[#2D6A56] opacity-20 rounded-full animate-ping"></div>
          <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center shadow-lg border-4 border-[#2D6A56] z-10">
            <span className="text-5xl">👂</span>
          </div>
        </div>
        
        <audio 
          ref={audioRef} 
          src={item.sentenceAudioUrl} 
          onEnded={handleAudioEnded} 
          className="hidden" 
        />
      </div>

      {/* 상태 2단계: 녹음 및 발화 중 (recording) */}
      <div 
        className={`transition-all duration-700 w-full max-w-lg flex flex-col items-center 
          ${step === 'recording' ? 'opacity-100 translate-y-0 relative' : 'opacity-0 translate-y-10 absolute pointer-events-none'}`}
      >
        <h2 className="text-[2.2rem] font-black text-[#2D6A56] mb-12 drop-shadow-sm text-center break-keep">
          "{item.stimulusText}"
        </h2>
        
        {/* VAD 반응 마이크 */}
        <div 
          className={`w-56 h-56 rounded-full flex items-center justify-center shadow-xl transition-all duration-200 
            ${isSpeaking ? 'bg-[#2D6A56] scale-110 shadow-[#2D6A56]/40' : 'bg-white border-4 border-[#EBF4F0] scale-100'}
          `}
        >
          <span className={`text-[5rem] transition-transform duration-200 ${isSpeaking ? 'scale-110 animate-pulse' : 'grayscale opacity-70'}`}>
            🎤
          </span>
        </div>
        
        {/* 잔여 시간 타임바 */}
        <div className="mt-16 w-full max-w-sm flex flex-col items-center">
          <p className="text-gray-500 mb-3 font-semibold text-sm">마이크에 대고 말씀해주세요</p>
          <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden shadow-inner">
             <div 
               className="h-full bg-[#2D6A56] transition-all duration-1000 ease-linear rounded-full"
               style={{ width: `${(timeLeft / 15) * 100}%` }}
             />
          </div>
        </div>
      </div>

      {/* 상태 3단계: 채점 분석 블로킹 모달 (scoring) */}
      {step === 'scoring' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#F7F6F3]/80 backdrop-blur-md">
          <div className="flex flex-col items-center bg-white py-10 px-12 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-gray-100">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-[#EBF4F0] rounded-full"></div>
              <div className="absolute inset-0 border-4 border-[#2D6A56] rounded-full border-t-transparent animate-spin"></div>
            </div>
            <p className="text-[#2D6A56] font-bold text-2xl mb-2">음성 분석 중</p>
            <p className="text-gray-400 font-medium">환자분의 발음을 꼼꼼히 듣고 있어요</p>
          </div>
        </div>
      )}
      
    </div>
  );
};
