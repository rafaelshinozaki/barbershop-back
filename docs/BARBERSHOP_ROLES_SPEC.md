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
