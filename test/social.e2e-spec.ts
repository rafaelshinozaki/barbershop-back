import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GoogleAuthGuard } from '../src/auth/guards/google-auth.guard';
import { FacebookAuthGuard } from '../src/auth/guards/facebook-auth.guard';

class MockGoogleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    if (req.url.includes('redirect')) {
      req.user = { email: 'google@test.com', displayName: 'Google User' };
      return true;
    }
    res.redirect('https://google.test');
    return false;
  }
}

class MockFacebookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    if (req.url.includes('redirect')) {
      req.user = { email: 'facebook@test.com', displayName: 'Facebook User' };
      return true;
    }
    res.redirect('https://facebook.test');
    return false;
  }
}

describe('Social Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(GoogleAuthGuard)
      .useClass(MockGoogleGuard)
      .overrideGuard(FacebookAuthGuard)
      .useClass(MockFacebookGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/auth/google redirects', async () => {
    const res = await request(app.getHttpServer()).get('/auth/google');
    expect(res.status).toBe(302);
  });

  it('/auth/google/redirect sets cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/google/redirect');
    expect(res.status).toBe(302);
    expect(res.header['set-cookie'].some((c: string) => c.includes('Authentication'))).toBe(true);
  });

  it('/auth/facebook redirects', async () => {
    const res = await request(app.getHttpServer()).get('/auth/facebook');
    expect(res.status).toBe(302);
  });

  it('/auth/facebook/redirect sets cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/facebook/redirect');
    expect(res.status).toBe(302);
    expect(res.header['set-cookie'].some((c: string) => c.includes('Authentication'))).toBe(true);
  });
});
