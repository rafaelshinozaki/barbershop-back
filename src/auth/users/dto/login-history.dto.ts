export class LoginHistoryDTO {
  ip: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  deviceType: string;
  os: string;
  browser: string;
  /** Sessão aberta por esse login, se ainda estiver ativa */
  sessionId?: number | null;
  isCurrent?: boolean;
  createdAt: string;
}
