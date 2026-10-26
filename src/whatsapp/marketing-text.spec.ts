import {
  inboundWhatsappTexts,
  isMarketingOptOut,
  marketingOptInReply,
  marketingOptOutReply,
  whatsappMarketingBody,
} from './marketing-text';
import { whatsappSenderVariants } from '../common/phone.util';
import { WhatsappOptOutService } from './whatsapp-opt-out.service';

describe('texto da campanha no WhatsApp', () => {
  it('troca quebra de linha e tabulação e avisa como sair', () => {
    const result = whatsappMarketingBody('Olá\n\ntudo bem?\tPromoção', 'pt');
    expect(result).toEqual({
      ok: true,
      text: 'Olá · tudo bem? · Promoção · Responda SAIR para não receber mais.',
    });
  });

  it('cinco espaços seguidos viram quatro', () => {
    const result = whatsappMarketingBody('corte     hoje', 'en');
    expect(result.ok && result.text.startsWith('corte    hoje · Reply STOP')).toBe(true);
  });

  it('passa de 1.024 caracteres não vai para a fila', () => {
    expect(whatsappMarketingBody('a'.repeat(1025), 'pt')).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(whatsappMarketingBody('   \n\t  ', 'pt')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('resposta SAIR', () => {
  it('reconhece a palavra de saída no começo e ignora o meio da frase', () => {
    expect(isMarketingOptOut('sair')).toBe(true);
    expect(isMarketingOptOut('STOP!')).toBe(true);
    expect(isMarketingOptOut('Salir.')).toBe(true);
    expect(isMarketingOptOut('PARAR')).toBe(true);
    expect(isMarketingOptOut('cancelar agora')).toBe(true);
    expect(isMarketingOptOut('sair por favor')).toBe(true);
    expect(isMarketingOptOut('quero sair da lista')).toBe(false);
    expect(marketingOptOutReply('SAIR')).toMatch(/saiu das campanhas/);
    expect(marketingOptOutReply('STOP')).toMatch(/opted out/);
    expect(marketingOptOutReply('obrigado')).toBeNull();
  });

  it('lê o texto e o botão que a Meta manda', () => {
    const found = inboundWhatsappTexts({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: '5511999990000', type: 'text', text: { body: 'SAIR' } },
                  {
                    from: '14155551234',
                    type: 'button',
                    button: { payload: 'STOP', text: 'Stop' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(found).toEqual([
      { from: '5511999990000', text: 'SAIR' },
      { from: '14155551234', text: 'STOP' },
    ]);
  });

  it('o telefone da Meta casa com a ficha escrita sem DDI', () => {
    expect(whatsappSenderVariants('5511999990000')).toEqual(
      expect.arrayContaining(['5511999990000', '11999990000']),
    );
    expect(whatsappSenderVariants('14155551234')).toEqual(
      expect.arrayContaining(['14155551234', '4155551234']),
    );
    // A Meta manda o celular do Brasil sem o 9; a ficha guarda com o 9.
    expect(whatsappSenderVariants('551188887777')).toEqual(
      expect.arrayContaining(['551188887777', '1188887777', '5511988887777', '11988887777']),
    );
    expect(whatsappSenderVariants('5511988887777')).toEqual(
      expect.arrayContaining(['551188887777', '11988887777']),
    );
  });

  // Item 275: o descadastro do WhatsApp é do telefone, numa tabela própria;
  // não mexe nas fichas nem no e-mail, e VOLTAR desfaz
  function optOutStore() {
    const rows = new Map<string, number | null>();
    const db = {
      whatsappOptOut: {
        findMany: jest.fn(async ({ where }: { where: { phoneDigits: { in: string[] } } }) =>
          where.phoneDigits.in
            .filter((digits) => rows.has(digits))
            .map((phoneDigits) => ({
              phoneDigits,
              clientAccountId: rows.get(phoneDigits) ?? null,
            })),
        ),
        create: jest.fn(
          async ({ data }: { data: { phoneDigits: string; clientAccountId: number | null } }) => {
            rows.set(data.phoneDigits, data.clientAccountId);
            return data;
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { phoneDigits: string };
            data: { clientAccountId: number | null };
          }) => {
            rows.set(where.phoneDigits, data.clientAccountId);
            return data;
          },
        ),
        deleteMany: jest.fn(async ({ where }: { where: { phoneDigits: { in: string[] } } }) => {
          let count = 0;
          for (const digits of where.phoneDigits.in) if (rows.delete(digits)) count++;
          return { count };
        }),
      },
      $executeRaw: jest.fn(),
    };
    return { rows, db };
  }

  it('SAIR guarda o telefone (sem mexer nas fichas) e confirma; VOLTAR desfaz; outra frase não', async () => {
    const { rows, db } = optOutStore();
    const sendSessionText = jest.fn(async () => undefined);
    const service = new WhatsappOptOutService(db as never, { sendSessionText } as never);
    expect(await service.optOutFromReply('5511999990000', 'SAIR')).toBe(1);
    expect(rows.has('5511999990000')).toBe(true);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(sendSessionText).toHaveBeenCalledWith(
      '5511999990000',
      expect.stringMatching(/saiu das campanhas/),
    );
    // Repetir não confirma de novo
    expect(await service.optOutFromReply('5511999990000', 'SAIR')).toBe(0);
    expect(await service.optOutFromReply('5511999990000', 'obrigado')).toBe(0);
    expect(sendSessionText).toHaveBeenCalledTimes(1);

    expect(marketingOptInReply('Voltar')).toMatch(/voltou a receber/);
    expect(marketingOptInReply('quero voltar')).toBeNull();
    expect(await service.optOutFromReply('5511999990000', 'VOLTAR')).toBe(1);
    expect(rows.size).toBe(0);
    expect(sendSessionText).toHaveBeenLastCalledWith(
      '5511999990000',
      expect.stringMatching(/voltou a receber/),
    );
  });

  it('o from sem o nono dígito guarda também a forma com o 9', async () => {
    const { rows, db } = optOutStore();
    const service = new WhatsappOptOutService(
      db as never,
      {
        sendSessionText: async () => undefined,
      } as never,
    );
    expect(await service.optOutFromReply('551188887777', 'sair por favor')).toBe(1);
    expect(rows.has('5511988887777')).toBe(true);
    expect(rows.has('11988887777')).toBe(true);
  });
});
