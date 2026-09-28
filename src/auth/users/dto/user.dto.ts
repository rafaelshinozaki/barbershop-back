// src\auth\users\dto\user.dto.ts
import { AddressSchema } from '../models/address.schema';
import { NotificationPreferenceSchema } from '../models/notificationPreference.schema';
import { UserSystemConfigDTO } from './userSystemConfig.dto';

export class UserDTO {
  id: number;
  provider: string;
  email: string;
  password: string;
  fullName: string;
  gender: string;
  phone: string;
  idDocNumber: string;
  readTerms: boolean;
  membership: string;
  isActive: boolean;
  plan?: string;
  subscriptionStatus?: string;
  birthdate: Date;
  address: AddressSchema | null;
  userSystemConfig: UserSystemConfigDTO | null;
  notificationPreference: NotificationPreferenceSchema | null;
  twoFactorEnabled: boolean;
  photoKey?: string | null;
  role?: { id: number; name: string };
  stripeCustomerId?: string | null;
  /** Identificador da sessão atual (do JWT) — usado para distinguir "esta sessão" das demais, nunca o IP */
  sessionToken?: string;
}
