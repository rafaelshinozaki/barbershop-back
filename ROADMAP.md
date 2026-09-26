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

## Horizonte futuro: Marketplace de profissionais de beleza e bem-estar — 💡 Ideias (não iniciado)

Registrado em 2026-09-25 como direção de produto para depois. A ideia é o app deixar de ser só "a agenda da barbearia" e virar um marketplace de pessoas, como Uber ou Airbnb: profissionais com vida própria na plataforma, que trabalham para uma ou várias barbearias, e clientes com histórico.

### O que já existe e serve de base
- **Uma conta em várias unidades + vínculo temporário** (`Barber.userId`, `currentEngagement()`): o mesmo usuário já pode trabalhar em mais de uma barbearia, inclusive como freelancer por período.
- **Cadeira alugada** (Shared Location): profissional independente dentro do espaço de outra barbearia, com cobrança do aluguel.
- **5 cargos** (básico, barbeiro, recepção, gerente, dono), escala, folgas, horário de funcionamento e checagem de conflito de horário por barbeiro.
- **Página pública da unidade** com galeria, avaliações, foto dos profissionais, SEO e agendamento com "qualquer profissional".
- **Pedido de avaliação por e-mail** algumas horas depois do atendimento concluído, com link sem login. Hoje só o cliente avalia a unidade, e cliente recorrente não recebe de novo antes de 60 dias.
- **Histórico do atendimento** (`Appointment`, serviços do horário, `ServiceHistory`) preso à unidade.
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
- A página é de **profissional**. Se ele também for dono de um estabelecimento, um elo aponta para a página dessa unidade ("dono de …"), sem transformar o perfil num perfil de dono.
- Botão de agendar com ele: escolhe o local (ou domicílio) e cai na agenda única.
- SEO igual ao da página da unidade: meta tags, imagem de compartilhamento e sitemap.

### 3. Perfil do cliente
- Para o próprio cliente: histórico de cortes e serviços (quando, onde, com quem, qual serviço) e lugares onde já foi. Parte disso já existe em "Minha conta". Quem vê esse perfil está no item 11: o próprio cliente, o profissional que atendeu ou vai atender, e a unidade desse atendimento. Não é página pública.
- **Nota do cliente dada pelo profissional:** pontualidade, comparecimento, trato. Como no Uber, serve para o profissional decidir sobre agendamentos (ex.: exigir sinal de quem falta muito).
  - ⚠️ **LGPD:** é dado pessoal com avaliação de conduta. Precisa de base legal clara e transparência (o cliente vê a própria nota e o que a compõe). Deve ser agregada (média, sem comentários livres sobre a pessoa) e vista só por profissionais que atendem ou vão atender o cliente. Nunca pública. Validar com jurídico antes.
- Preferências (tipo de corte, observações, fotos de referência) que o cliente leva para qualquer profissional ou unidade, com consentimento.

### 4. Descoberta tipo Uber/Airbnb
- Busca por profissional, não só por estabelecimento: especialidade, nota, preço, distância, "atende em casa" (item 9), "disponível hoje".
- Mais para frente: pagamento no app, com a taxa da plataforma sobre o que passa pelo Stripe, dentro da regra atual.

### 5. Perfis por tipo de usuário e controle de privacidade
Cada tipo de usuário tem um **perfil** dentro da plataforma, e **a própria pessoa decide o que aparece e para quem**. O padrão é privado: nada fica público sem ela escolher.

**Tipos de perfil.** Uma mesma pessoa pode ter vários: um barbeiro também é cliente, e um dono também pode atender.

| Perfil | O que mostra (se a pessoa escolher) |
|---|---|
| Cliente | Histórico de cortes e serviços, onde já foi, preferências e fotos de referência (tudo privado por padrão) |
| Profissional (barbeiro, manicure, cabeleireira…) | Serviços realizados, tipos, galeria, especialidades, locais, domicílio, nota e comentários, onde já trabalhou |
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
- **Cliente:** o perfil é o do item 11 (só ele, o profissional do atendimento e a unidade). Ele pode, em consentimento explícito e revogável, deixar profissionais de *outras* unidades verem o histórico e as preferências. A nota que os profissionais dão a ele (item 3) nunca aparece no perfil público — e o perfil de cliente não é público.
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
- De uma unidade da qual ele **já saiu**, cada atendimento antigo mostra só o primeiro nome e a data. Sobrenome, e-mail, telefone e o resto da ficha ficam na unidade. Na unidade em que ele ainda trabalha, a ficha continua completa.
- É o que prende o profissional à plataforma, qualquer que seja a barbearia onde ele esteja, e é o que alimenta a página pública (item 2).

**Agenda "por conta própria" (modo solo)**
- Uma agenda pessoal do profissional, **fora** de qualquer barbearia, para os clientes dele: local próprio, domicílio ou "combinar".
- Tem agenda, clientes, lembretes, link de agendamento próprio e página pública, sem precisar criar uma "franquia" nem uma unidade.
- Entra na **agenda única** (item 1): não dá para marcar um atendimento solo no horário em que ele está escalado na barbearia.

**Cota grátis por número de atendimentos, não por faturamento**
- Até **40 atendimentos concluídos por conta própria por mês** é **grátis para sempre**. Quarenta é cerca de dois por dia nos dias em que ele atende fora de uma unidade: cobre o extra e quem está começando, e fica pequeno demais para uma barbearia disfarçada (quem faz o volume de uma unidade assina o plano dela).
- Contar atendimentos é mais simples e mais difícil de burlar do que faturamento declarado: o preço pode ser registrado a menos, mas o atendimento está na agenda.
- **Só contam os atendimentos solo.** O que ele faz dentro de uma barbearia que já paga plano nunca conta, porque já está coberto.
- O painel mostra "você fez Y de 40 atendimentos por conta própria este mês", com aviso ao chegar perto do limite.
- **Acima de 40:** o profissional escolhe entre
  - o plano **Pro** (preço fixo baixo, ex.: R$ 39–59/mês, sem limite de atendimentos solo, com destaque e domicílio com raio maior); ou
  - continuar grátis e, naquele mês, não marcar mais atendimentos solo pelo sistema. Os que já estavam marcados continuam, só novos param.

  Ninguém é cobrado sem escolher. O primeiro mês acima do limite é tolerado, e a cobrança só é oferecida a partir do segundo mês seguido.

**Para não virar "barbearia disfarçada" (anti-abuso)**
- O modo solo é de **uma pessoa só**: não dá para adicionar outros profissionais, recepção nem gerente. Com equipe, vira uma barbearia com plano.
- Sem os recursos de negócio: caixa com vários operadores, estoque, relatórios de equipe, comissões, várias unidades, franquia e campanhas em massa ficam nos planos de barbearia.
- Uma conta = uma pessoa. Limite de sessões simultâneas no modo solo e detecção de login compartilhado (vários aparelhos atendendo ao mesmo tempo).
- A cota é por pessoa (CPF/identidade verificada para quem passar de um uso mínimo), não por conta: criar outra conta não zera o limite.
- Se o padrão de uso parecer de estabelecimento (volume alto todo mês, vários atendimentos no mesmo horário), o sistema sugere o plano de barbearia em vez de bloquear sem aviso.

### 9. Atendimento a domicílio (estabelecimentos e profissionais)
Barbearias, salões e profissionais liberais (barbeiro, manicure, maquiadora, massagista…) muitas vezes atendem na casa do cliente, no hotel, no escritório ou em eventos (noiva, formatura). Hoje o app só conhece atendimento **no endereço da unidade**.

**Quem oferece**
- **O estabelecimento:** a unidade liga "Atendemos a domicílio" e escolhe quais serviços valem fora (nem todo serviço dá para fazer em casa) e quais profissionais saem para atender.
- **O profissional:** no perfil ou no modo solo (item 8), liga "Atendo a domicílio" com a própria área e as próprias regras. Isso vale mesmo que a barbearia onde ele trabalha não ofereça.

**Configuração**
- **Área atendida:** raio a partir de um ponto (a unidade ou a base do profissional), ou lista de bairros/cidades. Fora da área, o serviço nem aparece.
- **Taxa de deslocamento:** fixa, por faixa de distância ou por km, com valor mínimo do pedido. Aparece separada no preço para o cliente.
- **Tempo de deslocamento:** ida e volta bloqueiam a agenda antes e depois do atendimento. A agenda única (item 1) usa isso para não marcar dois atendimentos longe um do outro colados.
- **Antecedência mínima** (ex.: domicílio só com 3h de antecedência) e horários próprios para domicílio.
- **Serviços com preço ou duração diferentes em casa** (opcional).

**Para o cliente**
- No agendamento, escolhe **"No local"** ou **"No meu endereço"**. Se for no endereço, informa o endereço, com autocomplete e o CEP que já existe no cadastro, e complemento. O sistema confere se está na área e soma a taxa.
- **Sinal online recomendado ou obrigatório** para domicílio: o profissional se desloca, e o no-show custa mais. Reaproveita o sinal online e a taxa de no-show que já existem.
- Lembrete com "o profissional está a caminho" (opcional, mais para frente) e contato pelo próprio app.

**Segurança e confiança**, porque é gente entrando na casa de gente:
- selo de **profissional verificado** (documento; mais para frente, antecedentes) como requisito para aparecer na busca de domicílio;
- histórico e nota do cliente (item 3, com as regras de LGPD) ajudam o profissional a decidir;
- endereço do cliente visível só para quem vai atender, e só perto do horário;
- botão de ajuda/ocorrência no atendimento.

**Na agenda e nos relatórios**
- O evento de domicílio fica com um ícone e o endereço, e o deslocamento aparece como bloco "em trânsito".
- Relatórios separam receita no local × domicílio, com a taxa de deslocamento à parte.

### 10. Além da barbearia: beleza e bem-estar
O produto não deve ficar preso a "barbearia". Salões de beleza, esmalterias, estúdios de sobrancelha/cílios, clínicas de estética, maquiadoras, massagistas e depiladoras têm o mesmo fluxo: agenda, profissionais, serviços, clientes, caixa, comissão e página pública.

**O que já existe e ajuda**
- As **categorias de serviço** já cobrem mais que barbearia: cabelo, barba, combo, coloração, penteado, **unhas, pele, sobrancelha/cílios, massagem, maquiagem, bem-estar, depilação** e outros. A busca e o SEO por categoria × cidade já usam isso.
- Agenda, cargos, comissão, pacotes, assinatura do cliente, fidelidade, avaliações e página pública não têm nada de específico de barbearia.

**O que precisa mudar**
- **Tipo de estabelecimento** no cadastro: barbearia, salão, esmalteria, estética, estúdio, espaço de massagem, profissional independente… Ele define o **catálogo inicial de serviços** (modelos prontos por tipo, ex.: "pé e mão", "design de sobrancelha"), os ícones e o texto da página pública.
- **Linguagem neutra no app:** "barbearia" vira "estabelecimento/unidade", e "barbeiro" vira "profissional". Onde fizer sentido, o termo segue o tipo ("Barbearia X", "Salão Y"). Isso afeta telas, e-mails, textos de SEO e as traduções (pt/en/es).
- **Especialidades por área:** manicure, cabeleireira, colorista, esteticista… no perfil do profissional (item 2), e **uma pessoa pode ter várias**.
- **Serviços com particularidades:** tempo de pausa/secagem no meio do serviço (ex.: química, esmalte em gel), atendimento em dupla (duas profissionais no mesmo cliente), ficha técnica do cliente (fórmula da coloração, alergias). A ficha técnica é dado sensível e segue as regras de LGPD.
- **Busca e marketplace por categoria**, não só por "barbearias perto de mim": "manicure a domicílio em Campinas", "design de sobrancelha hoje".
- **Marca e domínio:** o nome "Barbershop" e o código cheio de `barbershop*` funcionam por dentro, mas o **produto** que o público vê precisa de um nome que sirva para beleza em geral. Renomear o código não é necessário: a mudança é no que aparece para o usuário.

**Monetização:** o mesmo modelo para qualquer área. Planos por estabelecimento contando quem atende (item 7), profissional solo grátis até 40 atendimentos/mês (item 8) e cliente final sem pagar nada.

### 11. Depois do atendimento: chat, avaliação dos três lados, histórico e caixinha
Registrado em 2026-09-26. O modelo é o do iFood no chat (conversa presa ao pedido) e o do Airbnb no perfil e nos selos (cada um vê o que a relação permite, e o selo vem do uso real).

**Chat, preso ao atendimento**
Duas conversas, como o chat do pedido no iFood. O telefone continua oculto (item 5).
- **Cliente e unidade**, quando o atendimento é numa barbearia ou salão. No modo solo (item 8) essa conversa não existe, porque não há unidade.
- **Cliente e o profissional que fez o atendimento.**
- Cada conversa é só de quem participa. A unidade não lê o chat do profissional com o cliente, e o profissional não lê o chat da unidade, salvo quando é a mesma pessoa (dono que também atende).
- Abre no agendamento e segue depois de concluído. O histórico da conversa fica guardado com o atendimento.

**Ao finalizar o atendimento**
Um e-mail por atendimento concluído, no lugar do pedido atual que a unidade manda só ao cliente e no máximo a cada 60 dias. O mesmo link serve para avaliar e, no e-mail do cliente, para a caixinha.
- **Cliente:** avalia o profissional e a unidade, e pode deixar caixinha.
- **Unidade** (quando houver) **e o profissional:** avaliam o cliente.
- Só quem participou daquele atendimento concluído avalia. Uma avaliação por lado, com direito de resposta. A nota do cliente segue o item 3: agregada, o cliente vê a própria nota, e ela nunca entra em página pública.

**Histórico dos três**
Cada atendimento concluído entra no histórico da unidade, do profissional e do cliente: quando, onde, com quem, quais serviços, a avaliação e a caixinha. Os serviços daquele horário já estão no agendamento; o que falta é mostrá-los na ficha de cada um. O histórico do profissional atravessa as unidades (depende da identidade do item 1). O do cliente é a linha do tempo do perfil privado.

**Caixinha (gorjeta)**
O cliente escolhe o destino: o profissional **ou** a unidade. É opcional e separada do preço do serviço.
- **Na hora, registrado pela equipe:** dinheiro, Pix e "a mais no cartão" da maquininha. O sistema guarda o valor, o destino e o meio. O dinheiro não passa pela plataforma, no mesmo espírito do sinal manual.
- **Pelo app:** Stripe, quando o cartão já está na plataforma (sinal online ou pagamento no app). A taxa da plataforma só incide sobre o que passa pelo Stripe, como hoje.
- O e-mail de fechamento leva o cliente para essa escolha junto com a avaliação.

**Perfis**
- **Cliente, no modelo do hóspede do Airbnb.** Página privada. Veem: o próprio cliente, o profissional que o atendeu ou vai atender, e a unidade desse atendimento. Fora isso, ninguém. Não entra na busca nem no sitemap. O cliente vê o próprio histórico, os serviços feitos, as notas que recebeu e os selos.
- **Profissional, compartilhável.** É a página do item 2, com o controle de visibilidade do item 5 (pública, só na plataforma ou oculta) e link para mandar a outras pessoas. O perfil do cliente não tem esse link.

**Selos**
Gamificação no estilo dos selos do Airbnb: o selo aparece porque o histórico sustenta, e some se deixar de sustentar. Não se compra. O selo de identidade verificada continua sendo o do item 9 e do H4.
- **Profissional e unidade:** nota alta sustentada, pontualidade, volume de atendimentos concluídos, resposta no chat, poucos cancelamentos. Aparecem na página compartilhável se a pessoa deixar o campo visível.
- **Cliente:** comparece, pontual. Só no perfil privado, para o cliente, o profissional e a unidade. Nunca na busca.

**Por quanto tempo cada dado fica**
A LGPD (arts. 15 e 16) e, se houver pessoa na União Europeia, o GDPR (art. 5º, princípio da limitação da conservação, e art. 17, apagamento) não dizem um único "guarde por X anos". Os dois dizem o contrário: guarda-se pelo tempo do propósito, e apaga-se quando ele acaba. A exceção é a obrigação legal, em que o dado **não pode** sair antes do prazo da lei. No Brasil, documento fiscal em geral fica 5 anos. Na Europa o piso fiscal depende do país. O jurídico confirma os números; o sistema já nasce com um relógio por tipo, não com guarda eterna.

Proposta, até o jurídico fechar:

| Dado | Relógio | Quando acaba |
|---|---|---|
| Cópia de e-mail enviado, histórico de login e aviso no app | 12 meses | A tarefa diária apaga. Código de verificação e token de senha vencidos saem no mesmo dia |
| Texto do chat | 12 meses depois da última mensagem daquele atendimento | Apaga o texto. Se houve denúncia ou disputa aberta, segura até ela fechar |
| Endereço de domicílio | some depois do atendimento, com uma janela curta | Já é visto só por quem vai atender e só perto do horário (item 9) |
| Nota de conduta do cliente | enquanto a relação existe, ou até 2 anos sem novo atendimento | Sai também na exclusão da conta. Nunca vira página pública |
| Histórico de serviços com o nome da pessoa | enquanto a conta existe | Na exclusão, tira o nome. O profissional fica com a contagem e o tipo de serviço, sem saber quem era |
| Comentário de avaliação pública | enquanto o perfil público existir | Na exclusão, o texto sai. A média da unidade pode ficar se não der para identificar a pessoa |
| Caixinha, pagamento, nota | o prazo legal fiscal (Brasil, em geral 5 anos), mesmo depois do pedido de exclusão | Acesso restrito. Passado o prazo, anonimiza |
| Selo | o mesmo relógio do dado que o sustenta | Recalcula quando esse dado sai |

A exclusão de conta que já existe passa a alcançar chat, avaliação, perfil e selo. Não apaga o registro fiscal antes do prazo legal: troca o nome por um identificador interno e restringe quem lê. A política de privacidade publica essa tabela. Sem isso, milhões de usuários viram um arquivo que a lei manda esvaziar e o sistema não sabe por onde começar.

### Monetização (sem cobrar do cliente final)
Princípio: **conta de profissional é grátis**. Só paga quem tira valor de verdade da plataforma **por conta própria** e em volume. Quem trabalha dentro de uma barbearia já é coberto pelo plano dela.

| Quem | Paga? | Como |
|---|---|---|
| Cliente final | Nunca | — |
| Profissional dentro de barbearia/franquia com plano ativo | Não | Coberto pelo plano da unidade |
| Profissional: panorama de carreira e página pública | Não | Sempre grátis |
| Profissional solo até **40 atendimentos/mês** por conta própria | Não | Grátis para sempre (item 8) |
| Profissional solo acima de **40/mês** | Opcional | Plano **Pro**, fixo e baixo, **ou** para de marcar atendimentos solo novos naquele mês |
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
3. O **profissional solo grátis até 40 atendimentos** é algo que o Booksy não tem (lá o solo paga os mesmos US$ 29,99), e é o que traz o profissional para a plataforma antes de ele ter barbearia.

### Riscos e pontos em aberto
- **Identidade do profissional:** hoje cada unidade tem o próprio `Barber`. Unificar sem quebrar escala, comissão, repasse e histórico é a maior mudança de modelo de dados. Fazer com migração cuidadosa: criar `Professional` e ligar os `Barber` existentes pelo `userId`.
- **Conflito entre unidades:** precisa ser checado no banco (como o conflito atual por barbeiro) considerando todos os `Barber` do mesmo profissional, e o deslocamento entre locais também deveria contar.
- **Quem é "dono" do cliente:** a ficha fica na barbearia. Quando ele sai, a lista, o telefone, o e-mail, o sobrenome e a ficha técnica continuam só na unidade. No panorama dele, cada atendimento antigo mostra **só o primeiro nome e a data** — sem meio de contato. A nota que segue é a **dele**, dos atendimentos que ele fez. A nota da unidade continua sendo da unidade. Ele escolhe se o lugar antigo aparece no perfil público.
- **Dono que também é o barbeiro** (saiu de uma unidade, abriu a própria e assina o plano): é a mesma conta. Na unidade nova ele é dono e, com "Eu também atendo", profissional da casa. No perfil público ele aparece como profissional, com um elo para o estabelecimento de que é dono. A nota e o histórico de cortes são do `Professional`, somando onde ele já trabalhou e onde trabalha agora. Sair não apaga o vínculo: ele fica inativo e o histórico permanece. O que apaga o vínculo é reingresso na mesma unidade (libera a vaga) ou exclusão da conta.
- **Avaliação dos três lados** (item 11: cliente avalia profissional e unidade; profissional e unidade avaliam o cliente): antifraude (só quem teve atendimento concluído), moderação e direito de resposta. A nota do cliente continua sujeita à validação jurídica.
- **Caixinha:** dinheiro e Pix registrados na mão não têm taxa. A que passa pelo Stripe usa a mesma decisão de repasse do pagamento no app. Gorjeta é rendimento de quem recebe: nota fiscal fica junto da decisão fiscal do H4.
- **Relógio de guarda** (item 11): a lei não dá um X único. Cada tipo tem propósito, prazo máximo e, no fiscal, prazo mínimo. Vale LGPD e, para pessoa na União Europeia, o GDPR. Os números da tabela são proposta até o jurídico confirmar.
- **Fiscal:** cobrar o profissional pessoa física ou MEI exige nota fiscal e meio de pagamento. Usar a mesma cobrança Stripe dos planos.

### Horizontes e por onde começar
Ordem pensada para **entregar valor cedo sem esperar o marketplace inteiro**. Primeiro, o que dá para fazer sem mudar o modelo de dados. Depois, a base (identidade e agenda única) e o chamariz dos profissionais (modo solo grátis). Só no fim abre o marketplace para o público, quando confiança, pagamento e regras estiverem prontos. Cada horizonte tem objetivo e critério de sucesso: só se passa para o próximo quando o anterior mostrou resultado.

#### H1. Ganhos rápidos, sem mudar o modelo de dados — código concluído
Objetivo: resolver incômodos reais de quem já usa e preparar o terreno.
- **Plano conta só quem atende** (item 7): recepção e gerente que não atendem deixam de ocupar vaga. A mudança só favorece o cliente e é pequena (é o `ensureBarberLimitNotExceeded`).
- **"Eu também atendo"** para dono, gerente e recepção (item 7), usando o `Barber` atual. O perfil `Professional` vem no H2.
- **Tipo de estabelecimento + linguagem neutra** (item 10): "estabelecimento"/"profissional" nas telas, e-mails e SEO, e catálogo inicial por tipo (barbearia, salão, esmalteria, estética…). Abre para outras áreas sem mexer no banco.
- **Métricas de base** ✅: no backoffice, seção "Atividade da plataforma" — profissionais e unidades ativas, agendamentos por semana, retenção de cliente/profissional/unidade (4 semanas contra as 4 anteriores) e mediana de dias até o primeiro agendamento.

Sucesso: nenhuma unidade barrada no limite por causa de equipe administrativa, e primeiros estabelecimentos que não são barbearia cadastrados.

#### H2. O profissional no centro
Objetivo: o profissional passa a ter vida própria na plataforma, e o modo solo grátis traz gente nova.
- **Identidade `Professional` + agenda única** com conflito entre unidades (item 1) ✅: um `Professional` por conta, os `Barber` existentes ligados por `userId`. Atendimento no mesmo horário em outra unidade já era recusado; a escala semanal sobreposta também passa a ser.
- **Cadastro com escolha de tipo + "Perfis e privacidade"** (itens 5 e 6), começando pelo profissional dentro do `User`. Unificar com o `ClientAccount` fica para o H3.
- **Panorama de carreira** ✅, sempre grátis (item 8): `myCareer` junta as unidades em que a pessoa ainda está ligada. De uma unidade da qual ela saiu, cada atendimento antigo mostra só o primeiro nome e a data. O perfil público (`/p/:slug`) nasce oculto; quando ela liga, a página é de profissional e, se for dona, aponta para o estabelecimento. A nota pessoal ainda não existe (a avaliação hoje é da unidade).
- **Modo solo** com cota de **40** atendimentos concluídos por mês, plano Pro e regras anti-abuso (item 8). O preço do Pro continua em aberto.
- **Importação de dados** de outros sistemas (Booksy, Trinks, planilha): clientes, serviços e agenda. É a maior barreira para migrar.
- **Indicação entre profissionais**, que ganham meses de Pro.

Pré-requisitos: H1 (métricas) e o preço do Pro. A cota grátis é 40. Sucesso: X profissionais solo ativos por mês, e parte deles convertendo para Pro ou levando a barbearia para a plataforma.

#### H3. Vitrine: ser encontrado
Objetivo: cliente acha profissional e estabelecimento por categoria e perto dele.
- **Página pública do profissional** + avaliação por profissional (item 2), com link compartilhável.
- **Busca por localização de verdade** (distância, raio, filtros), com PostGIS ou similar, por profissional e por categoria (item 4).
- **Favoritos e "agendar de novo com o mesmo profissional"**, e política de cancelamento visível antes de agendar.
- **Unificar `User` e `ClientAccount`** (item 6, segunda etapa): o cliente passa a ter o mesmo login e o perfil privado (item 11), com o histórico de serviços.
- **Fechamento do atendimento** (item 11, a parte que não depende de chat nem de Stripe): e-mail a cada atendimento concluído para o cliente avaliar profissional e unidade e deixar caixinha; e-mail para a unidade e o profissional avaliarem o cliente; histórico dos três com os serviços feitos; caixinha registrada na mão (dinheiro, Pix, a mais no cartão); selos calculados desse histórico.
- Moderação de galerias, comentários e perfis públicos. O perfil do cliente não entra nessa moderação pública: ele não é público.

Sucesso: agendamentos vindos da busca (e não do link direto da unidade), e taxa de reserva por busca.

#### H4. Confiança e dinheiro
Objetivo: dar condições de a plataforma intermediar estranhos com segurança.
- **Verificação de identidade** (documento + selfie) e selo de verificado. Checagem de antecedentes (terceiro) para quem quiser atender a domicílio.
- **Chat do atendimento** (item 11): cliente–unidade, quando houver unidade, e cliente–profissional. Sem expor telefone. Notificações no celular (PWA primeiro, app nativo depois).
- **Caixinha pelo Stripe** (item 11), no mesmo fluxo do pagamento no app.
- **Pagamento no app**: reavaliar a decisão de não usar Stripe Connect. Alternativas: Connect opcional só para quem quer receber pelo app, ou split via Pix. Mais reembolso, disputas e nota fiscal das taxas, da assinatura e da caixinha que passar pelo Stripe.
- **Jurídico (LGPD e GDPR)**: termos de marketplace (plataforma intermediária, cancelamento, responsabilidade), contrato do profissional autônomo (sem vínculo), DPO e relatório de impacto para a **nota do cliente** e a **ficha técnica**. A política de retenção é a tabela do item 11, confirmada pelo jurídico e publicada. A tarefa diária já apaga cópia de e-mail, histórico de login, aviso no app e token vencido. Chat e nota de conduta entram nela quando existirem. O chat fica particionado por mês para esse apagamento ser descartar a partição velha, em vez de varrer a tabela inteira. Pagamento e caixinha não entram nessa tarefa.
- Denúncia, bloqueio, suspensão e suporte humano.

Sucesso: pagamentos pelo app sem aumento de disputas; jurídico aprovado para a nota do cliente e o domicílio.

#### H5. Marketplace aberto + domicílio (cidade piloto)
Objetivo: abrir de verdade, começando pequeno.
- **Cidade piloto + 1–2 categorias** (ex.: barbeiro e manicure em uma cidade). Enche a oferta primeiro (com o modo solo do H2) e só depois abre a busca ao público.
- **Atendimento a domicílio** (item 9): área, taxa, deslocamento na agenda, sinal obrigatório/recomendado, endereço só para quem atende, botão de ajuda.
- **Nota do cliente** dada pelo profissional (item 3), só depois do jurídico no H4.
- **Vagas para freelancer** e "Destaque" do profissional (monetização).
- Lista de espera no marketplace (avisar quando um profissional disputado abrir horário).

Sucesso: liquidez na cidade piloto (a maioria das buscas encontra horário em até 48h), retenção dos dois lados; só então replicar para outras cidades.

#### Decisões em aberto (definir antes do horizonte indicado)
- **Preço do Pro** (H2). A cota grátis já está definida: **40 atendimentos concluídos por conta própria por mês**, não por faturamento.
- **Marca** que sirva para beleza em geral (H1/H3).
- **Pagamento no app e caixinha pelo Stripe**: Connect opcional, Pix com split ou continuar manual, com o repasse da gorjeta na mesma regra (H4).
- **Cobrar por cliente novo do marketplace?** Se sim, taxa pequena com teto baixo, nunca os 30% do Booksy (H5).
- **Cidade e categorias do piloto** (H5).
- **Validação jurídica**: nota do cliente, ficha técnica, domicílio, contrato do autônomo e os prazos da tabela de guarda, inclusive o piso fiscal no Brasil e em cada país europeu em que houver cliente (H4).
