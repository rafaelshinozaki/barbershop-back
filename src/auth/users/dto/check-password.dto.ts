import { IsEmail, IsString } from 'class-validator';

export class CheckPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
