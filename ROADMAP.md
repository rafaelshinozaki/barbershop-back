# Roadmap — Barbershop SaaS

Histórico de horizontes de produto do marketplace (`barbershop-back` + `barbershop-front`). Cada item indica status, uma descrição curta e os commits de cada repositório quando aplicável.

> Horizontes anteriores ao "Marketplace completo" já estavam concluídos quando este arquivo foi criado (2026-09-08) e não foram registrados em detalhe aqui — este roadmap passa a rastrear a partir deste ponto em diante.

## Horizonte: Marketplace completo — ✅ Concluído

| # | Item | Status | Backend | Frontend |
|---|------|--------|---------|----------|
| 5 | Avaliações de unidades (reviews) | ✅ | `2f6873d` | `1f46c19` |
| 6 | Cartão-presente, sinal e fidelidade (controle manual) | ✅ | `0d97dba` | `9535775` |
| 7 | SEO por categoria×cidade + posicionamento pago "Destaque" | ✅ | `058677c` | `c68376e` |
| 8 | Moeda detectada por geolocalização no cadastro | ✅ | `160e808` | `1990178` |

### 5. Avaliações de unidades
Clientes avaliam (1-5 estrelas + comentário) uma barbearia após terem histórico com ela; média/contagem exibida na página pública e na busca.

### 6. Cartão-presente, sinal e fidelidade
- Cartão-presente: emissão pela franquia, resgate parcial/total no checkout de vendas.
- Sinal: valor sugerido por serviço, snapshot no agendamento, marcação manual de "recebido".
- Fidelidade: pontos por rede, ganhos em vendas pagas, resgate como desconto.
- **Decisão de escopo**: cobrança 100% manual (staff registra cash/cartão/pix como hoje) — sem nova integração Stripe para o cliente final do marketplace.

### 7. SEO por categoria×cidade + Destaque
- Rotas indexáveis `/search/:categoria/:cidade` (e variantes `/search/:categoria`, `/search/all/:cidade`), com título/descrição/canonical dinâmicos via hook próprio (`useSeoMeta`) — sem SSR/prerender (decisão explícita, SPA pura).
- Campo de busca por cidade (antes inexistente).
- Posicionamento pago "Destaque": ativação manual por admin (`/backoffice/featured-barbershops`), sem cobrança automática ainda; unidades destacadas sobem no topo da busca e ganham badge.
- Script de geração de `sitemap.xml` (rodagem manual/CI, não integrado ao build).

### 8. Moeda por geolocalização no cadastro
País inicial do cadastro sugerido por geolocalização de IP (mesma técnica da detecção de idioma); moeda passa a acompanhar o país selecionado (auto ou manual) via `country-state-city`, sem campo de moeda visível.

## Bugs encontrados e corrigidos ao longo do horizonte
- 3 bugs pré-existentes de ordem de argumentos entre resolver e service (`updateBarbershopService`, `updateBarberSchedule`, `deleteBarberSchedule`) — existiam desde o commit inicial.
- `searchPublicBarbershops` quebrava com erro GraphQL quando uma unidade sem nenhuma avaliação aparecia nos resultados (`reviewCount` não nullable sem fallback).

## Pendências conhecidas (fora deste horizonte)
- ~~Rollback de cadastro incompleto~~ ✅ resolvido: o rollback agora apaga também a `Network` criada por `createBarbershop` (que travava o `DELETE` do `User` por FK RESTRICT quando dois cadastros disputavam o mesmo slug) e as demais tabelas com FK pra `User` (`LoginHistory`, `ActiveSession`, `EmailLogger`, `VerificationCode`), numa transação que não mascara o erro original; a unique violation de slug vira a mesma mensagem amigável do check prévio.

## Horizonte: Crescimento e retenção — ✅ Concluído

| # | Item | Status | Backend | Frontend |
|---|------|--------|---------|----------|
| 1 | Lembretes de agendamento por WhatsApp | ✅ | `809dd3e` | — |
| 2 | Relatórios avançados pro dono (retenção, no-show, mais vendidos) | ✅ | `4ce78c1` | `de424f1` |
| 3 | Indicação entre clientes de uma barbearia (ganha pontos de fidelidade) | ✅ | `61d8116` | `9f95abd` |

### 1. Lembretes de agendamento por WhatsApp
Novo `WhatsappService` envia lembrete via WhatsApp Cloud API (Meta) direto, além do e-mail já existente — os dois canais são independentes (falha em um não afeta o outro). Só ativa se `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` estiverem configurados (ver `.env.example`); sem eles, comportamento idêntico ao de antes (só e-mail). Nova `normalizePhoneToE164` (`src/common/phone.util.ts`) normaliza o telefone (texto livre hoje) por heurística de melhor esforço pro mercado BR.

**Pendência pra funcionar de verdade em produção**: exige submissão manual de um template de mensagem no Meta Business Manager e aprovação da Meta (não automatizável, nem testável nesta sessão sem credenciais reais) — texto sugerido do template em `.env.example`.

### 2. Relatórios avançados pro dono
Nova aba "Reports" com seletor de período (semana/mês): taxa de não-comparecimento geral/por barbeiro/por serviço (baseada em agendamentos `COMPLETED`/`NO_SHOW`), serviços e produtos mais vendidos por receita (via `SaleItem` pago no período), e retenção de clientes (retornando vs. novos, comparando vendas do período com vendas anteriores). Reaproveita o módulo `'reports'` do plano Premium, que já existia definido em `barbershop-plan.constants.ts` mas nunca tinha sido usado — recurso Premium-only, com a mesma tela de "bloqueado por plano" já usada em Estoque.

### 3. Indicação entre clientes de uma barbearia
Cliente indica cliente e ganha pontos de fidelidade — reaproveita o programa de fidelidade já construído no horizonte anterior. Diferente do "Convidar amigos" (`InviteFriends`/`AcceptInvite`) já existente, que é pra atrair novos *donos* de barbearia pra plataforma, não clientes de uma unidade específica.

## Horizonte: Paridade com Booksy — ✅ Concluído

Baseado em análise competitiva contra o [Booksy](https://biz.booksy.com/en-us/who-loves-us/barber) (maior plataforma de agendamento pra barbearias/salões do mercado americano) — comparação completa em artifact publicado em 2026-09-08. Hoje já temos paridade ou vantagem em 17 categorias (SEO próprio, avaliações, comissão por barbeiro — que o Booksy nem tem —, relatórios avançados, etc.); estes são os gaps reais encontrados.

| # | Item | Status | Backend | Frontend |
|---|------|--------|---------|----------|
| 1 | Lista de espera automática | ✅ | `e0363aa` | `343cbb3` |
| 2 | Campanhas de marketing (Message Blast) | ✅ | `a21507b` | `d72d7ab` |
| 3 | Taxa de cancelamento tardio/no-show | ✅ | `895fe0f` | `c3eeee3` |
| 4 | Assinatura recorrente pro cliente final | ✅ | `621a912` | `fe7fe64` |
| 5 | Agendamento de posts em redes sociais | ✅ | `e5138de` | `358cfcc` |
| 6 | Site/domínio próprio do negócio | ✅ | `2af1f9d` | `ffada7c` |

### 1. Lista de espera automática
Novo modelo `WaitlistEntry`: staff adiciona cliente à lista de espera de um barbeiro/serviço/data (todos opcionais exceto data — "qualquer barbeiro"/"qualquer serviço" são válidos). Quando um agendamento que combina é cancelado, o primeiro da fila (por ordem de entrada) é automaticamente marcado como avisado e notificado por WhatsApp/e-mail — reaproveita `WhatsappService`/`EmailService` do item anterior. Não reagenda sozinho, só avisa que abriu vaga (evita criar agendamento sem confirmação do cliente). Nova página "Waitlist" na barbearia pra gerenciar.

### 2. Campanhas de marketing (Message Blast)
Nova página "Marketing": escolhe público (todos, inativos há N dias sem `ServiceHistory` nesta unidade, ou aniversariantes do mês), vê a contagem de destinatários em tempo real, escreve mensagem livre, escolhe canal (e-mail/WhatsApp) e confirma antes de disparar. Novo modelo `MarketingCampaign` guarda o histórico com contagem real de envios bem-sucedidos por canal (falha em um destinatário não derruba os demais). Novo `Customer.marketingOptOut` (checkbox no cadastro do cliente) exclui da segmentação. Reaproveita `WhatsappService`/`EmailService` dos lembretes; WhatsApp usa um template genérico de parâmetro único (mesma exigência de aprovação da Meta dos anteriores).

### 3. Taxa de cancelamento tardio/no-show
O Booksy pede cartão no momento do agendamento e cobra automaticamente em caso de cancelamento tardio/no-show — isso foi cogitado via Stripe Connect (conta própria da franquia), mas descartado: exigiria o dono da barbearia passar por onboarding numa plataforma de pagamento externa, uma camada de burocracia que barbearias não-técnicas provavelmente não completariam, arriscando abandono da plataforma. Ficou manual em vez disso — mesma filosofia do sinal e do cartão-presente: o sistema calcula automaticamente quanto o cliente deve (percentual do serviço ou valor fixo, configurável por rede) quando cancela dentro da janela de cancelamento tardio ou não aparece, registra o valor, e a equipe cobra depois por fora. Nova seção na tela de franquia pra configurar a política, e uma página listando as taxas geradas por barbearia com ações pra marcar como cobrada ou perdoar.

### 4. Assinatura recorrente pro cliente final
Ex.: "corte ilimitado por R$99/mês" cobrado automaticamente todo mês — diferente do pacote pré-pago (`ServicePackage`) que já existe, que é finito e sem cobrança recorrente. Aqui a cobrança precisa mesmo ser automática (não dá pra pedir pro cliente pagar na mão todo mês sem perder o sentido do produto), então usa Stripe Subscriptions nativo na conta da própria plataforma — não Stripe Connect: o dono da barbearia não participa do onboarding nenhum, mesma preocupação de fricção que descartou o Connect no item 3. O dinheiro cai inteiro na conta da plataforma; o repasse pra barbearia é só um cálculo (taxa de 15% fixa em código, não editável pela barbearia), mostrado num relatório — a transferência de fato é combinada por fora. Nova página "Assinaturas" pra criar planos, ver assinantes e o relatório de repasse; seção de planos + captura de cartão (Stripe Elements) na página pública de agendamento; "Minhas assinaturas" na área do cliente pra ver/cancelar.

### 5. Agendamento de posts em redes sociais
Barbearia conecta a própria Página do Facebook (e a conta comercial do Instagram vinculada, se houver) via OAuth Login do Facebook pra Empresas — token da Página guardado, nunca exposto no GraphQL. **Publicação de verdade exige a Meta aprovar as permissões de negócio** (`pages_manage_posts`, `instagram_content_publish`, etc.) via App Review, processo deles que pode levar dias; sem aprovação, só funciona com contas de teste do próprio app Meta da plataforma. Post agendado guarda legenda, imagem e horário; um cron a cada 5 minutos publica via Graph API direto (sem SDK, mesmo padrão do `WhatsappService`) — sem fila de jobs no projeto, granularidade de minutos é suficiente pra post de marketing. Falha numa rede não impede a outra. Nova página "Redes sociais" na barbearia pra conectar a conta, compor/agendar publicações e acompanhar status.

### 6. Site/domínio próprio do negócio
Mesma página pública de sempre (`/u/:slug`), agora também acessível por um subdomínio próprio da unidade (ex.: `barbeariavintage.<domínio da plataforma>`) — novo campo `Barbershop.subdomain`, opcional, editável, validado como label de DNS e único. Frontend detecta o host e roteia pra mesma página; CORS liberado dinamicamente pra qualquer subdomínio. **Falta a parte de infraestrutura**: domínio próprio registrado, DNS curinga (`*.dominio`) e SSL configurados (a Vercel precisa de plano pago pra domínio curinga) — isso é ação de conta/pagamento de quem administra a plataforma, não código; até lá, funciona em `*.localhost` pra desenvolvimento. Domínio customizado de verdade por barbearia (`barbeariavintage.com.br` própria) foi descartado por ser bem mais esforço (onboarding de DNS por tenant) sem ganho proporcional nesta fase.

## Horizonte futuro: Marketplace de profissionais — 💡 Ideias (não iniciado)

Registrado em 2026-09-25 como direção de produto para depois. A ideia é o app deixar de ser só "a agenda da barbearia" e virar um marketplace de pessoas, como Uber ou Airbnb: profissionais com vida própria na plataforma, que trabalham para uma ou várias barbearias, e clientes com histórico.

### O que já existe e serve de base
- **Uma conta em várias unidades + vínculo temporário** (`Barber.userId`, `currentEngagement()`): o mesmo usuário já pode trabalhar em mais de uma barbearia, inclusive como freelancer por período.
- **Cadeira alugada** (Shared Location): profissional independente dentro do espaço de outra barbearia, com cobrança do aluguel.
- **5 cargos** (básico, barbeiro, recepção, gerente, dono), escala, folgas, horário de funcionamento e checagem de conflito de horário por barbeiro.
- **Página pública da unidade** com galeria, avaliações, foto dos profissionais, SEO e agendamento com "qualquer profissional".
- **Taxa da plataforma** só em pagamento que passa pelo Stripe (sinal online, assinatura do cliente): regra atual, que continua valendo.

### 1. Cadastro aberto para profissionais
- Qualquer pessoa cria conta como **barbeiro, gerente ou recepção**, sem precisar do convite de um dono. Ela escolhe o papel (ou papéis) no cadastro.
- O profissional se **vincula a uma ou várias barbearias ao mesmo tempo**. A barbearia convida ou o profissional pede para entrar, e a outra parte aceita. O vínculo pode ser fixo ou temporário, como já é hoje.
- **Agenda única do profissional:** a disponibilidade dele é a soma das escalas em todas as unidades. A regra de conflito passa a valer **entre unidades**: não dá para marcar dois atendimentos no mesmo horário em lugares diferentes, nem escala sobreposta em duas barbearias. Hoje o conflito é checado por barbeiro, e cada unidade tem um `Barber` próprio. Precisa de uma identidade de profissional acima do `Barber` (ex.: `Professional` ligado ao `User`), com os `Barber` de cada unidade apontando para ela.
- Gerente e recepção com várias unidades: mesma ideia. O painel mostra as unidades de que a pessoa participa, e o cargo pode ser diferente em cada uma.

### 2. Página pública do profissional (`/p/:slug`)
- Quantidade de serviços realizados (atendimentos concluídos) e tipos de serviço (categorias e mais feitos).
- Galeria de trabalhos própria, independente da galeria da unidade, e especialidades (já existe `specialties` no barbeiro).
- **Locais de atendimento:** barbearias onde atende hoje, com mapa, e se **atende a domicílio** (área/raio e taxa de deslocamento).
- Nota média e comentários (avaliação do atendimento, não só da unidade), com resposta do profissional.
- Histórico profissional: **franquias e barbearias onde já trabalhou**, com período, vindo dos vínculos encerrados. O profissional escolhe se mostra.
- Botão de agendar com ele: escolhe o local (ou domicílio) e cai na agenda única.
- SEO igual ao da página da unidade: meta tags, imagem de compartilhamento e sitemap.

### 3. Perfil do cliente
- Para o próprio cliente: histórico de cortes e serviços (quando, onde, com quem, qual serviço) e lugares onde já foi. Parte disso já existe em "Minha conta".
- **Nota do cliente dada pelo profissional:** pontualidade, comparecimento, trato. Como no Uber, serve para o profissional decidir sobre agendamentos (ex.: exigir sinal de quem falta muito).
  - ⚠️ **LGPD:** é dado pessoal com avaliação de conduta. Precisa de base legal clara e transparência (o cliente vê a própria nota e o que a compõe). Deve ser agregada (média, sem comentários livres sobre a pessoa) e vista só por profissionais que atendem ou vão atender o cliente. Nunca pública. Validar com jurídico antes.
- Preferências (tipo de corte, observações, fotos de referência) que o cliente leva para qualquer profissional ou unidade, com consentimento.

### 4. Domicílio e descoberta tipo Uber/Airbnb
- Busca por profissional, não só por barbearia: especialidade, nota, preço, distância, "atende em casa", "disponível hoje".
- Pedido a domicílio: o cliente informa o endereço, vê quem atende a região e o horário livre, e agenda. O sinal online (já existe) reduz calote.
- Mais para frente: pagamento no app, com a taxa da plataforma sobre o que passa pelo Stripe, dentro da regra atual.

### 5. Perfis por tipo de usuário e controle de privacidade
Cada tipo de usuário tem um **perfil** dentro da plataforma, e **a própria pessoa decide o que aparece e para quem**. O padrão é privado: nada fica público sem ela escolher.

**Tipos de perfil.** Uma mesma pessoa pode ter vários: um barbeiro também é cliente, e um dono também pode atender.

| Perfil | O que mostra (se a pessoa escolher) |
|---|---|
| Cliente | Histórico de cortes e serviços, onde já foi, preferências e fotos de referência (tudo privado por padrão) |
| Profissional (barbeiro) | Serviços realizados, tipos, galeria, especialidades, locais, domicílio, nota e comentários, onde já trabalhou |
| Gerente | Unidades que gerencia ou gerenciou, tempo de experiência, especialidades de gestão |
| Recepção/atendente | Unidades onde atuou, idiomas, disponibilidade |
| Dono de barbearia/franquia | Já tem a página da unidade; pode ter um perfil pessoal que liga as unidades e, se também atender (item 7), o perfil de profissional — o mesmo vale para gerente e recepção |

**Controles no perfil**, numa página nova "Perfis e privacidade" nas configurações da conta, ao lado de "Segurança":
- **Visibilidade do perfil:**
  - *Público*: aparece na busca, no Google e no sitemap;
  - *Só na plataforma*: só usuários logados veem, fora do Google;
  - *Oculto*: só quem já trabalha ou é atendido pela pessoa.
- **Disponível para ser contratado** (open to work): sim ou não. Se sim:
  - tipo (fixo, freelancer ou aluguel de cadeira);
  - dias e horários livres, que vêm da agenda única;
  - raio ou cidades;
  - cargos que aceita.

  As barbearias só encontram quem marcou essa opção, e mandam uma proposta que a pessoa aceita ou recusa.
- **Aceitando novos clientes:** o profissional pode fechar a agenda para gente nova sem sumir da plataforma.
- **Campo a campo:** mostrar ou esconder foto, nota, número de atendimentos, comentários, histórico de franquias, locais e contato. O contato fica oculto por padrão, e a conversa acontece pelo próprio app.
- **"Ver como o público vê":** pré-visualização do perfil com as escolhas atuais.
- **Cliente:** decide se os profissionais de *outras* barbearias podem ver o histórico e as preferências dele. É consentimento explícito e dá para revogar. A nota que os profissionais dão a ele (item 3) nunca aparece no perfil público.
- **Regras gerais:**
  - só perfis *Públicos* entram na busca aberta e no sitemap, e os outros ganham `noindex`;
  - esconder o perfil não apaga nada;
  - a exclusão de conta (LGPD, já existe) passa a valer por perfil e para a conta inteira.

### 6. Cadastro com escolha do tipo de usuário
Muda o cadastro inteiro. Hoje existem o `User` (dono e equipe, com tipo "padrão" ou "dono de barbearia", e funcionário entrando só por convite) e o `ClientAccount` (cliente, com login separado em `/client`).
- **Primeiro passo do cadastro: "Como você vai usar?"**
  - *Quero agendar* (cliente);
  - *Sou profissional* (barbeiro, gerente ou recepção, podendo marcar mais de um);
  - *Tenho uma barbearia/franquia* (fluxo atual de dono), com a opção "Eu também atendo" (item 7).

  Depois o onboarding é específico de cada tipo: o profissional preenche especialidades, locais, domicílio e se está disponível para contratação; o dono cadastra a unidade, como hoje.
- **Adicionar perfil depois:** quem entrou como cliente pode ativar "Sou profissional" nas configurações, e vice-versa, sem criar outra conta.
- **Convite de barbearia continua existindo**, já com o tipo e o cargo preenchidos. Quem já tem conta só aceita o vínculo.
- **Login social:** na primeira entrada, pergunta o tipo antes de seguir, como o passo acima.
- **Unificar a identidade:** um login só (`User`) com perfis ligados (`ClientProfile`, `ProfessionalProfile`...), em vez de `User` e `ClientAccount` separados. É uma migração grande:
  - juntar contas com o mesmo e-mail confirmado;
  - manter as sessões, o "Lembrar de mim" e a verificação de e-mail;
  - redirecionar as rotas `/client/*`.

  Dá para fazer em etapas: primeiro os perfis de profissional no `User`, depois trazer o cliente.
- **Impacto:**
  - modelo de dados e guards de acesso: o cargo por unidade continua como está; o perfil é outra camada;
  - telas de cadastro e onboarding;
  - SEO e sitemap (só perfis públicos entram);
  - e-mails de boas-vindas por tipo;
  - exclusão de conta;
  - todos os testes E2E de cadastro e login.

### 7. Quem administra também pode atender (dono, gerente e recepção)
Cargo (o que a pessoa **pode fazer** na unidade) e atender (se ela **corta cabelo**) passam a ser coisas separadas. Qualquer um, seja dono, gerente ou recepção, pode ligar **"Eu também atendo"** e passar a aparecer como barbeiro, sem perder o cargo. É o modelo do Booksy, com funcionários "com agenda" e "sem agenda".

**Como é hoje**
- Dono não é tipo de funcionário: para atender, precisa se cadastrar como funcionário da própria unidade, como o seed faz com o "Cayo Carlos".
- Gerente já pode ser agendado.
- Recepção **nunca** atende (`BOOKABLE_STAFF` exclui).
- O limite de profissionais do plano (`maxBarbersPerShop`: Basic 3, Medium 10, Premium ilimitado) conta **todo funcionário ativo**, inclusive recepção e gerente que não atendem. Isso pesa injustamente para quem tem equipe administrativa.

**Proposta**
- **"Eu também atendo" por unidade**, na ficha do funcionário (gerente e recepção) e nas unidades do dono, também oferecido no cadastro de dono. Ligar a opção:
  - cria (ou reaproveita) o perfil de profissional;
  - habilita escala, folgas e serviços próprios;
  - põe a pessoa na agenda, na página pública e no "qualquer profissional".
- O cargo continua o mesmo: a recepção que atende segue com as permissões de recepção (e ganha a própria agenda); o gerente e o dono, idem.
- Vale **por unidade**: dá para atender numa e só administrar outra.
- Os horários de atendimento entram na checagem de conflito entre unidades (item 1). A recepção que atende tem o horário de atendimento reservado e continua cuidando do balcão nos outros horários.
- **Comissão:** gerente e recepção que atendem seguem as regras de comissão normais. O dono não gera comissão para si mesmo, porque a receita já é dele, mas aparece nos relatórios por profissional.
- **Perfil público:** os atendimentos contam para a página de profissional, e a pessoa escolhe se mostra o cargo (ex.: "Dono", "Gerente").

**Efeito no plano: cobrar por quem atende, não por quem administra**
- O limite do plano passa a contar **vagas de quem atende**: barbeiros, mais gerentes e recepção com "Eu também atendo" ligado.
- Gerente e recepção que **só administram não ocupam vaga**. Faz sentido, porque o valor do plano vem da agenda que gera receita.
- O **dono** que atende também não ocupa vaga, para não punir o pequeno dono que corta sozinho.
- Ligar "Eu também atendo" numa unidade que já está no limite pede upgrade, com a mesma mensagem de hoje.
- Desligar a opção libera a vaga. Os atendimentos já marcados continuam, e só não dá para marcar novos com a pessoa.
- Se o plano mudar para preço por profissional (por vaga), esta é a unidade natural de cobrança: "R$ X por profissional que atende", com a equipe administrativa grátis.
- **Transição:** unidades que hoje estão no limite por causa de recepção ou gerente sem agenda ganham vaga automaticamente. É uma mudança só a favor do cliente, sem ninguém passar a pagar mais.

### 8. Carreira do profissional e atendimentos "por conta própria"
Muitos profissionais trabalham numa barbearia e também atendem por fora: em casa, a domicílio, fim de semana, clientes antigos. Hoje o sistema só existe **dentro** de uma barbearia. A ideia é o profissional ter **o panorama da carreira inteira**, sem depender de estar preso a uma barbearia, e poder usar o sistema para a parte "dele" **sem pagar nada**, dentro de um limite.

**Panorama de carreira (sempre grátis)**, na conta do profissional:
- todas as barbearias onde atende ou já atendeu, com período, cargo e comissão;
- total de atendimentos, serviços mais feitos, faturamento gerado e comissão/pagamentos recebidos (vêm do módulo de pagamento da equipe, que já existe);
- nota média e evolução, clientes que voltam, horários mais cheios;
- tudo junto: o que fez nas barbearias **e** por conta própria, num lugar só.
- É o que prende o profissional à plataforma, qualquer que seja a barbearia onde ele esteja, e é o que alimenta a página pública (item 2).

**Agenda "por conta própria" (modo solo)**
- Uma agenda pessoal do profissional, **fora** de qualquer barbearia, para os clientes dele: local próprio, domicílio ou "combinar".
- Tem agenda, clientes, lembretes, link de agendamento próprio e página pública, sem precisar criar uma "franquia" nem uma unidade.
- Entra na **agenda única** (item 1): não dá para marcar um atendimento solo no horário em que ele está escalado na barbearia.

**Cota grátis por número de atendimentos, não por faturamento**
- Até **N atendimentos concluídos por conta própria por mês** (ex.: 30–40) é **grátis para sempre**.
- Contar atendimentos é mais simples e mais difícil de burlar do que faturamento declarado: o preço pode ser registrado a menos, mas o atendimento está na agenda.
- **Só contam os atendimentos solo.** O que ele faz dentro de uma barbearia que já paga plano nunca conta, porque já está coberto.
- O painel mostra "você fez Y de N atendimentos por conta própria este mês", com aviso ao chegar perto do limite.
- **Acima de N:** o profissional escolhe entre
  - o plano **Pro** (preço fixo baixo, ex.: R$ 39–59/mês, sem limite de atendimentos solo, com destaque e domicílio com raio maior); ou
  - continuar grátis e, naquele mês, não marcar mais atendimentos solo pelo sistema. Os que já estavam marcados continuam, só novos param.

  Ninguém é cobrado sem escolher. O primeiro mês acima do limite é tolerado, e a cobrança só é oferecida a partir do segundo mês seguido.

**Para não virar "barbearia disfarçada" (anti-abuso)**
- O modo solo é de **uma pessoa só**: não dá para adicionar outros profissionais, recepção nem gerente. Com equipe, vira uma barbearia com plano.
- Sem os recursos de negócio: caixa com vários operadores, estoque, relatórios de equipe, comissões, várias unidades, franquia e campanhas em massa ficam nos planos de barbearia.
- Uma conta = uma pessoa. Limite de sessões simultâneas no modo solo e detecção de login compartilhado (vários aparelhos atendendo ao mesmo tempo).
- A cota é por pessoa (CPF/identidade verificada para quem passar de um uso mínimo), não por conta: criar outra conta não zera o limite.
- Se o padrão de uso parecer de estabelecimento (volume alto todo mês, vários atendimentos no mesmo horário), o sistema sugere o plano de barbearia em vez de bloquear sem aviso.

### Monetização (sem cobrar do cliente final)
Princípio: **conta de profissional é grátis**. Só paga quem tira valor de verdade da plataforma **por conta própria** e em volume. Quem trabalha dentro de uma barbearia já é coberto pelo plano dela.

| Quem | Paga? | Como |
|---|---|---|
| Cliente final | Nunca | — |
| Profissional dentro de barbearia/franquia com plano ativo | Não | Coberto pelo plano da unidade |
| Profissional: panorama de carreira e página pública | Não | Sempre grátis |
| Profissional solo até **N atendimentos/mês** por conta própria | Não | Grátis para sempre (item 8) |
| Profissional solo acima de **N/mês** | Opcional | Plano **Pro**, fixo e baixo, **ou** para de marcar atendimentos solo novos naquele mês |
| Dono/gerente/recepção | Não | Ligados a uma unidade pagante; se atendem, seguem o item 7 |
| Barbearia/franquia | Sim | Planos atuais, com o limite passando a contar só quem atende (item 7) |

Proposta, a validar com números:
- **Por que número de atendimentos e não faturamento:** é o que o sistema mede com certeza, e não depende do preço registrado. A ideia anterior de limitar por faturamento (R$ 3–5 mil/mês) fica como alternativa, caso a contagem se mostre injusta com quem cobra caro.
- **Onde cobra:** a assinatura Pro pela mesma cobrança Stripe dos planos. Nos pagamentos que passam pelo Stripe (sinal online, pagamento no app), a taxa da plataforma continua como hoje.
- **Extras opcionais**, pagos só por quem quer mais alcance:
  - "Destaque" do profissional na busca, no mesmo modelo do destaque da barbearia;
  - raio maior para atender a domicílio;
  - selo de verificado.
- **Receita do lado das barbearias:** a barbearia abre vagas ("preciso de barbeiro sábado") e contrata freelancer pela plataforma, com taxa pequena por vínculo fechado ou incluso no Premium. É o lado "Airbnb" do aluguel de cadeira, que já existe.

#### Como o Booksy cobra (referência, EUA, 2026)
- **Assinatura:** US$ 29,99/mês para 1 usuário, **+ US$ 20/mês por membro adicional da equipe**. Tudo incluso, sem planos separados. Cobra por pessoa com agenda.
- **Boost (cliente novo do marketplace):** sem mensalidade. Cobra **30% da primeira visita** de cada cliente novo que o marketplace traz, **mínimo de US$ 10 e máximo de US$ 100**. Os retornos desse cliente não pagam nada. **É a parte mais criticada**, e há concorrentes que se vendem como "sem 30% sobre cliente novo".
- **Processamento de pagamento:** a partir de **2,49% + US$ 0,10** por transação. A proteção contra no-show (cobrar o cartão do cliente) usa esse processamento.
- **Cliente final:** não paga nada.

O que tiramos disso:
1. Cobrar **por quem atende** faz sentido, e é o que o item 7 propõe.
2. **Não copiar o Boost de 30%.** Se um dia cobrarmos por cliente novo vindo do marketplace, que seja uma taxa pequena com teto baixo, e anunciar isso como diferencial.
3. O **profissional solo grátis até N atendimentos** é algo que o Booksy não tem (lá o solo paga os mesmos US$ 29,99), e é o que traz o profissional para a plataforma antes de ele ter barbearia.

### Riscos e pontos em aberto
- **Identidade do profissional:** hoje cada unidade tem o próprio `Barber`. Unificar sem quebrar escala, comissão, repasse e histórico é a maior mudança de modelo de dados. Fazer com migração cuidadosa: criar `Professional` e ligar os `Barber` existentes pelo `userId`.
- **Conflito entre unidades:** precisa ser checado no banco (como o conflito atual por barbeiro) considerando todos os `Barber` do mesmo profissional, e o deslocamento entre locais também deveria contar.
- **Quem é "dono" do cliente:** o cliente que o profissional levou para a barbearia continua na base da barbearia quando ele sai? Definir regras de portabilidade (LGPD: o dado é do cliente) e de não-aliciamento.
- **Avaliação dupla** (cliente avalia profissional, profissional avalia cliente): antifraude (só quem teve atendimento concluído), moderação e direito de resposta.
- **Fiscal:** cobrar o profissional pessoa física ou MEI exige nota fiscal e meio de pagamento. Usar a mesma cobrança Stripe dos planos.

### Fases sugeridas
1. Identidade `Professional` + agenda única com conflito entre unidades (base de tudo).
2. Cadastro com escolha do tipo de usuário + perfis e a página "Perfis e privacidade" (visibilidade, "disponível para contratação", campo a campo) + cadastro aberto de profissional e vínculo por pedido/convite. A privacidade vem junto com o cadastro aberto, não depois.
3. Página pública do profissional (sem domicílio) + avaliação do atendimento por profissional.
4. Perfil/histórico do cliente e nota do cliente (depois da validação jurídica).
5. Domicílio + busca por profissional.
6. Panorama de carreira (grátis) + modo solo com cota de N atendimentos/mês, plano Pro e regras anti-abuso + destaque e vagas para freelancer.
