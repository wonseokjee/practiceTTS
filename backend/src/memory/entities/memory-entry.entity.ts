import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

// 감정 태그 허용 값 타입
export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

@Entity('memory_entries')
export class MemoryEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 라이프로그를 등록한 보호자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'caregiver_id',
    foreignKeyConstraintName: 'FK_memory_entries_caregiver',
  })
  caregiver: User;

  @Column({ name: 'caregiver_id', type: 'uuid' })
  caregiverId: string;

  // 훈련 대상 환자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_memory_entries_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 업로드된 사진 경로 (예: uploads/memory-images/파일명)
  @Column({ name: 'photo_url', nullable: true })
  photoUrl: string;

  // AI가 이미지에서 자동 추출한 장소 태그
  @Column({ name: 'location_tag', nullable: true })
  locationTag: string;

  // AI가 이미지에서 자동 추출한 사물 태그 목록
  @Column({ name: 'object_tags', type: 'jsonb', nullable: true })
  objectTags: string[];

  // 감정 태그 (happy | calm | nostalgic | excited)
  // @deprecated Phase 4 보호자 화면 재설계 이후 단계적으로 제거 예정 (P1-N9=(a) 호환 유지)
  @Column({ name: 'emotion_tag', nullable: true })
  emotionTag: EmotionTag;

  // 훈련에 사용할 목표 단어 (최대 3개)
  // @deprecated Phase 4 보호자 화면 재설계 이후 단계적으로 제거 예정 (P1-N9=(a) 호환 유지)
  @Column({ name: 'target_words', type: 'simple-array', nullable: true })
  targetWords: string[];

  // 보호자가 환자에게 전하는 한 마디 (Phase 6 양방향 치유 v1 사전 준비)
  // - Phase 1에서는 저장만 수행하며 UI 노출 없음
  // - DTO 레벨에서 1~120자 검증
  @Column({ name: 'caregiver_wish_message', type: 'text', nullable: true })
  caregiverWishMessage: string | null;

  // AI 마스킹 처리 후 저장되는 컨텍스트 텍스트
  @Column({ name: 'masked_context', type: 'text', nullable: true })
  maskedContext: string;

  // 시나리오 생성 결과 JSON 캐시
  @Column({ name: 'scenario_cache', type: 'text', nullable: true })
  scenarioCache: string;

  // 소프트 삭제 플래그 (false이면 목록에서 제외)
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
