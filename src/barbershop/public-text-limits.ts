import { BadRequestException } from '@nestjs/common';

/**
 * Tamanho máximo do que o visitante digita no agendamento e na lista de
 * espera da página pública (item 339). Sem limite, um nome de dezenas de
 * milhares de caracteres virava ficha de cliente e quebrava a agenda e os
 * e-mails da unidade.
 */
export const PUBLIC_TEXT_LIMITS = {
  name: 120,
  phone: 30,
  email: 254,
  notes: 500,
  referralCode: 40,
} as const;

const LABELS: Record<keyof typeof PUBLIC_TEXT_LIMITS, string> = {
  name: 'Nome muito longo',
  phone: 'Telefone inválido',
  email: 'Email inválido',
  notes: 'Observação muito longa',
  referralCode: 'Código de indicação inválido',
};

/** A mesma regra no serviço, para quem chama sem passar pela validação do input */
export function assertPublicTextLimits(
  fields: Partial<Record<keyof typeof PUBLIC_TEXT_LIMITS, string | null | undefined>>,
) {
  for (const [key, value] of Object.entries(fields) as Array<
    [keyof typeof PUBLIC_TEXT_LIMITS, string | null | undefined]
  >) {
    if (value != null && value.length > PUBLIC_TEXT_LIMITS[key]) {
      throw new BadRequestException(LABELS[key]);
    }
  }
}
