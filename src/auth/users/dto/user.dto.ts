// src\auth\users\dto\user.dto.ts
import { AddressSchema } from '../models/address.schema';
import { EmailNotificationSchema } from '../models/emailNotification.schema';
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
  company: string;
  jobTitle?: string;
  department?: string;
  professionalSegment: string;
  knowledgeApp: string;
  readTerms: boolean;
  membership: string;
  isActive: boolean;
  plan?: string;
  subscriptionStatus?: string;
  birthdate: Date;
  address: AddressSchema;
  userSystemConfig: UserSystemConfigDTO;
  emailNotification: EmailNotificationSchema;
  twoFactorEnabled: boolean;
  photoKey?: string;
  role?: { id: number; name: string };
  stripeCustomerId?: string;
}
