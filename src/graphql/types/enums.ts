import { registerEnumType } from '@nestjs/graphql';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  BARBERSHOP_OWNER = 'BARBERSHOP_OWNER',
  BARBERSHOP_EMPLOYEE = 'BARBERSHOP_EMPLOYEE',
}

export enum MembershipStatus {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
  PAID = 'PAID',
  PAST_DUE = 'PAST_DUE',
}

registerEnumType(UserRole, {
  name: 'UserRole',
});

registerEnumType(MembershipStatus, {
  name: 'MembershipStatus',
});
