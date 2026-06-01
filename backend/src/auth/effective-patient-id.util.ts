import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { UserRole } from './entities/user.entity';

/**
 * 환자 데이터 접근의 "유효 환자 ID" 도출 (순수 함수)
 *
 * 보호자 단일 계정 모델: 환자는 직접 로그인하지 않고, 보호자가 자신의 계정으로
 * 환자 모드에 진입한다. "지금 어느 환자인가"는 항상 토큰(req.user) 기준으로
 * 서버에서 도출하며, 클라이언트 입력 patientId를 신뢰하지 않는다.
 *
 *   role === 'patient'   → user.id        (하위호환: 기존 환자 직접 로그인)
 *   role === 'caregiver' → user.patientId  (연결된 환자, 없으면 400)
 *   그 외(therapist 등)  → 403
 *
 * 불변식: JWT payload에 role/patientId를 넣지 않고, 매 요청 validateUser가
 * DB에서 최신 User를 조회하므로 user.patientId는 항상 fresh하다. 이 불변식을
 * 깨고 토큰 클레임으로 최적화하면 클라이언트 신뢰 차단이 무너진다 — 변경 금지.
 */
export function resolveEffectivePatientId(user: {
  id: string;
  role: UserRole;
  patientId: string | null;
}): string {
  if (user.role === 'patient') {
    return user.id;
  }
  if (user.role === 'caregiver') {
    if (!user.patientId) {
      throw new BadRequestException('연결된 환자가 없습니다.');
    }
    return user.patientId;
  }
  throw new ForbiddenException('환자 데이터에 접근할 수 없는 역할입니다.');
}
