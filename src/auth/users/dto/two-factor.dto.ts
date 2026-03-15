// src/auth/users/dto/two-factor.dto.ts
import { IsBoolean } from 'class-validator';

export class TwoFactorDto {
  @IsBoolean()
  enabled: boolean;
}
