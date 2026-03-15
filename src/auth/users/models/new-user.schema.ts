// src\auth\users\models\new-user.schema.ts
import {
  IsBoolean,
  IsDate,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmptyObject,
  IsObject,
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AddressSchema } from './address.schema';

class NewUserSystemConfig {
  @IsString({ message: 'Invalid language' })
  language: string;
}

export class NewUserSchema {
  @IsEmail({}, { message: 'Invalid email' })
  email: string;

  @IsStrongPassword(
    { minLength: 8, minUppercase: 1, minNumbers: 1, minSymbols: 1, minLowercase: 1 },
    {
      message:
        'Password must be at least 8 characters long and include 1 uppercase letter, 1 lowercase letter, 1 number and 1 special character',
    },
  )
  password: string;

  @IsString({ message: 'Name must be a string' })
  @Transform(({ value }) => value.trim(), { groups: ['transform'] })
  @Matches(/^[a-zA-ZÀ-ÿ\s]{3,255}$/, { message: 'Name must be between 3 and 255 letters' })
  fullName: string;

  @IsIn(['male', 'female'], { message: 'Gender not found' })
  gender: string;

  @IsString({ message: 'Phone must be a string' })
  @Transform(
    ({ value }) => {
      // Remover todos os caracteres não numéricos
      const cleanPhone = value.replace(/\D/g, '');
      // Se não tem código do país, adicionar +55
      if (cleanPhone.length === 11 && !value.startsWith('+')) {
        return `+55${cleanPhone}`;
      }
      // Se já tem código do país, manter
      if (cleanPhone.length === 13 && value.startsWith('+55')) {
        return value;
      }
      return value;
    },
    { groups: ['transform'] },
  )
  @Matches(/^\+55\d{10,11}$/, {
    message: 'Invalid phone number format. Use format: +55XXXXXXXXXXX',
  })
  phone: string;

  @IsString({ message: 'CPF must be a string' })
  @Transform(
    ({ value }) => {
      // Remover todos os caracteres não numéricos
      const cleanCPF = value.replace(/\D/g, '');
      // Formatar para o padrão 000.000.000-00
      if (cleanCPF.length === 11) {
        return cleanCPF.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      }
      return value;
    },
    { groups: ['transform'] },
  )
  @Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, {
    message: 'Invalid CPF. Please provide a valid CPF in the format 000.000.000-00',
  })
  idDocNumber: string;

  @IsString({ message: 'Company name must be a string' })
  @Transform(({ value }) => value.trim().toUpperCase(), { groups: ['transform'] })
  @Matches(/^[a-zA-Z0-9À-ÿ\- ]{3,255}$/, {
    message: 'Company name must be between 3 and 255 characters',
  })
  company: string;

  @IsString({ message: 'Job title must be a string' })
  @Transform(({ value }) => (value ? value.trim().toUpperCase() : value), { groups: ['transform'] })
  jobTitle?: string;

  @IsString({ message: 'Department must be a string' })
  @Transform(({ value }) => (value ? value.trim().toUpperCase() : value), { groups: ['transform'] })
  department?: string;

  @IsString({ message: 'Invalid professional segment' })
  professionalSegment: string;

  @IsString({ message: 'Required field' })
  knowledgeApp: string;

  @IsBoolean({ message: 'Accept terms must be a boolean' })
  readTerms: boolean;

  @IsDateString({}, { message: 'Birthdate must be a valid date' })
  birthdate: Date;

  @IsObject({ message: 'Address must be an object' })
  @IsNotEmptyObject({ nullable: false }, { message: 'Address cannot be empty' })
  address: AddressSchema;

  @IsObject({ message: 'System settings must be an object' })
  @IsNotEmptyObject({ nullable: false }, { message: 'System settings cannot be empty' })
  userSystemConfig: NewUserSystemConfig;
}
