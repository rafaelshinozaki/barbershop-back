// src\common\contants.ts
// Status dos planos
export enum PLANO_STATUS {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// Status dos pagamentos
export enum PAGAMENTO_STATUS {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

export enum MEMBERSHIP_STATUS {
  FREE = 'FREE',
  PAID = 'PAID',
  PAST_DUE = 'PAST_DUE',
}

export const CHANGE_PASSWORD_CODE_EXPIRY_MINUTES = 10;
export const TWO_FACTOR_CODE_EXPIRY_MINUTES = 5;
export const CHANGE_PASSWORD_MAX_ATTEMPTS = 6;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_BLOCK_MINUTES = 15;
