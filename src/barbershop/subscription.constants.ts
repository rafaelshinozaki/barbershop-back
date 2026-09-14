/**
 * Percentual retido pela plataforma sobre cada cobrança de assinatura
 * recorrente do cliente final. Decisão de precificação da plataforma, não
 * da barbearia — por isso é uma constante de código, não um campo
 * configurável em Network/Barbershop. Usado só pra calcular o relatório de
 * repasse devido; o sistema não transfere dinheiro sozinho pra barbearia.
 */
export const PLATFORM_SUBSCRIPTION_FEE_PERCENT = 15
