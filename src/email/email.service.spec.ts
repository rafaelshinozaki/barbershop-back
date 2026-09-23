/**
 * Todo template renderiza em pt, en e es sem erro (antes um helper
 * inexistente derrubava o e-mail de pagamento recorrente em qualquer
 * idioma) e sai no idioma pedido — en/es chegaram a ser cópias do pt.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EmailService } from './email.service';
import { langForCountry, Lang, normalizeLang } from './language';

const TEMPLATES = path.join(__dirname, 'templates');
const LANGS: Lang[] = ['pt', 'en', 'es'];

// Palavras que só aparecem em português — não podem sobrar em en/es
const PORTUGUESE_ONLY = /\b(você|olá|obrigad[oa]|senha|fatura|clique|atenciosamente|não)\b/i;

const sample = {
  FullName: 'Ana',
  AppName: 'Barbershop',
  InviterName: 'Carlos',
  FriendName: 'Bia',
  BarbershopName: 'Green',
  RoleLabel: { pt: 'Barbeiro', en: 'Barber', es: 'Barbero' },
  InvoiceID: 'in_1',
  Amount: 49.9,
  Currency: 'brl',
  DueDate: new Date('2030-03-04T12:00:00Z'),
  PaymentDate: new Date('2030-02-04T12:00:00Z'),
  Year: 2030,
};

describe('EmailService.render', () => {
  const service = new EmailService({} as never, {} as never, {} as never);
  const names = fs
    .readdirSync(path.join(TEMPLATES, 'pt'))
    .filter((f) => f.endsWith('.hbs'))
    .map((f) => f.replace(/\.hbs$/, ''));

  it('toda língua tem os mesmos templates', () => {
    for (const lang of LANGS) {
      const files = fs.readdirSync(path.join(TEMPLATES, lang)).map((f) => f.replace(/\.hbs$/, ''));
      expect(files.sort()).toEqual([...names].sort());
    }
  });

  it.each(LANGS)('renderiza todos os templates em %s, no idioma certo', async (lang) => {
    for (const name of names) {
      const { html } = await service.render(name, sample, 'x', lang);
      expect(html.length).toBeGreaterThan(100);
      if (lang !== 'pt') {
        const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
        expect({ name, match: text.match(PORTUGUESE_ONLY)?.[0] ?? null }).toEqual({
          name,
          match: null,
        });
      }
    }
  });

  it('escolhe assunto e valores traduzidos pelo idioma', async () => {
    const subject = { pt: 'Convite', en: 'Invitation', es: 'Invitación' };
    const en = await service.render('employee_invite', sample, subject, 'en');
    expect(en.subject).toBe('Invitation');
    expect(en.html).toContain('as <strong>Barber</strong>');
    const es = await service.render('employee_invite', sample, subject, 'es');
    expect(es.subject).toBe('Invitación');
    expect(es.html).toContain('<strong>Barbero</strong>');
  });

  it('formata valor e data no padrão de cada idioma', async () => {
    const pt = (await service.render('recurring_payment_success', sample, 'x', 'pt')).html;
    expect(pt).toContain('R$ 49,90');
    expect(pt).toContain('04/03/2030');
    const en = (await service.render('recurring_payment_success', sample, 'x', 'en')).html;
    expect(en).toContain('R$49.90');
    expect(en).toContain('3/4/2030');
  });

  it('normaliza o idioma salvo e deduz o do cliente pelo país da unidade', () => {
    expect(normalizeLang('PT-BR')).toBe('pt');
    expect(normalizeLang('en_US')).toBe('en');
    expect(normalizeLang('fr')).toBe('pt');
    expect(normalizeLang(null)).toBe('pt');
    expect(langForCountry('BR')).toBe('pt');
    expect(langForCountry('mx')).toBe('es');
    expect(langForCountry('US')).toBe('en');
    expect(langForCountry('')).toBe('pt');
  });
});
