export const LOGGING_CONFIG = {
  // Controla se os logs estão habilitados
  enabled: process.env.NODE_ENV === 'development',

  // Controla logs de objetos grandes (mais de 500 bytes)
  logLargeObjects: false,

  // Controla logs de objetos muito grandes (mais de 10KB)
  logVeryLargeObjects: false,

  // Controla logs de arrays grandes (mais de 100 itens)
  logLargeArrays: false,

  // Controla logs de objetos aninhados profundos (mais de 3 níveis)
  logDeepObjects: false,

  // Controla logs de dados sensíveis (senhas, tokens, etc.)
  logSensitiveData: false,

  // Controla logs de requisições HTTP
  logHttpRequests: true,

  // Controla logs de erros
  logErrors: true,

  // Controla logs de warnings
  logWarnings: true,

  // Controla logs de informações gerais
  logInfo: true,

  // Controla logs de debug
  logDebug: process.env.NODE_ENV === 'development',

  // Tamanho máximo de objetos para log completo (em bytes)
  maxObjectSizeForFullLog: 500,

  // Tamanho máximo de arrays para log completo (número de itens)
  maxArraySizeForFullLog: 50,

  // Profundidade máxima de objetos para log completo
  maxObjectDepthForFullLog: 3,

  // Campos sensíveis que devem ser mascarados
  sensitiveFields: ['password', 'token', 'secret', 'key', 'authorization', 'cookie', 'session'],
};

export const shouldLogObject = (obj: any): boolean => {
  if (!LOGGING_CONFIG.enabled) return false;

  try {
    const jsonString = JSON.stringify(obj);
    const size = jsonString.length;

    if (size > LOGGING_CONFIG.maxObjectSizeForFullLog && !LOGGING_CONFIG.logLargeObjects) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

export const maskSensitiveData = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;

  const masked = { ...obj };

  for (const field of LOGGING_CONFIG.sensitiveFields) {
    if (masked.hasOwnProperty(field)) {
      masked[field] = '***MASKED***';
    }
  }

  return masked;
};

export const truncateLargeObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;

  try {
    const jsonString = JSON.stringify(obj);
    const size = jsonString.length;

    if (size > LOGGING_CONFIG.maxObjectSizeForFullLog) {
      return {
        _truncated: true,
        _originalSize: size,
        _truncatedAt: new Date().toISOString(),
        _sample: Array.isArray(obj) ? obj.slice(0, 5) : Object.keys(obj).slice(0, 5),
      };
    }

    return obj;
  } catch {
    return { _error: 'Could not serialize object' };
  }
};
