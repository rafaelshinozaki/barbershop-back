// src\common\errors.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class EmailNotSentException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

export enum CustomErrorMessage {
  DOCUMENT_NOT_FOUND = 'Document not found',
  CREDENCIAIS_INVALIDAS = 'Invalid credentials',
  EMAIL_JA_EXISTE = 'Email already exists',
}
