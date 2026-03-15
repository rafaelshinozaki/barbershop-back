import { SetMetadata } from '@nestjs/common';

export const THROTTLE_LIMIT = 'throttle:limit';
export const THROTTLE_TTL = 'throttle:ttl';

export const Throttle = (limit: number, ttl: number) => SetMetadata(THROTTLE_LIMIT, { limit, ttl });

// Decorators específicos para diferentes tipos de endpoints
export const ThrottleAuth = () => Throttle(5, 60000); // 5 tentativas por minuto para auth
export const ThrottleLogin = () => Throttle(3, 300000); // 3 tentativas por 5 minutos para login
export const ThrottlePasswordReset = () => Throttle(2, 900000); // 2 tentativas por 15 minutos para reset
export const ThrottleEmail = () => Throttle(10, 3600000); // 10 emails por hora
export const ThrottleUpload = () => Throttle(20, 3600000); // 20 uploads por hora
