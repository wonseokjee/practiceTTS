import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { QabSubtest } from '../constants/qab-subtest';
import type { QabFoilKind } from '../constants/qab-foil-kind';

/**
 * QAB 질문형 검사 결과 1행 (항목 단위).
 *
 * QAB 문항은 프론트에서 생성되어 quiz_question 테이블에 없으므로, quiz_attempt를
 * 재사용할 수 없다. 회복 추적(보호자 가시성)을 위한 별도 경량 결과 테이블이다.
 *
 *  - subtest : 검사 종류(word/sentence/naming/repeat/reading/ddk)
 *  - itemRef : 프론트 문항 식별자(추적/디버깅용, 문자열)
 *  - isCorrect: 정오답(이해/말하기), ddk는 목표 도달 여부
 *  - metric  : 수치형 지표(현재 ddk 감지 횟수). 그 외 검사는 null.
 */
@Entity('qab_results')
@Index('IDX_qab_results_patient_subtest', ['patientId', 'subtest'])
@Index('IDX_qab_results_session', ['sessionToken'])
// 멱등성: 같은 세션의 같은 문항 결과는 1행만. 재시도/중복 제출 시 추세 이중 집계 방지.
@Index(
  'UQ_qab_results_dedup',
  ['patientId', 'sessionToken', 'subtest', 'itemRef'],
  {
    unique: true,
  },
)
export class QabResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_qab_results_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'session_token', type: 'uuid' })
  sessionToken: string;

  @Column({ name: 'subtest', type: 'varchar', length: 16 })
  subtest: QabSubtest;

  @Column({ name: 'item_ref', type: 'varchar', length: 100 })
  itemRef: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect: boolean;

  // 보호자가 "넘어가기"로 통과시킨 문항(도움받음). 회복 추세 정확도 집계에서 제외한다.
  @Column({ name: 'assisted', type: 'boolean', default: false })
  assisted: boolean;

  /**
   * 채점 불가 — 음향 발음 평가를 얻지 못해 **판정을 내리지 않은** 문항.
   *
   * assisted와 다르다. assisted는 "보호자가 도와서 통과시켰다"(수행은 있었으나
   * 환자 혼자 한 것이 아니다)이고, unscored는 "**잴 수 없었다**"이다. 오답이
   * 아니라 측정 실패다.
   *
   * 이 행의 is_correct는 의미가 없다(false로 들어온다). 집계·레벨링은 반드시
   * 이 플래그로 걸러야 한다 — 아래 쿼리들이 그렇게 한다.
   */
  @Column({ name: 'unscored', type: 'boolean', default: false })
  unscored: boolean;

  /**
   * 틀렸을 때 고른 오답의 갈래 — 단어이해(word)에만 값이 있다.
   *
   *  - semantic      같은 의미 범주 오답('사과'에 대한 '바나나')
   *  - phonological  소리가 닮은 다른 범주 오답('사과'에 대한 '사자')
   *  - unrelated     둘 다 아닌 오답
   *
   * 의미 오답을 반복해 고르는 것과 음운 오답을 반복해 고르는 것은 서로 다른
   * 손상이다. 정답률 하나로는 구분되지 않아 이 컬럼이 필요하다.
   *
   * **NULL이 정상이다** — 맞힌 문항, 단어이해가 아닌 하위검사, 컬럼 이전의 옛 행.
   * 집계는 NULL을 세지 않는다. 기본값을 채워 "모름"을 "무관"으로 바꾸면 없는
   * 사실이 생긴다.
   *
   * **채점에 쓰지 않는다.** 정확도·레벨 재계산은 이 값을 보지 않는다. 낱말 뱅크가
   * 프론트에 있어 서버가 되짚을 수 없는 클라이언트 관측값이라, 측정에 물리면
   * 안 된다(presented_level은 서버가 확정하는 것과 대비된다).
   */
  @Column({ name: 'foil_kind', type: 'varchar', length: 16, nullable: true })
  foilKind: QabFoilKind | null;

  /**
   * 이 문항이 **레벨이 요구한 밴드 밖**에서 왔는가(M22).
   *
   * 뱅크는 후보가 모자라면 범위를 풀어 세션이 비지 않게 한다. 옳은 선택이지만
   * 그렇게 나온 문항의 `presented_level`은 실제 난이도를 뜻하지 않는다.
   *
   * **NULL이 정상이다** — 컬럼 이전의 행, 클라이언트가 안 보낸 행. 기본값 false를
   * 넣으면 "모름"이 "폴백 아님"이 되어 없는 사실이 생긴다. `foil_kind`와 같은
   * 성격의 관측값이고 채점에 쓰지 않는다.
   */
  @Column({ name: 'band_fallback', type: 'boolean', nullable: true })
  bandFallback: boolean | null;

  /**
   * 이름대기에서 제시된 그림의 종류 — `'photo'` | `'svg'`(M22).
   *
   * 자극의 33%(30/91)가 사진이 없어 SVG로 떨어진다. 둘은 이름을 떠올리는 난이도가
   * 달라, 안 남기면 이름대기 정답률이 무엇을 잰 값인지 알 수 없다.
   */
  @Column({
    name: 'stimulus_kind',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  stimulusKind: string | null;

  /**
   * 이 행이 어느 정적 문항 풀 기준인가(M23).
   *
   * `presented_level`은 "레벨 3에서 제시했다"만 말하고, 그 3이 무엇을 뜻하는지는
   * 그때의 문항 풀이 정한다. 풀이 바뀌면 같은 숫자가 다른 난이도가 된다.
   *
   * **NULL이 정상이다** — 컬럼 이전의 행, 버전을 안 보낸 옛 클라이언트.
   * 관측값이라 채점에 쓰지 않는다.
   */
  @Column({ name: 'manifest_version', type: 'smallint', nullable: true })
  manifestVersion: number | null;

  /**
   * 이 수행이 어느 언어였는가 (M27, BCP 47).
   *
   * **환자 로케일이고, 세션 시작 시점에 고정한 값이다**(계획 §7-7 B). 문항을
   * 푼 것은 환자이므로 보호자 로케일은 이 행에 뜻이 없다.
   *
   * 세션 중에 설정이 바뀌어도 이 행에는 시작할 때의 값이 박힌다. 한 세션에
   * 두 언어가 섞이면 그 회차 점수가 서로 다른 자로 재서 합산한 값이 되는데,
   * `pronunciationScore`가 문자열 폴백을 금지한 것과 같은 종류의 오염이다.
   *
   * **NULL이 정상이다** — `manifest_version`과 같은 모양이다. 컬럼 이전의 행,
   * 값을 안 보내는 옛 클라이언트. 기본값을 채워 "모름"을 특정 로케일로 바꾸면
   * 없는 사실이 생긴다.
   */
  @Column({ name: 'locale', type: 'varchar', length: 8, nullable: true })
  locale: string | null;

  // ddk 감지 횟수 등 수치 지표(없으면 null)
  @Column({ name: 'metric', type: 'int', nullable: true })
  metric: number | null;

  // 발음 정확도 점수(0~100). 따라말하기/읽기 등 발화 항목만 기록(그 외 null).
  // 보호자용 발음 추세 집계에 사용한다.
  @Column({ name: 'score', type: 'int', nullable: true })
  score: number | null;

  /**
   * 발음 세부 점수(0~100, M24) — `score`(종합점수)를 만드는 데 쓰인 원값들이다.
   *
   * **채점에 쓰지 않는다.** `score`·`isCorrect`는 이미 확정된 결과이고, 이
   * 컬럼들은 그 결과가 어떻게 나왔는지 보려는 관측용이다. unscored 행은 셋 다
   * NULL이다(score와 같은 규약) — 서비스가 채점 불가면 지운다.
   *
   * accuracy는 word·sentence 둘 다 있다. completeness·fluency는 지금 채점에
   * 안 쓰이는 검사(word)에서도 Azure가 값을 주므로 그대로 남긴다 — 나중에
   * 가중치를 조정하려면 검사 종류와 무관하게 분포가 필요하다.
   */
  @Column({ name: 'accuracy_score', type: 'smallint', nullable: true })
  accuracyScore: number | null;

  @Column({ name: 'completeness_score', type: 'smallint', nullable: true })
  completenessScore: number | null;

  @Column({ name: 'fluency_score', type: 'smallint', nullable: true })
  fluencyScore: number | null;

  // 이 항목이 제시된 난이도 레벨(1~5). 적응형 레벨링의 윈도우를 "현재 레벨에서
  // 제시된 항목"으로 한정해 능력과 제시 난이도의 교란을 막는다. 컬럼 추가 이전
  // 구데이터는 null(레벨링 윈도우에서 제외).
  /**
   * 이름대기에서 **얼마나 도와야 맞혔나**(E18). NULL이면 단서 개념이 없는
   * 하위검사이거나 이 기능 이전의 기록이다.
   *
   *   0 무단서 · 1 의미 단서 · (2 문장 완성 — 미구현) · 3 음소 단서 · 4 통과
   *
   * `assisted`를 대체하지 않는다. `cue_level >= 1`이면 둘 다 참이다 —
   * 기존 통계가 `NOT r.assisted`로 거르고 있어 그 뜻을 유지해야 한다.
   */
  @Column({ name: 'cue_level', type: 'smallint', nullable: true })
  cueLevel: number | null;

  @Column({ name: 'presented_level', type: 'smallint', nullable: true })
  presentedLevel: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
