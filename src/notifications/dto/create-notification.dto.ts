import { IsString, IsNumber, IsEnum, IsOptional, IsUrl } from 'class-validator';

export enum NotificationType {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
}

export class CreateNotificationDto {
  @IsNumber()
  userId: number;

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsOptional()
  @IsUrl()
  actionUrl?: string;

  @IsOptional()
  @IsString()
  actionText?: string;
}
