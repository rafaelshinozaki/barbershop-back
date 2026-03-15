import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum Membership {
  FREE = 'FREE',
  MEDIUM = 'MEDIUM',
  PREMIUM = 'PREMIUM',
}

export class ImportUserDto {
  @ApiProperty({ description: 'Email do usuário' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Nome completo do usuário' })
  @IsString()
  fullName: string;

  @ApiProperty({ description: 'Senha do usuário' })
  @IsString()
  password: string;

  @ApiProperty({ description: 'Número do documento de identificação' })
  @IsString()
  idDocNumber: string;

  @ApiProperty({ description: 'Telefone do usuário' })
  @IsString()
  phone: string;

  @ApiProperty({ description: 'Gênero do usuário', enum: Gender })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({ description: 'Data de nascimento' })
  @IsDateString()
  birthdate: string;

  @ApiProperty({ description: 'Empresa do usuário' })
  @IsString()
  company: string;

  @ApiProperty({ description: 'Segmento profissional' })
  @IsString()
  professionalSegment: string;

  @ApiProperty({ description: 'Conhecimento sobre aplicações' })
  @IsString()
  knowledgeApp: string;

  @ApiProperty({ description: 'CEP do endereço' })
  @IsString()
  zipcode: string;

  @ApiProperty({ description: 'Rua do endereço' })
  @IsString()
  street: string;

  @ApiProperty({ description: 'Cidade do endereço' })
  @IsString()
  city: string;

  @ApiProperty({ description: 'Bairro do endereço' })
  @IsString()
  neighborhood: string;

  @ApiProperty({ description: 'Estado do endereço' })
  @IsString()
  state: string;

  @ApiProperty({ description: 'Plano de associação', enum: Membership, default: Membership.FREE })
  @IsOptional()
  @IsEnum(Membership)
  membership?: Membership;

  @ApiProperty({ description: 'Se o usuário está ativo', default: false })
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ description: 'Idioma preferido', default: 'pt' })
  @IsOptional()
  @IsString()
  language?: string;
}

export class ImportUsersResponseDto {
  @ApiProperty({ description: 'Total de usuários processados' })
  totalProcessed: number;

  @ApiProperty({ description: 'Total de usuários criados com sucesso' })
  successCount: number;

  @ApiProperty({ description: 'Total de usuários que falharam' })
  errorCount: number;

  @ApiProperty({ description: 'Lista de erros detalhados' })
  errors: Array<{
    row: number;
    email: string;
    error: string;
  }>;

  @ApiProperty({ description: 'Lista de usuários criados com sucesso' })
  success: Array<{
    email: string;
    fullName: string;
  }>;
}
