import { Throttle as NestThrottle } from '@nestjs/throttler';

// Decorators para endpoints sensíveis a força bruta/abuso (login, reset de
// senha, criação de conta, envio de código, etc).
//
// Usam o decorator real do @nestjs/throttler, sobrescrevendo o throttler
// nomeado 'default' (configurado em app.module.ts) com um limite mais
// restrito para a rota decorada. A versão anterior destes decorators
// chamava SetMetadata com chaves próprias ('throttle:limit'/'throttle:ttl')
// que o ThrottlerGuard real nunca lê — nenhum destes limites era de fato
// aplicado. Corrigido junto com o guard global (GraphQLThrottleGuard,
// registrado como APP_GUARD em app.module.ts).
export const ThrottleAuth = () => NestThrottle({ default: { limit: 5, ttl: 60000 } }); // 5 tentativas por minuto
export const ThrottleLogin = () => NestThrottle({ default: { limit: 3, ttl: 300000 } }); // 3 tentativas por 5 minutos
export const ThrottlePasswordReset = () => NestThrottle({ default: { limit: 2, ttl: 900000 } }); // 2 tentativas por 15 minutos
export const ThrottleEmail = () => NestThrottle({ default: { limit: 10, ttl: 3600000 } }); // 10 envios por hora
export const ThrottleUpload = () => NestThrottle({ default: { limit: 20, ttl: 3600000 } }); // 20 uploads por hora
