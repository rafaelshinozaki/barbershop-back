export type ClientTokenPayload = {
  clientAccountId: number;
  email: string;
  /** sessionVersion da conta quando o cookie foi emitido */
  v?: number;
};
