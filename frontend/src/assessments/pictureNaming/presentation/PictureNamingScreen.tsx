import React, { useEffect } from 'react';
import { usePictureNamingViewModel } from './usePictureNamingViewModel';
import type { PictureNamingItem, PictureNamingResult } from '../domain/PictureNamingTypes';

interface PictureNamingScreenProps {
  item: PictureNamingItem;
  onComplete: (result: PictureNamingResult) => void;
}

export const PictureNamingScreen: React.FC<PictureNamingScreenProps> = ({ item, onComplete }) => {
  const { 
    step, 
    timeLeft, 
    isSpeaking, 
    audioUrl,
    handleInstructionEnded, 
    submitReview 
  } = usePictureNamingViewModel({
    item,
    onScored: onComplete
  });

  // 환자가 당황하지 않도록 1.5초간 "그림을 보고 말씀해주세요" 지시를 읽을 시간을 보장 (playing)
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
      
      {/* 1. 배경 & 자극 제시 화면 (Playing & Recording 시 활성) */}
      <div className={`transition-all duration-700 w-full max-w-lg flex flex-col items-center 
          ${step === 'reviewing' ? 'opacity-20 blur-sm scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}
      >
        <h2 className="text-2xl font-bold text-gray-800 mb-8 break-keep text-center">
          {step === 'playing' ? '그림을 보고, 이름을 말씀해 보세요.' : '정답을 말씀해 주세요.'}
        </h2>
        
        {/* 거대한 그림 캔버스 */}
        <div className="w-72 h-72 bg-white rounded-3xl shadow-lg border-4 border-[#2D6A56] overflow-hidden flex items-center justify-center mb-10">
          <img 
            src={item.imageUrl} 
            alt="Naming Stimulus" 
            className="w-full h-full object-contain p-4"
          />
        </div>
        
        {/* 마이크 및 남은 시간 피드백 바 */}
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
            <p className="mt-3 text-sm text-gray-500 font-medium">마이크에 대고 말씀해주세요</p>
          </div>
        </div>
      </div>

      {/* 2. 리뷰 패널 모달 (Reviewing) - 슬라이드 업 효과 */}
      {step === 'reviewing' && (
        <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col items-center bg-white rounded-t-[2.5rem] shadow-[0_-20px_50px_rgba(0,0,0,0.15)] px-8 pt-10 pb-12 animate-slide-up transform translate-y-0">
           <div className="w-16 h-1.5 bg-gray-200 rounded-full mb-8"></div>
           
           <h3 className="text-[1.7rem] font-black text-[#2D6A56] mb-3 text-center">녹음이 끝났습니다</h3>
           <p className="text-gray-500 font-medium mb-10 text-center break-keep">
             목소리를 직접 들어보고,<br/>단어를 똑바로 발음하셨는지 채점해 주세요.
           </p>
           
           <div className="w-full max-w-sm px-2 mb-10">
             {audioUrl ? (
               // 재생 바 (HTML 기본 오디오 컨트롤 - 스타일링 제한이 있지만 빠르고 안정적)
               <audio src={audioUrl} controls className="w-full h-14 outline-none" />
             ) : (
               <div className="text-center text-gray-400 p-4 bg-gray-50 rounded-lg">
                 🎤 녹음된 소리가 빈약하거나 마이크 권한이 없습니다.
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
