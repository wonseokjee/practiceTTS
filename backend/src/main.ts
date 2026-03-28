import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // React 개발 서버에서의 CORS 요청 허용
  app.enableCors({
    origin: 'http://localhost:5173',
    credentials: true,
  });

  // 전역 유효성 검사 파이프 등록 (class-validator 적용)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,      // DTO에 정의되지 않은 필드 자동 제거
      forbidNonWhitelisted: true, // 허용되지 않은 필드 포함 시 400 에러
      transform: true,      // 요청 데이터를 DTO 클래스 인스턴스로 변환
    }),
  );

  // 메모리 이미지 정적 파일 서빙 (인증 없이 공개 접근 허용 - UUID 파일명으로 보안 확보)
  app.useStaticAssets(
    join(process.cwd(), '..', 'tts-cache', 'memory-images'),
    { prefix: '/uploads/memory-images' },
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

