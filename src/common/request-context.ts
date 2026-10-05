import { AsyncLocalStorage } from 'async_hooks';

/** Quem está agindo neste request (vai pro histórico de alterações) */
export type ChangeActor = {
  /** user = conta do app; client = cliente final; staff = equipe da plataforma */
  type: 'user' | 'client' | 'staff';
  id: number;
  name?: string | null;
  role?: string | null;
  /** app = app das barbearias/cliente; backoffice = API do backoffice */
  origin: 'app' | 'backoffice';
  /** Motivo informado (ex.: suspensão pela equipe da plataforma) */
  reason?: string | null;
};

export type RequestContext = {
  requestId?: string;
  actor?: ChangeActor;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Contexto do request (id e quem está agindo), sem passar parâmetro por toda
 * a aplicação. O middleware abre no começo do request; o
 * ChangeActorInterceptor preenche o autor depois do login (guards).
 */
export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  setActor(actor: ChangeActor | undefined): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
};

type Req = { requestId?: string };

/** Abre o contexto do request (depois do requestIdMiddleware) */
export function requestContextMiddleware(req: Req, _res: unknown, next: () => void): void {
  requestContext.run({ requestId: req.requestId }, next);
}

/**
 * JSON que vai em set_config('app.actor', …, true) na transação; o gatilho
 * do histórico lê. Sem autor (job, script, request sem login): undefined, e
 * a alteração fica como "sistema".
 */
export function actorSetting(context: RequestContext | undefined): string | undefined {
  const actor = context?.actor;
  if (!actor) return undefined;
  return JSON.stringify({
    type: actor.type,
    id: actor.id,
    name: actor.name ?? null,
    role: actor.role ?? null,
    origin: actor.origin,
    reason: actor.reason ?? null,
    requestId: context?.requestId ?? null,
  });
}
