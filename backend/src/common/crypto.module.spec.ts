import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CryptoModule } from './crypto.module';
import { CryptoService } from '../memory/services/crypto.service';

/**
 * CryptoService 인스턴스가 하나뿐인지 고정한다.
 *
 * 배경: memory·profile·training 세 모듈이 각자 provider로 등록해 인스턴스가
 * 3개였다. 부팅 시 scryptSync가 3번 돌아(실측 77ms x 3 = 231ms) 시간을
 * 낭비했고, 키 미설정 경고도 3번 찍혔다.
 *
 * 더 중요한 건 잠재 위험이다. 지금은 상태가 없어 무해하지만, 키 회전이나
 * 파생 키 캐시가 들어가는 순간 세 인스턴스가 각자 다른 상태를 갖는다.
 * 그때는 증상이 조용하고 재현이 어렵다.
 */
describe('CryptoModule', () => {
  it('모듈을 두 번 주입해도 같은 인스턴스다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), CryptoModule],
    }).compile();

    const a = moduleRef.get(CryptoService);
    const b = moduleRef.get(CryptoService);

    expect(a).toBe(b);
  });

  it('CryptoService를 provider로 직접 등록한 모듈이 없다', () => {
    // 여기가 회귀 지점이다. 새 모듈이 편의상 providers에 CryptoService를
    // 넣으면 인스턴스가 다시 늘어나고, 그 사실은 부팅 로그의 경고 개수로만
    // 드러난다 — 아무도 안 본다. 기계가 막는다.
    const srcDir = join(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith('.module.ts')) {
          const source = readFileSync(full, 'utf-8');
          // crypto.module.ts 자신은 당연히 등록한다.
          if (full.endsWith('crypto.module.ts')) continue;
          // providers 배열 안에 CryptoService가 들어있는지 본다.
          const providers = source.match(/providers:\s*\[[\s\S]*?\]/);
          if (providers && /\bCryptoService\b/.test(providers[0])) {
            offenders.push(name);
          }
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
