import { BadRequestException } from '@nestjs/common';

/** Mesma regra do cadastro, da troca e da recuperação de senha. */
export function assertPassword(password: string) {
  const ok =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^\w\s]/.test(password);
  if (!ok) {
    throw new BadRequestException('Password does not meet the complexity requirements.');
  }
}
