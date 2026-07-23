import { MemoryEntry } from '../entities/memory-entry.entity';
import { PatientMemoryNote } from '../entities/patient-memory-note.entity';
import { toMemoryEntryResponseDto } from './memory-entry-response.dto';

/**
 * 응답 DTO 보안 회귀 테스트 (§9-3, W4 위험 완화)
 *
 * 핵심 검증:
 *  - Public DTO에 보호자 사적 데이터(mood, caregiverReflection) 절대 미포함
 *  - patientNotes는 orderIndex 오름차순으로 정렬
 *  - caregiverWishMessage는 노출 (Phase 6 환자 화면)
 */
describe('MemoryEntryResponseDto (Public)', () => {
  function buildEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: 'entry-id',
      patientId: 'patient-id',
      caregiverId: 'caregiver-id',
      photoUrl: '/uploads/memory-images/p.jpg',
      locationTag: '집',
      objectTags: ['책'],
      emotionTag: 'calm',
      targetWords: ['책'],
      maskedContext: 'encrypted',
      scenarioCache: 'cache',
      isActive: true,
      caregiverWishMessage: '사랑해요',
      createdAt: new Date('2026-05-17T10:00:00.000Z'),
      caregiver: undefined as never,
      patient: undefined as never,
      ...overrides,
    } as MemoryEntry;
  }

  function buildNote(
    overrides: Partial<PatientMemoryNote> = {},
  ): PatientMemoryNote {
    return {
      id: 'note-id',
      memoryEntryId: 'entry-id',
      memoryEntry: undefined as never,
      question: undefined as never,
      questionId: 'q-id',
      category: 'activity',
      orderIndex: 0,
      answerText: '공원에서 산책',
      createdAt: new Date(),
      ...overrides,
    } as PatientMemoryNote;
  }

  it('Public DTO에는 mood 필드가 존재하지 않는다', () => {
    // Given
    const entry = buildEntry();

    // When
    const dto = toMemoryEntryResponseDto(entry, []);

    // Then — TS 타입과 런타임 양쪽 모두에서 부재 확인
    expect('mood' in dto).toBe(false);
  });

  it('Public DTO에는 caregiverReflection 필드가 존재하지 않는다', () => {
    // Given
    const entry = buildEntry();

    // When
    const dto = toMemoryEntryResponseDto(entry, []);

    // Then
    expect('caregiverReflection' in dto).toBe(false);
  });

  it('patientNotes는 orderIndex 오름차순으로 정렬되어 노출된다', () => {
    // Given — 의도적으로 뒤섞인 순서
    const entry = buildEntry();
    const notes = [
      buildNote({
        id: 'n2',
        orderIndex: 2,
        category: 'context',
        answerText: '집',
      }),
      buildNote({
        id: 'n0',
        orderIndex: 0,
        category: 'activity',
        answerText: '공원',
      }),
      buildNote({
        id: 'n1',
        orderIndex: 1,
        category: 'moment',
        answerText: '웃음',
      }),
    ];

    // When
    const dto = toMemoryEntryResponseDto(entry, notes);

    // Then
    expect(dto.patientNotes.map((n) => n.orderIndex)).toEqual([0, 1, 2]);
    expect(dto.patientNotes[0].category).toBe('activity');
    expect(dto.patientNotes[1].category).toBe('moment');
    expect(dto.patientNotes[2].category).toBe('context');
  });

  it('caregiverWishMessage는 저장값 그대로 노출되며, null이면 null로 노출된다', () => {
    // Given
    const entryWithMessage = buildEntry({ caregiverWishMessage: '사랑해' });
    const entryWithout = buildEntry({ caregiverWishMessage: null });

    // When
    const dtoWith = toMemoryEntryResponseDto(entryWithMessage, []);
    const dtoWithout = toMemoryEntryResponseDto(entryWithout, []);

    // Then
    expect(dtoWith.caregiverWishMessage).toBe('사랑해');
    expect(dtoWithout.caregiverWishMessage).toBeNull();
  });

  it('hasScenario/hasMaskedContext는 원문을 노출하지 않고 boolean만 노출한다', () => {
    // Given
    const entry = buildEntry();

    // When
    const dto = toMemoryEntryResponseDto(entry, []);

    // Then
    expect(dto.hasScenario).toBe(true);
    expect(dto.hasMaskedContext).toBe(true);
    expect('scenarioCache' in dto).toBe(false);
    expect('maskedContext' in dto).toBe(false);
  });
});
