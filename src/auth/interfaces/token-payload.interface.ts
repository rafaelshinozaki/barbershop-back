// src\auth\interfaces\token-payload.interface.ts
export type TokenPayload = {
  userId: number;
  email: string;
  sessionToken: string;
  /** "Lembrar de mim" marcado no login */
  remember?: boolean;
};
