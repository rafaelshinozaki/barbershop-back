# Especificação: Sistema de Barbearia com Roles

## 1. Tipos de Usuário e Permissões

| Role | Descrição | Permissões |
|------|-----------|------------|
| **Admin** | Admin do sistema | Gerenciar barbearias, criar barbearias a partir do próprio usuário |
| **BARBERSHOP_OWNER** | Dono de barbearia | Gerenciar funcionários, produtos, cortes, pagamentos (assinatura), usuários, fluxo de caixa |
| **BARBERSHOP_EMPLOYEE** | Funcionário | Cadastrar clientes, gerenciar cortes a fazer, ver histórico de cortes do cliente |

## 2. Fluxo de Signup

### Cadastro como Dono de Barbearia
1. Usuário acessa `/signup`
2. **Etapa 1 - Informações Pessoais:** nome, email, telefone, documento, gênero, data nascimento, endereço pessoal
3. **Etapa 2 - Informações Profissionais:** *quando tipo = dono* → campos da barbearia:
   - Nome da barbearia
   - Slug (URL amigável)
   - Endereço (rua, cidade, estado, CEP, país)
   - Telefone, email da barbearia
   - Horário de funcionamento (opcional)
4. **Etapa 3 - Senha e Termos**
5. Ao finalizar → Backend cria **User** (role BARBERSHOP_OWNER) + **Barbershop** (ownerUserId = user.id)

### Cadastro como Funcionário
- Será convidado pelo dono (fluxo futuro)
- Ou pode ter uma tela "Aguarde convite" por enquanto

## 3. Dashboard por Role

| Role | Rota padrão | Menu lateral | Funcionalidades |
|------|------------|-------------|-----------------|
| BARBERSHOP_OWNER | `/barbershops` ou `/barbershops/:id` | Barbearias, Dashboard, Perfil | Ver barbearias (suas), gerenciar tudo |
| BARBERSHOP_EMPLOYEE | `/barbershop/:id` (sua barbearia) | Clientes, Cortes, Perfil | Lista limitada |
| Admin | `/backoffice` | Backoffice + Barbearias | Gerenciar barbearias do sistema |

## 4. Planos da Barbearia (Basic, Medium, Premium)

O **dono** (usuário que cadastrou a barbearia) é quem assina o plano. A assinatura dele define os **módulos** disponíveis para a barbearia. Dono e funcionários acessam os mesmos módulos conforme o plano.

| Plano   | Módulos |
|---------|---------|
| Basic   | clients, queue, cuts, barbers |
| Standard/Medium | Basic + appointments, products |
| Premium | Medium + cashFlow, reports, settings |

- **Implementado**: `BarbershopService.getBarbershopPlan(barbershopId)` → plano do dono via Subscription ativa
- **Implementado**: `BarbershopService.canAccessModule(barbershopId, module)` e `getAvailableModules(barbershopId)`
- **GraphQL**: campo `availableModules` em Barbershop

## 5. Modelo de Dados

- **User** + **Role** (BARBERSHOP_OWNER, BARBERSHOP_EMPLOYEE via Barber)
- **Barbershop** tem ownerUserId → dono, e **planId** ou **subscription** → plano ativo
- **Barber** tem userId (1:1) + barbershopId → funcionário vinculado à barbearia
- Um User pode ser Owner (barbershopsOwned) OU Employee (barberProfile em uma Barber)

## 6. Cargos na unidade (como no Booksy)

O papel da conta (seção 1) diz que tipo de usuário a pessoa é. **O que ela pode
fazer em cada unidade** vem do cargo dela na equipe (`Barber.staffType`), ou de
ser dona da unidade/rede. São 5 cargos, do mais restrito ao dono. O back é quem
garante (`ensureBarbershopAccess(userId, barbershopId, nívelMínimo)` em
`barbershop.service.ts`); o front só esconde o que o cargo não usa
(`src/utils/barbershopAccess.ts`) e recebe o cargo em `Barbershop.myAccessLevel`.

| | Barbeiro básico (`basic`) | Barbeiro (`barber`) | Recepção (`reception`) | Gerente (`manager`) | Dono |
|---|---|---|---|---|---|
| Agenda | só a dele | só a dele | de todos | de todos | de todos |
| Agendar | só nele | só nele | pra qualquer profissional | pra qualquer um | pra qualquer um |
| Apagar agendamento | — | — | — | ✓ | ✓ |
| Horário de trabalho / folga | o dele | o dele | — | de todos | de todos |
| Clientes: ver e cadastrar | só o nome | ✓ | ✓ | ✓ | ✓ |
| Clientes: telefone e e-mail | nenhum | só de quem já agendou com ele | todos | todos | todos |
| Clientes: editar | — | — | ✓ | ✓ | ✓ |
| Clientes: apagar | — | — | — | ✓ | ✓ |
| Vendas (registrar) | — | ✓ | ✓ | ✓ | ✓ |
| Vendas (ver) | — | só as dele | todas | todas | todas |
| Vendas (editar/apagar) | — | — | — | ✓ | ✓ |
| Fila (avulsos) e lista de espera | — | ✓ | ✓ | ✓ | ✓ |
| Pacotes, assinaturas e fichas do cliente (usar) | — | ✓ | ✓ | ✓ | ✓ |
| Caixa do dia (abrir e fechar) | — | — | ✓ | ✓ | ✓ |
| Resumo financeiro, despesas, histórico do caixa | — | — | — | ✓ | ✓ |
| Equipe (convidar, editar cargo, desligar) | — | — | — | ✓ (inclusive gerente) | ✓ |
| Serviços, produtos, estoque, pacotes, recursos | — | — | — | ✓ | ✓ |
| Marketing, indicações, redes sociais, perdoar taxa de no-show | — | — | — | ✓ | ✓ |
| Relatórios avançados e comissões | — | — | — | ✓ | ✓ |
| Apagar a unidade | — | — | — | — | ✓ |

Outras regras:
- A recepção não atende: não aparece na página pública, nem como profissional
  na agenda, na venda ou na lista de espera. Pra mudar alguém com horários
  marcados pra recepção, remarque os horários antes.
- Avisos do sistema: o gerente recebe todos; a recepção, os da agenda; o
  barbeiro, os que são dele.
- Funcionário desligado (`isActive = false`) perde o acesso.

Contas do seed (senha `pwned`, só fora de produção), todas na Green Barbershop:

| Cargo | Conta |
|---|---|
| Dono | cayo.carlos@barbershop.com |
| Gerente | bianca.silverio@barbershop.com |
| Recepção | julia.recepcao@barbershop.com |
| Barbeiro | minion.cayo@barbershop.com |
| Barbeiro básico | pedro.basico@barbershop.com |

## 7. Profissional em várias unidades e vínculo temporário

Profissional autônomo pode trabalhar em mais de uma barbearia, até de donos
diferentes. É **uma conta** com **um vínculo por unidade** (`Barber`, único por
`barbershopId + userId`), e cada vínculo tem o seu cargo.

- **Convite pra quem já tem conta:** o convite sai normalmente. No link, a pessoa
  entra com a conta dela e aceita (`POST /employee-invites/accept/:token/existing`),
  sem criar outra conta. Só a conta com o e-mail do convite aceita.
- **Agenda é uma só:** o mesmo horário não é vendido em duas unidades. Isso vale
  pra equipe, pra página pública e pra duas reservas ao mesmo tempo (a trava é por
  pessoa). A outra unidade vê só "ocupado em outra unidade", sem nada do
  atendimento de lá.
- **Cada unidade vê só o que é dela:** clientes, vendas e agenda continuam
  separados.
- **Dono com várias unidades** entra na equipe de cada uma. A agenda dele também
  é uma só.
- **Vínculo temporário (freelancer):** `accessStartsAt` e `accessEndsAt` no
  vínculo. Fora do período a pessoa não entra na unidade, não aparece na página
  pública, não recebe agendamento e não ocupa vaga do plano. Na tela da equipe
  aparece "Até dd/mm", "Começa em dd/mm" ou "Vínculo encerrado".
- **E-mail do convite é best-effort:** se o provedor falhar, o convite continua
  valendo e a tela mostra o link pra mandar por outro canal.

No seed de demonstração, Bianca é gerente da Green e da Green Centro, e Minion é
freelancer aos sábados na Barbearia Vintage (vínculo temporário).

## 8. Espaço compartilhado (cadeira alugada)

Como o "Shared Location" do Booksy: o profissional independente tem o
**próprio negócio** (conta de dono, plano, clientes, agenda, página e
recebimentos) e atende no espaço de outra barbearia. É diferente de entrar na
equipe (seção 7): aqui ninguém vê os dados do outro. O que eles compartilham é a
vitrine e o endereço.

- **Convite:** o espaço convida pelo link da página pública do profissional
  (`…/u/<slug>`), na aba "Espaço compartilhado" (gerente ou dono).
- **Resposta:** o profissional aceita ou recusa na mesma aba, do lado dele.
- **Página pública:** a do espaço lista "Profissionais independentes neste
  espaço", com link pra página de cada um (cada um tem a própria agenda). A do
  profissional mostra "Atende em …".
- **Encerrar:** qualquer um dos lados encerra; dá pra convidar de novo depois.
- **Regras:**
  - uma unidade da mesma rede não pode ser convidada (aí é equipe, seção 7);
  - pendente não aparece na página pública;
  - cada evento avisa o dono e os gerentes do outro lado.
- **Modelo:** `SharedLocationMember` (`hostBarbershopId`, `memberBarbershopId`,
  `status` PENDING | ACTIVE | DECLINED | REMOVED).

### Aluguel da cadeira

- **Valor:** o espaço (gerente ou dono) define o aluguel mensal de cada
  profissional ativo, na moeda da unidade. Mudar o valor com a cobrança já
  rodando vale a partir da próxima fatura, sem proporcional. Valor vazio ou 0
  encerra a cobrança. Definir o valor não passa pelo Stripe; o preço lá é
  criado quando o profissional autoriza.
- **Forma de cobrança** (o espaço escolhe por profissional):
  - **Cartão automático:** cobrado pelo Stripe todo mês (abaixo);
  - **Direto ao espaço** (PIX, dinheiro, transferência, outro): o sistema gera a
    mensalidade todo mês no mesmo dia (29–31 viram 28) e o espaço registra o
    pagamento com o método. Dinheiro entra no caixa aberto do espaço (conta na
    conferência do fechamento). Sai recibo (número `ALG-000123`), com e-mail
    pro profissional. Registro errado dá pra desfazer, menos quando o caixa em
    que o dinheiro entrou já foi fechado. Mensalidade atrasada avisa os dois
    lados uma vez. Não passa pelo Stripe e não tem taxa da plataforma.
- **Autorização (cartão):** o dono do negócio do profissional escolhe um cartão salvo da
  conta dele. O cartão vale só pra esse aluguel (não troca o cartão do plano).
  Cartão que pede 3D Secure é confirmado na tela.
- **Cobrança:** o Stripe cobra todo mês, na conta da plataforma (como a
  assinatura do cliente, sem Stripe Connect). Cada fatura paga vira um recibo,
  com link e PDF do Stripe, e o recibo vai por e-mail pro profissional.
- **Recusa:** os dois lados são avisados. Autorizar outro cartão tenta a fatura
  em aberto na hora. Se o Stripe desistir, o aluguel volta a aguardar
  autorização, com o mesmo valor.
- **Os dois lados veem:** cada pagamento, pelo cartão ou direto, vira despesa
  "Aluguel" no negócio do profissional; no espaço, o aluguel recebido direto
  entra no resumo financeiro (`chairRentIncome`).
- **Repasse (só cartão):** o espaço vê o total recebido, a taxa da plataforma
  (`PLATFORM_SUBSCRIPTION_FEE_PERCENT`) e o valor a repassar. O repasse é
  manual, como o das assinaturas.
- **Fim:** encerrar o vínculo, apagar uma das unidades ou excluir a conta do
  dono cancela a cobrança no Stripe. Os recibos ficam.
- **Modelo:** campos `rent*` em `SharedLocationMember` (`rentStatus` NONE |
  AWAITING_PAYMENT | INCOMPLETE | ACTIVE | PAST_DUE) e `ChairRentPayment`.

No seed de demonstração, o Studio Navalha (Tiago) atende no espaço da Green, e
a Barbearia Vintage tem um convite pendente.

## 9. Pagamento da equipe

Tudo o que a unidade paga a cada profissional fica registrado, pra dono e
gerente verem quanto cada um recebe (e quanto a equipe custa sobre o
faturamento), e pro profissional ver o próprio extrato. O dinheiro sai por
fora (PIX, dinheiro, transferência): o sistema registra, calcula e lança a
despesa.

- **Forma de pagamento** (por profissional, dono ou gerente define):
  - só comissão (padrão; as regras de comissão continuam as mesmas);
  - só fixo;
  - fixo + comissão;
  - o maior entre o fixo e a comissão.
  O fixo vale por período (mensal, quinzenal ou semanal).
- **Lançamentos avulsos:**
  - gorjeta a receber (entra somando);
  - vale/adiantamento: já foi pago, então vira despesa "Salário" na hora e,
    em dinheiro, sai do caixa aberto; no fechamento é descontado;
  - bônus (soma) e desconto (consumo, quebra, falta...).
  Lançamento errado se apaga enquanto não entrou num pagamento.
- **Pagamento do período:** a prévia mostra vendas, comissão, fixo, base,
  gorjetas, bônus, descontos, vales e o total. Pagar registra a forma de
  pagamento, guarda a foto do cálculo, fecha os lançamentos e lança a despesa
  "Salário" (em dinheiro, saindo do caixa aberto). O mesmo período (ou um que
  se sobreponha) não se paga duas vezes, nem com dois cliques. Vale maior que
  o devido: paga 0 e a diferença vira vale do próximo período. Pagamento
  errado se desfaz (menos com o caixa do dinheiro já fechado).
- **Quem vê:**
  - dono e gerente: tudo, de todos, e a visão do período (por profissional:
    vendas geradas, comissão, gorjetas, bônus, descontos, vales e o que foi
    pago; no total: faturamento, pago à equipe e % do faturamento);
  - o profissional (qualquer cargo com perfil na unidade): só o próprio
    extrato — forma de pagamento, o que tem a receber desde o último
    pagamento, lançamentos em aberto, pagamentos e recebido por mês.
- **Modelo:** `BarberPayConfig`, `BarberPayEntry` (TIP | ADVANCE | BONUS |
  DEDUCTION), `BarberPayout`.
