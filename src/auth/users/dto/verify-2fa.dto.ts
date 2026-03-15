// src/auth/users/dto/verify-2fa.dto.ts
import { IsString, IsUUID } from 'class-validator';

export class Verify2faDto {
  @IsUUID()
  loginId: string;

  @IsString()
  code: string;
}
