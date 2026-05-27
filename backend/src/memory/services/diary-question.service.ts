import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatientNoteCategory } from '../../quiz/constants/patient-note-category';
import { DiaryQuestion } from '../entities/diary-question.entity';

/**
 * 일기 질문 추출 서비스
 *
 * - 카테고리별 랜덤 1개 추출 (Step2/Step3 prefetch)
 * - is_active=true 인 질문만 후보군에 포함
 *
 * 본 서비스는 MemoryEntry/User에 의존하지 않는 단일 책임 모듈.
 */
@Injectable()
export class DiaryQuestionService {
  constructor(
    @InjectRepository(DiaryQuestion)
    private readonly diaryQuestionRepository: Repository<DiaryQuestion>,
  ) {}

  /**
   * 오늘의 질문 1개 조회.
   *
   * - scope='caregiver': 카테고리 무시, 보호자 풀에서 랜덤 1개
   * - scope='patient': category 필수, 해당 카테고리 풀에서 랜덤 1개
   *
   * @throws BadRequestException scope='patient'인데 category 누락
   * @throws NotFoundException 후보 풀이 비어있음 (QUESTION_POOL_EMPTY)
   */
  async getTodayQuestion(
    scope: 'caregiver' | 'patient',
    category?: PatientNoteCategory,
  ): Promise<DiaryQuestion> {
    if (scope === 'patient' && !category) {
      throw new BadRequestException(
        'scope=patient일 때 category는 필수입니다.',
      );
    }

    const where =
      scope === 'caregiver'
        ? { scope, isActive: true }
        : { scope, category, isActive: true };

    const candidates = await this.diaryQuestionRepository.find({ where });

    if (candidates.length === 0) {
      throw new NotFoundException({
        code: 'QUESTION_POOL_EMPTY',
        message: '해당 조건에 활성화된 질문이 없습니다.',
      });
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * 환자 카테고리별 랜덤 질문 1개씩 추출 (activity/moment/context).
   * - 어느 카테고리든 풀이 비어있으면 NotFoundException.
   * - 클라이언트가 Step3 진입 시 3개 질문을 한 번에 prefetch할 때 사용.
   */
  async getRandomPatientQuestionsByCategory(): Promise<{
    activity: DiaryQuestion;
    moment: DiaryQuestion;
    context: DiaryQuestion;
  }> {
    const [activity, moment, context] = await Promise.all([
      this.getTodayQuestion('patient', 'activity'),
      this.getTodayQuestion('patient', 'moment'),
      this.getTodayQuestion('patient', 'context'),
    ]);
    return { activity, moment, context };
  }

  /**
   * 보호자 회고 질문 1개 랜덤 추출 (getTodayQuestion('caregiver')의 별칭).
   */
  async getRandomCaregiverQuestion(): Promise<DiaryQuestion> {
    return this.getTodayQuestion('caregiver');
  }
}
