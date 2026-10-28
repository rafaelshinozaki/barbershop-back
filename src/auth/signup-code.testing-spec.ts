/**
 * Apoio dos testes (fica fora do build e não é uma suíte): Redis em memória
 * com o que o código do cadastro usa, e um código pronto para um e-mail.
 */
export function memoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      exists: async (k: string) => (store.has(k) ? 1 : 0),
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string, ...opts: unknown[]) => {
        if (opts.includes('NX') && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      },
      del: async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0),
      incr: async (k: string) => {
        const v = Number(store.get(k) ?? 0) + 1;
        store.set(k, String(v));
        return v;
      },
      ttl: async (k: string) => (store.has(k) ? 600 : -2),
      expire: async () => 1,
      // Só o que o bloqueio de login usa: set e del em sequência
      multi() {
        const ops: Array<() => void> = [];
        const chain = {
          set: (k: string, v: string) => (ops.push(() => store.set(k, v)), chain),
          del: (k: string) => (ops.push(() => store.delete(k)), chain),
          exec: async () => ops.map((op) => op()),
        };
        return chain;
      },
    },
  };
}

/** Grava um código válido para o e-mail (como se tivesse chegado na caixa de entrada) */
export function presetSignupCode(redis: ReturnType<typeof memoryRedis>, email: string) {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  redis.store.set(`auth:signup-code:${email.trim().toLowerCase()}`, code);
  return code;
}
