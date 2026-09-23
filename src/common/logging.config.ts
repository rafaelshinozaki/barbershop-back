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

// Chaves que nunca vão pro log, em qualquer nível do objeto: senha/hash,
// tokens, segredos, códigos de verificação e documento (CPF etc.)
const SENSITIVE_KEY =
  /pass(word)?|token|secret|api[-_]?key|authorization|cookie|session|^code$|verificationcode|iddoc|cpf|cnpj/i;

export const maskSensitiveData = (obj: any, depth = 0): any => {
  if (!obj || typeof obj !== 'object' || depth > 5) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map((item) => maskSensitiveData(item, depth + 1));

  const masked: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    masked[key] =
      SENSITIVE_KEY.test(key) || LOGGING_CONFIG.sensitiveFields.includes(key)
        ? '***MASKED***'
        : maskSensitiveData(value, depth + 1);
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
