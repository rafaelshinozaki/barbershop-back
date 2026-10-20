import { inboundWhatsappTexts, isMarketingOptOut, whatsappMarketingBody } from './marketing-text';
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
    expect(whatsappMarketingBody('a'.repeat(1025), 'pt')).toEqual({ ok: false, reason: 'too_long' });
    expect(whatsappMarketingBody('   \n\t  ', 'pt')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('resposta SAIR', () => {
  it('reconhece a palavra de saída e ignora o resto da conversa', () => {
    expect(isMarketingOptOut('sair')).toBe(true);
    expect(isMarketingOptOut('STOP!')).toBe(true);
    expect(isMarketingOptOut('Salir.')).toBe(true);
    expect(isMarketingOptOut('quero sair da lista')).toBe(false);
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
                  { from: '14155551234', type: 'button', button: { payload: 'STOP', text: 'Stop' } },
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
  });

  it('SAIR marca a ficha; outra frase não', async () => {
    const executeRaw = jest.fn(async () => 2);
    const service = new WhatsappOptOutService({ $executeRaw: executeRaw } as never);
    expect(await service.optOutFromReply('5511999990000', 'SAIR')).toBe(2);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(await service.optOutFromReply('5511999990000', 'obrigado')).toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
