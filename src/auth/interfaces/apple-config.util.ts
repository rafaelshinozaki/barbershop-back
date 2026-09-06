import { ConfigService } from '@nestjs/config';

// Apple Sign In precisa de credenciais reais (Services ID, Team ID, Key ID e
// a chave privada .p8) que só existem depois de configurar um app no Apple
// Developer Portal — diferente de DISABLE_SOCIAL_SSO (que liga/desliga
// Google/Facebook juntos), aqui checamos se a Apple especificamente já foi
// configurada, para devolver 404 (em vez de redirecionar para a Apple com
// client_id inválido) enquanto isso não acontece.
export function isAppleConfigured(
  configService: ConfigService,
  callbackUrlKey: 'APPLE_CALLBACK_URL' | 'APPLE_CLIENT_CALLBACK_URL' = 'APPLE_CALLBACK_URL',
): boolean {
  if (configService.get<boolean>('DISABLE_SOCIAL_SSO')) return false;
  return Boolean(
    configService.get<string>('APPLE_CLIENT_ID') &&
      configService.get<string>('APPLE_TEAM_ID') &&
      configService.get<string>('APPLE_KEY_ID') &&
      configService.get<string>('APPLE_PRIVATE_KEY') &&
      configService.get<string>(callbackUrlKey),
  );
}
