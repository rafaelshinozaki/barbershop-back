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
