import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CryptoService } from '../memory/services/crypto.service';

/**
 * 암호화 서비스를 **한 번만** 만들어 공유한다.
 *
 * 예전에는 memory·profile·training 세 모듈이 각자 CryptoService를 provider로
 * 등록했다. 주석에는 "ConfigService만 의존하므로 안전하게 재등록"이라 적혀
 * 있었고 오늘 기준으로는 맞는 말이지만, 대가가 있었다:
 *
 *   - 인스턴스가 3개라 부팅 시 scryptSync가 3번 돈다. scrypt는 **일부러
 *     느리게** 설계된 함수라 실측 77ms x 3 = 231ms를 순수하게 낭비했다.
 *   - 키 미설정 경고도 3번 찍혀 부팅 로그가 지저분했다.
 *   - 그리고 이게 더 중요한데, 나중에 이 서비스가 상태를 갖게 되면
 *     (키 회전, 파생 키 캐시 등) **세 인스턴스가 각자 다른 상태를 갖는다.**
 *     그때는 증상이 조용하고 재현이 어렵다.
 *
 * 여기로 모으면 셋 다 사라진다. 새로 쓰는 모듈도 CryptoService가 필요하면
 * 직접 provider에 넣지 말고 이 모듈을 import할 것.
 */
@Module({
  imports: [ConfigModule],
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
