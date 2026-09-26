// 채점 방식이 바뀌었다는 안내 — 보호자 진전 카드와 주간 기록이 같은 문구를 쓴다.
//
// 이웃 비교 채점을 켠 뒤로 정답률의 뜻이 바뀐다(가까운 다른 단어를 정답으로 치지 않는다). 그 전후의
// 정답률을 이어서 읽으면 환자가 나빠진 것으로 보일 수 있어, 바뀐 날짜와 함께 "바로 비교하기 어렵다"고
// 알린다. 잘잘못을 말하지 않는 담담한 문장이다.

import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../shared/i18n/formatDate.js';

export function ScorerChangeNote({ changedAt }: { changedAt: string }) {
  const { t } = useTranslation('caregiver');
  const date = formatDate(changedAt, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <p className="mt-1 text-xs leading-relaxed text-muted-sage" role="note">
      {t('qabProgress.scorerChangedNote', { date })}
    </p>
  );
}
