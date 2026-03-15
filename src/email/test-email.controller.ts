// src/email/test-email.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmailService } from './email.service';

@ApiTags('email')
@Controller('email')
export class TestEmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('reactivation')
  @ApiOperation({ summary: 'Send reactivation email example' })
  @ApiResponse({ status: 200 })
  async testReactivationEmail() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      ReactivationURL: 'https://seusite.com/reactivate?token=xyz789',
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    return this.emailService.sendTemplateEmail(
      1, // userId para log
      'reactivation_email', // nome do template (arquivo reactivation_email.hbs)
      context,
      'Reative sua conta', // assunto do e-mail
      'reativar-conta', // meta para log
      'rafaelsinosak@gmail.com', // destinatário
    );
  }

  // Testa o template “password_changed”
  @Get('password-changed')
  @ApiOperation({ summary: 'Send password changed email example' })
  @ApiResponse({ status: 200 })
  async testPasswordChanged() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };
    return this.emailService.sendTemplateEmail(
      1, // userId para log (por ex. ID do usuário)
      'password_changed', // nome do arquivo password_changed.hbs
      context,
      'Sua senha foi alterada', // assunto do e-mail
      'senha-alterada', // meta qualquer para armazenar no log
      'rafaelsinosak@gmail.com', // e-mail de teste
    );
  }

  @Get('password-reset')
  @ApiOperation({ summary: 'Send password reset email example' })
  @ApiResponse({ status: 200 })
  async testPasswordReset() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      ResetURL: 'https://seusite.com/reset?token=abc123',
      ExpirationHours: 2,
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    return this.emailService.sendTemplateEmail(
      1, // userId para log
      'password_reset', // nome do template (arquivo password_reset.hbs)
      context,
      'Redefinição de Senha', // assunto
      'redefinir-senha', // meta para log
      'rafaelsinosak@gmail.com', // destinatário
    );
  }

  @Get('verification-code')
  @ApiOperation({ summary: 'Send verification code email example' })
  @ApiResponse({ status: 200 })
  async testVerificationCode() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      VerificationCode: '123456',
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    return this.emailService.sendTemplateEmail(
      1, // userId para log
      'verification_code', // nome do template (arquivo verification_code.hbs)
      context,
      'Seu código de verificação', // assunto
      'codigo-verificacao', // meta para log
      'rafaelsinosak@gmail.com', // destinatário
    );
  }

  @Get('verify-email')
  @ApiOperation({ summary: 'Send verify email example' })
  @ApiResponse({ status: 200 })
  async testVerifyEmail() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      VerifyURL: 'https://seusite.com/verify?token=abc123',
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    return this.emailService.sendTemplateEmail(
      1, // userId para log
      'verify_email', // nome do arquivo verify_email.hbs
      context,
      'Confirme seu e-mail', // assunto do e-mail
      'confirmar-email', // meta para log
      'rafaelsinosak@gmail.com', // destinatário
    );
  }

  @Get('welcome')
  @ApiOperation({ summary: 'Send welcome email example' })
  @ApiResponse({ status: 200 })
  async testWelcomeEmail() {
    const context = {
      FullName: 'Rafael Sinosaki',
      AppName: 'Barbershop',
      LoginURL: 'https://seusite.com/login',
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    return this.emailService.sendTemplateEmail(
      1, // userId para log
      'welcome_email', // nome do arquivo welcome_email.hbs
      context,
      'Bem-vindo ao Barbershop', // assunto do e-mail
      'welcome-email', // meta para log
      'rafaelsinosak@gmail.com', // destinatário de teste
    );
  }
}
