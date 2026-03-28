import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrainingSession } from './training-session.entity';

/** 대화 참여자 역할 */
export type ConversationRole = 'ai' | 'patient';

@Entity('conversation_logs')
export class ConversationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 속한 훈련 세션
  @ManyToOne(() => TrainingSession, (session) => session.conversationLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session: TrainingSession;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  // 발화자 역할: ai(AI 응답) | patient(환자 발화)
  @Column({ type: 'varchar', length: 10 })
  role: ConversationRole;

  // 대화 내용 (AES-256-CBC 암호화 저장, "hex(iv):base64(ciphertext)" 형식)
  @Column({ type: 'text' })
  content: string;

  // 이 로그가 힌트 제공과 함께 생성되었는지 여부
  @Column({ name: 'hint_triggered', default: false })
  hintTriggered: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
