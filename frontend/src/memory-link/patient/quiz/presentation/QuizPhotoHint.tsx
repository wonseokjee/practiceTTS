import { AuthedImage } from '../../../shared/AuthedImage.js';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('quiz');
  return (
    <figure className="font-pretendard mb-5 overflow-hidden rounded-xl bg-canvas">
      <AuthedImage
        src={photoUrl}
        alt={t('photoHint.alt')}
        className="max-h-56 w-full object-cover"
      />
      <figcaption className="px-4 py-2 text-center text-sm text-muted-sage">
        {t('photoHint.caption')}
      </figcaption>
    </figure>
  );
}
