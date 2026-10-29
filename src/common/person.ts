import { BadRequestException } from '@nestjs/common';
import { WORK_MINIMUM_AGE, completedYears } from './work-age';

export const PERSON_NAME_MESSAGE = 'Informe o nome com pelo menos 2 letras.';
export const PERSON_PHONE_MESSAGE = 'Telefone inválido';
export const ADDRESS_REQUIRED_MESSAGE =
  'Para salvar o endereço, informe rua, cidade, bairro, estado, país e CEP.';

/** Nome com pelo menos duas letras (espaço sozinho não conta). */
export function personName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) throw new BadRequestException(PERSON_NAME_MESSAGE);
  return name;
}

/** O mesmo mínimo do cadastro: 8 dígitos, no máximo 15. */
export function signupPhone(raw: string | null | undefined): string {
  const phone = (raw ?? '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new BadRequestException(PERSON_PHONE_MESSAGE);
  return phone;
}

/** Nascimento de quem trabalha: entre 16 e 120 anos. Data futura não passa. */
export function assertWorkBirthdate(value: Date | string | null | undefined) {
  const text =
    value instanceof Date
      ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
      : String(value ?? '');
  const age = completedYears(text);
  if (age == null || age < 0 || age > 120) {
    throw new BadRequestException('Data de nascimento inválida');
  }
  if (age < WORK_MINIMUM_AGE) {
    throw new BadRequestException('Para trabalhar é preciso ter 16 anos.');
  }
}
