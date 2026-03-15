// src\auth\users\dto\reset-password.dto.ts
import { IsString } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  userId: string;

  @IsString()
  newPassword: string;
}
