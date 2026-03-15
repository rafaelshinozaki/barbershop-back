import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';

export enum NotificationType {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
}

registerEnumType(NotificationType, {
  name: 'NotificationType',
  description: 'The type of notification',
});

@ObjectType()
export class NotificationUser {
  @Field(() => Int)
  id: number;

  @Field()
  email: string;

  @Field()
  fullName: string;

  @Field({ nullable: true })
  role?: string;

  @Field()
  isActive: boolean;
}

@ObjectType()
export class NotificationWithUser {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  title: string;

  @Field()
  message: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field()
  isRead: boolean;

  @Field()
  isNew: boolean;

  @Field({ nullable: true })
  actionUrl?: string;

  @Field({ nullable: true })
  actionText?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => NotificationUser)
  user: NotificationUser;
}

@ObjectType()
export class UserNotification {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  title: string;

  @Field()
  message: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field()
  isRead: boolean;

  @Field()
  isNew: boolean;

  @Field({ nullable: true })
  actionUrl?: string;

  @Field({ nullable: true })
  actionText?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class EmailNotification {
  @Field(() => Int)
  id: number;

  @Field()
  news: boolean;

  @Field()
  promotions: boolean;

  @Field()
  instability: boolean;

  @Field()
  security: boolean;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class LoginHistory {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  deviceType: string;

  @Field()
  browser: string;

  @Field()
  os: string;

  @Field()
  ip: string;

  @Field()
  location: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class ActiveSession {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  deviceType: string;

  @Field()
  browser: string;

  @Field()
  os: string;

  @Field()
  ip: string;

  @Field()
  location: string;

  @Field()
  isCurrent: boolean;

  @Field()
  createdAt: string;
}

@ObjectType()
export class VerificationCode {
  @Field(() => Int)
  id: number;

  @Field()
  code: string;

  @Field()
  expiresAt: string;

  @Field()
  used: boolean;

  @Field()
  attempts: number;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => Int)
  userId: number;
}

@ObjectType()
export class PaginatedLoginHistory {
  @Field(() => [LoginHistory])
  data: LoginHistory[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}

@ObjectType()
export class PaginatedActiveSessions {
  @Field(() => [ActiveSession])
  data: ActiveSession[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}
