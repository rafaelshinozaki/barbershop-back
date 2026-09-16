-- Atualiza descrição/features dos planos existentes (Basic/Standard/Premium)
-- pra refletir os módulos reais liberados por tier (ver
-- src/barbershop/barbershop-plan.constants.ts), em vez do texto genérico de
-- "suporte" anterior. Só texto -- não mexe em preço, stripePriceId nem
-- billingCycle. Seed novo (prisma/seed.ts) já usa o mesmo texto, mas seed é
-- find-or-create e nunca atualiza uma linha já existente, então quem já tem
-- essas linhas (incluindo produção) precisa dessa migração pra ficar
-- consistente.

UPDATE "Plan" SET
  "description" = 'Ideal pra quem está começando',
  "features" = 'Cadastro de clientes, Fila de espera, Agenda de atendimentos, Até 3 barbeiros, 1 barbearia'
WHERE "name" = 'Basic';

UPDATE "Plan" SET
  "description" = 'Pra quem já vende produtos e controla estoque',
  "features" = 'Tudo do Basic, Catálogo de produtos, Controle de estoque, Até 10 barbeiros, Até 3 barbearias'
WHERE "name" = 'Standard';

UPDATE "Plan" SET
  "description" = 'Rede completa, com gestão financeira e fidelização',
  "features" = 'Tudo do Standard, Fluxo de caixa, Relatórios avançados, Pacotes de sessão e ficha de anamnese, Assinatura recorrente do cliente, Barbeiros e barbearias ilimitados'
WHERE "name" = 'Premium';
