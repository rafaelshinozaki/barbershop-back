// src\auth\users\dto\verify-code.dto.ts
import { IsString } from 'class-validator';

export class VerifyCodeDto {
  @IsString()
  code: string;
}
