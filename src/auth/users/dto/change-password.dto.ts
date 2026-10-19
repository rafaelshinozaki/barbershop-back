// src\auth\users\dto\change-password.dto.ts
import { IsString, IsEmail, IsOptional } from 'class-validator';
import { InputType, Field } from '@nestjs/graphql';

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

  @Field({
    nullable: true,
    description: 'Inscrição de push deste aparelho (as dos outros aparelhos são apagadas)',
  })
  @IsOptional()
  @IsString()
  pushEndpoint?: string;
}
