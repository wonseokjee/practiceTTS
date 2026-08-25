import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 소셜 로그인 CSRF state 검증에 httpOnly 쿠키를 쓴다(oauth-state.ts).
  app.use(cookieParser());

  // 프론트 origin 허용. 소셜 콜백 후 프론트가 /auth/token을 교차 출처로 호출하므로,
  // 프로덕션에서도 정확한 origin이어야 한다. FRONTEND_URL과 정렬한다(미설정 시 dev).
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  // 전역 유효성 검사 파이프 등록 (class-validator 적용)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 정의되지 않은 필드 자동 제거
      forbidNonWhitelisted: true, // 허용되지 않은 필드 포함 시 400 에러
      transform: true, // 요청 데이터를 DTO 클래스 인스턴스로 변환
    }),
  );

  // 메모리 이미지는 정적 서빙하지 않는다.
  //
  // 예전에는 여기서 `app.useStaticAssets`로 /uploads/memory-images 전체를
  // 인증 없이 열어두고 "UUID 파일명으로 보안 확보"라고 적어두었다. UUID는
  // 추측 방어일 뿐 접근 통제가 아니다 — URL이 Referer, 프록시 캐시, 액세스
  // 로그, 공유된 스크린샷 중 어디로든 새면 무효화할 수단이 없다. 환자와
  // 가족의 얼굴 사진이라 영향이 크다.
  //
  // 같은 경로를 MemoryPhotoController가 JWT + 소유권 확인 후 서빙한다.
  // 여기에 useStaticAssets를 되살리면 컨트롤러보다 먼저 매칭되어 접근
  // 통제가 통째로 무력화된다 — 되살리지 말 것.

  await app.listen(process.env.PORT ?? 3000);
}
// 부팅 실패를 삼키지 않는다. 떠 있지도 않은 서버를 정상 종료로 보고하면
// 프로세스 관리자가 재시작하지 않는다.
bootstrap().catch((err: unknown) => {
  console.error('부팅 실패:', err);
  process.exit(1);
});
