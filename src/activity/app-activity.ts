/**
 * Trilha do que as pessoas fazem no app (Axiom). Um evento por escrita
 * (mutation GraphQL ou rota REST que não é GET): quem, cargo, unidade,
 * operação, entidade, se deu certo e o id do request. Só ids: nada de nome,
 * e-mail, telefone, texto de chat, endereço, ficha de saúde, senha ou token.
 */
export interface AppActivityEvent {
  _time: string;
  requestId: string;
  actorType: 'user' | 'client' | 'anonymous';
  actorId: number | null;
  role: string | null;
  barbershopId: number | null;
  operation: string;
  entityType: string | null;
  entityId: number | null;
  success: boolean;
  /** Tipo do erro (nome da classe ou código), nunca a mensagem inteira */
  errorType: string | null;
}

export interface AxiomConfig {
  token: string;
  dataset: string;
  url: string;
}

/** AXIOM_TOKEN e AXIOM_DATASET vazios = trilha desligada */
export function axiomConfig(env: NodeJS.ProcessEnv): AxiomConfig | undefined {
  const token = env.AXIOM_TOKEN?.trim();
  const dataset = env.AXIOM_DATASET?.trim();
  if (!token || !dataset) return undefined;
  return {
    token,
    dataset,
    url: (env.AXIOM_URL?.trim() || 'https://api.axiom.co').replace(/\/$/, ''),
  };
}

const VERBS =
  /^(create|update|delete|remove|set|add|cancel|reschedule|confirm|complete|start|finish|close|open|accept|reject|send|mark|toggle|save|upsert|report|block|unblock|request|reply|answer|submit|join|leave|invite|link|unlink|register|pay|refund)/;

/** "cancelAppointment" → "Appointment"; sem verbo conhecido, null */
export function entityFromOperation(operation: string): string | null {
  const match = operation.match(VERBS);
  if (!match) return null;
  const rest = operation.slice(match[0].length);
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

const asId = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v)
    ? v
    : typeof v === 'string' && /^\d+$/.test(v)
    ? Number(v)
    : null;

/**
 * Ids que dizem sobre o que foi a ação, olhando os argumentos (e o `input`
 * ou `data` dentro deles). Só ids saem daqui; o resto dos argumentos, não.
 */
export function idsFromArgs(args: unknown): {
  barbershopId: number | null;
  entityType: string | null;
  entityId: number | null;
} {
  const bags: Record<string, unknown>[] = [];
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const top = args as Record<string, unknown>;
    bags.push(top);
    for (const key of ['input', 'data', 'params', 'body']) {
      const inner = top[key];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        bags.push(inner as Record<string, unknown>);
      }
    }
  }
  let barbershopId: number | null = null;
  let entityType: string | null = null;
  let entityId: number | null = null;
  for (const bag of bags) {
    for (const [key, value] of Object.entries(bag)) {
      const id = asId(value);
      if (id == null) continue;
      if (key === 'barbershopId' || key === 'shopId') {
        barbershopId ??= id;
        continue;
      }
      const m = key.match(/^(\w+)Id$/);
      if (m && entityId == null) {
        entityType = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        entityId = id;
      } else if (key === 'id' && entityId == null) {
        entityId = id;
      }
    }
  }
  return { barbershopId, entityType, entityId };
}

/** Tipo do erro, sem a mensagem (ela pode ter dado pessoal) */
export function errorType(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { extensions?: { code?: unknown }; code?: unknown }).extensions?.code;
    if (typeof code === 'string') return code;
    const status = (error as { getStatus?: () => number }).getStatus?.();
    if (typeof status === 'number') return String(status);
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'Error';
}
