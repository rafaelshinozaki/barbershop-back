import { IsString, IsArray, IsNumber, IsEnum, IsOptional, IsUrl } from 'class-validator';
import { NotificationType } from './create-notification.dto';

export class CreateBatchNotificationsDto {
  @IsArray()
  @IsNumber({}, { each: true })
  userIds: number[];

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
