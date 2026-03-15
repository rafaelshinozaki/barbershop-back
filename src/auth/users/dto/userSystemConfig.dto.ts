// src\auth\users\dto\userSystemConfig.dto.ts
import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';

export class UserSystemConfigDTO {
  theme?: string;
  accentColor?: string;
  grayColor?: string;
  radius?: string;
  scaling?: string;
  language?: string;
}

@InputType()
export class UpdateUserSystemConfigInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  theme?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  grayColor?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  radius?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  scaling?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  language?: string;
}
