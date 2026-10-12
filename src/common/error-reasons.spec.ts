import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ERROR_REASONS, errorReasonOf } from './error-reasons';

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

describe('ERROR_REASONS', () => {
  it('códigos em MAIÚSCULAS_COM_SUBLINHADO', () => {
    for (const code of Object.values(ERROR_REASONS)) expect(code).toMatch(/^[A-Z0-9_]+$/);
  });

  // Mudou o texto de um erro? Atualize o catálogo junto, senão o front perde
  // a tradução e volta a mostrar a mensagem em português
  it('toda mensagem do catálogo ainda existe no código', () => {
    const code = sources(join(__dirname, '..'))
      .filter((path) => !path.endsWith('error-reasons.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const missing = Object.keys(ERROR_REASONS).filter(
      (message) =>
        !code.includes(`'${message.replace(/'/g, "\\'")}'`) &&
        !code.includes(`"${message}"`) &&
        !code.includes(`\`${message}\``),
    );
    expect(missing).toEqual([]);
  });

  it('não confunde chave herdada de objeto com mensagem', () => {
    expect(errorReasonOf('constructor')).toBeUndefined();
    expect(errorReasonOf('Agendamento não encontrado')).toBe('APPOINTMENT_NOT_FOUND');
  });
});
