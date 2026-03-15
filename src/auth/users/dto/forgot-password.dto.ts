// src\auth\users\dto\forgot-password.dto.ts
import { IsEmail, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
