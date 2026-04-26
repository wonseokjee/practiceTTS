import React, { useEffect } from 'react';
import { useReadingAloudViewModel } from './useReadingAloudViewModel';
import type { ReadingAloudItem, ReadingAloudResult } from '../domain/ReadingAloudTypes';

interface ReadingAloudScreenProps {
  item: ReadingAloudItem;
  onComplete: (result: ReadingAloudResult) => void;
}

export const ReadingAloudScreen: React.FC<ReadingAloudScreenProps> = ({ item, onComplete }) => {
  const { 
    step, 
    timeLeft, 
    isSpeaking, 
    audioUrl,
    handleInstructionEnded, 
    submitReview 
  } = useReadingAloudViewModel({
    item,
    onScored: onComplete
  });

  // 환자가 마음의 준비를 하도록 1.5초 후 녹음 전환 (인위적인 TTS 없이 육안으로 먼저 읽게 함)
  useEffect(() => {
    if (step === 'playing') {
      const waitTimer = setTimeout(() => {
        handleInstructionEnded();
      }, 1500);
      return () => clearTimeout(waitTimer);
    }
  }, [step, handleInstructionEnded]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#F7F6F3] p-6 relative overflow-hidden">
      
      {/* 1. 거대 한글 텍스트 자극 제시 영역 (Playing & Recording) */}
      <div className={`transition-all duration-700 w-full max-w-lg flex flex-col items-center 
          ${step === 'reviewing' ? 'opacity-20 blur-sm scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}
      >
        <h2 className="text-2xl font-bold text-gray-800 mb-10 break-keep text-center">
          {step === 'playing' ? '아래 글자를 소리 내어 읽어보세요.' : '크고 또렷하게 읽어주세요.'}
        </h2>
        
        {/* 고령자 친화적 거대 폰트 뷰어 */}
        <div className="w-full max-w-md min-h-[16rem] bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden flex flex-col items-center justify-center p-8 mb-12">
          <span className="text-[5.5rem] md:text-[6.5rem] font-black text-[#2D6A56] leading-tight text-center break-keep tracking-tight">
            {item.textContent}
          </span>
        </div>
        
        {/* 마이크 및 남은 시간(Reading Aloud 전용) */}
        <div className={`transition-opacity duration-300 w-full flex flex-col items-center ${step === 'recording' ? 'opacity-100' : 'opacity-0'}`}>
          <div 
            className={`w-32 h-32 rounded-full flex items-center justify-center shadow-xl transition-transform duration-200 
              ${isSpeaking ? 'bg-[#2D6A56] scale-110 shadow-[#2D6A56]/40' : 'bg-white border-4 border-[#EBF4F0]'}`}
          >
            <span className={`text-[3.5rem] transition-transform ${isSpeaking ? 'animate-pulse scale-110' : 'grayscale opacity-60'}`}>
              🎤
            </span>
          </div>
          
          <div className="mt-10 w-full max-w-xs flex flex-col items-center">
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner">
               <div 
                 className="h-full bg-[#2D6A56] transition-all duration-1000 ease-linear rounded-full"
                 style={{ width: `${(timeLeft / 15) * 100}%` }}
               />
            </div>
          </div>
        </div>
      </div>

      {/* 2. 리뷰 패널 모달 (Reviewing) - 슬라이드 업 효과 공통 이식 */}
      {step === 'reviewing' && (
        <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col items-center bg-white rounded-t-[2.5rem] shadow-[0_-20px_50px_rgba(0,0,0,0.15)] px-8 pt-10 pb-12 animate-slide-up transform translate-y-0">
           <div className="w-16 h-1.5 bg-gray-200 rounded-full mb-8"></div>
           
           <h3 className="text-[1.7rem] font-black text-[#2D6A56] mb-3 text-center">녹음이 끝났습니다</h3>
           <p className="text-gray-500 font-medium mb-10 text-center break-keep">
             방금 읽은 목소리를 단어와 비교하며 스스로 채점해 주세요.
           </p>
           
           <div className="w-full max-w-sm px-2 mb-10">
             {audioUrl ? (
               <audio src={audioUrl} controls className="w-full h-14 outline-none" />
             ) : (
               <div className="text-center text-gray-400 p-4 bg-gray-50 rounded-lg">
                 🎤 녹음된 소리가 길지 않거나 권한을 찾을 수 없습니다.
               </div>
             )}
           </div>
           
           <div className="flex w-full max-w-sm gap-4">
              <button 
                onClick={() => submitReview(false)}
                className="flex-1 bg-[#FFF5F5] hover:bg-red-50 text-red-500 font-bold py-6 rounded-2xl transition-colors border border-red-100/50 shadow-sm text-lg active:scale-95"
              >
                <div className="text-3xl mb-1">👎</div>
                조금 틀렸어요
              </button>
              <button 
                onClick={() => submitReview(true)}
                className="flex-1 bg-[#2D6A56] hover:bg-[#235343] text-white font-bold py-6 rounded-2xl transition-colors shadow-md text-lg active:scale-95"
              >
                <div className="text-3xl mb-1">👍</div>
                네, 정확해요
              </button>
           </div>
        </div>
      )}
      
    </div>
  );
};
