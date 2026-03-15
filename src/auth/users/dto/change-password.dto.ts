// src\auth\users\dto\change-password.dto.ts
import { IsString, IsEmail } from 'class-validator';
import { InputType, Field } from '@nestjs/graphql';

export class ChangePasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  oldPassword: string;

  @IsString()
  newPassword: string;

  @IsString()
  code: string;
}

@InputType()
export class ChangePasswordInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  oldPassword: string;

  @Field()
  @IsString()
  newPassword: string;

  @Field()
  @IsString()
  code: string;
}
