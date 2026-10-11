/**
 * Atendimento a domicílio: fora do piloto até os termos específicos
 * (responsabilidade, segurança, botão de ajuda). Desligado por padrão; liga
 * com HOME_SERVICE_ENABLED=true. Desligado, a opção some do perfil e o selo
 * não aparece na página nem na busca.
 */
export function homeServiceEnabled(): boolean {
  return process.env.HOME_SERVICE_ENABLED === 'true';
}
