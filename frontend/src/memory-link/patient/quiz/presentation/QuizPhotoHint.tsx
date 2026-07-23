import { AuthedImage } from '../../../shared/AuthedImage.js';
// 사진 힌트 카드
//
// 상세 응답의 memoryEntry.photoUrl이 있을 때만 렌더되는 작은 힌트 카드.
// rounded-xl(24), Warm Clinical 톤.

interface QuizPhotoHintProps {
  /** 기억 사진 URL — null이면 호출측에서 렌더하지 않음 */
  photoUrl: string;
}

/** 문제 풀이 시 참고할 수 있는 기억 사진 썸네일 카드 */
export function QuizPhotoHint({ photoUrl }: QuizPhotoHintProps) {
  return (
    <figure className="font-pretendard mb-5 overflow-hidden rounded-xl bg-[#F7F6F3]">
      <AuthedImage
        src={photoUrl}
        alt="기억 사진 힌트"
        className="max-h-56 w-full object-cover"
      />
      <figcaption className="px-4 py-2 text-center text-sm text-[#5C6661]">
        사진을 보며 떠올려보세요
      </figcaption>
    </figure>
  );
}
