import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { PracticeItemKind } from '../constants/practice-item-kind';

/**
 * 연습 모드 결과 1행 (시도 단위).
 *
 * **검사(qab_results)와 같은 통에 담지 않는다.** qab_results에 들어온 행은 적응형
 * 레벨 재계산·문항 회전·보호자 추세·완료 통계가 전부 소비하는데, 연습은 한 세션
 * 40문항으로 검사(13문항)를 3:1로 압도한다. 섞이면 연습 성적이 곧 검사 지표가
 * 되고, 레벨 재계산을 통해 연습이 다음 검사의 난이도까지 정하게 된다.
 *
 * 이 테이블은 어떤 집계에도 연결되지 않는다 — 연결하지 않는 것이 설계다.
 * 쓰임은 (1) 순응도(며칠·몇 문항 했나), (2) 단서 반응성(단서를 주면 되는가),
 * (3) tier별 Azure 호출 실측 셋뿐이다.
 *
 * 검사 테이블과 모양이 다른 세 지점은 각 컬럼 주석에 적었다.
 */
@Entity('practice_results')
@Index('IDX_practice_results_patient_created', ['patientId', 'createdAt'])
// 멱등성: 같은 세션·문항·시도는 1행만. 재제출/중복 flush는 no-op.
// attempt가 키에 있어 단서 전/후 시도가 서로 다른 행으로 남는다 — qab_results의
// dedup UNIQUE가 (patient, session, subtest, item)까지만 잡는 것과 다른 지점이다.
@Index(
  'UQ_practice_results_dedup',
  ['patientId', 'sessionToken', 'itemRef', 'attempt'],
  { unique: true },
)
@Check('CHK_practice_results_tier', '"tier" BETWEEN 0 AND 2')
@Check('CHK_practice_results_attempt', '"attempt" >= 1')
export class PracticeResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_practice_results_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'session_token', type: 'uuid' })
  sessionToken: string;

  // 연습은 검사의 subtest 축(word/sentence/naming/...)이 아니라 문항 종류로 센다.
  // 연습에서 무엇을 얼마나 했는지가 관심사이지, 소검사 점수가 아니기 때문이다.
  @Column({ name: 'item_kind', type: 'varchar', length: 24 })
  itemKind: PracticeItemKind;

  @Column({ name: 'item_ref', type: 'varchar', length: 100 })
  itemRef: string;

  /**
   * 같은 문항 안에서의 몇 번째 시도인가 (1부터).
   *
   * 연습의 정상 흐름은 "발화 → 막히면 단서 → 재시도"다. 현재 설계에서
   * attempt >= 2는 곧 단서를 받은 뒤의 시도를 뜻한다. 단서를 주면 되는가는
   * 실어증 예후 지표라, 앞 시도를 덮어쓰지 않고 둘 다 남긴다.
   */
  @Column({ name: 'attempt', type: 'smallint', default: 1 })
  attempt: number;

  /**
   * 정오답. **null이 정상값이다.**
   *
   * Tier 1(발화하되 채점 안 함)은 판정 자체가 존재하지 않는다. 연습 중엔 판정을
   * 화면에 안 보여주므로, 안 보여줄 판정을 얻자고 Azure를 호출할 이유가 없다.
   * qab_results.is_correct는 NOT NULL이라 이 상태를 담을 수 없었다.
   */
  @Column({ name: 'is_correct', type: 'boolean', nullable: true })
  isCorrect: boolean | null;

  /**
   * 이 문항의 비용 계층. 0 = 터치(Azure 0), 1 = 발화·녹음만(Azure 0),
   * 2 = 발화·채점(Azure 1회).
   *
   * 연습 모드 재설계의 근거가 세션당 Azure 40회 → 6회였다. 근거는 실측 가능해야
   * 주장으로 남지 않는다.
   */
  @Column({ name: 'tier', type: 'smallint' })
  tier: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
