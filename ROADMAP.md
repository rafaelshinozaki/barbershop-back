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
- Posicionamento pago "Destaque": ativação manual por admin (`/backoffice/featured-barbershops`) e, desde o H5, compra com cartão (ver "Destaque" do profissional no H5); unidades destacadas sobem no topo da busca e ganham badge.
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
- Até **30 atendimentos concluídos por conta própria por mês** é **grátis para sempre**. Trinta cobre o extra e quem está começando, e fica pequeno demais para uma barbearia disfarçada (quem faz o volume de uma unidade assina o plano dela).
- Até **30 produtos vendidos por mês** na mesma agenda, contando unidades (não o preço). A mesma regra: o primeiro mês acima é tolerado; no segundo mês seguido, vendas novas de produto param.
- Contar atendimentos é mais simples e mais difícil de burlar do que faturamento declarado: o preço pode ser registrado a menos, mas o atendimento está na agenda.
- **Só contam os atendimentos solo.** O que ele faz dentro de uma barbearia que já paga plano nunca conta, porque já está coberto.
- O painel mostra "você fez Y de 30 atendimentos por conta própria este mês" e "Z de 30 produtos", com aviso ao chegar perto do limite.
- **Acima de 30:** o profissional escolhe entre
  - o plano **Pro** (preço provisório **R$ 49/mês**, dentro da faixa R$ 39–59, sem limite de atendimentos solo; destaque e domicílio com raio maior ficam para quando esses recursos existirem); ou
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

**Monetização:** o mesmo modelo para qualquer área. Planos por estabelecimento contando quem atende (item 7), profissional solo grátis até 30 atendimentos e 30 produtos por mês (item 8) e cliente final sem pagar nada.

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
| Pedido de suporte | 24 meses depois da última mensagem | Apaga o pedido inteiro. Sai antes se a conta de quem pediu for excluída |
| Aparelho inscrito na notificação | 6 meses sem uso, ou ao sair da conta | Apaga a inscrição. Sai antes se o serviço de push disser que expirou, ou na exclusão, desativação ou suspensão da conta |
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
| Profissional solo até **30 atendimentos/mês** e **30 produtos/mês** por conta própria | Não | Grátis para sempre (item 8) |
| Profissional solo acima de **30/mês** | Opcional | Plano **Pro**, fixo e baixo, **ou** para de marcar atendimentos solo novos e de vender produto novo naquele mês |
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
3. O **profissional solo grátis até 30 atendimentos e 30 produtos por mês** é algo que o Booksy não tem (lá o solo paga os mesmos US$ 29,99), e é o que traz o profissional para a plataforma antes de ele ter barbearia.

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
- **Cadastro com escolha de tipo + "Perfis e privacidade"** ✅ (itens 5 e 6), começando pelo profissional dentro do `User`. O primeiro passo é "quero agendar" (segue no login de cliente), "sou profissional" ou "tenho um estabelecimento", com "eu também atendo". A página ao lado de Segurança guarda visibilidade (público, só na plataforma, oculto), disponível para contratação, aceitando clientes novos e o que cada campo mostra. Unificar com o `ClientAccount` fica para o H3. Domicílio continua no H5.
- **Panorama de carreira** ✅, sempre grátis (item 8): `myCareer` junta as unidades em que a pessoa ainda está ligada. De uma unidade da qual ela saiu, cada atendimento antigo mostra só o primeiro nome e a data. O perfil público (`/p/:slug`) nasce oculto; quando ela liga, a página é de profissional e, se for dona, aponta para o estabelecimento. A nota pessoal veio no H3 (avaliação por profissional).
- **Modo solo** ✅ com cota de **30** atendimentos concluídos e **30** produtos vendidos por mês (item 8). A agenda, os clientes, os serviços e o link `/u/:slug` nascem como uma unidade de uma pessoa só, fora da cota de unidades do plano. O primeiro mês acima de cada teto segue aberto; no segundo mês seguido, o que é novo para e o que já estava marcado ou vendido continua. O limite de sessões e a cota por CPF continuam em aberto.
- **Preço do Pro** ✅ **R$ 39,90 por mês** (padrão em `src/pricing/pricing.ts`, editável em Preços e taxas; ver "Decisões tomadas"). Enquanto o Pro vale, a cota do solo não trava. A cobrança no cartão segue a mesma trilha Stripe dos planos.
- **Importação de dados** ✅ de outros sistemas (Booksy, Trinks, planilha): clientes, serviços e agenda, com prévia antes de gravar. Horário passado entra como histórico e não consome a cota do solo; horário futuro entra na agenda.
- **Indicação entre profissionais** ✅: cada um tem um código. Quem entra com o código de outro profissional ganha **1 mês de Pro**, e quem indicou também. Uma conta só aceita uma indicação. Não dá para usar o próprio código.

Pré-requisitos: H1 (métricas). O preço provisório do Pro é R$ 49/mês. A cota grátis é 30 atendimentos e 30 produtos. Sucesso: X profissionais solo ativos por mês, e parte deles convertendo para Pro ou levando a barbearia para a plataforma. O limite de sessões e a cota por CPF continuam em aberto.

#### H3. Vitrine: ser encontrado
Objetivo: cliente acha profissional e estabelecimento por categoria e perto dele.
- **Página pública do profissional** + avaliação por profissional (item 2), com link compartilhável ✅: `ProfessionalReview`, uma por atendimento, somando as unidades pela conta. Em `/p/:slug` aparecem a nota média, os comentários e a resposta do profissional, respeitando "mostrar nota" e "mostrar avaliações". O profissional responde pela carreira. Na exclusão da conta do cliente, o texto sai e a nota fica na média.
- **Busca por localização de verdade** (distância, raio, filtros), por profissional e por categoria (item 4) ✅: raio a partir da localização (padrão 25 km), filtros de nota, preço e aberto agora, e ordem por relevância, distância, nota ou preço. Sem PostGIS: um retângulo em volta do ponto corta no banco (índice em latitude e longitude) e a distância exata sai em memória; PostGIS fica para quando o volume pedir. A aba de profissionais mostra só perfis públicos, e quem esconde as unidades não entra na busca por distância.
- **Favoritos e "agendar de novo com o mesmo profissional"**, e política de cancelamento visível antes de agendar ✅: o cliente logado favorita o profissional pelo coração na equipe da página e agenda com ele pela conta. "Agendar de novo" no histórico abre a janela com o mesmo profissional e os mesmos serviços. A política (janela grátis e taxa) aparece na página e no resumo antes de confirmar.
- **Unificar `User` e `ClientAccount`** (item 6, segunda etapa) ✅: as duas contas da mesma pessoa (mesmo e-mail) ficam ligadas em vez de fundidas, e as duas telas de login continuam. Ligada, a senha da equipe vale nas duas telas e dá para passar de uma área para outra sem entrar de novo; da área do cliente para a da equipe não, se houver 2FA. Como a conta da equipe não confirma e-mail, só liga com prova. A mesma senha nos dois lados liga no login ou no cadastro; com senhas diferentes, a pessoa digita a senha do outro lado. Um e-mail avisa a ligação. A "esqueci a senha" do cliente ligado troca a senha da equipe. Excluir uma das contas só desfaz a ligação. O perfil privado do cliente continua na conta de cliente (histórico, nota de conduta e favoritos).
- **Fechamento do atendimento** (item 11, a parte que não depende de chat nem de Stripe) ✅:
  - E-mail a cada atendimento concluído (sem a trava de 60 dias). As estrelas são do profissional e a mesma página avalia a unidade; no modo solo a nota é uma só.
  - Nota do cliente (item 3):
    - pontualidade e trato de 1 a 5, sem texto, dados pela unidade (recepção para cima) e pelo profissional que atendeu, até 30 dias depois;
    - o comparecimento vem do histórico;
    - a média soma as fichas da mesma conta. Quem vê: quem atende ou vai atender, a unidade do atendimento e o próprio cliente. Nunca é pública;
    - o profissional recebe um resumo do dia às 21h para avaliar (`/rate-clients`). A unidade avalia pelo detalhe do agendamento;
    - sai na exclusão da conta e depois de 2 anos sem atendimento novo.
  - Caixinha registrada na mão (dinheiro, Pix, a mais no cartão), com destino profissional ou unidade. A do profissional recebida pela unidade vira lançamento TIP no pagamento dele.
  - Histórico dos três com serviços, nota e caixinha: carreira, ficha do cliente e conta do cliente.
  - Selos calculados do histórico:
    - profissional: nota alta, experiente, clientes fiéis;
    - unidade: nota alta, procurada;
    - cliente, privados: comparece, pontual.
  - A caixinha pelo Stripe segue no H4. A validação jurídica da nota do cliente também, e antes disso ela deve ficar restrita a quem atende.
- **Moderação** de galerias, comentários e perfis públicos ✅: qualquer visitante denuncia, sem login, uma foto da galeria, uma avaliação de profissional, o perfil de um profissional ou a página da unidade. O limite é de 10 por hora; a mesma pessoa não duplica, e o IP não é guardado (vira HMAC). O admin decide numa fila por conteúdo. Ocultar tira a foto da galeria e a avaliação da página e da nota, suspende o perfil e tira a unidade da busca e do sitemap; o link direto da unidade continua. Manter no ar descarta as denúncias, e restaurar volta atrás. As avaliações de unidade seguem o fluxo antigo (a unidade denuncia). O perfil do cliente não entra nessa moderação pública: ele não é público. Aviso ao dono ✅: quando a moderação oculta ou devolve uma foto da galeria ou a página da unidade, o dono e os gerentes são avisados no sininho e no celular; quando é o perfil, o próprio profissional. Avaliação e conversa não têm dono a avisar.

Sucesso: agendamentos vindos da busca (e não do link direto da unidade), e taxa de reserva por busca.

#### H4. Confiança e dinheiro
Objetivo: dar condições de a plataforma intermediar estranhos com segurança.
- **Verificação de identidade** (documento + selfie) e selo de verificado ✅, só para quem atende a domicílio. Usa o Stripe Identity: documento com foto e selfie ao vivo, na página do Stripe. O profissional liga "Atendo a domicílio" no perfil, e o domicílio só aparece no perfil e na busca depois de verificado. Só vale com o nome do documento batendo com o da conta, e trocar o nome tira o selo. Guardamos só o resultado; as imagens ficam no Stripe e são apagadas na exclusão da conta. Fora de produção roda com um fornecedor falso de teste. Falta a checagem de antecedentes (terceiro), que fica para quando o domicílio (H5) entrar de verdade.
- **Chat do atendimento** (item 11) ✅: cliente–unidade, quando houver unidade, e cliente–profissional. Sem expor telefone. Cada conversa é só de quem participa: a da unidade fica com recepção, gerência e dono; a do profissional, só com ele. O cliente entra pela conta ou pelo link "gerenciar agendamento" do e-mail, sem login. A equipe responde pelo detalhe do agendamento ou pela página Mensagens. A equipe é avisada no sininho, e o cliente por e-mail sem o texto, no máximo um a cada 30 minutos. O texto sai 12 meses depois da última mensagem, salvo se segurado por denúncia ou disputa. Notificação no celular ✅ por PWA (Web Push): cada pessoa liga ou desliga em cada aparelho; vai sem o texto da mensagem e, ao tocar, abre a conversa. A equipe da plataforma também recebe os pedidos de suporte. No iPhone, só com o app instalado na Tela de Início. O app nativo fica para depois. Em produção é preciso gerar e configurar as chaves VAPID uma vez.
- **Caixinha pelo Stripe** (item 11) ✅: ver "Pagamento no app", parte 2.
- **Pagamento no app**: decidido **Stripe Connect opcional** (Express), só para quem quer receber pelo app; quem não liga continua no repasse manual.
  - Parte 1 ✅: "Receber pelo app" da unidade, em Serviços. O dono cria a conta de recebimento na página do Stripe (dados, documento e banco); o gerente só vê a situação. Com a conta ativa, o sinal online cai direto nela, já sem a taxa da plataforma (a mesma de hoje, cobrada como taxa do Stripe). O estorno desfaz a transferência e devolve a taxa. O relatório de repasse separa o que já caiu direto. Em produção é preciso ativar o Connect no Stripe e criar o webhook de contas conectadas (account.updated).
  - Parte 2 ✅, caixinha pelo Stripe: o profissional cria a própria conta de recebimento em Perfis e privacidade. No link "como foi?" do e-mail, depois de avaliar, o cliente deixa a caixinha com cartão para o profissional ou para a unidade (só quem recebe pelo app), de 1 a 500. O dinheiro cai direto na conta de quem recebe, com a mesma taxa da plataforma (15%, mantida por decisão do produto). A caixinha entra no registro do atendimento como "pelo app" e não passa pelo pagamento do profissional; o estorno é pelo painel do Stripe.
  - Parte 3 ✅, atendimento pago pelo app: no link "gerenciar agendamento", o cliente paga antes o preço menos o sinal, direto na conta da unidade, com a mesma taxa. Ao fechar a conta, o valor é descontado. Se o horário for cancelado, pela unidade ou pelo cliente, o valor volta inteiro; em caso de falta, fica, e o gerente ou dono pode estornar antes de fechar a conta.
  - Reembolso parcial ✅: antes de fechar a conta, o gerente ou dono devolve tudo ou só uma parte (ex.: trocou por um serviço mais barato). A conta desconta só o que ficou pago; se o horário for cancelado, volta o que restou. O cliente vê no link quanto já foi devolvido.
  - Falta: nota fiscal das taxas (com o jurídico).
- **Jurídico (LGPD e GDPR)**: termos de marketplace (plataforma intermediária, cancelamento, responsabilidade), contrato do profissional autônomo (sem vínculo), DPO e relatório de impacto para a **nota do cliente** e a **ficha técnica**. A política de retenção é a tabela do item 11, confirmada pelo jurídico e publicada. A tarefa diária já apaga cópia de e-mail, histórico de login, aviso no app e token vencido. Chat e nota de conduta entram nela quando existirem. O chat é apagado por conversa (12 meses depois da última mensagem), em lotes. A partição por mês ficou de fora: o Prisma veria as partições como tabelas estranhas no `migrate diff`, e a regra de guarda é por conversa, não por mês. Volta à mesa se o volume pedir. Pagamento e caixinha não entram nessa tarefa.
- **Denúncia, bloqueio, suspensão e suporte humano** ✅:
  - Quem participa denuncia a conversa (cliente pelo link ou pela conta, equipe pelo agendamento). O texto fica guardado até a moderação decidir. "Encerrar conversa" deixa a conversa visível, mas sem mensagem nova.
  - A unidade (gerente para cima) bloqueia um cliente, com motivo. O bloqueado não agenda online em nenhuma unidade da rede (checado pelo telefone, e-mail ou conta) nem manda mensagem. O balcão continua atendendo.
  - Desativar alguém da equipe derruba as sessões já abertas.
  - O admin da plataforma suspende a conta de um cliente (fraude, abuso), com motivo. Suspensa, a conta não entra e as sessões caem; a pessoa recebe um e-mail com o motivo e o caminho do suporte. Os dados continuam, e reativar devolve o acesso. Suspender alguém da equipe continua sendo desativar a conta no backoffice.
  - Suporte humano: "Fale com a gente" para visitante, cliente ou equipe. Quem pediu recebe um e-mail com o link do pedido e acompanha e responde por ele, sem login. A equipe da plataforma é avisada no sininho e responde pela fila do backoffice, e a resposta vai por e-mail.

Sucesso: pagamentos pelo app sem aumento de disputas; jurídico aprovado para a nota do cliente e o domicílio.

#### H5. Marketplace aberto + domicílio (cidade piloto)
Objetivo: abrir de verdade, começando pequeno.
- **Cidade piloto + 1–2 categorias** (ex.: barbeiro e manicure em uma cidade). Enche a oferta primeiro (com o modo solo do H2) e só depois abre a busca ao público.
- **Atendimento a domicílio** (item 9): área, taxa, deslocamento na agenda, sinal obrigatório/recomendado, endereço só para quem atende, botão de ajuda.
- **Nota do cliente** dada pelo profissional (item 3), só depois do jurídico no H4.
- **"Destaque" do profissional** ✅, no mesmo modelo do destaque da unidade: o admin liga até uma data na aba Profissionais da página de Destaque do backoffice; o profissional destacado sobe no topo da busca por relevância (a ordem escolhida pela pessoa continua valendo) e ganha o selo. Compra com cartão ✅ (unidade e profissional): 30 dias por compra, somando ao que já vale, pelo card "Destaque na busca" (página pública da unidade, para dono e gerente; Perfis e privacidade, para o profissional com a página pública). É receita da plataforma, sem Connect. Preço e dias vêm de Preços e taxas (padrão R$ 49,90 a unidade e R$ 24,90 o profissional, por 30 dias). Três dias antes de vencer, quem tem o Destaque recebe um aviso no sininho e no celular (uma vez por vencimento), e o backoffice tem a aba Compras com a receita (últimos 30 dias e total) e a lista das compras pagas.
- **Vagas para freelancer** ✅: a unidade (gerente e dono) abre uma vaga por período (até 90 dias, com especialidade, número de pessoas e o combinado de pagamento em texto). Os profissionais da plataforma veem as vagas abertas em Vagas, com filtro por cidade e especialidade, e se candidatam com uma mensagem. A unidade aceita, e isso vira o convite com vínculo temporário no período da vaga (o mesmo fluxo de convite), ou recusa. Cada resposta e o encerramento avisam no sininho e no celular. A taxa por vínculo fechado ✅ sai de Preços e taxas: com Stripe, aceitar o freelancer pede o pagamento com cartão e o convite sai quando confirma; se o aceite não der mais certo, a taxa volta.
- Lista de espera no marketplace ✅ (primeira parte): na janela de agendamento, dia aberto e cheio, o cliente pede "me avise se abrir vaga" com o profissional escolhido ou qualquer um. Entra no fim da mesma fila da equipe (marcada como online), recebe um e-mail com o link para sair, e o aviso de vaga chega no e-mail informado com o botão "Agendar agora" já no dia. Até 60 dias à frente, no máximo 5 dias aguardando por pessoa e 5 entradas por e-mail a cada 24 horas (a confirmação não vira disparador contra o e-mail de outra pessoa), e cliente bloqueado não entra. Também avisa quando a agenda abre horário novo ✅ (folga desfeita, fechamento removido, escala ou horário de funcionamento ampliados): compara os horários livres de antes e de depois e avisa, na ordem de entrada, quem ganhou um horário que não havia.

Sucesso: liquidez na cidade piloto (a maioria das buscas encontra horário em até 48h), retenção dos dois lados; só então replicar para outras cidades.

#### Preços e taxas (editáveis sem deploy) ✅
Todos os valores cobrados pela plataforma ficam num lugar só (`src/pricing/pricing.ts`) e o admin muda em Backoffice → Preços e taxas, sem deploy (tabela `PlatformSetting`). Padrões decididos para o piloto (ver "Decisões tomadas"):

| Item | Padrão |
|---|---|
| Taxa da plataforma sobre o que passa pelo Stripe (sinal, pagamento pelo app, caixinha, repasses) | 15% |
| Pro (por mês) | R$ 39,90 |
| Destaque da unidade (por período) | R$ 49,90 |
| Destaque do profissional (por período) | R$ 24,90 |
| Dias de Destaque por compra | 30 |
| Taxa por vaga preenchida (a unidade paga ao aceitar o freelancer; 0 desliga) | R$ 14,90 |

Mudar vale para as próximas cobranças; o que já foi pago fica como estava.

#### Decisões tomadas (2026-09-28)
Fechadas pelo que faz mais sentido para um app de agendamento de beleza no Brasil. Todas podem ser revistas; os preços mudam no backoffice sem deploy.

**Preços** (já são os padrões do código)
- **Pro: R$ 39,90/mês.** Abaixo dos concorrentes para o profissional sozinho (em geral R$ 50–100/mês). Quem passa da cota grátis de 30 atendimentos/mês fatura bem acima de R$ 1.000 no mês, então o plano pesa menos de 4%. O final ",90" é o padrão do varejo no Brasil. A cota grátis continua em 30 atendimentos e 30 produtos por mês.
- **Destaque da unidade: R$ 49,90 por 30 dias; do profissional: R$ 24,90.** A conta é "um cliente novo paga o mês": um corte custa em média R$ 40–60. O profissional paga metade porque ocupa menos espaço na vitrine e ganha menos que uma unidade.
- **Taxa por vaga preenchida: R$ 14,90**, cerca de 6–7% de uma diária de freelancer (R$ 200–250). É barata o bastante para não empurrar a contratação para fora do app.
- **Taxa sobre pagamentos pelo app: 15%**, mantida (decidida antes). Vale só para o que passa pelo Stripe; dinheiro e Pix registrados na mão não pagam.

**Cliente novo do marketplace**
- **No piloto: não cobra.** Primeiro enche a oferta e prova que funciona; cobrar cedo afasta justo quem queremos atrair.
- **Depois do piloto:** 10% do primeiro atendimento concluído, com teto de R$ 10, só quando: o cliente nunca foi àquele negócio, chegou pela busca/vitrine da plataforma (não pelo link, QR ou site do próprio negócio) e o atendimento foi concluído (sem cobrança em falta ou cancelamento). Nunca em cliente recorrente. Entra como mais um item em Preços e taxas (padrão 0 até ligar).

**Cidade e categorias do piloto**
- **São José dos Campos (SP).** É onde está a base do time (a Green e os dados de exemplo são de lá). Com ~700 mil habitantes, é grande o bastante para ter demanda e pequena o bastante para encher a oferta indo de porta em porta. Próximas: Jacareí, Taubaté e Caçapava (Vale do Paraíba), depois a capital.
- **Categorias: barbearia e unhas (manicure/pedicure).** São os serviços de maior frequência (a cada 2–4 semanas), o que gera recorrência e liquidez rápido. Uma categoria masculina e uma feminina dobram o público sem dobrar o esforço de venda.
- **Abrir a busca ao público** só quando cada categoria tiver pelo menos 30 negócios ou profissionais com agenda online ativa na cidade. Meta: a maioria das buscas acha horário em até 48 h.

**Marca**
- **Nome de trabalho: "Marcaí"** (de "marca aí"). É curto, brasileiro, fala de agendar e serve para qualquer serviço de beleza, não só barbearia. **Antes de adotar:** busca no INPI (classes 35, 42 e 44) e checar `marcai.com.br` e os @ nas redes. Se estiver tomado, na ordem: "Horaí", "Cadeira Livre". Até lá o app segue como "Barbershop"; a troca (nome, logo, ícones do PWA, textos, e-mails) é uma tarefa só, depois da checagem.

**Histórico de alterações** (2026-09-29)
- O dono vê "Equipe da plataforma" com o motivo quando a plataforma mexe na unidade, sem o nome do funcionário (informado se ele pedir pelo suporte).
- Guarda: 1 ano para o histórico do negócio e 2 anos para o registro da equipe da plataforma.
- Gravado por gatilho no Postgres, para pegar os dois backs, jobs e scripts. Ver o horizonte "Registros e estabilidade".

**Arquitetura: backoffice fora do app** (2026-09-29)
- **Tudo do backoffice fica em dois apps próprios**, fora do app das barbearias:
  - `barbershop-backoffice-front`: as telas do admin do sistema.
  - `barbershop-backoffice-back`: uma API fina na frente deste back. Não tem banco nem regra de negócio própria. Só repassa as operações que o app do backoffice usa, numa lista gerada do build dele, e manda um segredo.
- **Por quê:** o app das barbearias não carrega nem expõe nada do backoffice. Com `BACKOFFICE_GATEWAY_SECRET` configurado, este back recusa operação só de admin/gerente do sistema que não venha dessa API, mesmo com o login de admin. Os dois apps podem ter deploy, domínio e acesso separados. Também abre caminho para funcionários da plataforma terem acesso ao backoffice.
- **O que continua aqui:** a regra de negócio, o banco e os cargos (SystemAdmin/SystemManager) seguem neste back. Um endereço `/backoffice/...` no app das barbearias redireciona para o app do backoffice.
- **Revisto em 2026-09-29:** o projeto principal fica sem nada do backoffice. Contas da equipe, login, operações e registro de ações vão para o `barbershop-backoffice-back`, no mesmo Postgres, com schema próprio e comandos na fila para os efeitos colaterais. Ver "Tirar o backoffice do projeto principal" no horizonte do Backoffice.

**Jurídico: o caminho conservador até o advogado confirmar**
- **Nota do cliente:** fica só dentro do negócio que avaliou. Não é compartilhada com outros negócios nem mostrada ao público. Compartilhar entre negócios só depois do parecer (LGPD: finalidade e transparência).
- **Ficha técnica** (fórmula de coloração, alergias): dado do negócio, visível só à equipe da unidade; sai junto quando a ficha do cliente é apagada. Alergia é dado de saúde (sensível na LGPD): só com consentimento do cliente.
- **Atendimento a domicílio: fora do piloto.** Entra depois dos termos específicos (responsabilidade, segurança, botão de ajuda).
- **Freelancer e autônomo:** a plataforma só aproxima. O combinado e o pagamento são entre a unidade e o profissional, e os termos dizem isso claramente (sem subordinação à plataforma).
- **Prazos de guarda:** vale a tabela proposta (o job de retenção já roda). Registros financeiros e fiscais ficam 5 anos (prazo do Código Tributário).
- **Nota fiscal:** a plataforma emite NFS-e só da **própria receita** (Pro, Destaque, taxa da vaga, taxa sobre pagamentos), de forma automática, por um emissor integrado (Focus NFe, NFE.io ou eNotas). O atendimento e a caixinha são receita do negócio/profissional, e a plataforma não emite por eles.
- **Só Brasil no piloto.** GDPR e os prazos europeus ficam para quando houver cliente na União Europeia.
- **Termos de uso e Política de privacidade:** reescrever com base nas decisões acima e passar por um advogado antes de abrir ao público.

## O que falta (mapa em 2026-09-28)
O código de H1 a H5 está pronto, com exceção do que depende das decisões abaixo. O seed de demonstração (`SEED_DEMO=true`) cobre as telas novas: vagas, Destaque pago, compras no backoffice e lista de espera online.

**1. Decisões do produto** ✅ (ver "Decisões tomadas")
- Preços do piloto já são os padrões do código; cidade e categorias do piloto definidas; cliente novo do marketplace sem cobrança no piloto.
- Falta só checar a marca no INPI e o domínio antes de trocar o nome.

**2. Jurídico** (caminho decidido; falta o advogado revisar)
- Termos de uso e Política de privacidade ✅ reescritos com as decisões tomadas (pt, en e es, com aviso "em revisão jurídica"): controlador × operador, dados de saúde só com consentimento, operadores (Stripe, e-mail/WhatsApp, Sentry e Axiom só com ids) e transferência internacional, prazos de guarda da rotina diária, direitos e como exercer, taxas só no que passa pelo Stripe, freelancer sem subordinação. **Falta:** revisão do advogado, nome e contato do encarregado (DPO) e razão social/CNPJ no rodapé.
- Confirmar os prazos da tabela de guarda e o consentimento para dado de saúde na ficha técnica.
- Contratar o emissor de NFS-e (Focus NFe, NFE.io ou eNotas) e o cadastro municipal da empresa.

**3. Configuração de produção** (ninguém precisa programar)
- Stripe: chaves live, webhook da plataforma e do Connect (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`), Identity ligado na conta.
- Web Push: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`.
- E-mail (Mailgun e domínio com SPF/DKIM) e WhatsApp Cloud API com os templates aprovados pela Meta.
- S3 (`S3_BUCKET`), domínio/DNS e HTTPS do front e da API, `FRONTEND_URL`/`PUBLIC_API_URL`.
- Segredos próprios dos links por e-mail (`APPOINTMENT_LINK_SECRET`, `UNSUBSCRIBE_SECRET`) e o primeiro admin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`).
- Geocodificação: o Nominatim público tem limite de uso; em produção, um serviço próprio ou pago em `GEOCODING_URL`.
- Operação: backup do Postgres. O backup automático do provedor é o primeiro; o app faz uma segunda cópia diária no S3 (ligar `BACKUP_ENABLED` e o bucket, ver `docs/MONITORING.md`). Erros e a trilha do que o usuário fez estão no horizonte "Rápido e barato" (Sentry e Axiom; a trilha não entra no Postgres).

**4. Código que as decisões destravam**
- Emissão automática de NFS-e da receita da plataforma (integração com o emissor escolhido).
- Consentimento para dados de saúde na ficha ✅: anamnese e teste de alergia só guardam respostas com o consentimento do cliente, que é registrado (quando e quem da equipe registrou). "Revogar consentimento" apaga as respostas e guarda a data. Ficha só para cliente da própria rede.
- Origem do agendamento ✅: todo agendamento online guarda o canal (`marketplace` = veio da busca ou vitrine; `direct` = link, QR ou site do negócio) e se o cliente é novo no negócio. Quem chega pela busca fica marcado por 7 dias naquela unidade. A equipe vê "Veio pela vitrine do app" e "Cliente novo" no detalhe do agendamento. É a base da taxa por cliente novo, depois do piloto.
- Métrica do piloto ✅ (Backoffice → Piloto): cada busca de unidades é avaliada alguns minutos depois (alguma das 5 primeiras tinha horário em até 48 h?), sem dado pessoal. A página mostra a taxa (meta: acima de 50%), por categoria, e os agendamentos pela vitrine (com clientes novos) e pelo link do negócio, por cidade e período.
- Troca de marca, depois da checagem no INPI.
- Atendimento a domicílio (item 9) e nota do cliente entre negócios: só depois do piloto e do parecer jurídico.

**5. Técnico, sem depender de ninguém** ✅
- Lint e tipos ✅: `strictNullChecks` ligado no back (98 erros corrigidos, alguns eram bugs: agenda .ics de quem saiu dava 500, `updateCoupon` com null quebrava, cupom/usuário inexistente virava TypeError) e lint com zero avisos, travado no CI (`--max-warnings 0`).
- Teste de carga ✅ ([docs/LOAD_TEST.md](docs/LOAD_TEST.md)): 3.000 unidades, 9.000 profissionais e 360 mil agendamentos. Achou e corrigiu a busca que, numa cidade com mais de 500 unidades no raio, deixava as mais próximas de fora; a busca por localização ficou ~3× mais rápida (São Paulo: 31 → 99 req/s, p95 861 → 252 ms). Agenda, página da unidade e horários livres já aguentavam 100–200 req/s por instância.
- Backoffice separado ✅: o backoffice saiu do app das barbearias e virou um app próprio (`barbershop-backoffice-front`), que fala com uma API fina (`barbershop-backoffice-back`). Essa API só repassa ao back as operações que o app usa (lista gerada do build) e manda um segredo. Com `BACKOFFICE_GATEWAY_SECRET` no back, operação só de admin/gerente do sistema chamada direto na API pública é recusada, mesmo com o login de admin.
- Equipe do backoffice com permissões por área ✅: o SystemAdmin é o mestre e vê tudo. Para cada pessoa da equipe (SystemManager), ele libera áreas: Suporte, Moderação, Usuários, Financeiro e Operação. Preços, planos, cupons, cargos e a própria equipe continuam só com ele. Toda operação da equipe declara a área (`@RequireArea`, conferido por teste). A equipe não altera contas do sistema: antes, um gerente do sistema conseguia trocar o e-mail do admin, desativá-lo ou apagá-lo. Aviso de suporte novo só vai para quem tem Suporte. Quem já era SystemManager ficou com todas as áreas.
- Registro de ações do backoffice ✅: toda escrita das operações da equipe do sistema (mutations GraphQL e rotas REST que não são GET) fica registrada: quem fez, quando, a área, os dados (sem senha nem token; textos e listas longas cortados) e se deu certo. Um interceptor global faz o registro, então operação nova entra sozinha. Só o admin lê (`backofficeAuditLog`). O registro é apagado depois de 2 anos pela rotina de guarda de dados.
- Duas etapas obrigatórias no backoffice ✅: conta do sistema (admin e equipe) entra com senha mais um código por e-mail, mesmo sem ter ligado as duas etapas. Vale em produção, ou com `BACKOFFICE_REQUIRE_2FA=true`. Conta do sistema também não entra mais pelo login social (Google/Apple/Facebook), que pulava a senha e o código.

**6. Rápido e barato** ✅ (spec abaixo)
- Teto de conexões do Prisma ✅, cache curto da busca pública no Redis ✅ (métrica do piloto em lote ✅), fila que não trava a requisição com o Redis fora ✅. Erros e request lento no Sentry ✅, trilha de ações do app no Axiom ✅. Uma instância da API até ela saturar.

**7. Backoffice — telas, operações e acessos** 🗺️ (spec abaixo)
- Cargos dos funcionários (Super admin, Administrador, Coordenador, Suporte N1/N2, Moderador, Financeiro, Crescimento, Analista), quem vê o quê, mapa de telas × operações e fases 1–3. Fase 0 (base) feita.
- Tirar tudo do backoffice do projeto principal (front e back): contas da equipe, login, operações e auditoria no `barbershop-backoffice-back`, com etapas S1–S4.

**8. Registros e estabilidade** 🗺️ (spec abaixo)
- Histórico de alterações para o negócio ("quem mudou o quê", com antes → depois), registro da equipe ligado a ele, Sentry nos fronts, id do request de ponta a ponta, conferência de fora, métricas, alertas e carga semanal. Etapas R1–R4 ✅ no código.

## Horizonte: rápido e barato — ✅ concluído

Registrado em 2026-09-29. O app fica o mais rápido possível pelo menor custo, com pouco uso do Postgres. A trilha do que a pessoa fez sai do banco.

### Conexões do Postgres

Hoje há um processo e um `PrismaClient` (`src/prisma/prisma.service.ts`), sem `connection_limit` na `DATABASE_URL`. O Prisma abre `CPUs × 2 + 1` conexões: numa máquina de 4 vCPU, cerca de 9. No teste de carga cada busca leva 5–15 ms no banco; o resto do tempo é a API montando o objeto. Vinte usuários ao mesmo tempo numa instância cabem nesse pool.

Mais conexões não encurtam a query. Cada uma ocupa memória no Postgres (por volta de 5–10 MB) e, em excesso, o banco gasta o tempo trocando de conexão. O `max_connections` padrão é 100. Isso aperta quando existem vários processos — segunda instância da API, worker à parte, seed, Prisma Studio — porque cada um abre o próprio pool. A soma estoura o banco antes de estourar a CPU.

- ✅ Fixar `connection_limit=10` na `DATABASE_URL` da instância única do piloto, com `pool_timeout=10`. Máquina com mais núcleo não abre mais conexão por causa disso. Os workers da fila (lembretes, retenção, e-mail) rodam no mesmo processo e dividem esse pool com as requisições. Feito em `src/prisma/pool-url.ts`: se a URL não traz `connection_limit`/`pool_timeout`, a API usa 10 e 10 s; o que vier na URL vale.
- Uma instância da API no piloto. A segunda só entra quando a primeira saturar: p95 da busca da cidade acima de ~400 ms de forma sustentada, ou a CPU da API no teto.
- PgBouncer em modo transaction, no mesmo servidor, **junto com a segunda instância**. Segura o Postgres num punhado de conexões reais. Antes disso é processo a mais, sem ganho, e não se paga um banco maior para "ter mais conexões".

### O que deixa rápido e alivia o banco

Nesta ordem:

1. ✅ **Cache de 30–60 s no Redis que já existe**, da busca pública (sem filtro e a da cidade, com categoria, raio, ordem e página na chave). É a mesma lista para todo visitante e é a tela mais cara (sem filtro: 28 req/s, p95 863 ms). Agenda da equipe e horário livre do dia ficam de fora: mudam o tempo todo e são por unidade. A vitrine pode atrasar até 60 s; não há invalidação na escrita.
   - **Busca "perto de mim":** `lat`/`lng` chegam com a posição exata de cada pessoa, então cada visitante seria uma chave nova e o cache não acertaria. Na chave, a posição entra arredondada (2 casas decimais, ~1 km). A distância mostrada é calculada depois, com a posição exata, em cima da lista em cache.
   - **Métrica do piloto:** hoje cada busca de unidades grava um `SearchEvent` (`public-booking.resolver.ts`), que alimenta a taxa de "horário em até 48 h". A busca servida do cache **continua registrando** o evento; senão a métrica perde justamente as buscas mais comuns. O registro é um insert por busca: entra num lote gravado a cada 5 s (ou a cada 50 buscas), em vez de ir ao Postgres dentro da requisição.
   - Feito em `src/barbershop/search-cache.service.ts` (busca de unidades e de profissionais, 45 s). Local: 52 ms na primeira busca, 5–7 ms nas seguintes, com a distância de cada pessoa. Mudar o Destaque (admin ou compra confirmada) sobe a geração do cache (`search:gen`): a vitrine reflete na hora quem entrou ou saiu do topo.
2. **A trilha de ações não grava no Postgres** (abaixo). Cada mutation viraria um insert na mesma hora do agendamento.
3. **Uma instância até saturar.** Réplica de leitura é outro Postgres e só entra depois do cache. PostGIS continua adiado, como em [docs/LOAD_TEST.md](docs/LOAD_TEST.md).
4. O front é SPA estática: CDN, sem custo de banco.

### ✅ Trilha do que o usuário fez → Axiom

Hoje só a equipe da plataforma deixa rastro, em `BackofficeAuditLog` (Postgres, lido pelo admin, apagado em 2 anos). Dono, gerente, recepção, profissional e cliente não têm trilha.

A trilha do app vai para o **Axiom**: evento JSON, append-only, busca por pessoa, unidade e operação, retenção configurada lá. Sem tabela nova. Se o Axiom não servir, Better Stack Logs recebe o mesmo evento.

Interceptor no estilo de `BackofficeAuditInterceptor`, nas mutations de quem usa o app. Queries não geram evento. O interceptor enfileira no BullMQ e um worker envia em lote. O request não espera o Axiom.

**Com o Redis fora, o request também não pode esperar a fila.** Hoje a conexão do BullMQ usa o padrão do ioredis, que segura o comando e tenta de novo enquanto o Redis está fora, e o e-mail é enfileirado com `await` dentro da requisição: o pedido fica parado até o Redis voltar. Para a trilha, o interceptor não espera o `add` (dispara e segue, com o erro só no log) e a fila da trilha usa uma conexão própria com `enableOfflineQueue: false` e um tempo máximo curto. O evento se perde, a ação da pessoa segue. O mesmo ajuste vale para o enfileiramento de e-mail e WhatsApp: ✅ feito, a requisição espera a fila no máximo 2 s (`withEnqueueTimeout`) e o envio sai quando o Redis voltar.

Campos: horário, id de quem fez, cargo, id da unidade quando houver, operação, tipo e id da entidade, sucesso ou falha, id do request. Fora do evento: senha, token, texto de chat, telefone, e-mail completo, endereço de domicílio e ficha de saúde. Texto e lista longos são cortados, como no backoffice.

Retenção no Axiom: **12 meses**, na faixa da cópia de e-mail e do histórico de login (configurada no dataset, no Axiom).

Feito em `src/activity/`: o `AppActivityInterceptor` (global) monta o evento só com ids (dos argumentos só saem `barbershopId` e o primeiro `<entidade>Id`; se não houver, o id do que a mutation devolveu) e o tipo do erro, nunca a mensagem. Os eventos juntam na memória e a cada 5 s (ou 200) viram um job; o worker faz o POST no ingest do Axiom, com as tentativas do BullMQ. Mutations só do backoffice ficam de fora (já vão pro `BackofficeAuditLog`). Conferido local: eventos chegam em lote, sem nome, e-mail ou telefone; com o Redis fora a requisição respondeu em 20 ms e o lote foi pro log.

`BackofficeAuditLog` **fica no Postgres**. O volume é pequeno (poucas pessoas na equipe, poucas escritas por dia), então o argumento de custo não vale para ela. E a tela Registro de ações do backoffice lê dali: mover para o Axiom obrigaria a tela a consultar a API do Axiom ou a sumir. Guarda de 2 anos, como já está. O Axiom é só para a trilha do app.

`LoginHistory` continua no Postgres: a tela de segurança lê dali, o volume é baixo e a guarda de 12 meses já apaga.

### ✅ Erros e alerta → Sentry

O log no stdout do Nest continua. O **Sentry** recebe exceção e request lento, com alerta. O plano gratuito cobre o piloto. Sentry é "quebrou"; Axiom é "quem fez".

Por padrão o SDK do Sentry manda cabeçalhos e corpo das requisições, com cookie de sessão e e-mail. Feito (`src/common/sentry/`), com o Sentry 11:
- `dataCollection` sem usuário automático, cookie, corpo, query string, variáveis nem texto do GraphQL, dados de jobs e texto de SQL; `beforeSend`/`beforeSendTransaction`/`beforeSendSpan` tiram de novo cookie, `Authorization`, `x-backoffice-gateway`, corpo, usuário além do id e o texto de comando dos spans (a chave do Redis leva o e-mail, ex.: `auth:login-blocked:<e-mail>`).
- Fora as integrações `LocalVariables` (copia variáveis da pilha no erro), `Console` e `Express` (aviso de MaxListeners em todo request).
- `SentryInterceptor`: exceção inesperada e 5xx viram erro; entrada inválida, sem login e sem permissão não. Request acima de `SENTRY_SLOW_REQUEST_MS` (2 s) vira aviso. Vão a operação e o id de quem chamou.
- Conferido contra um Sentry de mentira, com 100% de rastro: login certo e errado e consultas logadas, nenhum e-mail, senha ou cookie nos envios.

### LGPD

Axiom e Sentry guardam dados fora do Brasil. Os dois entram na Política de privacidade como operadores, com transferência internacional (finalidade: segurança e funcionamento do serviço). O evento leva id, não nome nem e-mail; o que não pode sair do país não entra no evento.

`SENTRY_DSN` vazio desliga o Sentry. `AXIOM_TOKEN` e `AXIOM_DATASET` vazios desligam a trilha. Nos dois casos a ação da pessoa segue, no mesmo espírito do WhatsApp sem token.

### Fora deste horizonte

- Subir `max_connections` para aguentar mais gente.
- Gravar a trilha no Postgres.
- PostHog: a métrica do piloto (busca com horário em 48 h, agendamento pela vitrine) já está no backoffice.
- PgBouncer ou segunda instância antes de a primeira saturar.

## Horizonte: Backoffice — telas, operações e acessos — 🗺️ Planejado

Registrado em 2026-09-29. Mapa do app do backoffice (`barbershop-backoffice-front` + `barbershop-backoffice-back`): quem entra, o que cada pessoa vê e faz, o que já existe e o que falta.

### Princípios

- **Cargos com nome para os funcionários.** O Super admin e cada funcionário são contas da equipe (`StaffUser`, fora dos usuários do app) com um cargo de backoffice (Administrador, Coordenador, Suporte N1/N2, Moderador, Financeiro, Crescimento, Analista), que define as permissões dele. Ver "Cargos dos funcionários da plataforma".
- **O back decide, a tela acompanha.** Toda operação de sistema declara a área (`@RequireArea`), e um teste confere. A tela só esconde o que a pessoa não pode usar, para não mostrar um botão que dá erro. Com `BACKOFFICE_GATEWAY_SECRET`, só a API do backoffice chama essas operações.
- **Só o admin mexe no que muda o negócio ou a própria equipe:** preços e taxas, planos, cupons, cargos, a equipe e as áreas, o registro de ações e contas do sistema (editar, desativar ou apagar admin e equipe).
- **Toda escrita fica registrada** (`BackofficeAuditLog`, 2 anos). Entrada com senha e código por e-mail, sem login social.
- **A equipe vê o mínimo de dado pessoal** para fazer o trabalho: o dado sensível do cliente fica com o negócio, e a ficha de saúde nunca aparece no backoffice.

### Áreas (hoje)

As cinco áreas abaixo são o que existe hoje (`User.backofficeAreas`). Os cargos da seção seguinte as substituem por permissões mais finas.

| Área | Para quê |
|---|---|
| **Suporte** (`support`) | Pedidos de "Fale com a gente" e contas de cliente (suspender/reativar) |
| **Moderação** (`moderation`) | Denúncias de conteúdo (fotos, perfis, comentários, conversas) e avaliações denunciadas |
| **Usuários** (`users`) | Contas da plataforma (donos, gerentes, profissionais): ver, editar, ativar/desativar, apagar, importar CSV |
| **Financeiro** (`finance`) | Plano de cada conta, cobranças recorrentes (atraso, forçar, cancelar) e receita do Destaque |
| **Operação** (`operations`) | Painel e métricas, piloto, Destaque (ligar/desligar), avisos no sininho e e-mails para usuários |

### Cargos dos funcionários da plataforma

Quem trabalha na empresa (não nas barbearias) recebe **um cargo de backoffice**. O cargo é fixo no código, com um nome e um conjunto de permissões. O admin só escolhe o cargo da pessoa e não monta permissões na mão. Hoje o Super admin é o `SystemAdmin` e o funcionário é `SystemManager`. Depois da separação, todos passam a ser `StaffUser` com `backofficeRole`, fora dos usuários do app.

| Cargo | Quem é | Pode | Não pode |
|---|---|---|---|
| **Super admin** | O dono da plataforma (1 ou 2 pessoas) | Tudo, inclusive preços e taxas, planos e criar ou tirar administradores | — |
| **Administrador** | Braço direito do dono | Tudo da operação: equipe (menos admins), cupons, registro de ações, saúde do sistema, apagar conta | Mudar preços, taxas e planos; mexer em Super admin ou em outro Administrador |
| **Coordenador de operações** | Lidera suporte e moderação | Tudo de Suporte, Moderação, Usuários (inclui importar e apagar, com confirmação) e Operação; vê o Financeiro e o registro de ações | Alterar plano, cobrança e reembolso; equipe; cupons |
| **Suporte N1** | Atendente | Responder e fechar pedidos; ver a ficha (só leitura) de quem pediu | Suspender, editar ou desativar conta (passa para o N2) |
| **Suporte N2** | Atendente sênior | O do N1, mais suspender/reativar cliente, editar cadastro, ativar/desativar conta e derrubar sessões | Apagar conta; importar; plano e cobrança |
| **Moderador** | Cuida de denúncias | Fila de moderação (ocultar/manter conteúdo, avaliações denunciadas), suspender cliente por abuso, ver a ficha | Responder suporte; editar cadastro; nada financeiro |
| **Financeiro** | Contas a receber | Trocar plano, cobranças recorrentes (forçar, cancelar), pagamentos pelo app e reembolso até um limite, compras do Destaque, cupons | Editar ou apagar conta; suporte; moderação; avisos e e-mails |
| **Crescimento** | Marketing e comercial | Painel, piloto, análise, ligar/desligar Destaque, avisos e e-mails em massa; ver cupons | Ver contato de uma pessoa específica (só dados agregados); editar conta; financeiro |
| **Analista** | Leitura para decisões | Painel, piloto e análise, só leitura e só números agregados | Qualquer alteração; lista de pessoas |

Regras que valem para todos:
- **Quem dá cargo:** só o Super admin cria ou tira Administrador. O Administrador dá os outros cargos. Ninguém muda o próprio cargo.
- **Ação sem volta** (apagar conta, reembolso acima do limite, e-mail para mais de 1.000 pessoas): quem não é Administrador pede confirmação de um Administrador (Fase 3; até lá, só Administrador ou Super admin faz).
- **Dado pessoal no mínimo:** Crescimento e Analista não veem nome, e-mail nem telefone. O Suporte vê o contato de quem abriu o pedido. A ficha de saúde nunca aparece. Conversa só aparece quando está anexada a uma denúncia.
- **Todos** entram com senha mais código, e toda alteração fica no registro de ações.

#### Quem vê o quê

`A` = vê e altera · `V` = só vê · `–` = não vê. Colunas: Super admin (SA), Administrador (AD), Coordenador (CO), Suporte N1 (S1), Suporte N2 (S2), Moderador (MO), Financeiro (FI), Crescimento (CR), Analista (AN).

| Tela | SA | AD | CO | S1 | S2 | MO | FI | CR | AN |
|---|---|---|---|---|---|---|---|---|---|
| Painel | V | V | V | – | – | – | V | V | V |
| Piloto / Análise | V | V | V | – | – | – | – | V | V |
| Suporte (fila) | A | A | A | A | A | – | – | – | – |
| Contas de cliente (suspender) | A | A | A | V | A | A | – | – | – |
| Moderação | A | A | A | – | V | A | – | – | – |
| Usuários (lista e ficha) | A | A | A | V | A | V | V | – | – |
| Usuários: apagar / importar CSV | A | A | A¹ | – | – | – | – | – | – |
| Trocar plano / Cobranças recorrentes | A | A | V | – | – | – | A | – | – |
| Pagamentos pelo app / reembolso | A | A | V | – | – | – | A² | – | – |
| Destaque (ligar/desligar) | A | A | A | – | – | – | – | A | – |
| Destaque: Compras | V | V | V | – | – | – | V | – | – |
| Avisos no sininho / E-mails | A | A | A | – | – | – | – | A³ | – |
| Cupons | A | A | – | – | – | – | A | V | – |
| Preços e taxas / Planos | A | V | – | – | – | – | V | – | – |
| Equipe | A | A⁴ | – | – | – | – | – | – | – |
| Registro de ações | V | V | V | – | – | – | – | – | – |
| Saúde do sistema | V | V | – | – | – | – | – | – | – |

¹ Apagar pede confirmação de um Administrador (Fase 3). ² Até o limite; acima dele, confirmação de um Administrador. ³ Escolhe o público por filtro (cargo, cidade, plano), sem ver a lista de pessoas. ⁴ Menos Super admin e outros Administradores.

#### Como fica no código

- As áreas viram **permissões** mais finas (ex.: `support.reply`, `clients.suspend`, `users.edit`, `users.delete`, `finance.write`, `refund`, `featured.write`, `notify.send`, `moderation.resolve`, `metrics.read`, `team.manage`, `pricing.manage`, `audit.read`). `@RequireArea` vira `@RequirePermission`, e continua o teste que obriga toda operação de sistema a declarar a sua.
- `BACKOFFICE_ROLES` no back define cada cargo como uma lista de permissões. O front do backoffice lê as permissões da pessoa e mostra só as telas e botões dela.
- `StaffUser.backofficeRole` (tabela do backoffice-back, ver "Tirar o backoffice do projeto principal") no lugar de `User.backofficeAreas`. Migração: `SystemAdmin` vira Super admin; quem tem as cinco áreas vira Coordenador de operações; os outros ganham o cargo mais próximo, e o Super admin confere na tela Equipe.

### Telas, operações e acesso

Legenda: ✅ existe · 🔧 existe com ajuste pendente · 🆕 a fazer. "Admin" = só o `SystemAdmin`.

| Tela (rota) | Área | O que faz | Operações no back | Situação |
|---|---|---|---|---|
| Entrar / código / esqueci a senha | — | Senha + código por e-mail; explica a recusa do login social | login, `verify2FA`, recuperação de senha | ✅ |
| **Painel** (`/`) | Operação | Números da plataforma, crescimento, distribuição por plano/cargo/status, atividade do marketplace | `backofficeDashboard`, `backofficeStats`, `userGrowthData`, `planDistribution`, `roleDistribution`, `statusDistribution`, `marketplaceMetrics` | ✅ |
| **Usuários** (`/manage-users`) | Usuários | Lista com filtros, editar, ativar/desativar (um ou vários), apagar | `usersDetailed`, `getUsers`, `user`, `updateUser`, `setUserActive`, `bulkUserAction`, `removeUser`, REST `/user/admin/list`, `set-active`, `set-multiple-active` | ✅ |
| ↳ trocar plano (na linha e em lote) | Financeiro | Muda o plano da conta | `changeUserPlan`, REST `change-plan`, `change-multiple-plans`, `update-payment-status` | ✅ |
| ↳ trocar cargo | Admin | Muda o cargo (inclusive para cargo do sistema) | `updateUserRole` | ✅ |
| ↳ conta do sistema | Admin | Editar, desativar ou apagar admin/equipe | `assertCanManageAccounts` | ✅ |
| **Importar usuários** (`/import-users`) | Usuários | Importa CSV | REST `/user/admin/import-csv` | ✅ |
| **Equipe** (`/team`) | Admin | Funcionários e o cargo de cada um; convidar | `backofficeTeam`, `setBackofficeAreas` (vira `setBackofficeRole`) | 🔧 falta cargo e convite (Fase 1) |
| **Registro de ações** (`/audit`) | Admin | O que a equipe alterou, por pessoa e operação | `backofficeAuditLog` | ✅ |
| **Avisos no sininho** (`/manage-notifications`) | Operação | Mandar aviso para uma pessoa ou para várias; histórico | `createNotification`, `createBatchNotifications`, `allNotificationsWithUser`, `backofficePeople` | ✅ |
| **E-mails para usuários** (`/manage-email-notifications`) | Operação | Mandar e-mail e ver o histórico | `sendEmailNotification`, `emailHistory`, `backofficePeople` | ✅ |
| **Análise geográfica e demográfica** (`/geographic-demographic-analysis`) | Operação | Onde estão e quem são os usuários | `geographicAnalysis`, `demographicAnalysis`; a lista de pessoas (`usersDetailed`) só com Usuários | ✅ |
| **Cobranças recorrentes** (`/recurring-payments`) | Financeiro | Em atraso, forçar cobrança, processar, cancelar assinatura, estatísticas | REST `/payments/recurring/*`, `/payments/cancel/:userId` | ✅ |
| **Destaque** (`/featured-barbershops`) — abas Unidades e Profissionais | Operação | Ligar/desligar Destaque até uma data | `adminBarbershops`, `adminProfessionals`, `setBarbershopFeatured`, `setProfessionalFeatured` | ✅ |
| ↳ aba Compras | Financeiro | Receita do Destaque (30 dias e total) e compras pagas | `adminFeaturedPurchases` | ✅ |
| **Piloto** (`/pilot`) | Operação | Busca com horário em 48 h, agendamentos pela vitrine × link | `pilotMetrics` | ✅ |
| **Moderação** (`/reviews`) | Moderação | Fila de denúncias de conteúdo e avaliações denunciadas | `moderationQueue`, `resolveContentReports`, `reportedReviews`, `moderateReview` | ✅ |
| **Suporte** (`/support`) | Suporte | Fila de pedidos, responder, mudar status | `supportQueue`, `supportOpenCount`, `answerSupportTicket`, `setSupportTicketStatus` | ✅ |
| **Contas de cliente** (`/client-accounts`) | Suporte | Buscar cliente, suspender/reativar com motivo | `adminClientAccounts`, `setClientAccountSuspended` | ✅ |
| **Preços e taxas** (`/pricing`) | Admin | Taxas da plataforma e preço do Destaque, sem deploy | `platformPricing`, `updatePlatformPricing` | ✅ |
| **Cupons** (`/coupons`) | Admin | Criar, editar, apagar cupons e ver o uso | `getAllCoupons`, `createCoupon`, `updateCoupon`, `deleteCoupon`, `getCouponStats` | ✅ |
| **Planos** (`/plans`) | Admin | Criar/editar/remover plano, sincronizar com a Stripe | REST `/plans/create`, `update`, `remove`, `sync-stripe` (GraphQL `createPlan`, `updatePlan`, `removePlan`, `syncPlansWithStripe`) | ✅ |
| **Ficha da unidade** (`/barbershops/:id`) | Usuários (leitura) | Uma unidade inteira num lugar: dono e equipe, plano, Connect, Destaque, denúncias, pedidos de suporte, histórico com nome da equipe | `adminBarbershopDossier`, `adminBarbershopChangeLog` | ✅ |
| **Ficha da pessoa** (`/users/:id`) | Usuários (leitura) | Conta, cargo e unidades, sessões abertas, últimos logins, pedidos de suporte; plano e cobranças com o Financeiro. Derrubar sessões e apagar conta | `adminUserDossier`, `adminRevokeUserSessions`, `adminDeleteUser` | ✅ Fase 2 |
| **Busca do topo** | Usuários ou Suporte | E-mail, nome, unidade ou número; contas e unidades com Usuários, contas de cliente com Suporte | `backofficeSearch` | ✅ Fase 2 |
| **Pagamentos pelo app** (`/payments`) | Financeiro | Sinal, atendimento pago e caixinha via Connect: lista, estorno com motivo, disputa (webhook `charge.dispute.*`), taxa da plataforma estimada pela tabela atual | `adminAppPayments`, `adminRefundAppPayment` | ✅ Fase 2 |
| **Confirmações** (`/approvals`) | Todos (os próprios) / Admin confirma | Ação sem volta pedida por quem não é Administrador: apagar conta, estorno acima do limite, e-mail para mais de 1.000 pessoas | `backofficeApprovals`, `backofficeApprovalsPending`, `decideBackofficeApproval` | ✅ Fase 3 |
| **Pedidos do titular (LGPD)** (`/privacy-requests`) | Suporte | Acesso, correção, exclusão e portabilidade pedidos por e-mail/suporte, com prazo de 15 dias e resposta registrada | `privacyRequests`, `createPrivacyRequest`, `updatePrivacyRequest` | ✅ Fase 3 |
| **Saúde do sistema** (`/health`) | Admin | Último minuto da API: requests, p95, erros, CPU, memória, banco, Redis, filas (BullMQ) e operações mais lentas | `systemHealth`, `backupStatus`, `runBackupNow` | ✅ |

**Fora do backoffice, de propósito:** operações da conta de cada negócio (agenda, clientes, fichas, pagamentos da equipe) ficam no app das barbearias. Exceções decididas em 2026-10-12: corrigir fuso, moeda, país e slug da unidade, e transferir a propriedade (ver "Operações que faltam"). A equipe não entra "como" o negócio (sem personificar). Para ajudar, usa a ficha só leitura. A ficha de saúde e o texto das conversas só aparecem quando vêm anexados a uma denúncia.

**Operações antigas a tirar** ✅ (feito): `changeUserPlan`, `changeMultipleUsersPlan`, `setUserActive`, `setMultipleUsersActive` e `removeUser` do `user.resolver` (só admin) duplicam as do `backoffice.resolver`, que declaram área. Saem do back e da lista da API do backoffice. `GET /stripe/test` também sai.

### Operações que faltam (levantamento de 2026-10-12)

O código do backoffice-back foi comparado com o que o suporte e o financeiro vão precisar no dia a dia. A coluna "Quem" usa as permissões de `staff/roles.ts`. Prioridade: **P1** antes de abrir o piloto pago, **P2** nos primeiros meses, **P3** quando o volume pedir.

**Feito (P1, 2026-10-16):** repasses a fazer (`/payouts`), unidades em risco (`/at-risk`, com nota interna), atribuir pedido de suporte e filtrar meus/sem responsável, nota interna no pedido e na ficha, corrigir fuso/moeda/país/slug com motivo, suspender unidade ou rede (a página pública deixa de aceitar agendamento), exportar JSON do titular, reenviar senha, confirmação de e-mail do cliente e convite pendente, cancelar o plano no fim do período ou desfazer, e estornar cobrança de plano. Cancelamento, estorno e reenvio saem pela fila para o back, que fala com a Stripe. Estorno acima de R$ 500 só o Administrador dispara. A migração `20261213100000_backoffice_ops` precisa rodar no banco do app. Clubes já cobrados na Stripe não são cancelados sozinhos na suspensão.

#### Financeiro

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Repasses a fazer** (aluguel de cadeira no cartão e clubes de assinatura dos clientes) | O dinheiro desses dois entra na conta da plataforma, e o repasse ao espaço/unidade é "reconciliação manual" (`chair-rent.service.ts`, relatório de repasse em `barbershop.service.ts`). Não há tela que junte quanto se deve a cada unidade, nem como marcar "repassado em DD/MM, por PIX/transferência, comprovante". Hoje o repasse depende de planilha. | `finance.write` | **P1** |
| **Estornar cobrança do plano** (assinatura do dono) | O estorno do backoffice cobre só pagamento pelo app (sinal, atendimento, caixinha). Cobrança do plano em dobro ou contestada só sai pelo painel da Stripe, e o app não fica sabendo (ver item 89). | `payments.refund` (acima do limite, confirmação) | **P1** |
| **Cancelar no fim do período / reativar assinatura do plano** | Hoje só existe cancelar na hora (ver item 84). O suporte precisa de "cancela ao fim do mês pago" e de "desfazer o cancelamento" antes do vencimento. | `finance.write` | **P1** |
| **Dias de cortesia / estender o teste grátis** | `trialEndDate` existe, mas não há como a equipe conceder dias (compensar uma falha, fechar uma venda). Hoje só com cupom, que vale na próxima cobrança. | `finance.write` | P2 |
| **Estornar compra de Destaque e taxa da vaga de freelancer** | Os dois aparecem só como receita (`adminFeaturedPurchases`). Pedido de reembolso vai pro painel da Stripe e o Destaque continua ligado (item 89). | `payments.refund` | P2 |
| **Disputas (chargeback): lista com prazo e evidência** | `PaymentDispute` chega pelo webhook e aparece misturado em Pagamentos pelo app. Não há fila com o prazo de resposta da Stripe, nem como anexar a evidência (agendamento, mensagens, recibo) sem sair do backoffice. | `finance.write` | P2 |
| **Assinaturas dos clientes (clubes)** | Não há lista das assinaturas de clube (`ClientSubscription`): situação, inadimplência, pagamentos, cancelar ou estornar por pedido do cliente. | `finance.read` / `finance.write` | P2 |

#### Contas e unidades

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Suspender uma unidade ou rede inteira** | Hoje só dá pra tirar a unidade da busca (moderação, `searchHiddenAt`). Em fraude ou golpe, a página pública continua recebendo agendamento e pagamento. Precisa de suspensão com motivo que tire a página do ar, pare cobranças pelo app e avise o dono. | `users.edit` (com confirmação) | **P1** |
| **Corrigir dados de base da unidade** (fuso, moeda, país, slug) | A moeda e o fuso vêm do país no cadastro. Escolheu errado, não há como trocar depois (nem o dono nem a equipe), e moeda errada afeta preços, Connect e cobrança. Fica só pra essas correções, com motivo, sem personificar (o resto continua no app do negócio). | `users.edit` | **P1** |
| **Transferir a propriedade** da unidade ou rede pra outra conta | Venda do negócio, sócio que sai, dono que perdeu o e-mail. Hoje exige mexer no banco. | `users.edit` (com confirmação) | P2 |
| **Reenviar e-mails de conta** (confirmar e-mail, redefinir senha, convite de funcionário pendente) | O suporte só consegue pedir pra pessoa tentar de novo. O convite da equipe da plataforma já tem reenviar (`team.resendInvite`), o convite de funcionário de uma unidade não. | `support.reply` | **P1** |
| **Exportar os dados do titular** (LGPD: acesso e portabilidade) | O pedido é registrado (`PrivacyRequest`, prazo de 15 dias), mas não há como gerar o arquivo com os dados da pessoa (conta, fichas de cliente, agendamentos, pagamentos, mensagens). O atendimento é feito à mão, consulta por consulta. | `privacy.manage` | **P1** |
| **Juntar fichas de cliente duplicadas** | Fichas antigas do mesmo telefone em formatos diferentes ficaram separadas (ver item 46). O dono não consegue juntar e pede ao suporte. A junção move agendamentos, vendas, pontos e pacotes pra uma ficha só. | `users.edit` | P2 |
| **Liberar vaga extra do plano por exceção** | O limite de profissionais é fixo por plano. Negociação comercial ("mais 1 vaga por 2 meses") não tem como ser feita sem trocar de plano. | `finance.write` | P3 |
| **Selo de identidade: revisar manualmente** | A verificação (Stripe Identity) é automática. Quando falha por foto ruim ou documento estrangeiro, o profissional não tem a quem recorrer. | `users.edit` | P3 |

#### Moderação e conteúdo

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Vagas de freelancer na moderação** | A fila cobre fotos, avaliações, perfis, unidades e conversas, mas não as vagas (`JobOpening`). Vaga falsa ou abusiva não tem como sair do ar. | `moderation.resolve` | P2 |
| **Lista de bloqueio de telefone/e-mail na plataforma** | O bloqueio de cliente é por negócio. Quem faz agendamento falso em massa em várias unidades só é barrado unidade por unidade. | `clients.suspend` | P3 |

#### Sistema e operação

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Envios que falharam** (e-mail e WhatsApp) | A Saúde do sistema mostra o tamanho das filas, mas não quais envios falharam de vez, pra quem e por quê, nem um "reenviar". Lembrete ou confirmação que falhou some sem ninguém saber. | `health.write` | P2 |
| **Webhooks da Stripe que falharam** | Se o processamento de um evento dá erro, ele fica só no log. Uma lista dos eventos com erro e um "processar de novo" evitam pagamento aprovado sem registro. | `health.write` | P2 |
| **Liga/desliga de funções sem deploy** | Atendimento a domicílio (`HOME_SERVICE_ENABLED`) e outras chaves estão no `.env`. Ligar pra uma cidade ou desligar numa emergência pede deploy. Ficaria em `PlatformSetting`, como Preços e taxas. | `pricing.manage` (só admin) | P3 |
| **Aviso geral no app** (manutenção, instabilidade) | O sininho é por pessoa. Uma faixa no topo pra todo mundo ("manutenção às 23h") não existe. | `notify.send` | P3 |

**Decidido** (dono da plataforma, 2026-10-12): corrigir dados de base da unidade (fuso, moeda, país, slug) e transferir a propriedade são as duas exceções à regra "fora do backoffice, de propósito". As duas exigem motivo, avisam o dono por e-mail e no sininho e entram no Histórico da unidade como "Equipe da plataforma" (o nome do funcionário fica só no Registro de ações). Fora delas, a equipe continua sem mexer em dado do negócio.

#### Mais operações que faltam (segundo levantamento, 2026-10-12)

Conferido no código: o pedido de suporte (`SupportTicket`) não tem responsável, prioridade nem nota interna. Não há campo de anotação da equipe em conta ou unidade. Os modelos de e-mail e as categorias de serviço estão no código.

**Suporte**

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Atribuir o pedido a alguém da equipe** | Sem responsável, duas pessoas respondem o mesmo pedido ou ninguém responde. Filtro "meus pedidos" e "sem responsável". | `support.reply` | **P1** |
| **Nota interna** (no pedido e na ficha da pessoa ou da unidade) | A equipe não tem onde deixar "já reclamou 3 vezes, ofereci 1 mês grátis". A nota não aparece pro cliente e fica no Registro de ações. | `support.read` vê, `support.reply` escreve | **P1** |
| **Prioridade e tempo de espera** | A fila não mostra há quanto tempo o pedido espera nem separa o urgente (pagamento, segurança). Inclui tempo de primeira resposta e de resolução por atendente. | `support.read` | P2 |
| **Respostas prontas** | Textos salvos pras perguntas mais comuns, em pt, en e es, editáveis pelo Coordenador. | `support.reply` usa, Coordenador edita | P2 |

**Sucesso do cliente**

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Unidades em risco** | Lista de quem parou de agendar, está com o plano em atraso, não entra há 14 dias ou caiu muito de movimento, pra ligar antes do cancelamento. Cada unidade com o motivo e um botão pra registrar o contato (nota interna). | `users.read` | **P1** |
| **Funil de entrada** | Cadastro → criou a unidade → cadastrou serviço → primeiro agendamento → primeira cobrança. Quantos travam em cada passo e quem são, pro suporte ajudar. | `metrics.read` (números), `users.read` (nomes) | P2 |
| **Contas de recebimento travadas** | Quem começou a conta de recebimento (Stripe Connect) e parou no meio, ou teve a conta bloqueada (`chargesEnabled`/`payoutsEnabled` falso). Sem ela, a unidade não recebe pelo app. | `finance.read` | P2 |

**Conteúdo e configuração**

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Editar os textos dos e-mails** | Os modelos (confirmação, lembrete, cancelamento) estão no código, e trocar uma frase pede deploy. Edição com prévia nos três idiomas, mantendo as variáveis (`{{CustomerName}}`). | só admin | P3 |
| **Termos de uso e privacidade com versão** | Não há registro de qual versão cada pessoa aceitou, nem novo aceite quando o texto muda (a LGPD pede pra provar o consentimento). | só admin | P2 |
| **Categorias de serviço** | A lista (`TreatmentCategory`) é fixa no código. Categoria nova pede migração e deploy. | só admin | P3 |

**Segurança e fraude**

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Sinais de fraude** | Lista automática de comportamento estranho: muitos cartões recusados numa unidade, muitos agendamentos do mesmo telefone em várias unidades, cupom usado por várias contas do mesmo aparelho ou IP. Cada sinal leva à ficha. | `clients.suspend`, `users.edit` | P2 |
| **Revisão periódica de acessos** | Lista de quem tem cada cargo na equipe da plataforma e há quanto tempo não entra, com aviso mensal ao Super admin pra tirar o acesso de quem saiu. | só admin | P2 |

**Operação**

| Operação | Por que falta | Quem | Prioridade |
|---|---|---|---|
| **Resumo semanal por e-mail** | Toda segunda, pro dono da plataforma: receita, unidades novas, cancelamentos, pedidos de suporte e alertas da semana, sem abrir o backoffice. Usa os números da Tela de resultados. | só admin recebe | P2 |
| **Agendar envio de avisos e e-mails** | Hoje o envio é na hora. "Segunda às 9h" fica como pedido agendado, que dá pra cancelar até a hora. | `notify.send` | P3 |

### Tela de resultados: lucro e números da plataforma — ✅ (pedido do dono da plataforma em 2026-10-12)

**O que existe hoje:** o Painel mostra uma "receita" que é a soma de todas as cobranças de plano pagas desde o começo (`Payment` concluído, `backofficeStats.revenue`). Não tem período, não desconta estorno nem a tarifa da Stripe, e não inclui as outras fontes de receita. O resto do Painel é contagem de contas, crescimento e retenção do marketplace. A receita do Destaque fica numa aba à parte, e a taxa estimada dos pagamentos pelo app, em outra tela.

**A tela:** `/results` no app do backoffice, com seletor de período (este mês, mês passado, 3, 6 e 12 meses, personalizado), comparação com o período anterior e exportação em CSV (com a proteção do item 90). Os valores vêm em reais (a moeda da plataforma). Pagamento em outra moeda entra convertido pela cotação que a Stripe usou no repasse (`balance_transaction`).

#### 1. Resultado (o quanto a plataforma ganha)

| Linha | De onde vem |
|---|---|
| Planos (assinaturas dos donos) | `Payment` pago no período |
| Destaque (unidade e profissional) | `FeaturedPurchase` paga |
| Taxa de vaga de freelancer | `JobApplication` com taxa paga |
| Taxa da plataforma nos pagamentos pelo app | `application_fee` de sinal, atendimento pago e caixinha (o valor real da Stripe, não a estimativa pela tabela atual) |
| Taxa da plataforma no aluguel de cadeira e nos clubes de assinatura | Parte da plataforma no que entra pela conta dela |
| Taxa do cliente novo do marketplace | Quando estiver ligada (item 51) |
| **= Receita bruta** | |
| − Estornos e disputas perdidas | Estornos do período, inclusive os feitos no painel da Stripe (item 89) |
| − Tarifa da Stripe | `balance_transaction.fee` de cada cobrança |
| − Cupons e cortesias | Desconto dado por cupom e dias de cortesia |
| **= Receita líquida** | |
| − Custos fixos (lançados à mão) | Servidor, e-mail (Mailgun), WhatsApp, domínio, ferramentas. Cadastro simples de custo por mês, só Super admin |
| **= Resultado do período** | Lucro ou prejuízo, com gráfico mês a mês |

**Dinheiro que só passa pela plataforma** fica num quadro separado e não conta como receita: aluguel de cadeira no cartão e clubes de assinatura. O quadro mostra quanto entrou, quanto já foi repassado e quanto falta repassar (liga com "Repasses a fazer").

#### 2. Assinaturas (saúde do negócio recorrente)

- **MRR** (receita mensal recorrente) e **ARR**, com a evolução mês a mês.
- MRR novo, de upgrade, de downgrade e perdido (cancelamento), no formato "ponte" de um mês pro outro.
- **Churn** de contas e de receita, e os motivos de cancelamento (campo novo no cancelamento).
- Assinaturas por plano, em teste grátis, em atraso (`PAST_DUE`) e o valor em atraso.
- **Ticket médio** por conta (ARPA), **LTV** estimado e **tempo médio até pagar** (do cadastro à primeira cobrança).
- Conversão do teste grátis em plano pago.

#### 3. Volume que passa pelo app (GMV)

- Total de agendamentos, vendas registradas e valor movimentado pelas unidades no período, com a parte paga pelo app (Connect) e a parte paga no balcão.
- Agendamentos por origem (vitrine, link próprio, equipe), cancelamentos e faltas.
- Unidades e profissionais ativos (com agendamento no período), novos e inativos há 30 dias.
- Contas de recebimento (Connect) abertas e quanto já movimentaram.

#### 4. Recortes

- Por cidade/estado, por tipo de estabelecimento, por plano e por canal de aquisição (cupom, indicação, convite de amigo).
- **Top unidades** por receita gerada pra plataforma e por GMV, com link pra ficha.
- **Coortes:** dos que entraram em cada mês, quantos continuam pagando depois de 1, 3, 6 e 12 meses.

#### Quem vê

| | SA | AD | CO | FI | CR | AN |
|---|---|---|---|---|---|---|
| Resultado (lucro), custos fixos | A | V | – | V | – | – |
| Assinaturas, GMV, recortes | V | V | V | V | V | V |

O Analista e o Crescimento veem só os números agregados, sem nome de unidade no "Top". Custo fixo só o Super admin lança. Nova permissão `results.read` (agregados) e `results.profit` (lucro e custos).

#### Como fazer

- **Fonte dos valores reais:** gravar, em cada cobrança paga, a tarifa e a taxa que a Stripe aplicou (`balance_transaction`: `fee`, `net`, `exchange_rate`), por webhook. A tela soma o que está no banco, sem chamar a Stripe.
- **Resumo diário:** uma rotina noturna grava os totais do dia (`PlatformDailyMetrics`). Assim a tela de 12 meses abre rápido e o histórico não muda quando um registro antigo é apagado. O dia de hoje é calculado na hora.
- **Antes, corrigir o que distorce os números:** estorno pela Stripe não sincronizado (89), moeda sem centavos (86), troca de plano sem cobrar (83/87), venda contada no dia em que foi lançada (73).

**Feito (primeira versão, 2026-10-16):** `/results` no backoffice. Período (este mês, mês passado, 3, 6, 12 meses, personalizado), comparação com o período anterior e CSV com a proteção do item 90. Receita em reais: planos (valor original, cupom à parte), Destaque, taxa de vaga, taxa do sinal gravada na cobrança e taxa do clube gravada na cobrança. Líquido = bruta − estornos dessas linhas − cupons. Quadro separado de aluguel no cartão e clubes que caíram na conta da plataforma (entrou, repassado, saldo a repassar). Assinaturas: MRR, ARR, ativas, em atraso e as que cancelam no fim do período. Volume por moeda (atendimento concluído e venda paga), origem do agendamento, unidades e profissionais, contas Connect abertas. `results.read` para os agregados (inclusive Analista e Crescimento) e `results.profit` para o lucro (Super admin, Administrador e Financeiro). **Ainda falta**, porque o banco não guarda: tarifa e cotação da Stripe (`balance_transaction`), taxa de atendimento pago, caixinha e aluguel de cadeira, custo fixo lançado à mão, resumo diário, ponte de MRR, motivo de cancelamento, coortes e top unidades.

### Tirar o backoffice do projeto principal

**Decisão (2026-09-29):** o projeto principal (`barbershop-front` e `barbershop-back`) fica **sem nada do backoffice**: sem tela, operação, cargo, conta da equipe, auditoria ou variável de ambiente. O backoffice vira dois apps completos:
- `barbershop-backoffice-front`: as telas.
- `barbershop-backoffice-back`: deixa de ser um repasse e vira a API do backoffice, com login próprio.

Revê o "O que continua aqui" da decisão "Arquitetura: backoffice fora do app".

**Por quê:**
- O app das barbearias e dos clientes não carrega, não expõe e não testa nada de admin.
- Uma falha no backoffice não abre porta no app público, e vice-versa.
- Os funcionários da plataforma deixam de ser `User` do app.

#### Como fica

| Assunto | Hoje | Depois |
|---|---|---|
| **Contas da equipe** | `User` com cargo `SystemAdmin`/`SystemManager` e `backofficeAreas`, login e 2FA no back principal | Tabela `StaffUser` própria (senha, 2FA obrigatório, `backofficeRole`, sessões). Login, cookie e JWT próprios no backoffice-back, em outro domínio. `SystemAdmin` e `SystemManager` saem do enum `Role` |
| **Banco** | Só o back principal acessa | Mesmo Postgres, dois donos. Schema `public`: negócio, migrações do back principal. Schema `backoffice`: `StaffUser`, sessões e registro de ações, migrações do backoffice-back. O backoffice-back usa um usuário do banco próprio: lê o `public` e escreve só nas colunas que administra |
| **Operações do admin** | Resolvers e rotas no back principal, repassadas pela API fina | Implementadas no backoffice-back, que lê e escreve direto no banco |
| **Efeitos colaterais** (derrubar sessões, e-mail, push, renovar o cache da busca) | Chamada direta no mesmo processo | O backoffice-back põe um **comando** numa fila do BullMQ (mesmo Redis): `session.revoke`, `email.send`, `notify.user`, `search-cache.bump`. O back principal consome esses comandos genéricos sem saber quem os mandou |
| **Stripe** (planos, cupons, reembolso) | Chave do back principal | O backoffice-back usa uma **chave restrita** própria, só com o que precisa. O webhook da Stripe continua no back principal |
| **Suporte** | Fila e resposta no back principal; aviso no sininho do app para a equipe | "Fale com a gente" continua no principal (cria o pedido e manda o e-mail a quem pediu). Fila, resposta e aviso à equipe ficam no backoffice. A resposta sai pelo comando `email.send` |
| **Moderação** | Fila e resolução no back principal | A denúncia é criada no principal. A resolução acontece no backoffice (ocultar conteúdo mais `search-cache.bump`) |
| **Métricas** (painel, piloto, análise) | Consultas no back principal | SQL no backoffice-back. Mais tarde, numa réplica de leitura |

#### O que sai do back principal

- Resolvers: `backoffice`, `backoffice-team`, `backoffice-audit` e `pilot`, mais as partes de admin de `coupons`, `plan`, `pricing` (a mutation), `featured` (`adminFeaturedPurchases`), `support` (fila, resposta, contas de cliente), `moderation`, `review-request` (`reportedReviews`, `moderateReview`), `notifications` (envio e histórico do admin), `barbershop` (`adminBarbershops`, `adminProfessionals`, ligar Destaque) e `user` (lista e ações de admin).
- Rotas REST de admin: `/user/admin/*`, `/payments/recurring/*` (as manuais), `/payments/cancel/:userId`, as rotas de admin de `/coupons`, `/plans/create|update|remove|sync-stripe` e `/stripe/test`.
- Código:
  - `src/backoffice/` (inclui `BackofficeAuditInterceptor`);
  - `auth/backoffice-areas.ts`, `auth/backoffice-login.ts`;
  - o que é de sistema em `rbac-policy.ts` e no `RolesGuard`;
  - `x-backoffice-client-ip` e o segredo em `common/client-ip.ts`;
  - a origem do backoffice no CORS;
  - o seed de admin.
- Banco: `User.backofficeAreas` e as contas `SystemAdmin`/`SystemManager`, copiadas para `StaffUser` e depois apagadas. `BackofficeAuditLog` passa para o schema `backoffice`.
- Variáveis: `BACKOFFICE_GATEWAY_SECRET`, `BACKOFFICE_REQUIRE_2FA` e a URL do backoffice.

**Fica no principal, porque é do negócio:**
- Leituras públicas: `platformPricing`, lista de planos, validar cupom.
- Criar pedido de suporte e denúncia.
- Compra do Destaque.
- Cobrança recorrente automática e o webhook da Stripe.
- Os consumidores dos comandos.

#### O que sai do front principal

- A rota `/backoffice` e o `BackofficeRedirect` (ficam uma versão para quem tem link salvo e depois saem).
- "Gerenciar" no menu do perfil e `BACKOFFICE_URL`.
- O desvio para o backoffice em `MainPage`.
- Os cargos de sistema em `utils/permissions.ts`.
- `services/graphql/backoffice.ts`, a parte de admin de `recurring-payments.ts` e de `support.ts` (`useSupportQueue`, `useAnswerSupportTicket`), `COUPONS_SERVICE.md` e as chaves de tradução do backoffice.
- E2E: os passos de admin nos fluxos que cruzam os dois lados (suporte, moderação, avaliação denunciada, Destaque, suspensão) passam a chamar a API do backoffice-back, que sobe no CI do front. O login de admin em `auth.setup.ts` e `helpers.ts` sai.

#### Etapas

- **S1 — front principal limpo.** ✅ (2026-10-06) Não depende do back. Fica só o redirecionamento de `/backoffice`.
  - **Saiu:** "Gerenciar" do menu do perfil, `utils/permissions.ts`, `services/graphql/backoffice.ts`, `recurring-payments.ts` (e os hooks de admin em `useGraphQL.ts`), a fila, a resposta e a suspensão em `support.ts`, `COUPONS_SERVICE.md`, `RECURRING_PAYMENTS_SERVICE.md` e as chaves de tradução das telas do backoffice. O front passou de 426 para 391 operações GraphQL.
  - **Ficou para depois, de propósito:** o desvio de `MainPage` para conta do sistema, que sai na S4 com os cargos de sistema (antes disso, quem entra no app com conta do sistema ficaria numa tela vazia). E os passos de admin nos E2E que cruzam os dois lados, que passam para a API do backoffice-back na S3, quando as operações mudarem de lugar.
- **S2 — contas da equipe no backoffice-back.** ✅ (no main em 2026-10-06: barbershop-backoffice-back#12 e barbershop-backoffice-front#13, junto com as escritas e leituras da S3. O E2E do app no CI ainda espera o secret `BACKOFFICE_BACK_TOKEN` no repo do app; localmente, os 65 passam)
  - **Para subir em produção:** rodar as migrações do backoffice-back (`pnpm prisma:migrate`), migrar as contas antigas (`pnpm staff:migrate-legacy --apply`), configurar as variáveis do `.env.example` dele (o mesmo `BACKOFFICE_GATEWAY_SECRET` daqui, `REDIS_URL`, o bucket só de leitura) e apontar o app do backoffice para a API do backoffice (`VITE_BASE_API_URL`). Depois, convidar o segundo Super admin pela tela Equipe.
  - **Ponte até a S3** ✅ (back): as operações de admin ainda estão no back, e a equipe deixa de ser `User`. O backoffice-back manda, junto com o segredo do gateway, `x-backoffice-staff`: quem é (id, e-mail, nome, cargo, a conta antiga se houver) assinado com HMAC-SHA256 do `BACKOFFICE_GATEWAY_SECRET`, válido por segundos. O back só aceita com o segredo certo (sem segredo configurado, nunca), e só em operação de sistema: o cargo vira o papel e as áreas antigos (`LEGACY_ACCESS` em `src/auth/staff-assertion.ts`), e a permissão fina de cada cargo é conferida no backoffice-back. Operação da própria conta (avisos, preferências) só para conta migrada, como o `User` antigo; conta nova da equipe não toca no `User` de mesmo número. Contas novas da equipe começam no id 1.000.000.000 (não se confundem com ids de `User` nas colunas sem chave estrangeira, como o autor da resposta do suporte).
  - **Comandos** ✅ (back): fila `backoffice-commands`, comando `email.send` só com os templates `verification_code`, `staff_invite` e `password_reset` (contrato em `src/backoffice-commands/commands.ts`).
  - **Contas** (backoffice-back): schema `backoffice` com migrações próprias; `StaffUser` com os cargos da seção "Cargos dos funcionários", sessões, código do login e tokens de convite/senha (só o hash vai pro banco). As permissões de cada cargo e de cada operação ficam em `src/staff/roles.ts` de lá: o repasse confere o cargo por campo do GraphQL e por rota REST antes de mandar pro back (o teste garante que toda operação do app tem permissão).
  - **Login com senha e código, e sessões**: código de 6 dígitos por e-mail (10 min, 5 tentativas), bloqueio de 15 min após 5 senhas erradas, limite por IP, cookie httpOnly/SameSite=Strict (12 h, cai após 2 h parada); senha nova, cargo novo ou conta desativada derrubam as sessões.
  - **Tela Equipe**: convidar (nome, e-mail, cargo; link de 72 h para criar a senha), mudar cargo, reenviar convite, ativar/desativar. Só o Super admin dá ou tira Super admin e Administrador; ninguém mexe na própria conta. Tudo no Registro de ações.
  - **Migração** (`staff:migrate-legacy`, simula sem `--apply`): mesmo id e mesma senha; SystemAdmin → Super admin; SystemManager pelas áreas (só suporte/usuários → Suporte N2, moderação → Moderador, financeiro → Financeiro, operações → Crescimento, nenhuma → Analista, misturadas → Coordenador). Contas de demonstração por cargo: `staff:seed-demo` (nunca em produção).
  - **O backoffice-front entra por aqui**: login, código, senha esquecida e convite pela API do backoffice; menu, rotas e botões pelas permissões de `/auth/me`. E2E com um teste por cargo e o convite de ponta a ponta.
  - **Até a S3**: conta nova da equipe (sem conta antiga) ainda não tem avisos nem preferências salvas; os cupons continuam só do papel SystemAdmin no back, então Financeiro e Crescimento abrem a tela mas não carregam a lista.
  - **Deploy**: as duas partes juntas (a API do backoffice nova recusa o login antigo). Antes, rodar `prisma migrate deploy` e `staff:migrate-legacy --apply` no backoffice-back; `DATABASE_URL` com `?schema=backoffice` e `REDIS_URL` (o mesmo do back).
- **S3 — operações para o backoffice-back, área por área.**
  - Primeiro as leituras (painel, piloto, análise, listas). Depois as escritas, com os comandos na fila.
  - Cada operação que muda de lugar sai do back principal e da lista de repasse no mesmo PR.
  - Ordem: Operação → Suporte → Moderação → Usuários → Financeiro → só do admin.
  - **Leituras** ✅ (backoffice-back, no PR da S2). Respondidas lá, lendo o schema `public` do mesmo Postgres (graphql-js com os tipos copiados daqui):
    - Operação: painel, análise, piloto, Avisos e E-mails (lista de pessoas, histórico de e-mails e de avisos).
    - Suporte: fila e contas de cliente.
    - Usuários: lista, ficha da unidade e o histórico dela, ficha da pessoa, busca do topo.
    - Financeiro: cobranças vencidas, próximas e feitas, compras de Destaque, pagamentos pelo app.
    - Só do admin e outras: Registro de ações, pedidos LGPD, confirmações, Destaque de profissionais, cupons, planos e preços.
    - Mesmas regras daqui, conferidas contra este back no banco de demonstração, com mais de um cargo. Diferenças de propósito:
      - ordem fixa nos gráficos;
      - teto nas listas sem limite;
      - texto vazio ou 0 onde o null derrubava a lista (histórico de e-mails, cobranças feitas);
      - `%` como texto nas buscas;
      - "não encontrado" com 404;
      - o Registro de ações abre pro Coordenador (`audit.read`).
    - Continuam aqui:
      - a conta da própria pessoa e os avisos dela;
      - Destaque de unidades (devolve o tipo `Barbershop` inteiro);
      - Moderação (as fotos usam link assinado do S3; decidido: o backoffice-back ganha leitura no bucket, ver Escritas);
      - saúde do sistema e backup;
      - todas as escritas.
    - Consulta que mistura campos de lá e daqui é recusada. `OPERATIONS_LOCAL=false` volta a repassar.
    - As colunas lidas (35 tabelas) ficam numa lista, e o CI de lá confere contra o `prisma/schema.prisma` daqui. Renomear coluna aqui quebra o CI de lá antes de quebrar a tela.
    - **Exceção à regra do mesmo PR:** essas operações continuam aqui até a S2 entrar, porque o app do backoffice em `main` ainda as pede pelo repasse. Saem daqui (com `userGrowthData` e as distribuições soltas, que o app não usa) no PR seguinte ao merge da S2. **A S2 entrou (2026-10-06):** essa limpeza é o próximo passo, depois de a API do backoffice estar no ar em produção (antes disso, o app em produção ainda fala com este back).
  - **Escritas**: cada uma vira escrita direta no banco quando é só dado (situação, flag, texto), numa transação com o autor em `app.actor` pro histórico e com o Registro de ações; o que tem regra ou segredo daqui vai por comando na fila `backoffice-commands`, depois de gravar.
    - **Suporte** ✅ (backoffice-back, no PR da S2; comandos aqui no #186):
      - Responder pedido, mudar a situação, suspender/reativar conta de cliente.
      - Comandos `support.reply_email` (o link do pedido é assinado com segredo daqui) e `client.suspended_email`.
      - Testado de ponta a ponta com a fila real: o back recebe o comando e manda o e-mail certo, e o histórico grava a equipe como autora, com o motivo e o id do request.
      - Achado no caminho: a fila do backoffice-back usava o prefixo padrão do BullMQ (`bull`) e o back escuta `barbershop`. Os comandos da S2 (código do login, convite, senha) nunca chegariam ao back em produção. Corrigido no mesmo PR, com teste do prefixo.
    - **Usuários** ✅ (backoffice-back, no PR da S2):
      - Editar conta, ações em lote (ativar, desativar, trocar plano com `finance.write`), derrubar sessões. Tudo é só dado: sem comando.
      - Conta do sistema só o Administrador altera.
      - Na edição só muda o que veio; gênero e ativo passaram a valer (o back ignorava).
      - Achado no caminho (app, PR da S2): o formulário de editar mandava telefone vazio e duas etapas desligadas (a lista não traz esses campos). Salvar qualquer edição apagava o telefone e desligava as duas etapas da conta. Agora manda só o que mudou, com E2E.
      - Continuam aqui: cargo de conta do app (`updateUserRole`), apagar conta (pede confirmação e apaga arquivos) e importar CSV (cria contas com senha).
    - **Financeiro e só do admin, parte 1** ✅ (backoffice-back, no PR da S2; comandos aqui no #189):
      - Trocar o plano de uma conta (`finance.write`), pedidos LGPD, cupons (criar, editar, apagar), Destaque de profissional e preços e taxas (só o Super admin, mesmos limites daqui).
      - Comandos `search.cache_bump` (a busca mostra o Destaque na hora) e `pricing.reload` (este back recarrega os preços guardados em memória; sem a fila, relê a cada minuto). O E2E de preços espera o back passar a usar o preço novo.
      - Testado com a fila real: o back recarregou o preço em 2 segundos.
      - (Destaque de unidade, avisos e e-mails da equipe: ver o item seguinte.)
    - **Avisos, e-mails, Destaque de unidade e cargo** ✅ (backoffice-back, no PR da S2; comandos aqui no #191):
      - Avisos (um e em lote; no lote, quem já recebeu o mesmo título em 5 minutos fica de fora), gravados lá; o comando `notifications.created` faz este back avisar as telas abertas.
      - E-mail da equipe pelo comando `email.admin_notification` (este back monta no idioma de cada pessoa e guarda no histórico), em pedaços de 1.000; para mais de 1.000, quem não é Administrador cria o pedido em Confirmações (este back executa quando aprovado).
      - Destaque de unidade (lista e ligar/tirar, com `search.cache_bump`) e cargo de conta do app (só o Super admin). Lá, os tipos `Barbershop` e `User` têm só os campos que as telas usam.
      - Testado com a fila real: o back recebeu o comando e montou o e-mail `admin_notification` no idioma da pessoa. Lista de unidades conferida contra este back no banco de demonstração. E2E novos: aviso mandado pela tela chega no sininho; Destaque de unidade ligado e tirado pela tela.
    - **Moderação** ✅ (backoffice-back, no PR da S2; comando aqui no #193). Decisão: o backoffice-back ganha leitura no bucket.
      - Fila e avaliações denunciadas lidas lá; as fotos vêm com link assinado de 1 hora, com uma credencial **só de leitura** (`s3:GetObject`) e as mesmas variáveis daqui (`S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Sem bucket, a fila aparece sem a imagem.
      - Ocultar, manter e restaurar gravados lá; ocultar ou devolver foto, unidade ou perfil manda `moderation.notify_owner` (este back avisa o dono pelo sininho e pelo celular). Unidade e perfil também renovam o cache da busca (aqui não renovavam).
      - Conferido contra este back no banco de demonstração (fila com foto, unidade e perfil; avaliações): igual, menos o link da foto (cada lado assina com a sua credencial). Testado com a fila real: o dono recebeu "Unidade fora da busca" e "Unidade de volta na busca". O E2E de Moderação passou pela API do backoffice.
      - **Falta você:** criar no provedor uma credencial só de leitura no bucket e pôr as variáveis no backoffice-back.
    - **Confirmações** ✅ (backoffice-back, no PR da S2; comando aqui no #195):
      - A decisão é lá (mesmas regras: só Administrador, nunca quem pediu, dois ao mesmo tempo só um vale). Aprovado, o pedido fica "em execução" e vai `approval.execute`; este back executa (apagar conta, estorno, e-mail em massa) e grava "feito" ou "falhou". Comando repetido não executa de novo. Se a fila não aceitar o comando, o pedido fica como falha.
      - A tela mostra "Confirmado; a ação está em execução" e o filtro ganhou "Em execução".
      - **E2E com a fila de verdade:** no CI, a API do backoffice sobe com o Redis e `LOG_COMMANDS=true` (só fora de produção: os e-mails também vão pro log, de onde o teste lê o código). Assim este back executa os comandos no E2E: a conta confirmada some, o preço novo vale na hora.
    - Continuam aqui, pedidos direto por quem é Administrador (resposta na hora, com o erro da Stripe ou da exclusão na tela): apagar conta, estorno, cobrança recorrente, planos (Stripe), importar CSV (cria contas com senha) e backup. O pedido de confirmação de quem não é Administrador também continua sendo criado aqui, junto dessas operações.
- **S4 — limpar o back principal.** Em andamento. O app do backoffice ainda repassa para cá o que não responde sozinho (apagar conta, estorno com confirmação, planos na Stripe, cobrança manual, backup, saúde, importar CSV, avisos da própria conta e a assinatura em tempo real). Enquanto isso, o gateway, os cargos de sistema, a coluna de áreas, o CORS e o interceptor de auditoria ficam. **Já saiu daqui** (o backoffice responde direto no banco): equipe, piloto, registro de ações, ficha da unidade, ficha da pessoa, busca do topo, sessões e pagamentos pelo app.

#### Riscos e cuidados

- **Duas bases de código escrevendo nas mesmas tabelas.** O backoffice-back escreve pouco (status, flags, plano, textos de resposta). Regra de negócio com efeito vai por comando para o principal, que é quem sabe executá-la. Um teste de contrato garante que cada comando tem consumidor.
- **Schema divergente.** O CI do backoffice-back compara o `public` que ele usa (introspecção) com o do back principal e quebra se uma coluna que ele lê mudar.
- **Ordem de deploy.** A migração do `public` sai antes. O backoffice-back só usa coluna nova depois que ela existe.
- **Dado pessoal.** O usuário do banco do backoffice não enxerga a ficha de saúde (sem `GRANT` nessas tabelas). O registro de ações continua gravando toda escrita.

### Fases

**Fase 0 — base** ✅ (feito)
- App e API separados, lista de operações gerada do build, segredo da API.
- Áreas por pessoa com `@RequireArea` e teste; a equipe não mexe em conta do sistema.
- Registro de ações, duas etapas obrigatórias, sem login social para conta do sistema.
- IP real do cliente (`TRUST_PROXY`, `x-backoffice-client-ip`), tempo máximo e imagem Docker.

**Fase 1 — acertar o que já existe**
- ✅ Avisos, E-mails e Análise são de Operação, mas usavam `usersDetailed` (Usuários), e Avisos ainda usa `allNotificationsWithUser` (só admin). Quem tinha só Operação via a tela e tomava erro.
  - ✅ **Seletor de pessoas enxuto** (`backofficePeople`, área Operação): id, nome, cargo, plano e se está ativa, sem e-mail, telefone ou endereço, e sem as contas do sistema. Avisos e E-mails usam ele.
  - ✅ **Análise:** a aba com a lista de pessoas (com e-mail) só aparece para quem tem Usuários; quem tem só Operação vê os números.
  - ✅ **Histórico de Avisos:** `allNotificationsWithUser` aberto para a área Operação (decidido pelo dono da plataforma em 2026-10-05). Mostra para quem foi cada aviso; o e-mail de quem recebeu só vai para o admin (a equipe recebe vazio e vê o #id).
- ✅ Tela Planos (admin, `/plans`): lista, criar, editar, remover (com confirmação) e "Sincronizar com a Stripe".
  - **Corrigido no back:** mudar o preço criava o preço novo num produto inexistente da Stripe (`'prod_' + id`); agora usa o produto do preço atual, ou cria um. Mudar o ciclo também gera preço novo.
  - **Remover** só tira da lista (`deleted_at`), em vez de apagar a linha que assinaturas antigas e pagamentos apontam; com assinatura ativa, não sai.
  - **Preço** não pode ser negativo; zero vale (plano gratuito). Mensagens em português.
- ✅ Tirar as operações antigas duplicadas: `setMultipleUsersActive` e `changeMultipleUsersPlan` saíram do schema (o backoffice usa `bulkUserAction`); `removeUser`, `setUserActive` e `changeUserPlan` ficaram só no `backoffice.resolver`, que declara a área e protege as contas do sistema; `GET /stripe/test` saiu.
- ✅ Cargos dos funcionários: permissões no lugar das áreas, na `StaffUser` do backoffice-back, com a migração de quem já tem áreas (S2).
- ✅ Tela Equipe: escolher o cargo e "convidar funcionário" (o admin informa nome, e-mail e cargo e a pessoa define a senha pelo link) (S2).
- ✅ E2E por cargo: cada cargo abre só o que a tabela "Quem vê o quê" diz e vê "acesso negado" no resto; a API do backoffice responde 403 (S2).

**Fase 2 — ver tudo de um negócio sem sair do backoffice** ✅ (back; as telas entram com a S2 no app do backoffice)
- ✅ Ficha da pessoa (`adminUserDossier`, só leitura): conta, cargo, unidades (dono ou equipe, com vínculo temporário), sessões abertas e últimos logins (sem IP), pedidos de suporte e a área do cliente ligada; plano e cobranças só para quem tem o Financeiro. Links para a ficha da unidade e para as filas de suporte e de contas de cliente. Na lista de Usuários, o nome abre a ficha.
- ✅ Busca única no topo (`backofficeSearch`): e-mail, nome, unidade ou número; contas e unidades com Usuários, contas de cliente com Suporte. `@RequireArea` passou a aceitar mais de uma área (basta ter qualquer uma).
- ✅ Pagamentos pelo app (`adminAppPayments`, Financeiro): sinal, atendimento pago antes e caixinha, com filtro por tipo e situação (pago, estornado em parte, estornado, em disputa), totais e a taxa da plataforma estimada pela tabela atual. Estorno (`adminRefundAppPayment`) com motivo, pelo mesmo fluxo da unidade (sinal e caixinha inteiros, atendimento em parte; conta já fechada só pelo painel da Stripe). Caixinha estornada guarda `refundedAt`. Disputas chegam pelo webhook `charge.dispute.*` (`PaymentDispute`).
- ✅ Derrubar as sessões de uma pessoa (`adminRevokeUserSessions`, Usuários): app e área do cliente ligada.

**Fase 3 — governança** ✅ (back; telas com a S2)
- ✅ Pedidos do titular (LGPD) (`PrivacyRequest`, Suporte): acesso, correção, exclusão, portabilidade; prazo de 15 dias, ligação com a conta pelo e-mail, filtro dos atrasados, resposta obrigatória para encerrar, quem registrou e quem resolveu.
- ✅ Ação sem volta (`BackofficeApproval`): apagar conta (sempre), estorno acima de `BACKOFFICE_REFUND_APPROVAL_LIMIT` (padrão R$ 500) e e-mail para mais de 1.000 pessoas. Quem não é Administrador pede com o motivo; outro Administrador (nunca quem pediu) confirma, e a ação roda na hora (ou recusa com nota). Falha fica registrada. Apagar conta agora usa a mesma exclusão do titular (`deleteByStaff`: dados pessoais apagados, linha anônima), no lugar de apagar a linha direto; conta do sistema não sai por aqui. Para o app do backoffice de antes da S2 continuar funcionando, ficam `removeUser` (só Administrador, já pela exclusão do titular) e `sendEmailNotification` (Boolean) como antigas; o app novo usa `adminDeleteUser` e `sendBackofficeEmail`. Saem na S4.
- ✅ Nível leitura × escrita: resolvido pelos cargos da S2 (cada cargo tem permissões de leitura e de escrita separadas, ex.: o Coordenador só vê o Financeiro).
- ✅ Sessões da equipe (backoffice-back): o Administrador vê onde cada pessoa está logada e derruba (`/team/:id/sessions`, `/team/:id/revoke-sessions`). Cargo novo avisa a pessoa por e-mail (`staff_role_changed`).
- Saúde do sistema (admin) ✅ (`/health`, com o último backup e links do Sentry e do Axiom).

### Decisões em aberto

- ~~Um segundo admin para não depender de uma pessoa só?~~ Decidido: sim (dono da plataforma, 2026-10-06), os dois com duas etapas (obrigatórias para toda a equipe). Feito no backoffice-back e no app, nos PRs da S2:
  - A tela Equipe avisa o Super admin quando ele é o único ativo e com o convite aceito; pela tela, ele convida o segundo (o convite e o login com código valem como para todo mundo).
  - Recuperar o acesso: se o único Super admin perdeu a conta, quem cuida do servidor roda `pnpm staff:super-admin --email ... [--name ...]` no backoffice-back. Conta nova recebe o convite; conta que já existe vira Super admin, é reativada e desbloqueada, e as sessões caem. Fica no Registro de ações como `cli`.
  - **Falta você:** depois da S2, convidar a segunda pessoa (o e-mail dela) pela tela Equipe.
- ~~Reembolso pelo backoffice ou só pelo painel da Stripe?~~ Feito no backoffice (Fase 2, pedido do dono da plataforma em 2026-10-06), com limite e confirmação acima dele.

## Horizonte: Registros e estabilidade — ✅ Concluído no código

Registrado em 2026-09-29. Duas perguntas para responder sempre:
1. **Quem mudou o quê?** Exemplos: "o Cayo trocou o preço do corte", "alguém editou a Green Barbershop", "a equipe da plataforma suspendeu este cliente".
2. **O sistema está de pé e aguentando?** Erros, lentidão, carga e fila, nos dois fronts (app e backoffice) e nos dois backs.

### O que já existe

| Peça | O que guarda | Quem vê | Falta |
|---|---|---|---|
| `BackofficeAuditLog` (Postgres, 2 anos) | Toda escrita da equipe da plataforma: quem, quando, operação, dados enviados, se deu certo | Admin, na tela Registro de ações | Valor de antes e depois; qual unidade ou pessoa foi afetada (hoje só aparece nos dados enviados) |
| Trilha no Axiom (`src/activity/`) | Mutations de quem usa o app: id da pessoa, cargo, unidade, operação, sucesso | Só nós, no Axiom | Não guarda o que mudou e não aparece para o dono. Fica assim de propósito: é trilha técnica, só com ids |
| Sentry no back principal | Erros e request lento | Só nós | Nada nos dois fronts nem no backoffice-back |
| Teste de carga (`docs/LOAD_TEST.md`) | Rodado uma vez, à mão | — | Não se repete; sem limite que avise quando piorar |
| `/health`, `/health/ready` | Se a API responde | — | Ninguém confere de fora; sem alerta |

### 1. Histórico de alterações (o que o negócio vê)

Uma tabela `ChangeLog` no Postgres, feita para gente ler. Não é log técnico.

- **Cada linha guarda:**
  - quando;
  - quem: id, nome no momento e cargo;
  - de onde veio: app, backoffice, cliente ou sistema (job);
  - a unidade;
  - o que foi alterado (tipo e id, mais um nome legível, ex.: "Green Barbershop", "Corte masculino");
  - a ação: criou, alterou ou apagou;
  - os **campos que mudaram, com antes → depois**.
- **O que entra:**
  - perfil da unidade (nome, endereço, contato, fotos, tipo);
  - horário de funcionamento e fechamentos;
  - serviços e preços;
  - equipe e cargos (convite, troca de cargo, desligamento, escala);
  - agendamentos (criar, remarcar, cancelar, fechar a conta, e por quem);
  - cadastro de cliente (sem a ficha de saúde);
  - configurações de pagamento, sinal, Connect e caixinha;
  - plano;
  - Destaque;
  - resposta a avaliação.
- **Quem vê:**
  - **Dono e gerente:** tela **Histórico** nas configurações da unidade, com filtro por pessoa, por tipo e por período. Cada item aparece como frase, ex.: "Cayo alterou o preço de *Corte masculino* de R$ 40 para R$ 45 — hoje, 14:32".
  - **Profissional** (barbeiro e básico) ✅: só a própria agenda: agendamentos (o que passou dele para outro aparece para os dois), escala, folgas e o próprio cadastro. A recepção não vê o Histórico.
  - **Equipe da plataforma:** o histórico inteiro na ficha da unidade e na ficha da pessoa do backoffice (Fase 2 do Backoffice).
  - **Quando a equipe da plataforma mexe na unidade:** o dono vê "Equipe da plataforma" com o motivo, sem o nome do funcionário (decidido). O nome fica no registro interno.
- **Dado pessoal:**
  - A ficha de saúde nunca entra: aparece só "ficha técnica atualizada".
  - Telefone e e-mail do cliente aparecem mascarados (`(11) 9••••-1234`).
  - Guarda de 1 ano (decidido), apagada pela rotina de guarda de dados.
  - Quando alguém exclui a conta, o nome dessa pessoa vira "Conta excluída" no histórico.
- **Como gravar:**
  - **Gatilho no Postgres** (decidido) nas tabelas acompanhadas. O gatilho compara a linha antiga com a nova e grava só os campos da lista de cada tabela.
  - Quem fez vem de `set_config('app.actor', …)` na mesma transação. Um wrapper de escrita do Prisma faz isso a partir do request.
  - Por que gatilho: pega **os dois backs**, já que o backoffice-back vai escrever direto no banco. Também pega jobs e scripts, e ninguém consegue "esquecer" de registrar uma operação nova.
  - Sem quem fez, a linha fica como "Sistema". Um teste garante que toda tabela acompanhada tem gatilho.

### 2. Registro de ações da equipe (backoffice)

- Continua existindo, e agora aponta para o que foi afetado: guarda o tipo e o id, a unidade e o nome legível. Ex.: "Cayo (Suporte N2) suspendeu o cliente Fulano — motivo: fraude".
- O valor de antes e depois vem do `ChangeLog` da mesma transação, ligado pelo id do request.
- Depois da separação do backoffice, fica no schema `backoffice` e o autor é a `StaffUser`.

### 3. Estabilidade: erros, lentidão e carga

- **Sentry nos dois fronts:**
  - erros de JavaScript com source map enviado no build do CI e versão = commit;
  - Web Vitals (LCP, INP, CLS) por página;
  - trace ligado ao back (`sentry-trace` no request), com amostra de 10%.
  - Replay de sessão desligado. Se um dia for ligado, só em erro e com tudo mascarado.
  - Mesmo `beforeSend` sem dado pessoal do back.
- **Sentry no backoffice-back**, com a mesma configuração do back principal.
- **Id do request de ponta a ponta:** o front gera um `x-request-id`. O backoffice-back repassa e o back devolve. O id vai para o Sentry (tag), o Axiom, o `ChangeLog` e o registro de ações. Com isso, "a tela deu erro às 14:32" leva a tudo o que aconteceu naquele request.
- **Métricas a cada 60 s para o Axiom:**
  - requisições, erros e p50/p95 por operação;
  - pool do Prisma (em uso e esperando);
  - Redis;
  - filas do BullMQ (esperando, falhas, mais antiga);
  - memória, CPU e atraso do event loop.
  - Com um painel no Axiom. É barato, porque é um evento por minuto por instância.
- **Conferência de fora a cada minuto:**
  - os dois fronts;
  - o `/health/ready` do back e do backoffice-back.
  - Serviço grátis (UptimeRobot ou Better Stack). Alerta por e-mail e WhatsApp ou Telegram.
- **Alertas:**
  - site fora por 2 minutos;
  - erro acima de 2% por 5 min;
  - p95 acima de 1 s por 10 min;
  - fila com falha ou job esperando há mais de 10 min;
  - pool com espera;
  - erro novo no Sentry depois de um deploy.
  - Vão para o Super admin e o Administrador.
- **Carga contínua:**
  - O script k6 do `docs/LOAD_TEST.md` vira um workflow semanal (e manual antes de release grande).
  - Roda contra homologação com os dados do teste de carga.
  - Limites que quebram o workflow: busca p95 < 300 ms a 50 req/s, agenda p95 < 200 ms, 0% de erro.
  - O resultado fica salvo para comparar semana a semana.
- **Tela Saúde do sistema no backoffice** (Fase 3 do Backoffice): lê essas métricas, o estado das filas, o último backup e o link para o Sentry e o Axiom.
- **`docs/RUNBOOK.md`:** o que fazer em cada alerta (reiniciar, escalar, pausar fila, reverter deploy).

### Etapas

- **R1 — estabilidade básica** ✅ (código): Sentry nos dois fronts e no backoffice-back, `x-request-id` de ponta a ponta (front → API do backoffice → back, gravado no Sentry, no Axiom e no registro de ações). Como ligar e a conferência de fora em [docs/MONITORING.md](docs/MONITORING.md). Falta criar os projetos do Sentry e os monitores (UptimeRobot ou Better Stack) e configurar as variáveis no deploy.
- **R2 — `ChangeLog`** ✅: gatilhos, wrapper do autor, lista de campos por tabela e tela Histórico para dono e gerente.
  - Back ✅:
    - **Tabela e gatilho:** tabela `ChangeLog` e um gatilho genérico (`change_log_capture`) em 11 tabelas: unidade, rede, serviços, produtos, equipe, escala, folgas, fechamentos, agendamentos, clientes e avaliações. Telefone e e-mail ficam mascarados; observação, motivo de folga e nascimento ficam ocultos.
    - **Autor:** vem do contexto do request (AsyncLocalStorage, preenchido depois do login). O `PrismaService` põe o autor em `set_config` dentro da transação: a escrita solta vira transação, e as transações interativas e em lote recebem o autor no começo. Job e script ficam como "Sistema".
    - **Consultas:** `barbershopChangeLog` e `barbershopChangeLogActors`, só para dono e gerente. A equipe da plataforma aparece como "Equipe da plataforma", com o motivo.
    - **Guarda:** 1 ano. Quem exclui a conta vira "Conta excluída" no histórico; o negócio apagado leva o histórico junto, sem gravar uma linha por item apagado em cascata.
  - Front ✅: aba **Histórico** (só dono e gerente).
    - **Cada linha** diz quem fez, o que alterou e o antes → depois de cada campo. Ex.: "Cayo Carlos alterou o serviço "Corte masculino" — Preço: R$ 50,00 → R$ 47,00".
    - **Filtros:** pessoa, tipo e período, com "mostrar mais".
    - **Valores formatados pelo campo:** dinheiro, data, sim/não, duração, dia da semana e situação.
    - **Equipe da plataforma:** aparece sem o nome. Telas em pt, en e es.
  - **Profissional** ✅: barbeiro e básico abrem o Histórico só com a própria agenda. Cada linha guarda de quais profissionais ela é (`barberIds`, preenchido pelo gatilho), e as linhas antigas foram preenchidas na migração.
- **R3 — registro de ações da equipe ligado ao `ChangeLog`** e ficha da unidade no backoffice ✅.
  - **Registro ligado ao histórico:** cada ação do Registro de ações traz o que mudou de fato (as linhas do histórico do mesmo request), com a unidade afetada e um link para a ficha. O gatilho também passou a cobrir User, ClientAccount, Professional, SupportTicket e ContentReport (o que a equipe da plataforma altera). Essas linhas não aparecem no Histórico do dono.
  - **Guarda:** o histórico do que a equipe da plataforma fez fica 2 anos, como o registro. Quem exclui a conta leva junto o histórico da própria conta.
  - **Ficha da unidade** (backoffice, área Usuários, só leitura): dono e plano, equipe, movimento de 30 dias, avaliação, clientes, serviços, suporte e denúncias abertos, recebimento pelo app, Destaque, e o histórico com o nome de quem da equipe mexeu. É a "ficha da unidade" da Fase 2 do Backoffice.
- **R4 — métricas, painel e alertas de lentidão e fila; carga semanal; runbook** ✅.
  - **Métricas a cada 60 s** por instância: requests, erros, p95 e as operações mais lentas; pool do Prisma; ping do Postgres e do Redis; filas do BullMQ (com o job mais antigo); memória, CPU e event loop. Vão para o Axiom e para a consulta `systemHealth` (só o admin).
  - **Alertas no Sentry:** lento, erro, pool esperando, banco ou Redis fora, fila parada e job com falha. No máximo 1 a cada 15 min por tipo, com limites em `ALERT_*`.
  - **Teste de carga semanal no GitHub Actions**, com p95 máximo por cenário (`scripts/load/thresholds.json`) e o resultado guardado por 90 dias.
  - **`docs/RUNBOOK.md`:** o que fazer em cada alerta. O painel no Axiom tem as consultas prontas no `docs/MONITORING.md`.
  - **Tela Saúde do sistema** no backoffice ✅ (`/health`, só o admin): o último minuto, atualizado a cada 30 s, com os mesmos limites dos alertas em vermelho, o último backup e os links do Sentry e do Axiom.
  - **Backup diário do Postgres** ✅: `pg_dump` às 03:30 para um bucket S3 privado (segunda cópia, fora do provedor do banco), guardado por 30 dias. Alerta `backup-stale` se passar de 26 h, botão "Fazer backup agora" e o passo a passo para restaurar no `docs/RUNBOOK.md`. O CI faz o backup e o restaura num banco novo. Para ligar: `BACKUP_ENABLED=true` e o bucket.

### Decisões tomadas (2026-09-29)

- **O dono não vê o nome do funcionário da plataforma.** No histórico dele aparece "Equipe da plataforma" com o motivo. O nome fica no registro interno do backoffice e é informado se o dono pedir pelo suporte.
- **Guarda do histórico:** 1 ano para as alterações do negócio (`ChangeLog`) e 2 anos para o registro da equipe da plataforma. A limpeza fica na rotina de guarda de dados.
- **O histórico é gravado por gatilho no Postgres**, não no código de cada back. Com o back principal e o backoffice-back escrevendo no mesmo banco, o gatilho pega os dois, além dos jobs e scripts. Uma operação nova não fica sem registro.

## Horizonte: Jornada de cada tipo de usuário — ✅ Concluído

Revisão de 2026-10-05: entrei no app principal como cada tipo de usuário do seed e abri todas as telas.
- **Equipe da unidade:** dono (Cayo), gerente (Bianca), barbeiro (Minion), recepção (Julia), básico (Pedro).
- **Fora da equipe:** dono de outra unidade no plano gratuito (Marcos), cliente final (Lucas), visitante sem login e admin do sistema.

A pergunta em cada tela: o que esse cargo faz no dia a dia, o que está sobrando, o que está errado e o que falta.

### Corrigido na própria revisão

- 🔴 **Cliente entrava na API da equipe como o admin do sistema.**
  - **O defeito:** só com o cookie do cliente (`ClientAuthentication`), a consulta `me` da equipe respondia com o usuário 1, o admin do sistema. A leitura do cookie da equipe procurava `Authentication=` no cabeçalho e achava o do cliente; o token do cliente (mesmo segredo, sem `userId`) passava; e a busca do usuário com id vazio devolvia o primeiro da tabela, porque a exclusão lógica troca `findUnique` por `findFirst`.
  - **O mesmo caminho servia ao `state` do OAuth das redes sociais**, que leva `userId` e passa pela URL do provedor.
  - **A correção:**
    - o cookie da equipe é lido pelo nome exato;
    - o token só vale como sessão da equipe com `userId` e uma `ActiveSession` ativa daquele usuário;
    - o do cliente só vale com `clientAccountId`;
    - `findUnique` sem chave dá erro em vez de devolver o primeiro registro.
  - **Teste:** o guard é testado contra o banco com o cookie do cliente, o `state` do OAuth, um token sem sessão e a sessão de verdade.

### Boas-vindas personalizadas por cargo (pedido) ✅

- **Feito:**
  - **Back:** consulta `myOnboarding` com os passos do cargo na unidade mais recente da pessoa. O que dá para conferir nos dados se marca sozinho: serviços, horário, equipe, recebimento pelo app, primeiro agendamento, caixa aberto pela pessoa, escala, calendário sincronizado e foto. Os passos de abrir uma tela (página pública, agenda, relatórios…) contam ao abrir, pelo `completeOnboardingStep`. O "Dispensar" e o progresso ficam na tabela `OnboardingProgress`.
  - **Quando aparece:** nos primeiros 30 dias da pessoa na unidade; o dono que ainda não cadastrou o negócio vê "Cadastrar o negócio".
  - **Front:** o card substitui o antigo, com o texto e os passos de cada cargo (pt, en, es).
  - ✅ **Profissional por conta própria e cliente final:**
    - **Agenda própria** (`practiceKind = solo`): passos próprios (serviços, horário, foto, perfil público, calendário e primeiro agendamento), em vez dos do dono, que pediam para convidar a equipe.
    - **Profissional sem unidade:** foto, perfil público no ar (com endereço e visível) e, opcional, as vagas para freelancer.
    - **Cliente final** (área do cliente): confirmar o e-mail, o telefone para os lembretes, um favorito e, opcional, a notificação no celular. Tudo conferido nos dados; o "Dispensar" fica na conta (`ClientAccount.onboardingDismissedAt`). Consultas `myClientOnboarding` e `dismissClientOnboarding`.
    - **"Seus dados" na área do cliente:** o cliente não tinha onde pôr o telefone depois do cadastro. Agora muda nome e telefone (`updateClientProfile`).

- **Hoje:** há um card só, "Bem-vindo ao seu estabelecimento!".
  - Ele aparece para quem está no plano gratuito, de qualquer cargo. Na recepção e no básico aparece com o texto do dono ("Gerencie… funcionários e vendas").
  - O passo "Explorar Dashboard" leva para a própria tela onde a pessoa já está.
  - Só o dono tem um passo dele ("Ver planos"), e nenhum passo ajuda a configurar o negócio.
  - O progresso fica no navegador: troca de aparelho, volta tudo.
- **Como deve ficar:** o card escolhido pelo cargo na unidade, e não pelo plano. Cada passo se marca sozinho quando a coisa é feita de verdade. O progresso fica no back, por pessoa e por unidade. O card some quando tudo está feito, e "Dispensar" vale em todos os aparelhos.
  - **Dono de negócio novo:** cadastrar os serviços, o horário de funcionamento, convidar a equipe, conferir a página pública (com o link e o QR para divulgar), ligar o recebimento pelo app (opcional) e fazer o primeiro agendamento. "Ver planos" só quando chegar perto do limite do plano.
  - **Gerente:** a agenda da equipe, a escala e as folgas, os relatórios e o caixa. Sem planos nem cobrança.
  - **Recepção:** a agenda de todos, cadastrar um cliente, abrir o caixa do dia e a fila de espera.
  - **Barbeiro:** a minha escala, as folgas, sincronizar com o calendário do celular, a foto e o perfil público, e os meus ganhos.
  - **Básico:** a minha agenda, a minha escala e sincronizar com o calendário.
  - **Profissional por conta própria:** o perfil público, onde atende e as vagas para freelancer.
  - **Cliente final** (área do cliente): confirmar o e-mail, o telefone para os lembretes, favoritar a unidade e ligar as notificações no celular.

### Sobrando: a equipe vê coisas do dono

1. ✅ **Menu da conta → "Financeiro"** (histórico de pagamentos, pendências e "Meu Plano", com a compra de plano) aparece para todos os cargos. Só o dono deveria ver. As rotas `/pricing`, `/payment-history` e `/financial-issues` também abrem para a equipe.
2. ✅ **Ícone e tela de Franquia** aparecem para a equipe. O ícone vem sem nome, e a tela diz "Cadastre uma unidade para criar sua franquia". Só o dono deveria ver; o gerente, no máximo para ler.
3. ✅ **A recepção vê "Faturamento hoje" e o valor das vendas** em "Últimos eventos" na tela inicial. Isso contradiz a regra "recepção sem resumo financeiro" das abas.
4. ✅ **O básico vê "Vender produto"** na tela inicial, mas não pode vender (a aba Vendas é bloqueada para ele).
5. ✅ **O boas-vindas com o texto do dono** aparece para todos (ver acima).

### Errado ou confuso

1. ✅ **"Últimos eventos"** (tela inicial e visão geral) lista agendamentos futuros ("13 de out.") misturados com vendas. Deveria ser "Atividade recente", com o que já aconteceu em ordem, sem repetir "Próximos horários".
2. ✅ **Fila do Atendimento:** o status aparece em inglês cru ("WAITING").
3. ✅ **Caixa:** a data aparece no formato americano ("9/29/2026, 11:45:00 AM") com o app em português.
4. ✅ **Abrir uma unidade em que a pessoa não trabalha** (pelo link) fica em "Carregando…" para sempre. Deveria dizer "Você não tem acesso a esta unidade" e oferecer voltar.
5. ✅ **A agenda abre às 00:00.** Deveria abrir no horário de funcionamento ou na hora atual.
6. ✅ **Barbeiro e básico:** o campo "Profissional" do novo agendamento começa vazio, mas eles só podem agendar para si. Deveria vir preenchido e travado.
7. ✅ **Seletor de unidade no topo:** fica "Selecione uma u…" (cortado) mesmo dentro da unidade ou com uma unidade só. Deveria mostrar a unidade atual, e já escolher sozinho quando houver só uma.
8. ✅ **"Faturamento (mês vigente)" no começo do mês** mostra "-100% em relação ao mês anterior". Deveria comparar com o mesmo período do mês anterior.
9. ✅ **Plano gratuito:** a faixa "Você está no plano gratuito. Assine para continuar." soa como bloqueio. Deveria dizer o que o plano gratuito permite e quando é preciso assinar.
10. ✅ **Visitante sem login que abre o endereço principal** cai no login da equipe. Deveria cair numa página inicial com "Encontrar um horário" (a busca) e "Tenho um negócio" (o cadastro).
11. ✅ **Perfil público do profissional:** mostra "0 atendimento concluído" (no singular, e mostrando o zero). Com zero, deveria esconder a linha.

### Falta

1. ✅ **Teste E2E por cargo do que aparece no menu da conta e no topo** (Financeiro, Franquia, seletor de unidade), para o que é do dono não voltar a aparecer para a equipe.
2. ✅ **"O que o meu cargo pode fazer"** no perfil da equipe (ex.: "Barbeiro: vê e mexe só na própria agenda; vê o contato só de quem já atendeu"), para ninguém achar que é defeito.

### Ordem sugerida

1. ✅ **Sobrando** itens 1 a 4, mais erros 2, 3 e 4. Plano, cobranças e franquia só para o dono (menu e rotas); a recepção vê o caixa, não o faturamento do dia; o painel diz se a pessoa vende (`canSell`); status da fila e datas no idioma do app; unidade sem acesso com aviso. Testado por cargo no E2E (`roles.spec.ts`).
2. ✅ **Boas-vindas por cargo:** o progresso no back e os passos que se marcam sozinhos.
3. ✅ **Erros 1 e 5 a 11:**
   - **Atividade recente:** só o que já aconteceu (agendamentos com início até agora e vendas), com o novo nome.
   - **Agenda:** abre no horário de funcionamento da unidade (8h às 20h sem horário cadastrado), com 1 h de folga de cada lado, e alarga para caber qualquer agendamento fora do expediente. A da franquia também.
   - **Profissional travado:** barbeiro e básico já veem o próprio nome no novo agendamento (agenda e modal rápido), sem poder trocar.
   - **Seletor de unidade:** mostra a unidade aberta; fora dela, a única unidade ou a última aberta (guardada no navegador); senão, "Unidades".
   - **Faturamento do mês:** compara com o mesmo período do mês anterior (`revenueSamePeriodLastMonth`), e não com o mês inteiro.
   - **Plano gratuito:** "Você está no plano gratuito. Veja o que cada plano libera quando precisar de mais." com "Ver planos".
   - **Visitante em "/":** página com "Encontrar um horário" (busca), entrar como cliente, "Cadastrar meu negócio" e "Já tenho conta: entrar". Link de indicação (`?pro=`) continua indo para o login.
   - **Perfil público do profissional:** esconde a linha de atendimentos quando é zero.
   - **Testes:** `roles.spec.ts` (profissional travado e seletor), `auth.spec.ts` (página do visitante) e o teste de integração do painel (sem futuro na atividade recente).
4. ✅ **O que faltava:**
   - **"O que o meu cargo pode fazer"** no perfil (`/profile`): por unidade, o cargo, o que ele pode e o que fica com outro cargo (dono, gerente, recepção, barbeiro, básico e agenda própria).
   - **Boas-vindas** do profissional por conta própria e do cliente final (ver acima).
   - **Testes:** integração no back (agenda própria, profissional sem unidade, cliente e o "Seus dados") e E2E (`client-account.spec.ts` e `roles.spec.ts`).


## Bugs encontrados na revisão (2026-10-07)

Achados numa revisão de código. Itens 1–36 corrigidos.

### Segurança e LGPD

1. ✅ **Chat do profissional depois de sair da unidade** (`chat.service.ts`): o acesso ao chat do atendimento confere só se `appt.barber.userId` é quem está logado. Não olha se o `Barber` ainda está ativo nem se está dentro de `accessStartsAt`/`accessEndsAt`. Um barbeiro removido ou freelancer com acesso vencido continua lendo e mandando mensagens, e o `notifyStaff` continua avisando ele. **Feito:** a conversa do profissional e o aviso usam `getMyAccessLevel`; a caixa de entrada e a recepção usam o vínculo vigente (`currentEngagement`).
2. ✅ **Push com SSRF** (`push.service.ts`): o endpoint de push só é validado pelo prefixo `https://`. Dá para cadastrar `https://10.0.0.5/...` e fazer o servidor chamar a rede interna. **Feito:** só hosts de FCM, Mozilla, Apple e WNS, e o DNS desse host não pode cair em IP privado, loopback ou link-local.
3. ✅ **Selo de identidade verificada sobrevive à troca de nome** (`user.resolver.ts`, `updateUserProfile`): trocar o `fullName` não limpa `identityVerifiedAt`. O profissional verificado troca o nome e continua com o selo. **Feito:** outro nome (comparado sem espaços nas pontas) limpa `identityVerifiedAt`, como já acontecia em `UserService.updateUser`.
4. ✅ **Perfil público fica no ar depois da exclusão da conta** (`account-deletion.service.ts`, `erase()`): não apaga nem esconde o `Professional` nem a `PaymentAccount` do profissional. O `/p/:slug` continua na busca e no sitemap depois de um pedido de exclusão (LGPD). **Feito:** a exclusão oculta o perfil (sem slug), desliga o recebimento do profissional e das unidades apagadas, e o teste cobre a busca e o sitemap.
5. ✅ **Link de gestão do agendamento passa por cima da suspensão** (`chat.service.ts`): o `manageToken` dá acesso ao chat do cliente mesmo com a `ClientAccount` suspensa ou excluída. **Feito:** com conta de cliente ligada, suspensa ou excluída, o link e o login da conta não abrem o chat.
6. ✅ **"Fale com o suporte" vira disparador de spam** (`support.service.ts`, `contactSupport`): sem login, manda o e-mail `support_received` para qualquer endereço, com nome e assunto escolhidos por quem envia, e ainda dispara push para todos os admins do suporte. **Feito:** a confirmação não repete nome nem assunto; 5 pedidos por hora por IP e 3 por dia por e-mail; o aviso da equipe não leva o texto livre. Captcha (`RECAPTCHA_SECRET_KEY` + token no formulário) é obrigatório quando a chave está configurada.

### Regras e dados errados

7. ✅ **Chamados abertos antigos somem da fila** (`support.service.ts`, `queue()`): pega os 200 mais recentes por `lastActivityAt` e só depois põe os abertos na frente. Um chamado aberto antigo some da fila padrão. **Feito:** a fila padrão busca os abertos no banco antes de completar com respondidos e fechados.
8. ✅ **Candidaturas presas em "pendente"** (`job-opening.service.ts`): quando as vagas enchem, as candidaturas que sobraram ficam pendentes para sempre, sem aviso, e contam no limite `MAX_PENDING_PER_USER = 20`. **Feito:** ao preencher a última vaga, as pendentes são recusadas e quem se candidatou é avisado. Encerrar a vaga já fazia isso.
9. ✅ **Pacotes e planos aceitam valores zerados ou negativos** (`barbershop.service.ts`): pacotes de serviço e planos de assinatura não validam `totalSessions`, `sessionsPerCycle` nem preço. Dá para criar um plano que cobra todo mês e nunca pode ser usado. **Feito:** sessões pelo menos 1 e preço a partir de zero, no DTO e no service.
10. ✅ **Venda editada não acerta estoque nem pontos** (`updateSale`): mudar itens ou o status do pagamento não devolve nem baixa estoque e não ajusta os pontos de fidelidade. **Feito:** na mesma transação, a diferença de produtos mexe no estoque e os pontos acompanham o total, o cliente e se a venda está paga.

### Idioma, fuso e desempenho

11. ✅ **Avisos fixos em português e no fuso de São Paulo** (`featured-payment.service.ts`, `JobOpeningService.notify`): textos em português e datas em pt-BR no fuso `America/Sao_Paulo`, ignorando o idioma do usuário e o fuso da unidade. **Feito:** o sininho sai no idioma da conta (pt/en/es) e a data do Destaque no fuso da unidade; a lista de vagas filtra o “hoje” pelo fuso de cada unidade.
12. ✅ **Agenda da franquia sempre de 8h às 20h**: a agenda da franquia usa o horário padrão em vez do horário de funcionamento das unidades. **Feito:** a faixa usa o menor início e o maior fim entre as unidades que estão na tela (filtro e legenda). Sem horário configurado, vale o expediente padrão (9h–18h).
13. ✅ **"Próximo horário livre" faz milhares de consultas** (`getPublicNextAvailableSlot`): calcula dia a dia e profissional a profissional, com consultas em laço. **Feito:** escala, fechamentos, horários e folgas do período inteiro vêm numa leva e o primeiro horário livre é calculado em memória.
14. ✅ **Backoffice: transação interativa por escrita** (`barbershop-backoffice-back`): cada escrita abre uma transação interativa do Prisma, o que pesa no pool de conexões. **Feito:** escrita única ou várias já montadas usam `$transaction([...])` em lote (`asActorBatch`). A transação interativa fica onde a próxima escrita depende da anterior (trava, preço, privacidade, suspensão, edição de conta).

### Segunda rodada (2026-10-08)

**Dinheiro e segurança**

15. ✅ **Aplicar cupom num pagamento pendente** (`PaymentsService.applyCouponToPayment` e `CouponsService.applyCoupon`, mutation `applyCoupon`):
    - Muda só o valor no banco. A cobrança na Stripe continua com o valor cheio.
    - Usa `registerUse`, sem a trava de `claimUse`. Cliques ao mesmo tempo passam do limite de usos e do "um por pessoa".
    - Aceita outro cupom no mesmo pagamento. O desconto é calculado em cima do valor já descontado e `originalAmount` é sobrescrito.
    - Com valor final 0, só marca o pagamento como pago, sem passar pelo fluxo que ativa ou renova o plano.
    - **Feito:** a mutation e o `POST /apply/:paymentId` recusam. O cupom continua no checkout (`createPaymentIntentForCheckout`), que já manda o valor certo pra Stripe e registra o uso com `claimUse`.
16. ✅ **Cancelar "este e os próximos" da série passa por cima do cargo** (`AppointmentSeriesService.cancelFromHere`): confere a permissão só para o profissional do horário clicado. Se um horário seguinte da série foi passado para outro profissional, um barbeiro cancela também o horário do colega. **Feito:** cada horário seguinte passa pela mesma checagem de agenda; o de outro profissional fica de fora quando o cargo não permite.
17. ✅ **Links de gerenciar e de avaliar não vencem** (`appointment-link.ts`): o token é só o id assinado, sem validade e sem como revogar. Um e-mail antigo encaminhado dá acesso ao chat do atendimento e deixa mudar a avaliação anos depois. **Feito:** o link novo é `id.versão.assinatura` (o antigo `id.assinatura` vale como versão 0). Gerenciar e chat valem até 14 dias depois do fim do horário; avaliar, até 30 dias. `Appointment.linkVersion` sobe quando a unidade cancela (agenda, série ou fechamento), e o e-mail de cancelamento sai com a versão nova. O cancelamento feito pelo próprio cliente no link continua abrindo.
18. ✅ **Token da Página do Facebook em texto puro** (`SocialConnection.facebookAccessToken`): fica legível no banco e em backups. **Feito:** o token é gravado com AES-256-GCM (`SOCIAL_TOKEN_KEY`, ou `JWT_SECRET` se ela não existir). Na publicação, o valor antigo em texto puro ainda abre e é cifrado nessa leitura.

**Equipe e convites**

19. ✅ **Remover da equipe não cancela o convite pendente** (`BarbershopService.deleteBarber`):
    - Só faz `isActive: false`.
    - O convite continua `PENDING`: convidar a mesma pessoa de novo esbarra em "Já existe um convite pendente". E o link antigo ainda é aceito, ligando a conta a um vínculo desativado.
    - Os horários futuros do profissional removido ficam na agenda sem aviso a ninguém.
    - **Feito:** remover cancela os convites `PENDING` desse vínculo. Validar e aceitar o convite recusam quando o `Barber` está inativo. Se ainda há horário futuro confirmado ou aguardando pagamento, dono e gerentes recebem o aviso para remanejar.
20. ✅ **Documento no aceite do convite** (`EmployeeInviteService.acceptInvite`):
    - Aplica a máscara de CPF em qualquer país.
    - A checagem de duplicado compara o número cru com o salvo (que no convite fica com máscara e no cadastro normal fica como foi digitado). Então o mesmo CPF passa duas vezes.
    - **Feito:** `canonicalIdDoc` mascara só CPF brasileiro (11 dígitos); os outros documentos numéricos ficam só com os dígitos. A duplicata compara pelos dígitos, no país informado, então o número cru e o mascarado são a mesma conta.
21. ✅ **Aceite do convite fora de transação e em português fixo** (`acceptInvite`):
    - Cria usuário, endereço, configuração, preferências e o vínculo em passos separados. Se um passo falha no meio, a conta fica criada e o convite pendente; tentar de novo dá "Já existe uma conta com estes dados".
    - O idioma da conta nova é sempre `pt`, mesmo em unidade do México ou dos EUA.
    - **Feito:** usuário, endereço, configuração, preferências, vínculo e o aceite do convite entram numa transação (o convite só sai de `PENDING` se ainda estava pendente). O idioma da conta nova segue o país da unidade (`langForCountry`).

**Avaliações e redes sociais**

22. ✅ **Editar a avaliação mantém a resposta antiga** (`ReviewRequestService.submitReview`): o cliente troca a nota e o texto pelo link, e a resposta pública da unidade continua lá, respondendo a um texto que não existe mais. Também não volta para moderação se tinha sido denunciada. **Feito:** quando o texto muda (pelo link ou logado), `reportedAt` sai e a resposta fica `replyStale` — a página e a lista da unidade dizem que ela foi escrita para o texto anterior. Uma resposta nova limpa a marca. Só mudar a nota não mexe na denúncia.
23. ✅ **Conectar o Facebook pega sempre a primeira Página** (`SocialService.handleOAuthCallback`): quem administra várias Páginas não escolhe qual, e o post pode sair na Página errada. A volta do OAuth também não confere se a pessoa ainda é gerente da unidade. **Feito:** na volta, quem não administra mais a unidade não conecta. Uma Página só segue conectando na hora. Várias Páginas voltam para a tela de redes sociais, onde a pessoa escolhe; o token de usuário fica cifrado por 15 minutos e a Página escolhida é a que fica salva.

**Limpeza**

24. ✅ **Checagens mortas no login** (`jwt.strategy.ts`): `validate(payload, req)` espera o request, mas a estratégia não liga `passReqToCallback`. Então `req.cookies` nunca existe e a lista negra de tokens (`isTokenInvalidated`) e a checagem por `updatedAt` nunca rodam. Hoje quem revoga é a `ActiveSession`, então nada quebra. Mas ligar `passReqToCallback` sem cuidado faria qualquer `user.update` derrubar todas as sessões, inclusive a atual. **Feito:** saíram a lista negra e a comparação com `updatedAt`. A sessão continua valendo só com `ActiveSession`. A tabela `InvalidatedToken` foi removida.

### Terceira rodada (2026-10-08)

**Convite de amigos (1 mês grátis)**

25. ✅ **O cupom de "1 mês grátis" não funciona para quem foi convidado** (`FriendInviteService.createFriendInviteCoupon`):
    - O cupom é criado com `minSubscriptionMonths: 1`. Quem acabou de criar a conta não tem assinatura, e o `validateCoupon` recusa com "Cupom requer assinatura prévia".
    - O cupom não fica ligado a ninguém: o `_userId` é ignorado e não se cria `UserCoupon`. Ele não aparece em "seus cupons" (`getCouponsForUser`), e qualquer um com o código usa.
    - **Feito:** o cupom do amigo não pede meses de assinatura. Cada um ganha um `UserCoupon`. Se o cupom está reservado para uma conta, outra conta não usa o código.
26. ✅ **Aceitar o convite duas vezes ao mesmo tempo** (`FriendInviteService.acceptInvite`): confere `status === 'PENDING'` e só grava depois. Dois cliques geram quatro cupons. **Feito:** o convite só sai de `PENDING` numa transação, antes de criar os cupons. O segundo clique encontra o convite já processado.
27. ✅ **Convite de amigo como disparador de e-mail** (`POST /friend-invites`): sem limite próprio (só o geral de 300 por minuto por IP). O e-mail leva o nome da conta, que quem envia escolhe, para qualquer endereço. Também dá para criar contas em série e ganhar meses grátis. **Feito:** 5 convites por conta por dia, só com e-mail confirmado (login social ou conta de cliente verificada) e no máximo 12 convites aceitos com mês grátis por pessoa.

**Privacidade e moderação**

28. ✅ **O profissional vê a nota que cada cliente deu a ele** (`CustomerRatingService.visitFeedback`): a lista mostra, atendimento por atendimento, as estrelas que o cliente deu ao profissional. Ao mesmo tempo, o profissional avalia o cliente. Dá para revidar uma nota baixa e o cliente perde a confiança de avaliar com sinceridade. **Feito:** o histórico do cliente na unidade mostra a caixinha e não a estrela da visita.
29. ✅ **Conta desativada continua com perfil público** (`CareerService.publicProfile`): só esconde se `Professional.suspendedAt`. O usuário desativado pela plataforma (`User.isActive = false`) continua com `/p/:slug` no ar, e provavelmente na busca. **Feito:** conta inativa some da página, da busca, do sitemap e do Destaque, como o perfil suspenso.
30. ✅ **Fila da moderação perde denúncias antigas** (`ModerationService.queue`): pega as últimas `QUEUE_REPORTS` denúncias de tudo e só depois agrupa. Um item com denúncia aberta antiga some da fila. Um item oculto cujas denúncias saíram da janela não aparece mais para ser restaurado. É o mesmo padrão do item 7 (fila do suporte). **Feito:** a fila agrupa no banco os itens com denúncia aberta e, no espaço que sobra, os já ocultados, pra poder restaurar.

### Quarta rodada (2026-10-08)

31. ✅ **E-mail diferencia maiúsculas no cadastro e no login** (`UserService.createUser` e `verifyUser`):
    - O e-mail é gravado e procurado do jeito que foi digitado. A unicidade (`@@unique([email, provider])`) diferencia maiúsculas no Postgres.
    - `Fulano@x.com` e `fulano@x.com` viram duas contas. Quem se cadastrou com maiúscula não entra digitando minúscula.
    - Os fluxos que já usam minúscula (convite da equipe, ligação com a conta de cliente, convite de amigo) não acham a conta com maiúscula. O convite da equipe acaba criando uma segunda conta.
    - **Fazer:** normalizar (`trim().toLowerCase()`) no cadastro, no login, no "esqueci a senha" e no OAuth. Migrar os e-mails existentes, depois de juntar as duplicadas, e trocar o índice por um que ignore maiúsculas (`citext` ou índice em `lower(email)`). **Feito:** cadastro, login, esqueci a senha, troca de senha, 2FA e OAuth gravam e procuram o e-mail em minúsculas. A migration `20261124140000_user_email_case` deixa a conta ativa mais antiga com o endereço e desativa a duplicata (e-mail com `+dup<id>`, sem misturar agenda e venda). Um índice em `lower(email)` impede a repetição.
32. ✅ **Indicação de profissional perde meses e vira fábrica de meses grátis** (`ProReferralService.claim`):
    - O `grant` lê `proUntil` e grava a soma depois. Dois indicados usando o mesmo código ao mesmo tempo fazem o indicador ganhar só uma das extensões.
    - Qualquer conta, até antiga, pode usar um código. A e B podem usar o código um do outro. E não há teto para o indicador.
    - **Fazer:** soma atômica no banco (ou trava por usuário), só conta nova pode usar código, sem indicação cruzada, e teto de meses por indicador. **Feito:** o fim do Pro é lido com a linha travada e os dois usuários entram num lock em ordem de id. Só conta criada nos últimos 30 dias usa código, indicação de volta é recusada, e o indicador para nos 12 meses.
33. ✅ **Estorno feito direto na Stripe não chega ao app** (`stripe.controller.ts`): não há tratamento de `charge.refunded`. Um estorno pelo painel da Stripe (ou por suporte) deixa o sinal como pago, a caixinha somando no pagamento da equipe e o atendimento como "pago pelo app". **Fazer:** tratar `charge.refunded` e `refund.updated` com a mesma lógica dos estornos feitos pelo app. **Feito:** `charge.refunded` e `refund.updated` (quando o estorno confirma) marcam sinal, caixinha e atendimento pago. Estorno parcial do atendimento guarda o valor. Evento repetido não desfaz o que o app já registrou, e a Stripe não é chamada de novo.
34. ✅ **Fechar o dia cancela o que já aconteceu e esquece quem está pagando o sinal** (`ClosureService.set`):
    - Fechar o dia de hoje cancela (e estorna) também os atendimentos de mais cedo que ainda estão `CONFIRMED`.
    - Os horários `PENDING_PAYMENT` (cliente no meio do pagamento do sinal) ficam de fora e podem ser pagos para um dia fechado.
    - Trocar o fechamento por um horário especial maior (via `set`) não avisa a lista de espera. Só o `remove` avisa.
    - **Fazer:** cancelar só do horário atual para frente, incluir `PENDING_PAYMENT` (expirando a reserva) e avisar a lista de espera quando o horário aumenta. **Feito:** atendimento confirmado que já começou fica. Reserva de sinal no horário fechado é liberada (se o pagamento já tinha passado, o horário confirma). Salvar o fechamento usa o mesmo aviso da lista de espera de quando o dia reabre, então aumentar o horário especial avisa.
35. ✅ **Importação de planilha escolhe o profissional errado** (`ImportService.matchBarber`): compara nomes com "contém" nos dois sentidos e fica com o primeiro que bater. "Ana" na planilha cai na "Mariana", e "Jo" em qualquer "João" ou "Jorge". **Fazer:** igualdade exata (sem acento e maiúsculas) primeiro, "contém" só se houver um único candidato, e erro na linha quando ficar ambíguo. **Feito:** o nome igual ganha. "Contém" só quando uma pessoa combina. Se mais de uma combina, a linha volta com erro em vez de escolher a primeira.
36. ✅ **Aceite do convite da equipe com e-mail em maiúscula** (efeito do item 31 em `EmployeeInviteService.acceptInvite`): o convite guarda o e-mail em minúscula e procura a conta exatamente assim. Quem já tem conta com maiúscula ganha uma segunda conta em vez de entrar com a sua. Resolve junto com o item 31. **Feito:** criar, validar e aceitar o convite procuram a conta sem diferenciar maiúsculas, então a conta que já existe é reaproveitada.

### Quinta rodada (2026-10-11)

**CI vermelho na main (6 commits seguidos)**

37. ✅ **Lint quebra o CI antes dos testes:** 45 erros de formatação (prettier), quase todos em `prisma/seed-demo.ts` e alguns em `src/support/support.service.ts`. Como o lint vem primeiro, os testes e a checagem de migrations não rodam no CI. **Fazer:** `pnpm exec eslint --fix` nesses arquivos. **Feito:** formatação corrigida em 20 arquivos (só espaços e quebras de linha).
38. ✅ **Testes desatualizados (7 arquivos falham rodando local):**
    - `professional-review`, `search`, `moderation`, `identity-verification` e `featured-payment`: a página pública agora exige conta ativa, e o padrão de `User.isActive` é `false`. Os usuários de teste são criados sem `isActive: true`.
    - `job-opening` (taxa por vaga): o teste novo "preencher a última vaga" coloca mais um profissional na unidade, e o teste seguinte esbarra no limite de 3 profissionais do plano.
    - `deposit-payment`: o link do cliente para de abrir depois que a unidade cancela. Ver o item 44.
    - **Fazer:** criar os usuários de teste com `isActive: true`, usar outra unidade (ou plano maior) no teste da taxa e decidir o item 44.
    - **Feito:** usuários de teste com `isActive: true`. O teste da vaga preenchida remove da equipe quem entrou (libera a vaga do plano e cancela o convite). O teste do pagamento passa a esperar o comportamento atual: o link antigo não abre e o da versão nova mostra o estorno (o item 44 continua em aberto).
39. ✅ **e2e do front vermelho na main:** o log disponível não mostra o motivo. Rever depois de o back voltar a ficar verde (o e2e do front roda contra a main do back). **Feito:** era o teste do push com endpoint falso (`push.example.test`), que o back passou a recusar. O teste usa um endereço do FCM (front #125).

**Correções que ficaram pela metade**

40. ✅ **Convite de amigo bloqueado para quase todo dono** (`FriendInviteService.createInvite`): a checagem de "e-mail confirmado" só aceita conta local que tenha conta de cliente ligada e confirmada. A conta da equipe não tem confirmação de e-mail própria. Então o dono cadastrado por e-mail e senha, sem conta de cliente, sempre recebe "Confirme seu e-mail antes de convidar alguém". **Fazer:** usar uma confirmação de e-mail da própria conta da equipe (ex.: o código do cadastro) ou outra prova (conta com plano pago, login social). **Feito:** a conta da equipe ganhou `emailVerifiedAt`. Na tela de convidar amigos, quem entrou por e-mail e senha recebe um código de 6 dígitos e confirma ali mesmo (`/friend-invites/email-confirmation`). Também conta como confirmado: login social, conta de cliente confirmada, "esqueci a senha" concluído pelo link e convite da equipe aceito pelo link.
41. ✅ **CPF repetido ainda passa no cadastro principal** (`UserService.createUser`): o convite da equipe passou a comparar por dígitos (`canonicalIdDoc` e `documentTaken`), mas o cadastro normal ainda compara o texto exato e grava como foi digitado. `123.456.789-01` e `12345678901` viram duas contas. **Fazer:** usar o mesmo `canonicalIdDoc` e a mesma busca por dígitos no cadastro, no cadastro em massa e na edição do perfil. **Feito:** cadastro, cadastro em massa e convite usam o mesmo `canonicalIdDoc` e a mesma busca por dígitos (`idDocTaken`, em `src/common/id-doc-lookup.ts`).
42. ✅ **Busca de documento no convite falha por país** (`EmployeeInviteService.documentTaken`):
    - Sem endereço no formulário, o país vem do cadastro da unidade e é comparado por igualdade com o país do endereço das contas. Se um lado tem "BR" e o outro "Brasil", não bate.
    - Conta sem endereço nunca é achada, porque o filtro de país corta o `LEFT JOIN`.
    - **Fazer:** normalizar o país para o código ISO dos dois lados e, sem país conhecido, comparar só o documento.
    - **Feito:** o país é comparado pelos nomes equivalentes ("BR", "Brasil", "Brazil"), e conta sem endereço também é encontrada.
43. ✅ **Links de gerenciar criados sem a versão do agendamento:** `getClientUpcomingAppointments` (`barbershop.service.ts`) e o link "pagar o sinal" (`deposit-payment.service.ts`) usam a versão 0. A equipe pode reativar um agendamento cancelado (de CANCELLED para CONFIRMED), e aí a versão já é maior que 0. O link em "Próximos horários" da conta do cliente e o de pagar o sinal dão "não encontrado". **Fazer:** passar `appt.linkVersion` em todo `createAppointmentToken` e `appointmentManageUrl`. **Feito:** a conta do cliente, o e-mail do sinal e a tela de confirmação do agendamento usam a versão atual do link.
44. ✅ **Cancelado pela unidade, o cliente perde a página do pagamento:** cancelar aumenta a versão do link, e o link que o cliente tinha (pagamento pelo app ou sinal) para de abrir. Ele não consegue ver que o valor foi estornado. O e-mail de cancelamento traz o link novo, mas quem está na página ou usa o e-mail anterior fica sem nada. **Fazer:** deixar a versão anterior abrir só para leitura (status e estorno), sem chat nem ações, ou mandar sempre o link novo junto com o aviso de estorno. **Feito:** a versão imediatamente anterior abre a página e mostra o status e o estorno. Não cancela, não remarca, não paga e não abre o chat. Uma versão mais antiga continua sem abrir.
45. ✅ **Token do Facebook depende do `JWT_SECRET`** (`social.service.ts`): sem `SOCIAL_TOKEN_KEY`, a chave de cifra sai do `JWT_SECRET`. Trocar o `JWT_SECRET` (por exemplo, para derrubar todas as sessões) faz os tokens guardados não abrirem mais, e todo post agendado falha. **Fazer:** exigir `SOCIAL_TOKEN_KEY` em produção (falhar ao subir sem ela) e tratar a falha de decifrar como "conecte de novo".

**Novos**
    - **Feito:** em produção, conectar exige `SOCIAL_TOKEN_KEY`. Tokens antigos, cifrados com o `JWT_SECRET`, ainda abrem e são cifrados de novo com a chave própria. Token que nenhuma chave abre faz o post falhar com "conecte a conta de novo", sem ficar tentando.
46. ✅ **Telefone sem padrão no agendamento público** (`createPublicAppointment` e `ensureNotBlocked`):
    - O telefone é comparado exatamente como foi digitado (a tela não tem máscara).
    - Cliente bloqueado pela unidade agenda de novo só trocando a formatação: `(11) 99999-0000` em vez de `11999990000`.
    - O mesmo cliente vira várias fichas, o que estraga histórico, "cliente novo", fidelidade e indicação.
    - **Fazer:** normalizar para E.164 (`normalizePhoneToE164`, já usado na importação) ao gravar e ao buscar, e migrar as fichas existentes, juntando as duplicadas com cuidado.
    - **Feito:** a ficha (e o bloqueio) é achada pelos dígitos do telefone, em qualquer formatação, no agendamento e na lista de espera online. Ficha nova grava o telefone no formato internacional. As fichas antigas duplicadas não foram juntadas (isso precisa de revisão manual).
47. ✅ **Avisos de atividade para freelancer com acesso vencido** (`ActivityNotificationsService.deliver`): os destinatários são filtrados só por `isActive`, sem olhar `accessStartsAt`/`accessEndsAt`. Freelancer com vínculo vencido continua recebendo no sininho e por e-mail os agendamentos, vendas e nomes de clientes. **Fazer:** usar o mesmo filtro de período de acesso que `barbershop.service.ts` já usa nas outras consultas. **Feito:** os avisos usam `currentEngagement()`, o mesmo filtro de período de acesso do resto da unidade.
### Sexta rodada (2026-10-11): requisitos conferidos contra o código

Conferidos e certos: preços padrão (Pro R$ 39,90, Destaque R$ 49,90 e R$ 24,90, taxa da vaga R$ 14,90, 15% só no Stripe), cota grátis (30 atendimentos e 30 produtos), prazos de guarda (1 ano do histórico do negócio, 2 anos do registro da equipe da plataforma) e o consentimento para dado de saúde.

48. ✅ **A nota do cliente vaza entre negócios** (`CustomerRatingService.conductOf`): a decisão jurídica diz que a nota "fica só dentro do negócio que avaliou". Mas, quando a ficha tem conta de cliente, a média junta as fichas de **todas as redes** (`customer.findMany({ clientAccountId })`), com notas, faltas e comparecimento de outros negócios. **Fazer:** limitar ao `networkId` da unidade que consulta (a visão do próprio cliente, `myConduct`, pode continuar juntando). **Feito:** a equipe vê só as notas, faltas e comparecimento das fichas da própria rede. O cliente, na conta dele, continua vendo tudo junto.
49. ✅ **Apagar a ficha do cliente apaga histórico financeiro e avaliações** (`BarbershopService.deleteCustomer`):
    - O `customer.delete` leva em cascata os agendamentos e, com eles, as avaliações do profissional (`ProfessionalReview`), as caixinhas (`AppointmentTip`), as taxas de falta, os pacotes comprados e os dados do sinal e do pagamento pelo app.
    - Isso contraria duas decisões: "a avaliação continua (sem o nome); a unidade não some com avaliação ruim apagando o cliente" e "registros financeiros ficam 5 anos". Na prática, o gerente apaga uma avaliação ruim do profissional apagando o cliente.
    - **Fazer:** anonimizar a ficha (nome, telefone, e-mail, observações e ficha técnica) em vez de apagar, ou trocar as relações de agendamento, caixinha, avaliação e pacote para `SetNull`/`Restrict`. Teste cobrindo que a avaliação e a caixinha continuam.
    - **Feito:** apagar a ficha agora anonimiza: saem nome, telefone, e-mail, observações, ficha técnica e lista de espera, e a ficha some das listas (`Customer.deletedAt`). Ficam atendimentos, caixinhas, pagamentos e avaliações. Com horário marcado pela frente, pede para cancelar antes.
50. ✅ **Atendimento a domicílio já está no ar** (`profile-privacy.ts`, `career.service.ts`, busca): a decisão é "fora do piloto, até os termos específicos (responsabilidade, segurança, botão de ajuda)". Hoje o profissional verificado liga "Atendo a domicílio" e o selo aparece no perfil público e na busca. **Fazer:** uma chave de liberação (variável de ambiente ou item do backoffice), desligada por padrão, que esconde a opção e o selo. **Feito:** a chave `HOME_SERVICE_ENABLED` começa desligada. Desligada, a opção some do perfil, o back recusa ligá-la e o selo não aparece na página nem na busca.
51. ✅ **Taxa do cliente novo do marketplace não existe em Preços e taxas** (`src/pricing/pricing.ts`): a decisão pede "mais um item em Preços e taxas (padrão 0 até ligar)": 10% do primeiro atendimento concluído vindo da vitrine, com teto de R$ 10. Não há o item nem o cálculo, embora a origem do agendamento (vitrine × link) e o "cliente novo" já existam. **Fazer:** criar o item com padrão 0 agora (para o backoffice mostrar) e o cálculo depois do piloto. **Feito:** `newClientFeePercent` (padrão 0) e `newClientFeeCapCents` (padrão R$ 10) entraram em Preços e taxas e no GraphQL. O cálculo da cobrança fica para depois do piloto.
52. ✅ **Taxa da vaga aceita valores que a Stripe recusa** (`PRICING_LIMITS.jobFillFeeCents`): o limite é `min: 0`, mas o comentário diz "acima de zero, no mínimo R$ 1,00". O admin consegue salvar 1 a 99 centavos, e a cobrança falha na Stripe. **Fazer:** aceitar 0 (desligado) ou valor de 100 para cima. **Feito:** a taxa da vaga aceita 0 ou a partir de 100 centavos, tanto ao salvar quanto ao carregar.

### Sétima rodada (2026-10-11)

53. ✅ **A venda aceitava qualquer total vindo da tela** (`BarbershopService.createSale`): o back conferia só se os itens eram da unidade. Dava pra lançar R$ 100 em itens com total de R$ 1, e o caixa, os relatórios, a comissão e os pontos ficavam cada um com um número. **Feito:** `checkSaleConsistency` confere item = quantidade × preço, subtotal = soma dos itens e total = subtotal − desconto + imposto (mínimo 0), com tolerância de 1 centavo. Vale na criação e na edição que manda um total novo.
54. ✅ **Configuração de e-mail desencontrada do código** (`app.module.ts`, `mailgun.service.ts`): a validação exigia `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS` e `MAILGUN_FROM`, que não são usadas, e não exigia `MAILGUN_API_KEY`. O endereço da API era fixo na região dos EUA. **Feito:** são obrigatórias só `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` e `EMAIL_FROM`. `MAILGUN_URL` (opcional) atende domínio na região EU. O `.env.example` explica cada uma.
55. ✅ **Assinaturas na conta do cliente sempre em reais:** a tela usava `'BRL'` fixo. **Feito:** `ClientSubscriptionType.currency` traz a moeda da unidade, e a tela usa ela.
56. ✅ **A agenda da equipe usa o fuso do navegador, não o da unidade** (front: `Appointments.tsx`, `QuickAppointmentModal.tsx`, `TimeOffDialog.tsx`, `Barbers.tsx` e o calendário): o calendário mostra e grava os horários na hora do navegador. Se o gerente está num fuso diferente do da unidade (dono em SP cuidando de unidade em Manaus, unidade no México, viagem), os horários ficam deslocados em relação ao horário de funcionamento e aos e-mails do cliente. A página pública já usa o fuso da unidade. **Fazer:** o calendário com `timeZone` da unidade (FullCalendar + plugin de fuso) e todo `new Date(\`${data}T${hora}\`)` da equipe convertido com o fuso da unidade. **Feito** (front #128): em vez do plugin de fuso, a tela usa "datas de relógio" (`src/utils/shopClock.ts`): o que vem do servidor vira a hora da unidade e o que vai pro servidor volta a instante real. Isso vale pra agenda (eventos, folgas, agora, arrastar/editar, novo agendamento e série), o agendamento rápido, as folgas e o acesso temporário. A lista de espera da equipe grava o dia como meia-noite UTC, igual à página pública. Fica de fora a agenda da franquia (várias unidades, que podem ter fusos diferentes), que continua no fuso do navegador.

### Oitava rodada (2026-10-11)

57. ✅ **Moedas sem centavos cobram 100 vezes o valor** (`deposit-payment.service.ts`, `prepayment.service.ts`, `tip.service.ts`, `chair-rent.service.ts`, `app-payments.service.ts`): todo valor vai pra Stripe como `Math.round(valor * 100)` e volta como `amount / 100`. A moeda da unidade vem do país no cadastro (`countries.ts`), então Japão (JPY), Coreia (KRW), Chile (CLP), Paraguai (PYG) e Vietnã (VND) entram. Nessas moedas a Stripe não usa centavos: um sinal de ¥1.000 vira cobrança de ¥100.000. Também afeta a taxa da plataforma, os estornos e a leitura do valor pago. Os limites da caixinha pelo app (1 a 500) também não fazem sentido em ienes ou wons. **Fazer:** uma função `toMinorUnits(valor, moeda)` / `fromMinorUnits` com a lista de moedas sem centavos da Stripe, usada em todos esses pontos, e limites da caixinha por moeda. **Feito:** `src/common/money-units.ts` (`toMinorUnits`/`fromMinorUnits`, com a lista de moedas sem centavos da Stripe) em sinal, pagamento pelo app, caixinha, aluguel da cadeira (preço, fatura), estorno parcial e na leitura dos estornos feitos na Stripe (pela moeda da cobrança). A caixinha pelo app tem limite por moeda (`appTipLimits`: ¥100 a ¥50.000, ₩1.000 a ₩500.000 etc.). Moedas de 3 casas (BHD, KWD...) ficam de fora.
58. ✅ **O profissional apaga caixinha registrada pela recepção** (`TipService.remove`): quem atendeu pode apagar qualquer caixinha do atendimento, inclusive a da unidade e a recebida pela unidade. Na unidade em que só a recepção registra essas (`staffRecordsUnitTips` desligado), o `add` bloqueia o profissional, mas o `remove` não. **Fazer:** a mesma regra do `add` no `remove`. O profissional só apaga a caixinha que ele mesmo registrou e que não seja recebida pela unidade quando ela exige a recepção. **Feito:** o `remove` segue a regra do `add`: fora da recepção, a pessoa só apaga a caixinha que ela mesma registrou, nunca a da unidade nem a recebida pela unidade quando só a recepção registra.
59. ✅ **Cliente excluído ainda recebe agendamento e venda** (`BarbershopService.ensureCustomerOfNetwork`): depois da exclusão (anonimização com `deletedAt`, item 40), a ficha some das listas, mas a checagem usada por `createAppointment`, `updateAppointment`, vendas, lista de espera e atendimento sem hora não filtra `deletedAt: null`. Com o id (agenda antiga, aba aberta, API), dá pra marcar e vender pra ficha anonimizada. **Fazer:** `deletedAt: null` na checagem. **Feito:** `ensureCustomerOfNetwork` filtra `deletedAt: null`.
60. ✅ **A equipe agenda com profissional desligado** (`BarbershopService.ensureBarberOfBarbershop`, `ensureBarberAvailable`): a checagem usa `BOOKABLE_STAFF`, que olha só se a pessoa atende, não se está ativa. `withinEngagement` olha só as datas do vínculo. Pela agenda (ou pela API), dá pra marcar ou mover horário pra quem foi desligado (`isActive: false`). A remarcação pelo link do cliente já exige `isActive: true`. **Fazer:** exigir `isActive: true` ao criar e ao trocar o profissional (`createAppointment`, `updateAppointment`, série). **Feito:** agendar ou trocar o profissional exige `isActive: true` (`ensureBarberOfBarbershop` com `active`). Mover o horário sem trocar quem atende continua livre.
61. ✅ **Agendamento da equipe sem conferir início e fim** (`BarbershopService.createAppointment`): `updateAppointment` recusa fim antes do início, mas `createAppointment` não confere nada. Com fim antes do início, a checagem de conflito (`startAt < endAt` e `endAt > startAt`) nunca bate e o horário passa por cima de outro. Data inválida (`new Date('abc')`) vira erro 500 do Prisma. **Fazer:** recusar data inválida e `endAt <= startAt`, como no `updateAppointment`. **Feito:** `createAppointment` recusa data inválida e fim igual ou antes do início.
62. ✅ **A origem `HISTORY` fura a cota do plano solo** (`createAppointment` + `solo.ts`): o `source` vem livre da tela. Com `source: 'HISTORY'`, o agendamento pula `assertSoloBookingAllowed` e também não conta no uso do mês (`completedInRange` ignora `HISTORY`). Quem está no solo grátis marca tudo como histórico e atende sem limite. Também dá pra gravar `ONLINE` e misturar com a métrica da vitrine. **Fazer:** a mutation da equipe aceita só as origens da equipe (`PHONE`, `WALK_IN` etc.). `HISTORY` e `IMPORT` só pela importação, e `ONLINE` só pela página pública. **Feito:** a mutation da equipe aceita só `PHONE` e `WALK_IN` (`assertStaffAppointmentSource`). `HISTORY`/`IMPORT` continuam só pela importação.
63. ✅ **Vaga de freelancer começa "amanhã" à noite** (front: `Jobs.tsx`): `today()` usa `new Date().toISOString().slice(0, 10)`, que é o dia em UTC. No Brasil, depois das 21h já é o dia seguinte. A data inicial e o mínimo do campo pulam o dia de hoje, e não dá pra abrir vaga pra hoje à noite. **Fazer:** o dia de hoje no fuso da unidade (`shopClockNow`). **Feito:** `today()` usa o relógio da unidade (`shopClockNow` com o fuso dela).
64. ✅ **Caixinha estornada continua aparecendo como dada** (`TipService.list`, `TipService.appTipOptions`): o estorno pelo Financeiro ou pela Stripe grava `refundedAt`, mas a lista da equipe e a página do link ("você já deu") não olham esse campo. A caixinha devolvida aparece como recebida. **Fazer:** mostrar como estornada na lista da equipe e tirar de "já deu" na página do cliente. **Feito:** a caixinha estornada sai de "já deu" na página do link e a lista da equipe traz `refunded` e a tela mostra o selo "Estornada".

### Nona rodada (2026-10-11): vendas e caixa

65. ✅ **Venda paga depois cai no caixa errado** (`createSale`, `updateSale`, `closeCashSession`): a venda guarda o caixa aberto na hora em que é criada, mesmo pendente. O fechamento soma só as vendas `PAID` em dinheiro daquele caixa. Venda lançada pendente e paga em dinheiro num caixa seguinte (ou criada sem caixa aberto) nunca entra na conta do caixa onde o dinheiro entrou, e a gaveta "sobra". Venda pendente num caixa e paga depois que ele fechou também não entra em nenhum. **Fazer:** ligar a venda ao caixa no momento em que ela vira paga em dinheiro (na criação já paga, ou no `updateSale` que muda pra `PAID`/`CASH`). **Feito:** a venda pendente não entra em caixa; vai pro caixa aberto quando vira paga (na criação ou no `updateSale`).
66. ✅ **Venda e despesa mudam depois do caixa fechado** (`updateSale`, `deleteSale`, `deleteExpense`): dá pra editar valor, forma ou situação, ou apagar venda ou despesa de um caixa já fechado. O fechamento gravado (esperado e diferença) deixa de bater com o que está nele. Pagamento da equipe e aluguel da cadeira já recusam isso ("o caixa já foi fechado"), mas venda e despesa não. `deleteExpense` também apaga a despesa de um vale, de um pagamento da equipe ou do aluguel da cadeira, e o lançamento continua apontando pra ela. **Fazer:** a mesma trava do caixa fechado em venda e despesa. Despesa criada por vale, pagamento ou aluguel só sai desfazendo pela tela de origem. **Feito:** venda de caixa fechado não muda situação, forma, itens, desconto nem acréscimo, e não se apaga (`saleMoneyChanged`). Despesa de caixa fechado não se apaga, nem a que veio de vale, pagamento da equipe ou aluguel da cadeira (desfaz pela tela de origem).
67. ✅ **Caixinha em dinheiro recebida no balcão não entra no caixa** (`TipService.add`, `closeCashSession`): a caixinha do profissional recebida pela unidade em dinheiro vira lançamento `TIP` no pagamento dele, sem caixa. O fechamento não soma caixinha, então a gaveta sobra no dia em que ela entra. Quando o pagamento da equipe sai em dinheiro (com a caixinha dentro), a gaveta falta. **Fazer:** a caixinha em dinheiro recebida no balcão entra no caixa aberto, e o fechamento soma ela. **Feito:** a caixinha em dinheiro que fica na gaveta (a da unidade e a do profissional deixada no balcão) entra no caixa aberto (`AppointmentTip.cashSessionId`), o fechamento soma ela, e a de caixa fechado não se apaga.
68. ✅ **Pacote e cartão-presente vendidos não viram receita** (`purchaseClientPackage`, `createGiftCard`): "Vender pacote" só cria as sessões do cliente, e criar cartão-presente só cria o saldo. Nenhum dos dois lança venda, entra no caixa ou aparece no faturamento. E qualquer barbeiro (nível padrão) dá um pacote de graça pra quem quiser. **Fazer:** a venda do pacote e do cartão gera uma venda (com forma de pagamento e caixa), e vender pacote fica da recepção pra cima. **Feito:** vender pacote (da recepção pra cima) e cartão-presente (com `barbershopId` da unidade que vendeu) lança uma venda `PACKAGE`/`GIFT_CARD`: com a forma de pagamento já sai paga e no caixa aberto; sem ela fica pendente pra receber pela tela de vendas. A tela manda a forma de pagamento (ou "receber depois") e, no cartão-presente, a unidade que vendeu.
69. ✅ **Baixa de estoque perde vendas simultâneas** (`createSale`): a venda lê a quantidade do produto e grava `antes - vendido` como valor absoluto. Duas vendas do mesmo produto ao mesmo tempo leem o mesmo saldo, e uma baixa some (o estoque fica maior do que é). **Fazer:** `quantity: { decrement }` (como o `deleteSale` já faz pra devolver) e o "antes/depois" do movimento a partir do valor que voltou. **Feito:** baixa e ajuste de estoque com `increment` no banco (`moveStock`), e o antes/depois do movimento sai do valor que voltou.

### Décima rodada (2026-10-11)

70. ✅ **Lembrete some quando o horário é remarcado no mesmo dia** (`AppointmentReminderService.enqueueDueReminders`, `notification-queue.service.ts`): a remarcação zera `reminderSentAt`, e o lembrete novo vai pra fila com o mesmo `jobId` (`appointment-reminder-email-${id}` e `-whatsapp-${id}`). A fila guarda o trabalho concluído por 24 h (`removeOnComplete: { age: 24h }`), e a BullMQ ignora um `jobId` que já existe. Se o lembrete do horário antigo saiu há menos de 24 h, o do horário novo é descartado em silêncio, mas o agendamento fica marcado como lembrado. O e-mail de cancelamento (`appointment-cancelled-${id}`) tem o mesmo problema: cancelado, reativado e cancelado de novo no mesmo dia, o segundo aviso não sai. **Fazer:** pôr o horário no `jobId` (como `appointment-rescheduled-${id}-${startAt}` já faz) e a versão do link no do cancelamento. **Feito:** o `jobId` dos lembretes leva o horário (`startAt`) e o do cancelamento leva o `updatedAt`.
71. ✅ **Freelancer fura o limite de vagas do plano** (`updateBarber`, `countPlanSeats`): quem tem vínculo encerrado (`accessEndsAt` no passado) não ocupa vaga. Mas estender o fim do vínculo pela edição não passa por `ensureSeatFor`, que só roda quando muda `isActive` ou quem atende. Assim dá pra cadastrar alguém, deixar o vínculo vencer, preencher a vaga e estender o anterior. **Fazer:** conferir a vaga também quando o fim do vínculo é estendido e ele volta a valer. **Feito:** estender o fim do vínculo vencido (voltando a valer) confere a vaga do plano.
72. ✅ **Desligar pela edição pula o aviso dos horários e o convite pendente** (`updateBarber` com `isActive: false`): o formulário de edição da equipe tem a caixa "Ativo" (`Barbers.tsx`). Desmarcada, ela desliga a pessoa pelo `updateBarber`, que não cancela o convite pendente e não avisa dono e gerente dos horários marcados com ela. O `deleteBarber` faz as duas coisas. **Fazer:** `isActive: false` no `updateBarber` passa pelo mesmo caminho do `deleteBarber`. **Feito:** `updateBarber` com `isActive: false` (de ativo pra inativo) cancela o convite pendente e avisa dono e gerente dos horários marcados, como o `deleteBarber`.
73. ✅ **Faturamento conta a venda no dia em que foi lançada, não no dia em que foi paga** (`dashboardPulse`, `getNetworkDashboardStats`, `getFinancialSummary`, comissões): os totais filtram `paymentStatus: 'PAID'` por `createdAt`. Venda lançada pendente ontem e paga hoje entra no faturamento de ontem (ou do mês passado), e o "hoje" do painel não mostra o que entrou hoje. O aluguel da cadeira já usa `paidAt`. **Fazer:** filtrar as vendas pagas por `paidAt`, com `createdAt` só onde `paidAt` está vazio (vendas antigas). **Feito:** as vendas pagas entram pelo `paidAt` (e pelo `createdAt` só quando `paidAt` está vazio) no painel, na rede, no financeiro, nos relatórios e no pagamento da equipe (`paidInRange`).
74. ✅ **Conversas mostram o horário no fuso de quem olha** (front: `ClientMessages.tsx`, `Messages.tsx`): a lista de conversas mostra a data do atendimento com `toLocaleString` sem `timeZone`. Cliente ou equipe em outro fuso (ou com o relógio do celular em UTC) vê o horário deslocado em relação ao da unidade. As outras telas do cliente já usam o fuso da unidade. **Fazer:** mandar o `timezone` da unidade junto e formatar com ele. **Feito:** a caixa de entrada das conversas traz o `timezone` da unidade e a data sai nele (`formatShopDateTime`).

### Décima primeira rodada (2026-10-11): interface

Achados abrindo o app com o seed de demonstração. Todas as telas foram visitadas como dono, gerente, recepção, barbeiro e barbeiro básico, mais as páginas públicas. Nenhuma tela deu erro de execução ou de GraphQL. Os problemas são de layout no celular (375 px), de acessibilidade e de idioma.

75. ✅ **Botão "Novo agendamento" sai da tela no celular** (front: visão geral, `FranchiseDashboard.tsx`): a fileira "Calendário / Vender produto / Novo agendamento" não quebra linha. O último botão fica cortado e a página inteira rola de lado (16 px). **Fazer:** `flex-wrap` na fileira, ou os botões em coluna no celular. **Feito:** a fileira de botões quebra linha (`wrap`).
76. ✅ **Tabelas de Pacotes e Assinaturas cortadas no celular** (front: `Packages.tsx`, `Subscriptions.tsx`): a tabela não está dentro de um contêiner com rolagem lateral, como a da lista de espera (`overflow-x-auto`). As colunas Status e ações (editar, desativar) ficam fora da tela, e a página inteira rola de lado (até 556 px em 375). **Fazer:** envolver as tabelas em `overflow-x-auto`, ou trocar por cartões no celular. **Feito:** as tabelas ficam num contêiner `overflow-x-auto` e rolam de lado.
77. ✅ **Botão "Adicionar à lista" cortado na lista de espera** (front: `Waitlist.tsx`): fica ao lado do filtro de situação, na mesma linha sem quebra, e passa 49 px da tela. **Fazer:** quebrar a linha no celular. **Feito:** o filtro e o botão quebram linha.
78. ✅ **Última aba do menu da conta some no celular** (front: `AccountSettingsLayout.tsx`): a barra inferior tem 8 abas (Meu perfil, Notificações, Redefinir senha, Segurança, Privacidade, Carreira, Vagas, Solo) com `flex-1` e sem rolagem. A aba "Solo" fica cortada pela borda e não dá pra tocar. **Fazer:** rolagem lateral na barra, ou um menu "Mais" como o da unidade. **Feito:** a barra rola de lado (72 px mínimo por aba), com `aria-current` na aba ativa.
79. ✅ **Botões só com ícone sem nome pra leitor de tela** (front: `NotificationsDropdown.tsx`, menus "⋯" das linhas em clientes, vendas, equipe e serviços, lixeira da despesa no caixa, tema e idioma no login): o botão não tem texto nem `aria-label`. Leitor de tela lê só "botão", e o teste automático não consegue achar pelo nome. O sino aparece em todas as telas logadas. **Fazer:** `aria-label` traduzido em cada um. **Feito:** `aria-label` no sino, nos menus "⋯", nas lixeiras e nos botões de tema e idioma.
80. ✅ **"Agendar agora" esconde o título dos serviços atrás da barra fixa** (front: `ServicesSection.tsx`): o botão rola até `#services`, mas a seção não tem `scroll-mt`, e o título "Serviços" fica embaixo da barra do topo. A seção de avaliações já tem `scroll-mt-20`. **Fazer:** `scroll-mt-20` em `#services`. **Feito:** `scroll-mt-20` em `#services`.
81. ✅ **Erro do servidor aparece em português pra quem usa inglês ou espanhol** (back: mensagens das exceções; front: os `toast.error(e.graphQLErrors[0].message)`): as mensagens de `BadRequestException`/`ForbiddenException` são escritas em português, e o front mostra o texto como veio. Quem usa o app em inglês ou espanhol vê "Este profissional já tem um agendamento nesse horário" no meio da tela traduzida. **Fazer:** o back manda um código junto (`extensions.code`, ex.: `BARBER_BUSY`), e o front traduz pelo código, com o texto do back só como reserva. **Feito:** o back manda `extensions.reason` (código estável, ex.: `BARBER_BUSY`) junto do `code` de sempre (que continua sendo a categoria, FORBIDDEN etc., já usada pelo front), a partir do catálogo `src/common/error-reasons.ts` (~390 mensagens). O front traduz pelo código num ponto só (link de erro do Apollo, chaves `apiErrors.*` em pt/en/es), com o texto do back como reserva; as telas que comparavam o texto (login, excluir conta, cartão) passaram a comparar o código. Um teste garante que toda mensagem do catálogo ainda existe no código. Mensagens montadas com variáveis seguem sem código.
82. ✅ **"Perfil não encontrado" sem saída** (front: `/p/:slug` com slug que não existe): a página mostra só o título, sem cabeçalho, sem link pra busca e sem botão de voltar. Quem cai num link velho fica sem caminho. **Fazer:** a mesma página de "não encontrado" do resto do app, com link pra busca. **Feito:** a página mostra o texto de "não encontrado" e os botões "Buscar um negócio" e "Entrar na área do cliente" (`WayOutLinks`).

### Décima segunda rodada (2026-10-11): planos e assinaturas

83. ✅ **Trocar de plano muda o limite na hora, mas o preço só na renovação** (`PaymentsService.changePlan`): o `planId` muda na hora (vagas, unidades e módulos do plano novo), mas a Stripe recebe `proration_behavior: 'none'` e o preço novo só vale no próximo vencimento. Dá pra subir de plano, usar o maior o mês inteiro e voltar pro menor na véspera da renovação sem nunca pagar a diferença. No caminho contrário, descer de plano não confere se a unidade já usa mais vagas ou unidades do que o plano novo permite. **Fazer:** subir de plano cobra a diferença proporcional na hora (`proration_behavior: 'always_invoice'`) antes de liberar o limite. Descer agenda a troca pra renovação (o limite atual vale até lá) e recusa se o uso passa do novo limite. **Feito:** subir de plano cobra na hora a diferença proporcional ao que falta do período (no cartão salvo; mensal → anual cobra o anual menos o crédito e o período recomeça) e só então libera o limite. Na assinatura antiga da Stripe, `always_invoice` + `error_if_incomplete`. Descer (e anual → mensal) confere o uso de hoje (`assertUsageFitsPlan`: unidades e vagas) e fica agendado em `pendingPlanId`, que entra na renovação (ou na fatura `subscription_cycle` da Stripe). Escolher o plano atual desfaz o agendamento. A tela diz "diferença cobrada" ou "troca agendada para {data}" e mostra o plano agendado.
84. ✅ **Cancelar o plano corta na hora o mês já pago** (`plan.resolver.ts cancelSubscription`, `PaymentsService.unsubscribe`): os dois caminhos cancelam na Stripe na hora (`subscriptions.cancel`) e marcam a assinatura `INACTIVE`. Como os limites da unidade vêm da assinatura `ACTIVE` (`getBarbershopPlan`), o dono cai pro plano grátis no mesmo minuto, com dias já pagos sobrando. Os dois caminhos também divergem. A mutation usada pela tela (`cancelSubscription`) não volta `membership` pra `FREE`. O `unsubscribe` (backoffice) engole o erro da Stripe e marca cancelado no banco mesmo se a Stripe continuar cobrando. **Fazer:** um caminho só, com `cancel_at_period_end: true`, a assinatura ativa até `current_period_end`, e só marcar cancelado quando a Stripe confirmar (`customer.subscription.deleted`). **Feito:** um caminho só (`PaymentsService.unsubscribe`, usado pela tela e pelo backoffice): marca `cancelAtPeriodEnd`, o plano vale até `currentPeriodEnd` e a renovação volta pro gratuito sem cobrar. Na assinatura antiga da Stripe, `cancel_at_period_end: true`, e erro da Stripe não marca nada; o fim vem pelo `customer.subscription.deleted`. Os campos `currentPeriodEnd`, `cancelAtPeriodEnd` e `pendingPlanId` saem no GraphQL, e a tela mostra "cancelado, vale até {data}" (o botão de cancelar some).
85. ✅ **Links fixos de outro domínio nos e-mails** (`payments.service.ts`, `users.service.ts`): `ReactivateURL: 'https://app.barbershop.com/plans'` e `LoginURL: 'https://app.barbershop.com/login'` estão escritos no código, em vez de `FRONTEND_URL`. O link "reativar plano" do e-mail de cancelamento e o "entrar" de dois e-mails de conta levam pra um domínio que não é o do app. **Fazer:** montar com `FRONTEND_URL` (como `appointmentManageUrl`), e o e-mail de suporte vir de configuração. **Feito:** links montados com `appUrl()` (de `FRONTEND_URL`) e e-mail de suporte com `supportEmail()` (`SUPPORT_EMAIL`), em `src/common/app-urls.ts`.
86. ✅ **Assinatura do cliente ainda cobra 100 vezes em moeda sem centavos** (`createSubscriptionPlan`, `updateSubscriptionPlan`, `stripe.controller.ts handleClientSubscriptionInvoiceSucceeded`): ficou de fora do item 57. O preço do plano de assinatura do cliente vai pra Stripe como `Math.round(price * 100)` na moeda da unidade, e o pagamento é gravado como `amount_paid / 100`. Unidade em ienes, wons ou pesos chilenos cria um "corte ilimitado" 100 vezes mais caro. **Fazer:** `toMinorUnits`/`fromMinorUnits` (de `src/common/money-units.ts`) nos três pontos. **Feito:** `toMinorUnits`/`fromMinorUnits` no preço do plano e nos três pontos do webhook.

### Décima terceira rodada (2026-10-12): backoffice e estornos

87. ✅ **Trocar o plano pelo backoffice muda só o banco** (backoffice-back: `admin-writes.ts changeUserPlan`, `users-writes.ts bulk` com `changePlan`): o `planId` da assinatura muda no banco, mas a assinatura da Stripe (`stripeSubscriptionId`) continua no preço antigo. Quem foi rebaixado pelo backoffice continua pagando o plano maior, e quem foi promovido continua pagando o menor. **Fazer:** com `stripeSubscriptionId`, trocar o item na Stripe (como `PaymentsService.changePlan`) por um comando pro back. Sem ela, só o banco, como hoje. **Feito:** trocar o plano pelo backoffice (um a um ou em lote) tira o plano menor agendado e manda o comando `plan.sync_stripe`; o back passa a assinatura antiga da Stripe pro preço do plano novo, sem cobrar diferença (`PaymentsService.syncStripePlanPrice`).
88. ✅ **Trocar o e-mail pelo backoffice mantém o e-mail como confirmado** (backoffice-back: `users-writes.ts update`): o e-mail novo é gravado sem limpar `emailVerifiedAt`, sem passar pra minúsculas e sem derrubar as sessões. O e-mail confirmado é o que liga a conta à área do cliente com o mesmo e-mail (conta única, H3) e vale pro convite de amigo (item 40). Um e-mail digitado errado pelo suporte passa a valer como confirmado. **Fazer:** e-mail novo em minúsculas, `emailVerifiedAt = NULL` e as sessões derrubadas, e a pessoa confirma o e-mail novo. **Feito:** e-mail novo em minúsculas, `emailVerifiedAt = NULL` e as sessões (e o push) derrubadas. O mesmo e-mail com outra caixa não mexe em nada. A pessoa confirma o e-mail novo (redefinir a senha confirma).
89. ✅ **Compra da plataforma estornada na Stripe continua valendo** (`stripe.controller.ts` `charge.refunded` → `AppPaymentsService.syncStripeRefund`): o estorno feito no painel da Stripe (ou disputa perdida) só é sincronizado pra sinal, atendimento pago pelo app e caixinha. A compra de Destaque (`FeaturedPurchase`) continua `paid` e os dias de destaque continuam valendo. A taxa da vaga de freelancer paga e estornada também continua contando como paga. **Fazer:** tratar `featured_purchase` e a taxa da vaga no `charge.refunded`: marcar estornado e tirar os dias (ou avisar o Financeiro, se já passaram). **Feito:** `charge.refunded` total (e disputa perdida) chama `revokePlatformPurchase`: a compra de Destaque vira `refunded` e tira os dias que tinha somado (termina agora, no máximo), e a taxa da vaga deixa de contar como paga. O pagamento repetido não volta a valer.

### Décima quarta rodada (2026-10-12): backoffice (app e API)

90. ✅ **Planilha exportada pelo backoffice pode virar fórmula no Excel** (barbershop-backoffice: `ManageUsers.tsx exportToCSV`, `GeographicDemographicAnalysis.tsx exportToCSV`): nome e e-mail vêm do cadastro feito pela própria pessoa e vão pra planilha como estão. Um nome como `=HYPERLINK("http://…";"clique")` vira fórmula ao abrir no Excel ou no Google Planilhas da equipe (injeção de CSV). Na análise geográfica, as aspas nem são escapadas: um nome com `"` desalinha as colunas, e campo vazio sai como `null`/`undefined`. Os dois arquivos saem sem BOM, então o Excel mostra acentos quebrados. **Fazer:** uma função só pra célula de CSV: escapar aspas, prefixar `'` quando começa com `= + - @` (ou tab/CR), vazio pra nulo. E `﻿` no começo do arquivo. **Feito:** `src/utils/csv.ts` no app do backoffice: aspas escapadas, `'` antes de `= + - @`/tab/CR, vazio pra nulo e BOM. As duas exportações usam.
91. ✅ **Exportar usuários corta em 1.000 sem avisar** (barbershop-backoffice: `ManageUsers.tsx`; análise geográfica): a exportação busca de novo com `limit: 1000` e baixa o que voltou. Com mais de 1.000 contas no filtro, o arquivo vem incompleto, sem nenhum aviso. A análise geográfica exporta só a página carregada. **Fazer:** buscar página a página até o total (ou exportar no servidor), ou avisar quando cortar. **Feito:** as duas exportações buscam página por página (a API devolve no máximo 100 — o `limit: 1000` vinha com 100) até o total, com um teto de 20.000 que avisa quando corta. A análise geográfica exporta o filtro inteiro, não só a página.
92. ✅ **Link da notificação mandada pelo backoffice sem validação** (backoffice-back: `notify-writes.ts create/createMany/sendEmail`; front: `NotificationsDropdown.tsx openAction`): o `actionUrl` é gravado como veio. No app, o que não começa com `/` abre em `window.open`, inclusive `javascript:` e qualquer domínio de fora. Um aviso "oficial" da plataforma pode levar pra uma página falsa de login, e no e-mail o link sai do mesmo jeito. **Fazer:** aceitar só caminho interno (`/…`, sem `//`) ou `https://` de domínio da plataforma, no backoffice-back e de novo no front antes de abrir. **Feito:** o backoffice-back só aceita caminho do app (`/…`, sem `//`) ou `https://` do domínio em `APP_FRONTEND_URL` (aviso, aviso em lote e e-mail); o back confere de novo no e-mail (`safeAppLink`) e o app só abre link do próprio app (o botão some com outro).

### Décima quinta rodada (2026-10-12): interface, segunda passada

O app foi aberto com o seed de demonstração, em desktop (1366 px) e celular (375 px), como dono e como cliente final (área do cliente). Nenhum erro de execução. Os achados são de dado mostrado errado e de uso.

93. ✅ **Agenda abre de madrugada** (front: `Appointments.tsx`, `FranchiseAppointments.tsx` → `visibleHours`): a faixa de horas é alargada pra incluir "agora", mas `visibleHours` usa o `new Date()` do navegador (o item 56 converteu o resto da agenda, menos isto). Aberta cedo, a agenda começa às 04:00 com a unidade abrindo às 09:00, e o dia de trabalho fica lá embaixo. **Fazer:** passar `shopClockNow(tz)`, e só alargar pro "agora" quando ele estiver a até 2 h do expediente. **Feito:** `visibleHours` recebe o "agora" no relógio da unidade (na agenda da rede, quando as unidades na tela têm o mesmo fuso).
94. ✅ **Vendas e caixa com hora do navegador e com segundos** (front: `Sales.tsx`, `Cashier.tsx`): "11/10/2026, 23:17:20" na lista de vendas, "Caixa aberto desde 11/10/2026, 11:45:00", abertura e fechamento dos caixas. Usam `toLocaleString` sem o fuso da unidade (dono em outro fuso vê outra hora) e mostram os segundos. **Fazer:** formatar no fuso da unidade, sem segundos, com a mesma função em todas as listas (`formatShopDateTime`). **Feito:** `formatShopDateTime` (fuso da unidade, sem segundos) na lista de vendas, no caixa aberto e na abertura e no fechamento dos caixas.
95. ✅ **Relatório: as partes não fecham com o total** (front: `Reports.tsx`; back: relatório da unidade): no mês de demonstração, "Receita de serviços" R$ 7.015,00 + "Receita de produtos" R$ 1.398,30 = R$ 8.413,30, mas "Receita total" mostra R$ 8.321,11. As partes somam o valor dos itens (antes do desconto, sinal, cartão-presente e pontos), e o total soma o que foi cobrado. O dono não sabe qual vale. "Taxa de retenção 100,0%" aparece sem dizer como é calculada. **Fazer:** mostrar a diferença numa linha ("descontos e abatimentos") ou calcular as partes na mesma base, e um "?" com a definição de cada indicador. **Feito:** o relatório mostra a linha "Ajustes (descontos e abatimentos)" com a diferença entre o faturamento e a soma de serviços e produtos, e um "?" com a definição do faturamento, ticket médio, receitas, faltas, cancelamentos e retenção.
96. ✅ **Histórico do cliente mostra horários que ainda não aconteceram** (back: `ClientAuthService.getHistory`; front: `ClientAccount.tsx`): o histórico busca os agendamentos sem filtro de data. Os 4 próximos horários aparecem em "Próximos horários" e de novo no topo do "Histórico", com "Agendar de novo". O contador "Atendimentos 50" do topo soma agendamentos futuros e compras, enquanto "Sua nota como cliente" diz "30 atendimentos concluídos". **Fazer:** histórico só com o que já passou (`startAt < agora`) e o contador com os atendimentos concluídos. **Feito:** o histórico traz só agendamentos que já passaram (`startAt < agora`), e o contador "Atendimentos" conta os concluídos.
97. ✅ **Conta do cliente: o importante fica no fim** (front: `ClientAccount.tsx`): no celular, os próximos horários só aparecem depois de "Seus dados", "Contas conectadas", "Mensagens", "Favoritos" e "Profissionais favoritos", cerca de 1.500 px abaixo. O histórico lista todos os itens de uma vez (50 na demonstração, 7.500 px de página), e não há botão pra buscar um negócio ou agendar de novo fora de cada item. **Fazer:** próximos horários e mensagens primeiro; dados, contas conectadas e excluir conta numa seção "Conta" (ou abas). Histórico com "ver mais", e um "Agendar" no topo. **Feito:** próximos horários e mensagens no topo, depois histórico (10 por vez, com "ver mais"), assinaturas e favoritos; dados, contas conectadas, notificações e excluir conta na seção "Conta" no fim. Botão "Agendar" no topo, ao lado de Sair.
98. ✅ **Etiquetas do topo iguais e cartão sem sentido** (front: barra do topo e `Overview` da unidade): com unidade e rede de mesmo nome, o topo mostra duas etiquetas "Green Barbershop" (uma com tesoura, outra com prédio), sem dizer qual é a unidade e qual é a rede. Na visão geral de uma unidade, o cartão "Unidades: 1" é sempre 1. **Fazer:** rótulo "Unidade" / "Rede" nas etiquetas (ou dica ao passar o mouse), e trocar o cartão por um indicador da unidade (por exemplo, ocupação da agenda). **Feito:** as etiquetas do topo mostram "Unidade" e "Rede" (em telas médias pra cima), e na visão de uma unidade o cartão "Unidades" virou "Próximos horários".

### Décima sexta rodada (2026-10-12): fluxos completos

Testado de ponta a ponta no app com o seed de demonstração: agendamento pela página pública (celular), página do agendamento pelo link do e-mail, e as telas do profissional ("Meus ganhos", painel).

99. ✅ **Quem agenda perto do horário não consegue desfazer nem logo depois** (back: `loadManagedAppointment`; front: agendamento público e página do agendamento): a página pública aceita horário a qualquer distância, mas cancelar ou remarcar pelo link só vale até `lateCancellationWindowHours` antes (12 h na demonstração). Um cliente que marcou às 05:00 pra 10:45 do mesmo dia abriu o link segundos depois e já viu "Mudanças pelo link fecham 12h antes do horário. Ligue para o estabelecimento". O agendamento não avisa disso antes de confirmar. **Fazer:** aviso no passo de confirmar quando o horário já está dentro da janela, e um prazo de arrependimento (ex.: 15 min depois de agendar) em que o cancelamento pelo link vale sempre. **Feito:** 15 minutos de arrependimento depois de agendar (`BOOKING_GRACE_MINUTES`): cancelar ou remarcar pelo link vale mesmo dentro da janela (até o horário). O agendamento avisa antes de confirmar quando o horário já está dentro da janela.
100. ✅ **Datas da equipe no fuso do navegador, além das do item 94** (front: cerca de 40 chamadas a `toLocaleString`/`toLocaleDateString` sem `timeZone`, em 25 arquivos: `Payroll.tsx`, `MyPay.tsx`, `ClosuresDialog.tsx`, `History.tsx`, `Subscriptions.tsx`, `NoShowCharges.tsx`, `Customers.tsx`…): em "Meus ganhos" e no pagamento da equipe, o período pago aparece como "01/09/2026 – 01/10/2026" pra quem não está no fuso da unidade, mas o fim gravado é 30/09 23:59 na unidade. Parece que o dia 01/10 entrou em dois pagamentos. **Fazer:** junto com o item 94, uma função de data da unidade (`formatShopDate`, `formatShopDateTime`) e trocar as chamadas que mostram dado do negócio. Hora de mensagem e de notificação pode ficar no fuso de quem lê. **Feito:** `formatShopDate`/`formatShopDateTime` no pagamento da equipe, em "Meus ganhos", nos fechamentos, no Histórico, nas assinaturas, nas cobranças de falta e na ficha do cliente. Hora de mensagem, notificação e dados da conta da própria pessoa seguem no fuso de quem lê.
101. ✅ **"Você recebe por O maior entre fixo e comissão"** (front: `MyPay.tsx`, chave `payroll.howPaid` + o nome da forma de pagamento, nos três idiomas): a frase encaixa o nome da forma de pagamento, que começa com maiúscula ("Comissão", "O maior entre fixo e comissão"). **Fazer:** chaves próprias pra frase, uma por forma de pagamento. **Feito:** uma frase por forma de pagamento (`payroll.howPaidBy.*`, nos três idiomas).
102. ✅ **Página pública gera erro de login a cada visita anônima** (front: página da unidade): sem cliente logado, a página dispara consultas da área do cliente e recebe três erros de GraphQL ("No authentication token found", duas vezes "Cliente não autenticado."). Não aparece pra quem visita, mas enche o console e o Sentry, e cada visita gasta três consultas à toa. **Fazer:** só consultar os dados do cliente quando houver sessão de cliente (`skip`). **Feito:** duas consultas que respondem null sem sessão, em vez de erro: `currentUser` (checagem de sessão da equipe, `@OptionalAuth`) e `clientSession` (`OptionalClientJwtAuthGuard`). A página pública e o cadastro abrem sem nenhum erro de GraphQL (conferido no navegador).
103. ✅ **Abas da conversa estouram o cartão no celular** (front: página do agendamento, abas "Com <unidade>" / "Com <profissional>"): com nome um pouco maior, a segunda aba passa da borda do cartão em 375 px. **Fazer:** abas que quebram linha ou rolam de lado, com o nome cortado por reticências. **Feito:** as abas ocupam a largura do cartão e cortam o nome com reticências.
104. ✅ **Link inválido é beco sem saída** (front: página do agendamento e página de avaliação): com link vencido, adulterado ou de agendamento apagado, a página mostra só "Este link é inválido…", sem cabeçalho e sem nenhum caminho. Quem cai num e-mail antigo não tem como chegar à unidade, à busca ou à área do cliente. **Fazer:** links pra "Buscar um negócio" e "Entrar na minha conta" (onde os próximos horários estão), na mesma linha do item 82. **Feito:** o link inválido (agendamento e avaliação) mostra os mesmos botões de saída (`WayOutLinks`).

### Décima sétima rodada (2026-10-12): cadastro do dono

O cadastro "Tenho um estabelecimento" foi percorrido no celular (375 px), passo a passo, até o último botão (o captcha não carrega no ambiente de teste).

105. ✅ **O estado não aparece pela sigla** (front: autocomplete de estado no cadastro, `personal-info-tab.tsx` e `address-fields.tsx`): digitar "SP" no campo Estado sugere só "Espírito Santo" (o nome contém "sp"), e não São Paulo. No Brasil, quase todo mundo digita a sigla. **Fazer:** buscar também pela sigla (UF), com a sigla exata primeiro. **Feito:** o autocomplete busca também pelo valor (a UF), com a sigla exata primeiro.
106. ✅ **Botões de tema e idioma ficam por cima do formulário** (front: botões fixos no canto do layout público): no celular, os dois botões ficam presos no canto de cima e, ao rolar, cobrem o fim dos campos (e-mail, abas do cadastro, tipo de estabelecimento). **Fazer:** botões no fluxo da página (no cabeçalho, que rola junto), ou só no topo. **Feito:** os botões ficam no topo da página (`absolute`) e rolam junto.
107. ✅ **"Próximo" travado sem dizer o que falta** (front: `SignupRefactored.tsx`): o botão fica desabilitado até tudo estar válido, sem apontar o campo que falta, e a aba só mostra um "!". Duas situações deixam a pessoa sem entender:
    - **País em branco:** o país não vem preenchido (nem pelo idioma do navegador). Documento, telefone e CEP ficam cinza até escolher o país, sem dizer por quê.
    - **Endereço depois do CEP:** Estado, Cidade, Rua e Bairro só aparecem depois que a busca do CEP termina. Com o serviço lento ou fora do ar, nada aparece por vários segundos.

    A tela de cadastro também dispara a mesma consulta sem sessão do item 102. **Fazer:**
    - Botão sempre clicável, levando ao primeiro campo com problema e mostrando a mensagem dele.
    - País sugerido pelo idioma do navegador.
    - Campos de endereço visíveis desde o começo, com a busca do CEP só preenchendo.

    **Feito:** "Próximo" sempre clicável: com algo faltando, mostra "Falta preencher: <campo>" (ou "Confira o campo") e leva o cursor até ele; "Concluir" faz o mesmo. País sugerido pelo idioma do navegador (pt-BR → Brasil). Estado, Cidade, Rua e Bairro aparecem desde o começo nos dois passos; a busca do CEP só preenche.
108. ✅ **Captcha que não carrega prende a pessoa no último passo** (front: `password-terms-tab.tsx`): quando o script do captcha não carrega (bloqueador, rede da empresa, lentidão), o espaço dele fica vazio e "Concluir" só mostra o aviso "Por favor, complete o captcha". Não há explicação nem jeito de tentar de novo. **Fazer:** detectar a falha ao carregar e mostrar "Não foi possível carregar a verificação. Tentar de novo", com um botão que recarrega o widget. **Feito:** se o script do captcha não carrega em 10 s (ou dá erro), aparece "Não foi possível carregar a verificação…" com "Tentar de novo".
109. ✅ **Cadastro pede dado repetido e usa termo técnico** (front: passo "Dados do estabelecimento"): o endereço não tem campo "Número" (vai na Rua ou no Complemento). O segundo passo pede de novo CEP e telefone, sem "usar os mesmos dados pessoais". "Slug (URL amigável)" é jargão. **Fazer:** campo Número, a opção "mesmo endereço e telefone", e trocar "Slug" por "Endereço da sua página" com a prévia (`…/u/salao-teste-ui`). **Feito:** campo Número nos dois endereços (vai junto da rua no envio); caixa "Usar o mesmo endereço e telefone dos meus dados" no passo do estabelecimento; "Slug" virou "Endereço da sua página", com a prévia (`…/u/salao-teste-ui`) embaixo.


### Décima oitava rodada (2026-10-12): pacotes, clube, taxas e agendamento online

O app foi aberto com o seed de demonstração. As telas foram percorridas como dono, recepção, barbeiro, barbeiro básico e cliente, no desktop e no celular (375 px), e em inglês. A varredura não achou erro de tela nem de GraphQL, e não sobrou texto em português na versão em inglês. O código de pacotes, cartão-presente, fidelidade, assinatura do cliente, taxa de falta, agendamento online, lembretes e avaliações foi lido de ponta a ponta. A duplicata do item 115 foi reproduzida chamando a API.

110. ✅ **Apagar a venda de um pacote ou cartão-presente não desfaz o que foi vendido** (back: `deleteSale`, `updateSale`, `purchaseClientPackage`, `createGiftCard`): vender um pacote cria a venda e o `ClientPackage`; vender um cartão-presente cria a venda e o `GiftCard`. Nenhum dos dois guarda o id da venda. Se a venda é apagada ("o cliente desistiu"), o pacote continua com todas as sessões e o cartão continua com o saldo inteiro: o cliente fica com o valor sem ter pago. Editar o total da venda também não muda o valor do cartão. **Fazer:** guardar o `saleId` no pacote e no cartão. Apagar a venda cancela os dois e recusa se o pacote já teve sessão usada ou o cartão já foi usado; nesse caso, oferecer o estorno do que sobrou. Venda de pacote ou cartão não aceita mudança de valor pela edição. **Feito:** pacote e cartão guardam a venda que os emitiu. Apagar essa venda cancela o pacote sem sessão usada e zera o cartão ainda intacto. Se já houve uso, a exclusão recusa e a tela oferece "Estornar o que sobrou" (a venda fica no valor consumido e o resto some). Editar o valor dessas vendas é recusado; receber uma pendente continua permitido. Vendas antigas, sem o vínculo, seguem como estavam.
111. ✅ **Assinatura do cliente (clube): o limite de sessões por ciclo nunca é aplicado** (front: nenhuma tela usa `redeemClientSubscriptionSession`): o plano tem "Limite/ciclo" (ex.: "Clube Corte + Barba (2x/mês)"), mas não há botão pra registrar que o cliente usou uma sessão. O hook existe no front e ninguém chama. Na prática, todo plano é ilimitado e o contador `usedThisCycle` fica sempre em 0. **Fazer:** mostrar a assinatura ativa na ficha do cliente e no fechamento da conta do atendimento, com "Usar sessão do clube" e o saldo do ciclo, como já existe para os pacotes. **Feito:** a ficha do cliente (aba Pacotes) lista o clube ativo, com o saldo do ciclo e "Usar sessão do clube". No fechamento da conta, a mesma opção zera uma sessão do serviço do plano e baixa o saldo junto com a venda. Sem sessões restantes, o botão não conta de novo. A ficha liga pela conta do cliente, ou pelo mesmo e-mail.
112. ✅ **Assinatura do cliente: o dinheiro fica na conta da plataforma, sem repasse registrado** (back: `subscribeToPlan`, `getSubscriptionRevenueReport`): o sinal e o pagamento pelo app usam o Stripe Connect (`transfer_data` pra conta da unidade, com a taxa da plataforma). A assinatura do clube cria a cobrança na conta da plataforma, sem destino. O relatório de repasse só calcula ("Não transfere nada"), e não há onde marcar o repasse como feito, nem histórico do que já foi pago à unidade. A própria tela de Assinaturas avisa "o dinheiro vai pra conta da plataforma". **Fazer:** com a unidade conectada ao Stripe, a assinatura vai pra conta dela, com `application_fee_percent` igual à taxa da plataforma. Sem conta conectada, o repasse manual ganha registro (data, valor, quem pagou) no backoffice, e a unidade vê o que já recebeu. **Feito:** assinatura nova, com a conta de recebimento ligada, vai pra essa conta com a taxa da plataforma. O relatório tira esse valor do que ainda é devido. Sem conta, o Financeiro registra o repasse na ficha da unidade (data, valor e quem pagou) e a tela de Assinaturas mostra o que já caiu na conta, o que já foi repassado e o que ainda falta.
113. ✅ **Pacotes: a tela diz que o desconto é automático, mas a baixa é manual** (front: `Packages`, ficha do cliente em `Customers.tsx`; back: `debitClientPackageSession`): a tela de Pacotes diz "cada atendimento desconta 1 sessão do saldo do cliente". Na verdade, fechar a conta do atendimento não usa o pacote: a sessão só sai pelo botão "Registrar sessão" na ficha do cliente, que qualquer cargo (até o barbeiro básico) pode clicar. A baixa não fica ligada a um atendimento nem registra quem a fez, e não dá pra desfazer um clique errado. O pacote também não tem validade. **Fazer:** no fechamento da conta, oferecer "Usar sessão do pacote" quando o cliente tem pacote do serviço (zerando o valor do serviço). Ligar a baixa ao atendimento e a quem fez, permitir desfazer, e opcionalmente dar validade ao pacote. Ajustar o texto da tela. **Feito:** no fechamento da conta, "Usar sessão do pacote" zera uma sessão do serviço e baixa o saldo na mesma venda, com o atendimento e quem fez. Apagar essa venda devolve a sessão. A baixa avulsa na ficha ficou da recepção pra cima, guarda quem fez e tem "Desfazer". A oferta pode ter validade em dias, copiada para o pacote do cliente. O texto da tela de Pacotes descreve o fechamento da conta.
114. ✅ **Taxa de falta e de cancelamento tardio: cobra o cliente pelo que a unidade fez e não entra no caixa** (back: `recordNoShowFee`, `markNoShowFeeCollected`): **Feito:** ao cancelar, a equipe diz quem cancelou (`cancelledBy`: cliente ou unidade) e só o cliente gera taxa de cancelamento tardio. Tirar o status de falta ou cancelado apaga a taxa pendente (a já recebida fica). "Recebida" pede a forma de pagamento, vale da recepção pra cima e lança uma venda `NO_SHOW_FEE` no caixa aberto (`NoShowFee.saleId`).
    - **Cancelamento da unidade gera taxa:** qualquer cancelamento dentro da janela gera taxa pro cliente, inclusive quando quem cancela é a unidade (profissional doente, imprevisto). O sistema não guarda quem cancelou.
    - **Correção não apaga a taxa:** "faltou" marcado por engano e depois corrigido pra "concluído" deixa a taxa pendente, porque ela é "calculada uma vez só".
    - **"Cobrada" não entra no caixa:** "Marcar como cobrada" pode ser feito por qualquer cargo e não cria venda nem entra no caixa. O dinheiro recebido some do faturamento.

    **Fazer:**
    - Ao cancelar pela equipe, perguntar "Quem cancelou?" (cliente ou unidade) e só gerar a taxa quando foi o cliente.
    - Ao tirar o status de falta ou cancelado, a taxa pendente é dispensada sozinha.
    - "Cobrada" pede a forma de pagamento e lança a venda no caixa aberto (da recepção pra cima).
115. ✅ **Agendamento online deixa o mesmo cliente marcar dois horários no mesmo instante** (back: `createPublicAppointment`): o agendamento confere só a agenda do profissional, não a do cliente. Teste: o mesmo telefone marcou dia 22/10 às 15h com Cayo e, na mesma hora, com Bianca (ids 1042 e 1043). Um clique duplo ou um "qualquer profissional" repetido cria duplicatas, e um único telefone pode ocupar todos os profissionais no mesmo horário. **Fazer:** recusar quando o mesmo cliente (pelo telefone ou pela conta) já tem horário que se sobrepõe na rede ("Você já tem um horário nesse período"). Limitar a quantidade de horários futuros por telefone no agendamento público (ex.: 5). **Feito:** o mesmo telefone (em qualquer formatação) ou a mesma conta não marca horário por cima de outro na rede, e para em 5 horários futuros. A checagem entra de novo na transação, com trava por telefone, pra dois cliques juntos não passarem os dois.
116. ✅ **Quem paga pelo app não ganha pontos de fidelidade por essa parte** (back: `createSale`): os pontos são calculados sobre `finalTotal`, que já desconta o sinal pago online e o pagamento pelo app. Quem pagou o atendimento inteiro pelo app ganha 0 ponto; quem pagou só o sinal ganha pontos só pelo resto. É o contrário do que se quer incentivar. **Fazer:** calcular os pontos sobre o que o cliente pagou em dinheiro de verdade (total menos cartão-presente e pontos usados), incluindo o sinal e o pagamento pelo app. **Feito:** os pontos saem do que foi pago em dinheiro (o que falta no caixa mais o sinal e o pagamento pelo app). Cartão-presente e pontos resgatados continuam de fora. A edição da venda usa a mesma base.
117. ✅ **E-mail de fatura e de renovação do plano com a data no fuso do servidor** (back: helper `{{date}}` em `email.service.ts`, usado por `invoice_email` e `recurring_payment_success`): o helper usa `toLocaleDateString` sem fuso, ou seja, o fuso do servidor (UTC). Um pagamento às 22h em Brasília sai com a data do dia seguinte, e o vencimento pode aparecer um dia adiantado. **Fazer:** passar o fuso de quem recebe (da unidade principal do dono, ou `America/Sao_Paulo` como padrão) para o helper. **Feito:** o helper usa `TimeZone` do contexto, e sem ele cai em `America/Sao_Paulo`. A fatura da Stripe, a renovação do plano e o recibo do aluguel da cadeira mandam o fuso da primeira unidade ativa do dono.
118. ✅ **Lembrete de 24 h chega logo depois da confirmação** (back: `AppointmentReminderService.enqueueDueReminders`): o lembrete pega todo agendamento das próximas 24 h que ainda não foi lembrado. Um horário marcado hoje para amanhã cedo recebe o e-mail de confirmação e, minutos depois, o "lembrete" igual. **Fazer:** não enviar lembrete para agendamento criado menos de X horas antes do início (ex.: 6 h), ou marcar o lembrete como feito na criação quando o horário já está dentro da janela. **Feito:** horário criado a 24 h ou menos do início é marcado como lembrado e não recebe o segundo e-mail. Quem marcou com mais antecedência continua recebendo o lembrete quando entra na janela.
119. ✅ **Tabelas de Comissões e Pacotes cortadas no celular** (front: `Commissions`, `Packages`): em 375 px, a tabela de comissões não rola de lado e corta o "%" da última coluna (a página fica com 380 px). Na de pacotes, o preço aparece cortado ("R$120.") e as ações da linha ficam fora da tela, sem indicação de que dá pra rolar. **Fazer:** a mesma tabela com rolagem lateral das outras telas, ou cartões empilhados no celular. **Feito (front):** as tabelas de Comissão rolam de lado e o "%" não quebra; em Pacotes o preço não quebra e a coluna de ações fica fixa à direita.
120. ✅ **Pequenos, achados na leitura do código:**
    - **Duas redes pro mesmo dono:** `Network.ownerUserId` não tem índice único, e o `findOrCreateNetwork` faz "procura e cria" sem trava. Dois cadastros de unidade ao mesmo tempo podem criar duas redes pro mesmo dono, e o resto do código assume uma só (`getMyNetwork` pega a primeira). **Feito:** trava por dono antes de criar, e índice único em `ownerUserId`. Duplicata vazia é apagada na migration; duplicata com dado não é apagada (o índice falha).
    - **Cartão-presente vencido na criação:** `createGiftCard` aceita data de validade no passado. O cartão é vendido e cobrado já vencido. **Feito:** validade no passado é recusada.
    - **Cancelar assinatura já cancelada:** `cancelMySubscription` não confere a situação e chama a Stripe; em assinatura já encerrada, aparece um erro genérico. **Feito:** assinatura já `CANCELED` ou já marcada pra acabar no fim do ciclo volta sem chamar a Stripe.
    - **Posição repetida na fila:** em `createWalkIn`, a posição na fila presencial é calculada fora da transação. Duas entradas ao mesmo tempo ficam com o mesmo número. **Feito:** a posição sai dentro da transação, com trava da unidade.
    - **Hora sempre em pt-BR:** o e-mail "avalie seus clientes" formata a hora sempre em pt-BR, mesmo pra quem usa o app em inglês ou espanhol. **Feito:** a hora sai no idioma da conta (`UserSystemConfig.language`) e no fuso da unidade.
121. ✅ **E-mail do agendamento sem convite de calendário** (back: `sendAppointmentEmail`, lembrete): o e-mail de confirmação não trazia o evento. O Gmail adivinhava pelo texto e mostrava o cartão como "Consulta médica". **Feito:** a confirmação, a remarcação e o lembrete levam o convite `invite.ics` (`METHOD:REQUEST`, a unidade como organizadora e o cliente como participante já confirmado). O título é o nome do serviço, e a unidade vai no local. O cancelamento leva `METHOD:CANCEL` com o mesmo UID, e o app apaga o evento. O "Adicionar à agenda" também usa o nome do serviço como título. A série recorrente leva um evento por data, tanto na confirmação quanto no "cancelar este e os próximos". Excluir um horário futuro avisa o cliente e apaga o evento do calendário dele (antes ele não recebia nada).

### Décima nona rodada (2026-10-12): exclusões, lista de espera, agendamento público e conversa

Os textos das telas e dos e-mails foram conferidos de forma automática: nenhuma chave de tradução falta em pt, en ou es, e todo template de e-mail tem as três versões. Foi lido o código de conversa, comissões, estornos, estoque, importação, lista de espera e exclusão de contas e unidades. A API do agendamento público foi testada com entradas fora do normal. Comissão, estorno e importação não tiveram problema. Os itens 124 e 125 foram reproduzidos chamando a API.

122. ✅ **Apagar uma unidade (ou a conta do dono) some com os horários marcados e com o dinheiro pago pelo app** (back: `deleteBarbershop`, `AccountDeletionService.erase`): a exclusão cancela as assinaturas do clube e o aluguel da cadeira, e depois apaga a unidade em cascata. Junto vão os horários futuros:
    - os clientes não são avisados e têm o horário (e agora o convite) na agenda;
    - o sinal e o atendimento pagos pelo app não são estornados;
    - os registros desses pagamentos são apagados, e não dá mais pra estornar pelo sistema.

    A prévia da exclusão só mostra as unidades e as assinaturas, sem os horários futuros nem o dinheiro recebido online. A assinatura do clube é cancelada na hora, sem devolver o resto do ciclo já pago. **Fazer:** antes de apagar:
    - cancelar os horários futuros (e-mail de cancelamento com o convite `CANCEL`);
    - estornar o sinal e o pagamento pelo app desses horários;
    - avisar quem está na lista de espera.

    Manter os registros financeiros (anonimizados) em vez do cascade. Na prévia, mostrar "X horários futuros serão cancelados e R$ Y devolvidos".

    **Feito:** antes de apagar a unidade (ou a conta do dono), os horários futuros são cancelados. O sinal e o atendimento pagos pelo app são estornados, e o cliente recebe o e-mail de cancelamento com o motivo, o aviso do estorno e o convite `CANCEL`, que tira o evento da agenda. Estorno que falha interrompe a exclusão, e nada é apagado. A prévia da exclusão da conta e a da unidade (consulta nova `barbershopDeletionPreview`) mostram "N horários serão cancelados" e "R$ X pago pelo app volta para os clientes". Ficou pro item 128: guardar os registros financeiros anonimizados e devolver o resto do ciclo da assinatura do clube.
123. ✅ **Lista de espera avisa uma pessoa só e para por aí** (back: `checkWaitlistOnCancellation`, `deleteAppointment`): quando abre um horário, só a primeira pessoa da fila recebe o aviso e passa a "avisada". Se ela não agenda, o horário fica vago e ninguém mais é avisado: não há prazo pra resposta nem reaviso pro próximo. Excluir um horário futuro também libera a vaga sem avisar a lista (cancelar avisa). **Fazer:** prazo pra quem foi avisado (ex.: 30 min, ou até 2 h antes do horário). Vencido o prazo e o horário ainda livre, avisar o próximo. A exclusão passa pelo mesmo aviso do cancelamento. **Feito:** o aviso guarda o horário oferecido. Se a pessoa não agenda em 30 min (`WAITLIST_OFFER_MINUTES`) e o horário continua livre, um job a cada 5 min avisa o próximo da fila. No horário que abriu na escala, só esse horário conta como novo. Excluir um horário avisa a lista como o cancelamento.
124. ✅ **Agendamento público aceita qualquer data e qualquer minuto** (back: `createPublicAppointment`, `ensurePublicSlot`): a API aceitou um horário em 22/10/2030 (id 1044, quatro anos adiante) e um às 14:07 (id 1046), fora da grade que a tela mostra. Não existe limite de antecedência ("agendar até X dias", como no Booksy). Um script, ou alguém mexendo na requisição, cria horários fora da grade e deixa buracos de poucos minutos na agenda. **Fazer:** limite de antecedência configurável na unidade (padrão 90 dias), conferido na lista de horários e na criação. A criação só aceita horários que a lista oferece. **Feito:** o agendamento online vai até 90 dias à frente (`PUBLIC_BOOKING_WINDOW_DAYS`): a lista de horários e o "próximo horário livre" param ali, e a criação recusa ("Esse dia ainda não está aberto para agendamento online"). A criação (e a remarcação pelo link) só aceita horário da grade de 15 minutos a partir do início do expediente ("Escolha um dos horários da lista"). As duas mensagens estão no catálogo de traduções. Fica pra depois deixar os 90 dias configuráveis por unidade.
125. ✅ **Erros de validação continuam em português pra quem usa inglês ou espanhol** (back: DTOs com `class-validator`, ex.: `public-booking.dto.ts`, `client-auth.dto.ts`): "Telefone inválido", "Email inválido", "Nome muito curto" e as outras mensagens de validação (cerca de 15) não passam pelo catálogo do item 81, então chegam sem `reason` e o front mostra o texto em português. **Fazer:** incluir essas mensagens no `ERROR_REASONS` (com as traduções em `apiErrors.*`), e estender o teste do catálogo aos DTOs. **Feito:** era pior que o descrito: o erro de validação chegava como "Bad Request Exception", sem dizer o campo. O formatador do GraphQL passa a mandar a primeira mensagem da validação, com o código dela; as mensagens dos DTOs entraram no catálogo, e a que não está nele leva o código genérico `INVALID_INPUT`. O front traduz os códigos novos em pt, en e es.
126. ✅ **Conversa do atendimento sem prazo, e troca de profissional muda quem lê** (back: `ChatService.allowedKinds`): **Feito:** a conversa recebe mensagem até 7 dias depois do atendimento (`CHAT_OPEN_DAYS_AFTER`); depois, só leitura. A conversa com o profissional fica com quem a abriu (`ChatThread.barberId`): se a equipe troca o profissional, o novo não lê, o anterior continua lendo, e a conversa fica só leitura (mensagem nova vai pela conversa com a unidade).
    - **Sem prazo:** um atendimento concluído há anos ainda aceita mensagem do cliente, e a conversa vira um canal permanente.
    - **Troca de profissional:** se a equipe troca o profissional do horário, quem lê a conversa "com o profissional" passa a ser o novo (o acesso é pelo profissional atual do agendamento). Ele vê o que o cliente escreveu pro anterior, e o anterior perde o acesso.

    **Fazer:** fechar a conversa X dias depois do atendimento (ex.: 7), deixando só leitura. Prender a conversa ao profissional que a abriu (`ChatThread.barberId`) ou abrir outra ao trocar.
127. ✅ **Venda de produto deixa o estoque negativo sem aviso** (back: `moveStock`; front: venda): o ajuste manual recusa estoque negativo ("Estoque não pode ficar negativo"), mas a venda baixa o estoque mesmo sem saldo. O produto aparece com -2, e quem vende não é avisado na hora. **Fazer:** na venda, avisar "Só há N em estoque" (sem bloquear, pra não travar o caixa) e mostrar o negativo destacado no estoque. **Feito (front):** a venda (tela Vendas e venda rápida) avisa "Só há N em estoque" sem bloquear; o estoque negativo aparece em vermelho com "Estoque negativo: confira a contagem".
128. ✅ **Exclusão da unidade ainda apaga os registros financeiros e não devolve o resto do ciclo do clube** (back: `deleteBarbershop`, `AccountDeletionService.erase`; continuação do item 122): o cascade apaga vendas, pagamentos pelo app e repasses junto com a unidade, e a contabilidade da plataforma perde o histórico. A assinatura do clube é cancelada na hora, sem devolver a parte do ciclo já paga e não usada. **Fazer:** guardar as vendas e os pagamentos anonimizados (sem cliente nem unidade apagados, com o id da rede antiga) ou marcar a unidade como encerrada em vez de apagar. Devolver proporcionalmente o ciclo do clube pelo Stripe (`proration`). **Feito (decisão: encerrar em vez de apagar):** "Excluir unidade" grava `Barbershop.closedAt`, desliga a unidade, libera o slug e o subdomínio, desliga a equipe, cancela a lista de espera e os convites pendentes. Vendas, pagamentos e repasses ficam no banco. A unidade encerrada some das listas, do limite do plano e do acesso de todos. A exclusão da conta (LGPD) continua apagando a rede. **Feito também:** o resto do ciclo pago do clube volta pelo Stripe para o cartão do cliente. O valor é o tempo que falta do ciclo ou, no plano com sessões contadas, as sessões que sobraram (o menor dos dois). Na conta da unidade, desfaz a transferência e devolve a taxa. A prévia mostra o total, e o repasse tira o que voltou (`ClientSubscriptionPayment.refundedAmount`, também atualizado por estorno feito no painel do Stripe). Estorno recusado não impede o encerramento e fica no log.

### Vigésima rodada (2026-10-13): listas grandes, comissão, caixa, campanhas e efeitos do encerramento

Foi lido o código de caixa, estorno de pacote e cartão-presente, comissão, cupons, fidelidade, série recorrente, fechamentos, folgas, avaliações, campanhas, exclusão de ficha e o encerramento de unidade (item 128). Cupons, série recorrente, fechamento do dia, avaliações e a devolução de estoque ao apagar ou editar venda não tiveram problema.

129. ✅ **Listas de clientes mostram só os 50 primeiros, e a busca procura só neles** (back: `getCustomers`; front: `Customers`, novo agendamento, venda, lista de espera, venda e agendamento rápidos): o back devolve no máximo 50 clientes, em ordem alfabética, e o front não manda o termo de busca. Ele filtra só dentro desses 50. Numa unidade com 200 clientes, o "Zé" não aparece na lista, não é achado na busca e não dá para agendar nem vender para ele pela tela. O seed de demonstração tem 29 clientes por rede, por isso nunca apareceu. **Fazer:** mandar a busca para o back (`search`, que já existe) com atraso de digitação, e paginar a página Clientes ("carregar mais"). Nos seletores, buscar no back conforme se digita. **Feito:** a busca vai ao back com atraso de digitação, num seletor comum (`CustomerPicker`) usado em venda, venda rápida e lista de espera. A Agenda e o agendamento rápido também buscam no back, e o cliente criado na hora já fica escolhido. A página Clientes tem "Mostrar mais". A agenda passou a receber o nome (e o telefone, conforme o cargo) em cada horário: antes, cliente depois do 50º aparecia como "Cliente". `barbershopCustomers` aceita `limit` e `offset` (até 200).
130. ✅ **Vendas: só as 50 últimas aparecem, sem filtro de data nem paginação** (back: `getSales`, limite padrão 50; front: `Sales`): a tela não manda período nem página. Venda mais antiga que as 50 últimas não aparece, então não dá para corrigir, apagar nem estornar pela tela. **Fazer:** filtro de período (padrão: este mês) e "carregar mais". **Feito:** a tela Vendas tem o mês (padrão: o atual, no calendário da unidade) e "Mostrar mais". `barbershopSales` aceita `limit` e `offset`.
131. ✅ **Sessão de pacote ou do clube não gera comissão para quem atende** (back: `computeCommissions`; front: `AppointmentCheckoutDialog`): no fechamento da conta, o serviço coberto pelo pacote ou pelo clube entra com preço 0, e a comissão é calculada sobre o preço do item, então dá zero. A venda do pacote e a do clube também não têm profissional. Resultado: quem atende cliente de pacote ou clube nunca recebe comissão por esses atendimentos. **Fazer:** comissão da sessão sobre o valor da sessão (preço do pacote dividido pelo número de sessões; no clube, o preço do serviço ou uma regra própria), ou uma regra de comissão por sessão de pacote ou clube. **Feito:** o serviço coberto entra na comissão de serviço sobre o valor da sessão: no pacote, o que o cliente pagou dividido pelas sessões; no clube, o preço do serviço. Esse valor não conta como faturamento no relatório. A venda guarda a assinatura usada (`Sale.clientSubscriptionId`), e apagar essa venda devolve a sessão do clube se ainda for o mesmo ciclo.
132. ✅ **Estorno do saldo de pacote ou cartão-presente reescreve a venda antiga e é bloqueado depois do caixa fechado** (back: `refundIssuedRemainder`): o estorno diminui o total da venda original. O faturamento do dia da venda muda depois, às vezes semanas atrás. E se o caixa daquela venda já foi fechado, o estorno é recusado ("Lance a correção no caixa aberto"), mas não existe como lançar essa correção. Pacote vendido na semana passada não tem como ser estornado. **Fazer:** lançar o estorno como movimento novo (venda negativa ou saída de caixa) com a data de hoje no caixa aberto, sem mexer na venda original. **Feito:** com a venda paga, o estorno vira uma venda de estorno (`REFUND`, valor negativo) com a data de hoje, no caixa aberto e com a mesma forma de pagamento da venda original. A venda original fica como foi, então o faturamento do dia antigo não muda e o estorno funciona mesmo com o caixa dela fechado. A venda de estorno não pode ser editada nem apagada. Venda pendente continua sendo ajustada nela mesma.
133. ✅ **Campanha de marketing: o gerente de uma unidade dispara para os clientes da rede inteira, sem limite** (back: `resolveMarketingSegment`, `sendMarketingBlast`): **Feito:** o gerente manda só para os clientes atendidos na unidade (horário ou venda nela). A rede inteira é só do dono. Bloqueados ficam de fora. Cada unidade pode mandar uma campanha a cada 24 horas e até 5000 e-mails a cada 30 dias (`MARKETING_EMAILS_PER_30_DAYS`). Os erros têm código para tradução.
    - Os segmentos "todos" e "aniversariantes" pegam os clientes da **rede**, não os da unidade. O gerente de uma unidade manda campanha para os clientes de todas as outras.
    - Não há limite de frequência nem de volume. Dá para disparar milhares de e-mails várias vezes por dia pelo domínio da plataforma, o que derruba a reputação de envio de todas as unidades.
    - Cliente bloqueado pela unidade também recebe.

    **Fazer:** segmentos da unidade (rede inteira só para o dono), limite por unidade (por exemplo, uma campanha por dia e um teto mensal de e-mails pelo plano) e tirar os bloqueados.
134. ✅ **Encerrar unidade deixa presos os pacotes pagos e os dias de Destaque** (back: `deleteBarbershop`, `deletionImpact`; continuação do item 128): o pacote do cliente é da unidade. Com ela encerrada, as sessões já pagas não podem ser usadas, não são devolvidas e o cliente não é avisado. A prévia da exclusão mostra horários e assinaturas, mas não os pacotes. O Destaque pago para a unidade também segue até o fim, sem efeito. **Fazer:** mostrar os pacotes ativos na prévia, devolver a parte não usada (ou transferir para outra unidade da rede) e avisar o cliente. Encerrar também o Destaque. **Feito:** a prévia do encerramento mostra os pacotes ativos e quanto devolver aos clientes (sessões não usadas × o que foi pago por sessão). Ao encerrar, os pacotes deixam de valer e o Destaque da unidade termina. A devolução é feita pela unidade, porque o pacote foi pago fora do app.
135. ✅ **Apagar a venda da taxa de falta deixa a taxa como "cobrada"** (back: `deleteSale`, `markNoShowFeeCollected`; continuação do item 114): a venda `NO_SHOW_FEE` pode ser apagada pela tela Vendas, mas a taxa continua COLLECTED, ligada a uma venda que não existe. **Fazer:** ao apagar a venda, a taxa volta para PENDING (e `saleId` fica nulo). Na tela Vendas, mostrar "Taxa de falta" na descrição dessa venda, que hoje aparece sem itens. **Feito:** apagar a venda da taxa volta a taxa para pendente, e a tela Vendas mostra "Taxa de falta ou cancelamento".
136. ✅ **Código de indicação é o id do cliente** (back: `encodeReferralCode`): o código é o número do cliente em base 36 ("1", "2", "A"...). Dá para adivinhar códigos válidos e indicar em nome de qualquer cliente. O bônus só sai na primeira venda paga do indicado, então o risco é baixo, mas o código também revela quantos clientes a rede tem. **Fazer:** código aleatório guardado na ficha (por exemplo, 8 caracteres). **Feito:** código aleatório de 8 caracteres guardado na ficha (`Customer.referralCode`), criado na primeira vez que é pedido. Os códigos antigos (id em base 36) deixam de valer.

### Vigésima primeira rodada (2026-10-14): edição de venda, indicação, clube e convites

Foi lido o código de venda (criar, editar, apagar), cartão-presente, fidelidade, indicação, caixa, comissão, plano do clube (dono e cliente), série recorrente, importação, convite da equipe e pedido de avaliação. Também foram lidas as telas Vendas, Assinaturas e Equipe.

137. ✅ **Editar uma venda apaga o que foi abatido de sinal, pago pelo app, cartão-presente e pontos** (front: `Sales.tsx`, `handleSubmit`; back: `updateSale`): o formulário de edição manda de novo `total = subtotal − desconto`. O back só confere esse valor contra subtotal − desconto + imposto e grava. Uma venda de R$ 100 com R$ 30 de cartão-presente (total gravado R$ 70) volta a R$ 100 quando alguém muda só a forma de pagamento ou marca como paga. O mesmo vale para o sinal e o que foi pago pelo app: o cliente aparece pagando duas vezes no faturamento e no caixa, e os pontos ganhos são recalculados sobre o valor cheio. **Fazer:** o back recalcula o total a partir dos itens, menos sinal, pago pelo app, cartão e pontos já gravados (não aceita o total do front quando a venda tem abatimentos). Na tela, a edição mostra os abatimentos e não os perde. **Feito:** o back desconta do total cheio da tela o que já foi abatido (sinal, pago pelo app, cartão-presente, pontos). Recusa valor menor que o já abatido. A edição mostra "Já pago antes" e o valor a cobrar.
138. ✅ **Pacote e cartão-presente vendidos "para receber depois" nunca podem ser recebidos** (front: `Sales.tsx`, `PaymentMethodSelect`; back: `recordStandaloneSale`): a opção "receber depois" cria a venda pendente e diz que ela é recebida na tela Vendas. Mas a edição dessa tela só aceita itens de produto ou serviço: o item `PACKAGE` ou `GIFT_CARD` é descartado e aparece "adicione um item". A venda fica pendente para sempre, fora do faturamento e do caixa, e o pacote ou o cartão já vale. **Fazer:** uma ação "Receber" na lista (forma de pagamento + caixa aberto), sem passar pelo formulário de itens, para qualquer tipo de venda pendente. **Feito:** ação "Receber" na lista para qualquer venda pendente (forma de pagamento; entra no caixa aberto). "Editar" só aparece em venda de serviço, produto ou mista.
139. ✅ **Venda aceita tipo, situação e forma de pagamento quaisquer** (back: `CreateSaleInput`, `UpdateSaleInput`; front: `Sales.tsx`): `saleType`, `itemType`, `paymentStatus` e `paymentMethod` são texto livre. Pela API dá para: **Feito:** listas fechadas no back (tipos serviço, produto e misto; itens serviço e produto; situação pendente ou paga; formas `CASH`, `CARD`, `CREDIT_CARD`, `DEBIT_CARD`, `PIX`, `TRANSFER`, `OTHER`), também na taxa de falta, no pacote e no cartão-presente. Tipo e itens de venda de pacote, cartão ou taxa não mudam. O formulário não oferece mais "Parcial" nem "Reembolsado" (venda antiga com essas situações continua editável).
     - criar uma venda `REFUND`, que depois não pode ser editada nem apagada;
     - mudar uma venda de pacote para `SERVICE` e então alterar o valor, passando por cima da trava do item 132;
     - gravar `cash` minúsculo, que fica fora da conferência do caixa.
     
     Na tela, a situação "Estornada" e "Parcial" só troca o rótulo: não devolve estoque, cartão-presente, pontos nem sessão de pacote, e "Parcial" não guarda quanto foi pago. **Fazer:** listas fechadas no back (tipos que a equipe pode criar: serviço, produto, misto; situação: pendente ou paga; formas de pagamento conhecidas). O tipo não muda na edição. Tirar "Estornada" e "Parcial" do formulário (estorno é pelo apagar ou pela devolução do saldo).
140. ✅ **Indicação: venda paga depois não completa, e venda de valor zero completa** (back: `createSale`, `updateSale`): o bônus de quem indicou só sai em `createSale` com a venda já paga. A venda criada pendente e recebida depois (`updateSale`) nunca completa a indicação. Ao mesmo tempo, uma venda paga de R$ 0 (sessão do clube ou do pacote, ou paga toda com cartão-presente ou pontos) completa, ao contrário do comentário que diz "sem gasto real, sem bônus". **Fazer:** uma função só, chamada quando a venda passa a paga (na criação ou na edição), que exige valor pago em dinheiro maior que zero. **Feito:** `completeReferralIfPaid` roda na criação paga e quando a edição marca a venda como paga. Sessão de graça, cartão-presente e pontos não completam a indicação.
141. ✅ **Resgate de pontos funciona com a fidelidade desligada** (back: `createSale`): o resgate confere só o saldo do cliente e o valor do ponto, não `loyaltyEnabled`. Com o programa desligado (e o valor do ponto ainda preenchido), a venda pela API desconta pontos antigos. **Fazer:** recusar o resgate quando o programa está desligado. **Feito:** a venda com resgate é recusada enquanto a fidelidade está desligada, e os pontos do cliente não mudam.
142. ✅ **Plano do clube: o limite de sessões não volta a "ilimitado" e muda na hora para quem já assina** (front: `Subscriptions.tsx`; back: `updateSubscriptionPlan`): apagar o campo "sessões por ciclo" na edição manda `undefined`, e o back mantém o limite antigo; um plano limitado nunca mais vira ilimitado. Além disso, mudar o preço não afeta quem já assina (o Stripe segue no preço antigo), mas baixar o limite de sessões vale na hora para todos, no meio do ciclo já pago. **Fazer:** mandar `null` para "ilimitado". Guardar o limite na assinatura (como o preço), para que a mudança valha só para quem assinar depois, ou no próximo ciclo com aviso. **Feito:** o formulário manda `null` quando o campo fica vazio, e o plano volta a ilimitado. A assinatura guarda o limite da época (`ClientSubscription.sessionsPerCycle`); mudar o plano depois vale só para quem assinar em seguida. Quem já assinou segue no limite antigo, inclusive no reembolso do ciclo.
143. ✅ **Convite da equipe sem "reenviar" e que vence calado** (back: `EmployeeInviteService.createInvite`; front: `Barbers.tsx`): o convite vale 30 dias. Se o e-mail se perde, não há como reenviar, e o link só aparece na tela quando o envio falha na hora. Depois de vencido, o convite continua "pendente", e um novo convite para o mesmo e-mail é recusado ("já existe um convite pendente" e "já existe um funcionário com este e-mail"). **Fazer:** botão "Reenviar convite" (novo prazo, mesmo cadastro). "Copiar link" sempre visível para convite pendente. Convite vencido não bloqueia um novo. **Feito:** reenviar gera outro link e mais 30 dias no mesmo cadastro, mesmo vencido. Gerente e dono veem "Copiar link" no card enquanto o convite está pendente. Convite vencido vira expirado, o cadastro que ninguém aceitou sai da equipe, e um convite novo para o mesmo e-mail passa.

### Vigésima segunda rodada (2026-10-14): moedas, sinal, faturamento e agendamento online

Foi lido o código de caixinha, sinal online, aluguel da cadeira, vagas, escala da equipe, painel financeiro e cálculo dos horários livres.

144. ✅ **Limites de valor fixos, iguais em qualquer moeda** (back: `MAX_MONEY` = 1.000.000 em `barbershop.service.ts`, `MAX_AMOUNT` = 1.000.000 em `payroll.service.ts`, `MAX_TIP` = 10.000 em `tip.service.ts`): os tetos valem igual para real, peso colombiano, rupia ou dong. Em COP, IDR, VND ou PYG, 1.000.000 é pouco: o salário mínimo colombiano passa disso, e em IDR uma venda de produto também. A folha, a venda, o troco do caixa e a despesa são recusados com "valor inválido". A caixinha registrada à mão para em 10.000, menos de 3 dólares em COP. A caixinha pelo app já escala pela moeda (`APP_TIP_SCALE`); os outros tetos não. **Fazer:** um fator por moeda num lugar só (o mesmo da caixinha pelo app), usado por todos os tetos. **Feito:** `moneyScale` em `money-units` é o fator da caixinha pelo app e dos outros tetos. Venda, preço de plano e pacote, troco, despesa, folha e caixinha registrada à mão usam o teto vezes o fator da moeda da unidade. Em real o teto continua 1.000.000 (caixinha à mão, 10.000).
145. ✅ **Sinal online na conta da plataforma: o repasse nunca baixa, e a taxa é a de hoje** (back: `DepositPaymentService.payoutReport`): sem conta de recebimento, o sinal cai na plataforma. O relatório mostra "devido à unidade", mas não existe registro de repasse manual para o sinal (o clube tem `SubscriptionPayout`, item 112). A dívida só cresce, e o backoffice não tem onde lançar o pagamento. Além disso, a taxa é sempre a atual (`currentPricing()`): mudar a taxa hoje muda o que é devido nos meses passados, e também o "repassado automaticamente" dos sinais que já caíram na conta da unidade com a taxa antiga. **Fazer:** gravar a taxa no agendamento quando o sinal é pago. Registro de repasse manual do sinal (como o do clube), descontado no relatório. **Feito:** `depositPlatformFeePercent` fica no agendamento quando o sinal é cobrado. O relatório usa essa taxa, não a de hoje, e desconta o `DepositPayout` do período. O backoffice (Financeiro) registra o repasse do sinal, e a unidade vê "Já repassado pela plataforma".
146. ✅ **Faturamento não conta o sinal nem o que foi pago antes pelo app** (back: `getFinancialSummary`, painel do dia e do mês): o faturamento soma `Sale.total`, que já desconta o sinal e o atendimento pago pelo app. Esse dinheiro não entra em nenhuma venda. Um atendimento de R$ 100 com R$ 30 de sinal aparece como R$ 70. O sinal retido de quem faltou ou cancelou fora do prazo nunca aparece. Os pontos já somam essas partes (item 116); o faturamento não. **Fazer:** somar `depositApplied` e `prepaidApplied` das vendas pagas. Contar o sinal retido (falta, cancelamento fora do prazo) na data em que ficou com a unidade, separado por tipo no painel. **Feito:** painel do dia, do mês, da rede, resumo financeiro e relatório de pagamento da equipe somam sinal e pago pelo app. O resumo financeiro conta o sinal e o pago pelo app que ficaram com a unidade (falta ou cancelamento sem estorno) no dia do horário, nas linhas "Sinal" e "Pago pelo app". As formas de pagamento do resumo aparecem traduzidas.
147. ✅ **Agendamento online sem antecedência mínima** (back: `computeSlots`, `ensurePublicSlot`): o único corte é "o horário ainda não começou". O cliente marca pela página às 9h58 um horário das 10h, e o profissional descobre quando o cliente chega, ou não descobre a tempo. Com sinal, o horário fica preso enquanto o pagamento corre. **Fazer:** antecedência mínima por unidade (por exemplo, 0, 30 min, 1 h, 2 h, 1 dia), aplicada na lista de horários e conferida de novo ao confirmar. **Feito:** a unidade escolhe 0, 30 min, 1 h, 2 h ou 1 dia (`minBookingLeadMinutes`, padrão 0). A lista e o próximo horário livre só mostram o que começa depois desse prazo, e a confirmação recusa de novo. A equipe continua marcando na hora.

### Vigésima terceira rodada (2026-10-14): backend — login, modo solo, encerramento e campanhas

Foi lido o código de login com código por e-mail, ativação das duas etapas, agenda assinável, exclusão da conta do cliente, avaliações, modo solo, vagas, aluguel da cadeira, fechamentos de dia, ficha do cliente, campanhas e cancelamento de série recorrente.

148. ✅ **Código do login em duas etapas: o limite de tentativas não é atômico** (back: `UserService.verifyLoginCode`): as tentativas erradas ficam num JSON no Redis, que é lido, somado e gravado de novo. Pedidos em paralelo leem o mesmo contador e gravam "1" cada um, então o limite de 5 tentativas por código não segura. O limite por IP (5 por minuto) também não segura um ataque vindo de vários IPs. Com um milhão de códigos possíveis, o risco é baixo, mas o limite existe justamente para isso. **Fazer:** contador separado com `INCR` atômico (e o mesmo prazo do código). Apagar o código ao chegar no limite, antes de comparar. **Feito:** o contador é um `INCR` à parte, com o mesmo prazo do código. No limite, o código é apagado antes da comparação.
149. ✅ **Modo solo nasce no fuso de São Paulo e em real, em qualquer país** (back: `SoloService.start`): a agenda solo grava `timezone: 'America/Sao_Paulo'` fixo. A rede nova sai com a moeda padrão (BRL), mesmo com o país informado no cadastro. Uma profissional em Portugal ou no México tem os horários livres, os lembretes e os relatórios deslocados, e os preços em real, até mudar nas configurações. **Fazer:** fuso e moeda pelo país (e estado, quando o país tem vários fusos), como na moeda por geolocalização do cadastro (horizonte 1, item 8). O fuso pode vir do navegador. **Feito:** a rede nova nasce com a moeda do país. O fuso vem do navegador quando é um fuso daquele país; senão, do estado (e do fuso principal do país). A tela manda o fuso do navegador.
150. ✅ **Encerrar a unidade não encerra o aluguel da cadeira cobrado à mão nem as candidaturas** (back: `deleteBarbershop`, `cancelChairRentsOfBarbershops`, `ChairRentService.processManualDues`; continuação do item 128): o encerramento só cancela o aluguel cobrado pelo Stripe. O vínculo de espaço compartilhado continua `ACTIVE`, e a rotina diária segue criando mensalidades e mandando avisos de atraso ao profissional todo mês, por um espaço que não existe mais. Isso vale quando a unidade encerrada é o espaço ou o profissional. As candidaturas pendentes às vagas da unidade também ficam "esperando resposta" para sempre. **Fazer:** encerrar os vínculos de espaço compartilhado da unidade (os dois lados), cancelar as mensalidades em aberto que vencem depois do encerramento e mostrar na prévia as que ficaram em atraso. Fechar as vagas e recusar as candidaturas pendentes com aviso. **Feito:** os vínculos dos dois lados saem de ativo, o aluguel no cartão é cancelado e a mensalidade manual que vence depois do encerramento é apagada. A que já venceu aparece na prévia e continua devida. As vagas abertas fecham e as candidaturas pendentes são recusadas com aviso.
151. ✅ **Descadastro das campanhas: a equipe desfaz, e outra ficha da mesma pessoa continua recebendo** (back: `updateCustomer`, `unsubscribeFromMarketing`, `resolveMarketingSegment`):
     - A recepção pode mudar `marketingOptOut` de volta para falso na edição da ficha, reinscrevendo quem saiu pelo link do e-mail. Pela LGPD, só o próprio cliente pode voltar a aceitar.
     - O descadastro marca só a ficha do link. Fichas duplicadas com o mesmo e-mail (comuns: o agendamento online cria ficha pelo telefone) continuam recebendo.
     - A campanha não junta e-mails repetidos, então a mesma pessoa pode receber duas vezes.
     
     **Fazer:** a equipe só pode marcar "não quer receber", nunca desmarcar. O descadastro vale para todas as fichas da rede com o mesmo e-mail. A campanha envia uma vez por e-mail. **Feito:** desmarcar é recusado. Marcar "não quer receber" e o link do e-mail valem para todas as fichas da rede com o mesmo e-mail. A campanha manda um e-mail por endereço.

### Vigésima quarta rodada (2026-10-14): agendamento online de quem volta, lembretes

Foi lido o código de Destaque pago, folha da equipe (lançamentos, pagamento e desfazer), suporte, perfil público do profissional, rotinas agendadas, lembretes e o agendamento pela página pública.

152. ✅ **Cliente que volta: o e-mail digitado no agendamento online só vale para a primeira confirmação** (back: `createPublicAppointment`; e-mails em `AppointmentReminderService`, `DepositPaymentService.finalize` e `remindPendingHolds`, `ReviewRequestService`, cancelamento e remarcação): quem já tem ficha é achado pelo telefone, e a ficha fica como estava. O e-mail digitado só recebe a confirmação imediata (`input.customerEmail || customer.email`). Os outros e-mails vão para `customer.email`: o lembrete de 24 h, a confirmação depois de pagar o sinal, o lembrete de pagar o sinal, o aviso de cancelamento ou remarcação pela unidade e o pedido de avaliação. Se a ficha não tinha e-mail (cadastro no balcão só com telefone), nenhum desses chega. No sinal online, o cliente paga e não recebe a confirmação nem o link de gerenciar. Se a ficha tinha um e-mail antigo ou de outra pessoa, os avisos vão para lá. **Fazer:** guardar no agendamento o e-mail de contato digitado (como `WaitlistEntry.contactEmail`) e usá-lo em todos os e-mails daquele horário. Preencher o e-mail da ficha quando ela não tinha (sem trocar um e-mail que já existe, para não dar para sequestrar a ficha de outra pessoa pelo telefone). **Feito:** o e-mail digitado fica no horário (`contactEmail`) e é o destino da confirmação, do lembrete de 24 h, do sinal (confirmação e lembrete de pagar), do cancelamento e da remarcação (equipe, fechamento e encerramento) e do pedido de avaliação. A ficha só recebe esse e-mail quando ainda não tinha.
153. ✅ **Remarcar para as próximas 24 h manda o lembrete logo depois do aviso de remarcação** (back: `AppointmentReminderService.enqueueDueReminders`, `reminderCoveredByConfirmation`; continuação do item 118): remarcar zera `reminderSentAt`, e a regra que evita lembrete repetido olha a criação do horário (`createdAt`), não a remarcação. Um horário criado há uma semana e remarcado para amanhã gera o e-mail de remarcação e, minutos depois, o lembrete de 24 h com o mesmo conteúdo. **Fazer:** guardar quando o horário foi marcado ou remarcado pela última vez (ou marcar o lembrete como enviado ao remarcar para dentro das 24 h, já que o aviso de remarcação traz tudo). **Feito:** remarcar para dentro de 24 h marca o lembrete como enviado. Mais longe, o lembrete volta a valer para o horário novo.

### Vigésima quinta rodada (2026-10-14): modelo de dados — escopo, apagamento e índices

Foram lidas as 96 tabelas do `schema.prisma` (relações, `onDelete`, chaves únicas e índices) e todas as funções do back que alteram ou apagam um registro pelo id.

154. ✅ **Crítico: o gerente de uma rede altera e apaga serviço, produto e categoria de outra rede** (back: `updateService`, `deleteService`, `updateProduct`, `deleteProduct`, `updateProductCategory`, `deleteProductCategory`, e a categoria em `createProduct`/`updateProduct`): a função confere o acesso à unidade informada (`barbershopId`), mas grava com `where: { id }`, sem conferir que o registro é dessa unidade. Qualquer gerente ou dono pode mandar o próprio `barbershopId` com o id de um serviço de outra empresa e mudar o preço, o nome ou a duração, desativar ou apagar o serviço. Os ids são números em sequência, fáceis de percorrer. O mesmo vale para produtos e categorias. A categoria de outra unidade também é aceita ao criar ou editar produto. As outras funções desse tipo (pacote, plano, regra de comissão, despesa, estoque, recurso, avaliação) já conferem a unidade. **Fazer:** `findFirst({ id, barbershopId })` antes (ou `updateMany`/`deleteMany` com `barbershopId` e erro quando nada mudou), e conferir a categoria. Teste de integração com duas redes para cada uma das seis funções. **Prioridade máxima.** **Feito:** serviço, produto e categoria são conferidos na unidade antes de gravar ou apagar. Categoria de outra unidade é recusada ao criar ou editar produto.
155. ✅ **Apagar serviço ou produto apaga o histórico, ou dá erro sem explicação** (back: `deleteService`, `deleteProduct`; `schema.prisma`: `AppointmentService.service`, `ServiceHistory.service`, `ServicePackage.service`, `ClientSubscriptionPlan.service`, `InventoryItem.product` com `onDelete: Cascade`):
     - O serviço é apagado de verdade. Em cascata somem o serviço de todos os horários (passados e futuros), o histórico de atendimentos do cliente, os pacotes e os planos do clube com esse serviço.
     - Se algum cliente comprou o pacote ou assina o plano, o banco recusa (`ClientPackage` e `ClientSubscription` não deixam) e a tela recebe um erro 500 sem explicação.
     - O produto apagado leva o estoque e todos os movimentos dele. As vendas ficam com "1x —" no lugar do nome.
     
     **Fazer:** desativar em vez de apagar (`isActive = false`, como o plano do clube e o pacote já fazem). Trocar as cascatas de histórico para `Restrict`/`SetNull`. **Feito:** apagar serviço ou produto só desativa. Horário, fila, histórico, pacote, plano, item de venda e estoque não somem com o cadastro (`onDelete: NoAction`, conferido no fim do comando, para a exclusão da unidade em cascata continuar possível).
156. ✅ **Índices que faltam para as consultas mais usadas** (`schema.prisma`):
     - `Sale` não tem índice por `paidAt`, e todo faturamento, comissão e relatório filtra pela data de pagamento (`paidInRange`).
     - `Appointment` não tem índice por `customerId` sozinho: o histórico do cliente na rede e o "tem horário marcado?" ao apagar a ficha precisam disso.
     - `Appointment` também não tem índice por `barberId` + `startAt` fora da unidade: os horários livres de quem atende em várias unidades buscam `barberId in (...)` sem a unidade.
     
     Com poucos dados não aparece; com alguns anos de vendas, os relatórios leem a tabela inteira. **Fazer:** `@@index([barbershopId, paidAt])` em `Sale`, `@@index([customerId, startAt])` e `@@index([barberId, startAt])` em `Appointment`, e conferir com `EXPLAIN` no teste de carga. **Feito:** os três índices estão no schema e na migração. O `EXPLAIN` no teste de carga não rodou: o Postgres em `localhost:5433` estava desligado.

### Vigésima sexta rodada (2026-10-14): escopo das consultas e situação do agendamento

Foi feita uma varredura de todas as funções que leem, alteram ou apagam pelo id (back inteiro) e de todos os resolvers sem proteção de login que recebem id. Além dos casos do item 154, as funções de escala, folga, fotos, espaço compartilhado, aluguel, chat do cliente, avaliações, pacotes, planos, despesas e estoque já conferem a unidade (ou descobrem a unidade pelo próprio registro antes de conferir o acesso).

157. ✅ **Horário já cobrado pode virar "cancelado" ou "faltou", e o dinheiro sai duas vezes** (back: `updateAppointment`): a mudança de situação não olha se o horário já tem venda.
     - Um atendimento concluído e cobrado, se marcado como cancelado pela equipe, estorna pelo Stripe o sinal e o que foi pago pelo app (`refundOnlineDeposit`, `refundPrepayment`). A venda continua paga, com `depositApplied` e `prepaidApplied`, e o faturamento conta um dinheiro que voltou para o cliente.
     - Marcado como "faltou", gera a taxa de falta para quem foi atendido e pagou.
     - O e-mail de cancelamento também sai.
     
     **Fazer:** horário com venda não muda para cancelado nem para faltou ("apague ou estorne a venda antes"). Só volta para outra situação depois que a venda sair. **Feito:** cancelar ou marcar falta é recusado enquanto existir venda, antes do estorno e do e-mail. Outra situação continua permitida.
158. ✅ **Agendamento aceita sala ou cadeira de outra unidade** (back: `createAppointment`, `updateAppointment`): o `resourceId` não é conferido contra a unidade. A checagem de conflito filtra pela unidade do horário, então passa, e o horário fica ligado ao recurso de outra empresa (o nome dele aparece na agenda, e a trava de agenda é compartilhada com a outra unidade). **Fazer:** conferir `resource.barbershopId` (e `isActive`) antes, como já é feito com profissional, cliente e serviços. **Feito:** criar ou trocar o recurso exige que ele seja desta unidade e esteja ativo.

### Vigésima sétima rodada (2026-10-14): importação, painel da rede

Foram lidos os cupons e o checkout do plano do dono, a renovação dos planos, o convite de amigo, o leitor de planilha da importação, os períodos dos relatórios e o painel da rede. O cupom só vale no checkout: o antigo `applyCoupon` em cima de um pagamento já foi desligado (`CouponsService.applyCoupon` ficou sem uso e pode sair).

159. ✅ **Importação: horários antigos disparam o pedido de avaliação, e o leitor erra preço e data fora do padrão brasileiro** (back: `import-sheet.ts`, `ReviewRequestService.enqueueDueRequests`):
     - Um horário passado entra como `COMPLETED` (origem `HISTORY`). O pedido de avaliação pega todo `COMPLETED` dos últimos 3 dias sem olhar a origem. Importar a planilha da semana manda "Como foi?" para clientes atendidos no sistema antigo, que nunca receberam nada do app.
     - O preço "1.200" (milhar com ponto, sem vírgula) vira 1,20.
     - A data é sempre lida como dia/mês: em unidade dos Estados Unidos, 03/04 vira 3 de abril em vez de 4 de março.
     
     **Fazer:** o pedido de avaliação ignora a origem `HISTORY` (e `IMPORT`). O preço com ponto e três casas depois dele é milhar. A ordem de dia e mês segue o país da unidade, com aviso na prévia quando a data for ambígua. **Feito:** histórico e importação não recebem pedido de avaliação. `1.200` vale mil e duzentos, e `1.20` continua decimal. A data segue o país (nos Estados Unidos, mês/dia) e a prévia avisa quando dia e mês podem trocar de lugar.
160. ✅ **Painel da rede soma moedas diferentes e usa o fuso da primeira unidade** (back: painel da rede do dono, `getDashboard`): cada unidade tem a própria moeda (`Barbershop.currency`), mas o faturamento do mês, o comparativo de 6 meses e o "por unidade" somam todos os valores num número só. Esse número sai com a moeda e o fuso da primeira unidade. Uma rede com uma unidade no Brasil e outra em Portugal mostra R$ 10.000 quando são R$ 5.000 mais € 5.000, e o "mês" começa à meia-noite de São Paulo para as duas. **Fazer:** totais por moeda (como já é feito na prévia de encerrar a unidade) e o mês de cada unidade no fuso dela. Se a rede tiver uma moeda só, nada muda na tela. **Feito:** o mês, o comparativo e o dia de cada unidade usam o fuso dela, e cada moeda é somada à parte. Com uma moeda só, o painel continua com um número. Com mais de uma, cada moeda aparece na própria linha e no próprio gráfico.

### Vigésima oitava rodada (2026-10-14): permissões do backoffice, Connect, nota do cliente, histórico

Foram lidas as permissões por área de todas as operações do backoffice dentro do back (só as de admin da plataforma ficam sem área, como esperado), a conta de recebimento (Connect), a nota de conduta do cliente, o histórico de alterações (escopo por cargo), o registro e a retenção dos e-mails enviados e a fila de atendimento por ordem de chegada. Nada grave; ficam os pequenos abaixo.

161. ✅ **Pequenos, achados na leitura do código:**
     - **Conta de recebimento criada em dobro** (`ConnectService.startOnboarding`): dois cliques juntos em "Receber pelo app" criam duas contas no Stripe. A segunda gravação esbarra na chave única (`ownerType + ownerId`) e devolve erro 500, e a conta extra fica órfã no Stripe. **Fazer:** trava por dono (como no clube) ou chave de idempotência na criação. **Feito:** a criação fica sob trava por dono e a conta no Stripe usa a mesma chave de idempotência.
     - **Item de venda aceita histórico de atendimento de outra unidade** (`createSale`, `updateSale`): o `serviceHistoryId` dos itens não é conferido contra a unidade (o serviço e o produto são). **Fazer:** conferir junto com `ensureItemsOfBarbershop`. **Feito:** o histórico tem de ser desta unidade, na criação e na edição da venda.
     - **Fila por ordem de chegada: o profissional básico muda a situação de qualquer cliente da fila** (`updateWalkInStatus`): a função só exige estar na equipe. **Fazer:** o mesmo nível de quem agenda pelos outros (recepção para cima), ou só os da própria fila para o básico. **Feito:** recepção, gerente e dono mudam qualquer um. Barbeiro e básico só mudam a própria fila.
     - **Função sem uso** (`CouponsService.applyCoupon`): aplicava cupom num pagamento sem validar o cupom nem o dono. O caminho público já foi desligado (`applyCouponToPayment` recusa); a função ficou sem chamada. **Fazer:** apagar, para não voltar a ser usada por engano. **Feito:** a função foi apagada, junto com `registerUse`, que só ela chamava. O cupom continua só no checkout.

### Vigésima nona rodada (2026-10-14): backoffice-back e suspensão de conta

Foram lidas as consultas e escritas do backoffice-back (que lê o banco direto) depois das mudanças recentes do banco (unidade encerrada, valor devolvido do clube, vendas) e a desativação de conta pela equipe da plataforma. A desativação (sozinha, em lote e pela edição) já derruba as sessões e as notificações no celular.

162. ✅ **Conta do dono desativada pela plataforma: as unidades continuam no ar e cobrando** (back: `setUserActive`, `setMultipleUsersActive`, página pública, agendamento online, busca; backoffice-back: `users-writes.ts`): desativar a conta só tira o acesso dela. As unidades do dono continuam:
     - na busca e na página pública;
     - aceitando agendamento online, com sinal cobrado e caindo na conta de recebimento dele;
     - cobrando o clube dos clientes todo mês.
     
     O perfil do profissional já some com a conta desativada; a unidade não. Quando a plataforma suspende alguém por fraude, os clientes dele continuam pagando. **Fazer:** dono desativado tira as unidades da busca e da página pública e recusa agendamento online e venda do clube. O que já está marcado fica, com aviso no backoffice de quantos horários e assinaturas estão ativos. Reativar volta tudo. **Feito:** a vitrine, o sitemap, a lista de cidades, a página pública, os horários, a fila de espera, o agendamento online e a venda do clube exigem o dono da rede (e o da unidade, quando existe) ativo e não apagado. O que já está marcado não é cancelado, nem a assinatura que já cobra. A ficha da pessoa mostra quantos horários futuros e assinaturas do clube ainda estão ativos, e desativar pela edição ou em lote pede confirmação com esses números. Reativar a conta devolve a vitrine sem gravar outro estado.
163. ✅ **Backoffice "Pagamentos pelo app": total em moedas misturadas e o clube de fora** (backoffice-back: `finance.ts`, `appPayments`):
     - O total, o estornado e a taxa estimada somam sinal, atendimento pago e caixinha de todas as unidades num número só, sem olhar a moeda (o mesmo problema do item 160, no backoffice).
     - Os pagamentos do clube (`ClientSubscriptionPayment`) não entram na lista, nem os estornos deles (`refundedAmount`, item 128). O Financeiro não vê o dinheiro do clube que caiu na plataforma nem o que voltou para o cliente ao encerrar a unidade, e é ele quem registra o repasse manual.
     
     **Fazer:** totais por moeda. Tipo "clube" na lista, com o valor estornado. **Feito:** o total pago, o estornado e a taxa estimada saem por moeda (uma moeda continua num número só; várias não se somam). A lista inclui o clube (`SUCCEEDED`), com o valor já estornado e o número da assinatura. O estorno pelo botão desta tela continua só para sinal, atendimento pago e caixinha.

### Trigésima rodada (2026-10-14): tempo real, identidade, busca, sitemap, avisos

Foram lidos o tempo real (assinaturas GraphQL), a verificação de identidade (o nome do documento contra o da conta, e a verificação refeita quando o nome muda pelo app ou pelo backoffice), a busca pública de unidades e profissionais, o sitemap e a escolha de quem recebe os avisos de atividade (já filtra quem está ativo e no período do vínculo). Só um detalhe pequeno.

164. ✅ **Tempo real guarda as unidades da pessoa do momento em que a conexão abriu** (back: `RealtimeResolver.networkActivity`): a lista de unidades que a pessoa pode ouvir é calculada uma vez, quando a tela conecta. Quem é desligado continua recebendo os avisos de "algo mudou" da unidade até a página recarregar. Quem entra numa unidade nova não recebe os dela até recarregar. Os avisos levam só o tipo do que mudou (sem dados), então não vaza conteúdo, mas a tela de quem saiu continua se atualizando. **Fazer:** conferir o acesso a cada aviso (com cache curto), ou derrubar a conexão quando a pessoa sai da equipe (a sessão já cai). **Feito:** cada aviso relê as unidades da pessoa (a mesma regra de `getMyBarbershops`) se a lista da conexão tiver mais de 15 segundos. Quem saiu para de receber; quem entrou passa a receber. Dentro da janela a lista fica em memória.

### Trigésima primeira rodada (2026-10-14): e-mails, moderação, redes sociais

Foram lidos os modelos de e-mail (só `admin_notification` usa HTML sem escape, e o texto vindo dos avisos de atividade já passa por `escapeHtml`; o resto vem da equipe da plataforma), a denúncia e a moderação de conteúdo público e a publicação agendada nas redes sociais.

165. ✅ **Unidade encerrada continua publicando nas redes sociais** (back: `deleteBarbershop`; `SocialService.publishPost`; continuação dos itens 128 e 150): encerrar a unidade não desconecta o Facebook/Instagram (`SocialConnection` fica com o token) nem cancela as postagens agendadas (`SocialPost` em `SCHEDULED`). A rotina publica no dia marcado, com o link de agendar para uma página que não existe mais. O token da página também fica guardado sem uso. **Fazer:** no encerramento, cancelar as postagens agendadas (situação "cancelada pelo encerramento") e apagar a conexão. A publicação também recusa unidade encerrada. **Feito:** encerrar cancela as postagens agendadas e apaga a conexão (e a escolha de página pendente). Publicar também recusa unidade já encerrada.

### Trigésima segunda rodada (2026-10-14): front — moeda, datas e validações

Foram procurados no front a moeda fixa (só os planos da plataforma usam real; as telas da unidade passam a moeda dela), as datas lidas sem fuso (os horários da página pública já saem no fuso da unidade) e as validações que existem só na tela.

166. ✅ **Pequenos, achados na leitura do front:**
     - **Idade mínima do convite da equipe só na tela e só pelo ano** (front: `AcceptEmployeeInvite.tsx`; back: `acceptInvite`): a conta é "ano de hoje − ano de nascimento". Quem nasceu em 31/12/2013 passa como 13 anos em outubro de 2026. O back não confere idade nenhuma (pela API passa qualquer data). **Fazer:** idade pelo dia e mês, conferida também no back, com a idade mínima de trabalho definida (no Brasil, 16, ou 14 como aprendiz).
     - **Preço dos planos sempre no formato brasileiro** (front: `PricingTable`, `StripeCheckout`, `Invoice`, `ListPayments`, `FinancialIssues`): `formatCurrency(valor)` sem o idioma usa `pt-BR`. Quem usa o app em inglês ou espanhol vê "R$ 49,90" no formato brasileiro. A moeda (real) está certa. **Fazer:** passar o idioma da tela. **Feito:** a idade do convite conta dia e mês. No servidor e na tela, trabalhar exige 16 anos (aprendiz de 14 não é um cargo). Sem data, ou com data inválida, o convite não cria a conta. O preço dos planos continua em real e passa a usar o idioma da tela.

### Quadragésima rodada (2026-10-18): revisão das rodadas 33–39 e main vermelha

As três mains estavam vermelhas depois dos commits diretos (rodadas 33 a 39):
- **back:** `UsersModule` no lugar de `UserModule` (não compilava), Prettier em 11 arquivos e um `!` que o lint barra;
- **back:** 66 testes falhando. Os testes criavam o dono com `isActive` falso (o padrão do schema), e o item 162 passou a exigir o dono ativo. O cadastro de verdade já cria ativo, então só os testes mudaram;
- **backoffice-back:** consulta lendo uma coluna que não existe e 51 colunas novas sem tabela de teste;
- **front:** o e2e quebrava por causa do back que não compilava.

O pior: o back da main não subia. O passo "App sobe e responde" do CI acusa isso, mas como os testes falhavam antes, ninguém via. Duas causas:
- `EmployeeInviteService` não achava o `BarbershopService` por causa da importação circular `barbershop.service` → `job-opening.service` → `employee-invite.service` → `barbershop.service`, criada pelo `forwardRef` do item 171. Corrigido com `forwardRef` também no convite.
- `Barber.pendingInviteToken` era `string | null` sem o tipo explícito no `@Field`, e o GraphQL não montava o schema. Corrigido com `@Field(() => String)`.

Um deploy dessa main derrubaria a API.

Foi lido o código novo do back (convites, clube, sinal, caixinha, plano pela equipe, tempo real e vitrine) e da Operação no backoffice-back.

172. ✅ **Excluir a conta do dono quebrava no banco** (back: migração do item 169, `AccountDeletionService`): as FKs para `BarbershopService` (`AppointmentService`, `WalkInService`, `ServiceHistory`, `ServicePackage`, `ClientSubscriptionPlan`) passaram a `NO ACTION`, para o histórico do serviço ficar. Só que apagar a unidade ou a rede leva, em cascata, o serviço e o agendamento com o item dele. O Postgres confere a FK do serviço antes de a cascata apagar o item, e a exclusão de conta (LGPD) falhava com `AppointmentService_serviceId_fkey` para qualquer dono com um atendimento. **Feito:** as cinco FKs ficam `DEFERRABLE INITIALLY DEFERRED`. A conferência passa a ser no fim da transação, quando o item já saiu. Apagar só um serviço com histórico continua barrado.
173. ✅ **Operação: o GMV quebrava e a ficha contava checkout abandonado como assinatura** (backoffice-back: `results.ts`, `users.ts`):
     - O GMV somava `Appointment.price`, uma coluna que não existe, e o painel de Resultados dava erro. Agora soma quantidade × preço dos serviços do agendamento. É o preço de tabela: desconto dado no caixa não entra.
     - `activeClubSubscriptions` contava tudo que não fosse `CANCELED`, inclusive `INCOMPLETE` (checkout do clube que não pagou). Agora conta só `ACTIVE` e `PAST_DUE`. A coluna lida entrou no contrato (`public-columns.json`), que ainda não tinha `ClientSubscription.status`.
174. ✅ **Estorno do plano pela equipe deixa o plano valendo e a Stripe cobrando** (back: `PaymentsService.staffRefundPlanPayment`): o estorno devolve o dinheiro e marca o `Payment` como `REFUNDED`, mas não mexe na assinatura. `membership`, `proUntil`, `currentPeriodEnd` e a assinatura na Stripe ficam como estavam: a pessoa continua com o plano pago até o vencimento, e a Stripe cobra de novo na renovação. Estorno feito direto no painel da Stripe também não chega ao `Payment` (o `charge.refunded` só cuida do sinal, do atendimento pago, da caixinha e do clube). **Fazer:**
     - decidir o efeito do estorno: encerrar já, voltando ao plano grátis e cancelando na Stripe, ou só devolver e manter até o vencimento. Mostrar a escolha no backoffice;
     - sincronizar o `charge.refunded` do plano.
     
     **Feito:** estornar a cobrança do período atual da assinatura ativa encerra o plano na hora: a assinatura na Stripe é cancelada (sem nova cobrança), a conta volta ao plano gratuito e o pagamento fica `REFUNDED`. Cobrança de um período anterior só devolve o dinheiro. O `charge.refunded` (e o `refund.updated`) do plano tem o mesmo efeito quando o estorno é total; o parcial não muda o plano. Marcar como estornado é uma vez só, então o webhook do próprio estorno da equipe não repete nada. No backoffice, o botão "Estornar" agora pede confirmação e explica o efeito.
175. ✅ **Reenviar convite pelo backoffice falha se quem convidou saiu da unidade** (back: `EmployeeInviteService.resendByStaff`): o reenvio da equipe da plataforma chama `resendInvite(invite.inviterId, …)`, que exige que quem convidou ainda seja gerente da unidade (`ensureAccess(..., 'manager')`). Gerente desligado, ou dono que passou a unidade adiante, faz o reenvio pelo backoffice dar "sem acesso", justamente no caso em que a plataforma precisa ajudar. **Fazer:** separar o reenvio (novo token, prazo e e-mail) da checagem de acesso. A equipe da plataforma chama direto, sem trocar o `inviterId`. **Feito:** o reenvio (novo link, mais 30 dias e o e-mail) ficou separado da checagem de acesso. O gerente continua passando por ela; a equipe da plataforma reenvia direto, e o convite continua no nome de quem convidou.
176. ✅ **Repasse do sinal: o "a repassar" do período mistura datas** (back: `DepositPaymentService.payoutReport`): os sinais entram pela data da cobrança (`depositPaidAt`) e os repasses manuais pela data do repasse (`DepositPayout.paidAt`). Repassar em novembro os sinais de outubro deixa outubro positivo e novembro negativo, e nenhum dos dois meses diz o que ainda falta pagar. Sinal estornado depois de repassado some do bruto (`depositRefundedAt: null`) sem aparecer como valor a receber de volta. O arredondamento é sempre em 2 casas, mesmo em moeda sem centavos (iene, peso chileno). **Fazer:** "a repassar" como saldo acumulado (todos os sinais menos todos os repasses até o fim do período), estorno depois do repasse como linha própria, e `roundMoney` com a moeda da unidade. **Feito:** o "a repassar" (`netOwedToBarbershop`) passou a ser o saldo até o fim do período: tudo o que foi cobrado menos a taxa, o que caiu direto na conta da unidade e os repasses manuais. Negativo quer dizer que a unidade recebeu a mais, e a tela mostra "A devolver à plataforma". O estornado das cobranças do período sai numa linha própria (`refundedAmount`), e o arredondamento segue a moeda da unidade. O relatório do clube (`subscriptionRevenueReport`) tinha o mesmo problema e usa a mesma conta.

### Quadragésima primeira rodada (2026-10-18): repasses e "em risco" no backoffice

Foram lidos a lista "a repassar" e a tela "em risco" da Operação (backoffice-back: `ops.ts`, `results.ts`), o registro de repasse manual (`admin-writes.ts`) e o resumo do aluguel da cadeira (back: `ChairRentService.view`).

177. ✅ **"A repassar" do backoffice soma errado** (backoffice-back: `OpsQueries.payoutsDue` e `stillOwed` em `results.ts`): a lista das unidades com dinheiro na plataforma, e o total da tela de Resultados, fazem clube + aluguel por cartão − repasses do clube − repasses do sinal. Erros:
     - **Aluguel sem a taxa:** entra o valor cheio do aluguel pago por cartão, mas a plataforma fica com a taxa (`ChairRentService.view` desconta). O devido sai maior.
     - **Sinal pela metade:** os repasses do sinal (`DepositPayout`) são descontados, mas o sinal que ficou na plataforma (cobrado sem Connect) não entra. Uma unidade com sinal a receber aparece com menos, ou some da lista.
     - **Moedas misturadas:** só entra o que é em real, mas os repasses de qualquer moeda são descontados.
     - **Taxa do clube vazia vira 0%:** o back usa a taxa de hoje (relatório do clube, item 176). As duas telas dão números diferentes para a mesma unidade.
     
     **Fazer:** a mesma conta do relatório da unidade (item 176) para cada tipo, cada uma descontando só os próprios repasses, e por moeda.
     
     **Feito:** a lista "a repassar" e o total dos Resultados usam uma conta só (`payouts.ts`). Clube, aluguel por cartão e sinal que ficou na plataforma são calculados separados, cada um sem a taxa de quando foi cobrado (sem taxa gravada, a de hoje em Preços e taxas) e menos os próprios repasses. Cada unidade aparece na própria moeda. O total dos Resultados soma só as unidades em real, como o resto da página. Na tela de repasses, cada tipo tem a sua coluna e o repasse é registrado no tipo escolhido (por padrão, o que tem mais a repassar). Antes, tudo virava repasse do clube.
178. ✅ **Aluguel da cadeira por cartão não tem registro de repasse** (back: `ChairRentService.view`; backoffice-back: `admin-writes.ts`): o aluguel pago por cartão cai na conta da plataforma e o espaço precisa receber, mas não existe onde registrar esse repasse (há `SubscriptionPayout` e `DepositPayout`). Consequências:
     - o "a repassar" que o espaço vê (`payoutDue`) é todo o cartão desde o começo menos a taxa, e nunca diminui;
     - no backoffice, a única saída é registrar o repasse como "do clube". Isso tira do saldo do clube da unidade (item 176), que fica negativo, e o espaço continua vendo o aluguel como devido;
     - a taxa é a de hoje aplicada a todo o histórico: mudar a taxa muda o que já foi cobrado meses atrás.
     
     **Fazer:** `ChairRentPayout` (ou um tipo no repasse) e a tela do backoffice para registrar. Gravar a taxa em cada pagamento do aluguel, como no sinal e no clube. O `payoutDue` vira saldo (cobrado − taxa − repassado).
     
     **Feito:** nova tabela `ChairRentPayout`, para o repasse ao espaço registrado no backoffice (`recordChairRentPayout`). Cada aluguel pago por cartão grava a taxa da cobrança (`ChairRentPayment.platformFeePercent`). O "a repassar" que o espaço vê passou a ser o saldo de todos os aluguéis no cartão dele: cobrado − taxa − repassado.
179. ✅ **"Em risco": o plano em atraso nunca aparece, e a unidade da rede sempre aparece** (backoffice-back: `OpsQueries.atRisk`):
     - O motivo "plano em atraso" procura `Subscription.status = 'PAST_DUE'`, que não existe: a assinatura do plano só é `ACTIVE` ou `INACTIVE`, e o atraso fica em `User.membership = 'PAST_DUE'`. Nenhuma unidade cai nesse motivo.
     - Login e plano são do `Barbershop.ownerUserId`. Unidade sem dono próprio (o dono é o da rede, `Network.ownerUserId`) não tem login nenhum e entra sempre como "dono sem entrar".
     
     **Fazer:** o dono é o da unidade ou, sem ele, o da rede (a regra de `ownerAcceptsPublic`), e o atraso vem do `membership`.
     
     **Feito:** o dono é o da unidade ou, sem ele, o da rede (a mesma regra da vitrine), e o atraso vem do `User.membership`.

### Quadragésima segunda rodada (2026-10-18): estorno do aluguel, unidade pausada, Destaque

Foram lidos o fechamento do caixa (soma o que entrou em dinheiro, já sem o sinal e o pago antes), o uso de sessão do clube (exige assinatura ativa, com baixa condicional e reenvio do webhook sem zerar o ciclo), o estorno de pacote e de vale-presente e o prazo do Destaque (soma ao que falta).

180. ✅ **Aluguel da cadeira estornado continua como pago** (back: `AppPaymentsService.syncStripeRefund`, `ChairRentService`): o `charge.refunded` cuida do sinal, do atendimento pago antes, da caixinha, do clube e das compras da plataforma, mas não do aluguel pago por cartão (fatura da assinatura `chair-rent`). Estornado pelo painel da Stripe, o pagamento fica `SUCCEEDED`:
     - o espaço continua vendo esse valor como recebido e a repassar (item 178), e o backoffice também;
     - a despesa "Aluguel" lançada no negócio do profissional continua lá;
     - o `rentPaidUntil` continua valendo.
     
     **Fazer:** sincronizar o estorno do aluguel pela fatura (`stripeInvoiceId`), como o do clube. Gravar o valor devolvido, tirar do repasse e da despesa do profissional, e no total voltar o período pago.
     
     **Feito:** o `charge.refunded` (e o `refund.updated`) da fatura do aluguel grava o devolvido (`ChairRentPayment.refundedAmount`, só sobe). Esse valor sai do recebido, do repasse ao espaço (no back e no backoffice) e da despesa "Aluguel" do profissional, que some se o estorno é total. Estorno total da fatura do período atual devolve o "pago até" para o começo do período.
181. ✅ **Unidade pausada continua cobrando o clube, e quem pausa pode ser o gerente** (back: `updateBarbershop`): desmarcar "Ativa" na edição tira a unidade da busca, da página pública e do agendamento online, mas as assinaturas do clube continuam cobrando todo mês na Stripe. O cliente paga por sessões numa unidade que não aceita horário. Encerrar a unidade cancela o clube (item 128); pausar não faz nada. Além disso, a edição exige só o cargo de gerente, então um gerente tira a unidade do ar sozinho, e reativar também é com ele.
     
     **Fazer:** pausar (e reativar) só pelo dono. Com assinaturas do clube ativas, pedir confirmação e pausar a cobrança na Stripe (`pause_collection`) enquanto a unidade estiver pausada, ou cancelar como no encerramento.
     
     **Feito:** pausar ou reativar a unidade (`isActive` na edição) passou a ser só do dono. Ao pausar, as assinaturas do clube ativas ou em atraso têm a cobrança suspensa na Stripe (`pause_collection`, a fatura nem é gerada) e ficam marcadas (`ClientSubscription.shopPausedAt`). Ao reativar, voltam só essas. O front não tinha botão de pausar; a regra vale para a API.
182. ✅ **Destaque comprado para unidade que não aparece na busca** (back: `FeaturedPaymentService.target`): para o profissional, a compra confere se a página pública existe (`publicProfile`). Para a unidade, não confere nada além do cargo. Uma unidade pausada, suspensa pela plataforma, escondida da busca (`searchHiddenAt`) ou com o dono desativado (item 162) pode comprar 30 dias de Destaque e não aparecer em lugar nenhum. O prazo também corre enquanto a plataforma mantém a unidade suspensa.
     
     **Fazer:** recusar a compra (ou avisar antes de pagar) quando a unidade não passa pela regra da vitrine (`ownerAcceptsPublic`, `isActive`, sem `searchHiddenAt`). Ao suspender pela plataforma, devolver os dias que faltavam no fim da suspensão.
     
     **Feito:** a compra de Destaque da unidade usa a mesma regra da vitrine (ativa, sem `searchHiddenAt`, não encerrada, sem suspensão e com o dono ativo). Fora dela, o `featuredStatus` responde `notListed` (a tela explica) e a compra é recusada. No backoffice, tirar a suspensão da unidade ou da rede devolve os dias de Destaque que correram suspensos. Suspender de novo não muda mais o começo da suspensão.

### Quadragésima terceira rodada (2026-10-18): comissão paga e dados de base da unidade

Foram lidos o apagar e o editar venda (devolvem vale-presente, pontos, pacote, sessão do clube e estoque), a baixa de estoque (negativo é proposital e comentado), o limite de agendamento online por cliente (já existe) e o cálculo da comissão (pela data em que a venda foi paga, com desconto e sessão coberta).

183. ✅ **Venda apagada ou editada depois de pagar a comissão some sem ajuste** (back: `deleteSale`, `updateSale`, `PayrollService`):
     - O período em aberto do profissional começa no dia seguinte ao último pagamento (`BarberPayout`). Apagar a venda, trocar o profissional, mudar o valor ou voltar de "paga" para "pendente" numa venda de um período já pago não trava nem gera ajuste. O profissional fica com a comissão de uma venda que não existe mais, ou deixa de receber a de uma venda que passou para ele.
     - O estorno do saldo de pacote ou vale-presente (`refundIssuedRemainder`) é lançado sem profissional (`barberId` vazio). Se a regra de comissão cobre `PACKAGE` ou `GIFT_CARD`, quem vendeu continua com a comissão do que foi devolvido.
     
     **Fazer:** venda de período já pago não pode mudar o que conta para a comissão (valor, profissional, itens, situação), nem ser apagada; a correção vira um lançamento (`BarberPayEntry` de desconto ou bônus) no período em aberto, com o motivo. O estorno de saldo leva o profissional da venda original.
     
     **Feito:** apagar ou editar uma venda paga cuja data já está num pagamento de comissão do profissional não trava. A diferença da comissão vira um lançamento no período em aberto: desconto quando diminui ou a venda é apagada, bônus quando aumenta, com o número da venda na nota. Se a venda passa para outro profissional que já recebeu aquele período, ele ganha o bônus. O que foi pago não é reescrito. O estorno do saldo de pacote ou vale-presente leva o profissional da venda, e item negativo entra na comissão (antes ficava zerado), descontando o que voltou. O estorno não conta como venda a mais.
184. ✅ **Moeda e fuso da unidade editáveis por gerente, sem validação** (back: `UpdateBarbershopInput`, `updateBarbershop`): a API aceita `currency` e `timezone` como texto livre, de qualquer gerente.
     - Uma moeda inválida ("R$", "real") derruba a formatação de dinheiro nas telas (`Intl.NumberFormat` lança erro) e a Stripe recusa as cobranças.
     - Uma moeda válida, mas diferente, reinterpreta todo o histórico (vendas, clube, sinal e repasses são gravados sem moeda) e deixa os preços do clube na Stripe na moeda antiga.
     - O backoffice já valida o formato (`assertShopBase`); o app não.
     - No front, a edição muda o país sem recalcular moeda e fuso: uma unidade que passa de BR para PT continua em real e no fuso de São Paulo.
     
     **Fazer:** validar como o backoffice (moeda ISO de 3 letras, fuso IANA válido). Trocar a moeda só pelo dono, e recusar se a unidade já tem dinheiro registrado (venda paga, clube, sinal ou aluguel); nesse caso o caminho é o backoffice. Ao trocar o país, sugerir moeda e fuso do país (`place-locale`).
     
     **Feito:** a edição só aceita fuso IANA válido e moeda ISO 4217. Trocar a moeda é só do dono e é recusado se a unidade já tem dinheiro registrado (venda paga, clube, sinal ou pago antes, aluguel); nesse caso o caminho é o backoffice. Trocar o país sem informar a moeda traz o fuso do país e, se ainda não há dinheiro registrado, a moeda dele.

### Quadragésima quarta rodada (2026-10-18): lista de espera, disputa perdida e fila de chegada

Foram lidos a lista de espera (entrada manual e online, aviso no cancelamento e na abertura de horário, repasse da vaga para o próximo da fila), o sitemap (respeita suspensão e moderação), o lembrete de agendamento, as disputas da Stripe e as permissões dos cargos nos endpoints que usam o nível padrão (`barber`).

185. ✅ **Lista de espera nunca fecha: dia passado e cliente que já agendou continuam na fila** (back: `WaitlistEntry`, `joinPublicWaitlist`, `checkWaitlistOnCancellation`):
     - Nenhum job encerra as entradas de dias que já passaram: elas ficam `WAITING` (ou `NOTIFIED`) para sempre. O limite de 5 entradas online por cliente (`WAITLIST_MAX_ONLINE_PER_CUSTOMER`) conta essas entradas velhas, sem filtro de data; depois de 5 dias de espera ao longo do tempo, o cliente nunca mais consegue entrar em nenhuma lista ("Você já está na lista de espera de 5 dias").
     - A tela da equipe (`getWaitlistEntries`) acumula entradas de dias passados como "aguardando".
     - Quando o cliente agenda aquele dia (pelo link do aviso ou por conta própria), a entrada continua `WAITING`/`NOTIFIED`. Um cancelamento depois avisa de novo quem já tem horário, e a vaga deixa de ir para o próximo da fila.
     - O aviso de vaga sai também quando a unidade está pausada (`isActive = false`) ou suspensa pela plataforma, com link para uma página que não aceita agendamento.
     - A entrada manual (`createWaitlistEntry`) aceita dia no passado ou a anos de distância, sem o limite de 60 dias da online.
     
     **Fazer:** um job diário encerra (status `EXPIRED`) as entradas de dias que já passaram no fuso da unidade; o limite por cliente conta só as de hoje em diante. Agendar (pela equipe ou online) o dia de uma entrada do mesmo cliente na mesma unidade fecha a entrada (`BOOKED`). Unidade pausada ou fora da vitrine não avisa ninguém. A entrada manual segue a mesma janela da online (hoje até 60 dias).
     
     **Feito:** um job de hora em hora fecha o que ficou para trás: entrada de dia que já passou (no fuso da unidade) vira `EXPIRED`, e entrada de quem já tem horário na unidade naquele dia vira `BOOKED`. Antes de avisar alguém (cancelamento, horário novo ou vaga repassada), a mesma checagem roda na hora, e quem já agendou não é avisado. O limite de 5 por cliente conta só os dias de hoje em diante. Unidade pausada, encerrada ou fora da vitrine não avisa ninguém. A entrada pela equipe segue a janela da online (hoje até 60 dias). A tela da lista de espera mostra "Agendou" e "Vencido".
186. ✅ **Disputa perdida não sai do repasse** (back: `AppPaymentsService.recordDispute`; backoffice-back: `payoutBalances`):
     - Quando o cliente abre disputa no cartão e a plataforma perde, o dinheiro volta para ele (com a tarifa da disputa). Hoje a disputa perdida só desfaz compra da plataforma (Destaque, taxa da vaga).
     - Fatura do clube e sinal cobrados na conta da plataforma (sem Connect) e aluguel de cadeira no cartão continuam como recebidos: o "a repassar" do backoffice e o relatório de repasse do app mostram esse valor como devido à unidade, e a plataforma paga do próprio bolso um dinheiro que já devolveu.
     - Ganhar a disputa depois de um "lost" provisório não é o caso: o status final é só um.
     
     **Fazer:** disputa perdida marca o pagamento de origem como devolvido (`refundedAmount` no clube e no aluguel, `depositRefundedAt` no sinal, pelo `payment_intent`/fatura), do mesmo jeito que o estorno pela Stripe, e entra no relatório. Se o repasse já foi feito, o saldo fica negativo (a unidade recebeu a mais), como no estorno.
     
     **Feito:** quando a disputa passa a "perdida" (uma vez só), o webhook busca a cobrança na Stripe e trata o valor disputado como estorno, pelo mesmo caminho do estorno pelo painel: fatura do clube e do aluguel (`refundedAmount`), sinal, atendimento pago, caixinha e plano do dono. Disputa de parte da cobrança devolve só a parte. Sem a cobrança, usa o pagamento da disputa. O "a repassar" do backoffice e o relatório do app passam a descontar o valor.
187. ✅ **Fila de chegada: telefone escondido volta na resposta e barbeiro põe cliente na fila de outro** (back: `updateWalkInStatus`, `createWalkIn`):
     - `getWalkIns` esconde o telefone do cliente para quem não pode ver contato (`hideWalkInContact`), mas `updateWalkInStatus` devolve o registro inteiro: o barbeiro muda o status de um cliente da própria fila e recebe o `customerPhone` que a lista escondia.
     - `createWalkIn` aceita qualquer `barberId` da unidade para o barbeiro, enquanto no agendamento o barbeiro só marca na própria agenda (`ensureCanBookForBarber`). Ele põe clientes na fila de colegas, e depois não consegue mexer neles (`updateWalkInStatus` só deixa a própria fila).
     
     **Fazer:** a resposta de `updateWalkInStatus` (e de `createWalkIn`) passa por `hideWalkInContact`. Na criação, barbeiro e barbeiro básico só põem na própria fila (ou sem profissional); recepção para cima, em qualquer uma.
     
     **Feito:** criar e mudar o status de cliente na fila passam a resposta por `hideWalkInContact`, como a lista. Barbeiro só põe cliente na própria fila (ou sem profissional); recepção para cima, em qualquer uma.

### Quadragésima quinta rodada (2026-10-19): rede com mais de uma moeda e resultados do backoffice

Foram lidos o caixa (abrir, fechar e o esperado em dinheiro: vendas, despesas, aluguel e caixinha), o pacote de sessões (validade e sessão coberta), o pedido de avaliação (nota inteira de 1 a 5, só atendimento concluído), o vale-presente, a fidelidade e a taxa de no-show, e as contas de "Resultados" e "Financeiro" do backoffice.

188. ✅ **Vale-presente, pontos e taxa fixa de no-show ignoram a moeda da unidade** (back: `GiftCard`, `createGiftCard`, `createSale`, fidelidade e `NoShowFee` na `Network`):
     - Desde o item 184, cada unidade tem a própria moeda, e uma rede pode ter unidades em países diferentes (BR e PT, por exemplo).
     - O vale-presente é da rede e não guarda moeda. Um vale de 100 vendido em real é aceito numa unidade em euro como 100 euros, e vice-versa.
     - A fidelidade (`loyaltyPointsPerCurrencyUnit`, `loyaltyPointValue`) e a taxa fixa de no-show (`noShowFeeValue` com tipo `FIXED`) são um número só para a rede: 1 ponto por real e 1 ponto por iene não são a mesma coisa, e a taxa fixa de 30 vira 30 euros na unidade de Portugal.
     - `createGiftCard` não passa o valor por `checkMoney` (sem teto, como os outros valores de dinheiro).
     
     **Fazer:** o vale-presente grava a moeda da unidade que vendeu (sem unidade, a da rede) e só é aceito em unidade da mesma moeda (mensagem clara na consulta e na venda). Pontos ganhos e resgatados e a taxa fixa de no-show valem só nas unidades na moeda da rede; nas outras, a fidelidade e a taxa fixa ficam desligadas até haver configuração por moeda. O valor do vale passa por `checkMoney`.
     
     **Feito:** o vale-presente grava a moeda da unidade que vendeu (sem unidade, a da rede; os antigos ficam na da rede, pela migração) e só é aceito, na consulta e na venda, em unidade da mesma moeda. O valor do vale passa por `checkMoney`. Numa unidade em moeda diferente da rede, a fidelidade fica desligada (ganhar, resgatar e consultar pontos) e a taxa fixa de no-show não é gerada nem mostrada na política da página pública; a taxa em percentual continua valendo. No front, a lista de vales mostra cada um na moeda dele, e o valor do vale novo aparece na moeda da unidade que vende.
189. ✅ **"Resultados" do backoffice: o repassado não inclui o aluguel e mistura moedas** (backoffice-back: `results.ts`, `finance.ts`):
     - `paidOut` soma `SubscriptionPayout` e `DepositPayout`, mas não o `ChairRentPayout` (repasse do aluguel, item 178). O aluguel no cartão entra no `passThrough` (dinheiro de terceiros que passou pela plataforma) e o repasse dele nunca sai: o saldo do período fica sempre maior do que é.
     - Os repasses não filtram moeda: repasse em euro é somado aos valores em real. Todo o resto do quadro já separa (`currency = 'BRL'`, com "outras moedas" à parte).
     - O `passThrough` não desconta o aluguel estornado (`refundedAmount`, item 180) e não inclui o sinal cobrado na conta da plataforma (sem Connect), que tem repasse próprio (`DepositPayout`, item 176). Entra o repasse do sinal, mas não o dinheiro que ele repassa.
     - No "Financeiro", o total do Destaque (`totalCents`, `last30Cents`) soma compras de todas as moedas e mostra tudo como real.
     
     **Fazer:** `paidOut` soma os três repasses, só das unidades em real (os outros contam em "outras moedas"). `passThrough` desconta o aluguel estornado e inclui o sinal sem Connect não estornado. O total do Destaque no "Financeiro" filtra a moeda da plataforma (e conta o resto à parte, como em "Resultados").
     
     **Feito:** em "Resultados", o repassado soma clube, sinal e aluguel, só das unidades em real. O dinheiro de terceiros desconta o aluguel estornado e inclui o sinal cobrado na conta da plataforma que não voltou. No "Financeiro", o total do Destaque conta só as compras em real.

### Quadragésima sexta rodada (2026-10-19): unidade fora do ar pelos links do atendimento e campanha repetida

Foram lidos o convite de equipe (cargos válidos, convite vencido, pessoa que já está na equipe), apagar e editar cliente (anonimiza, recusa com horário marcado), o bloqueio de cliente (pega o telefone em qualquer formato), o chat do atendimento, a caixinha pelo app, o pedido de avaliação, as postagens agendadas nas redes e a campanha de marketing.

190. ✅ **Unidade encerrada ou suspensa continua recebendo pelos links do atendimento** (back: `TipService`, `ReviewRequestService`, `ChatService`, `SocialService.publishPost`, `sendMarketingBlast`):
     - Os links do e-mail do atendimento (caixinha, avaliação, conversa) só olham o atendimento e o token. Uma unidade encerrada (`closedAt`) ou suspensa pela plataforma (`platformSuspendedAt`, da unidade ou da rede) continua:
       - recebendo caixinha pelo app na conta Connect dela ou do profissional (`startAppTip` só checa `chargesEnabled`);
       - recebendo avaliação nova no link (`submitReview`), que entra na nota da página;
       - recebendo mensagens do cliente no chat, que ninguém da equipe lê (encerrada: ninguém tem acesso) e que avisam a equipe de uma unidade suspensa.
     - Profissional suspenso pela moderação (`Professional.suspendedAt`) também continua recebendo caixinha pelo app.
     - A unidade suspensa continua publicando as postagens agendadas no Facebook e no Instagram (só o encerramento cancela) e disparando campanha de marketing para os clientes.
     
     **Fazer:** caixinha pelo app, avaliação e mensagem do cliente recusam atendimento de unidade encerrada ou suspensa (unidade ou rede), com mensagem clara; caixinha para profissional suspenso também. A página do link mostra que a unidade não está recebendo. Postagem agendada de unidade suspensa fica parada (não publica nem cancela) até a suspensão sair. Campanha de marketing recusada enquanto a unidade ou a rede está suspensa.
     
     **Feito:** caixinha pelo app (página e pagamento), avaliação (página e envio) e mensagem do cliente no chat recusam atendimento de unidade encerrada ou suspensa (ela ou a rede), com a mensagem "não está recebendo pelo app" (`SHOP_NOT_RECEIVING`). Profissional suspenso pela moderação sai dos destinos da caixinha. Postagem agendada de unidade suspensa fica parada, sem publicar nem cancelar, até a suspensão sair. Campanha de marketing é recusada com a unidade ou a rede suspensa.
191. ✅ **Campanha de marketing manda a mesma mensagem várias vezes para a mesma pessoa** (back: `sendMarketingBlast`, `resolveMarketingSegment`):
     - A rede pode ter mais de uma ficha da mesma pessoa: a equipe cadastrou com o telefone num formato e o cliente agendou online em outro, ou o mesmo e-mail com telefones diferentes.
     - A campanha monta a lista por ficha, sem juntar e-mail nem telefone. A mesma pessoa recebe o mesmo e-mail e o mesmo WhatsApp duas ou três vezes, e o limite de e-mails do mês é gasto com repetidos.
     - Quem saiu das campanhas numa ficha (`marketingOptOut`) continua recebendo pela outra quando o e-mail é diferente mas o telefone é o mesmo (o descadastro só vale para fichas com o mesmo e-mail), e o WhatsApp vai para o telefone de quem saiu.
     
     **Fazer:** a lista da campanha junta por e-mail (sem diferença de caixa) e por telefone normalizado (E.164): um envio por endereço. Se qualquer ficha com o mesmo e-mail ou o mesmo telefone saiu das campanhas, nenhuma recebe. A contagem de destinatários e o limite do mês usam a lista já sem repetidos.
     
     **Feito:** a lista da campanha (e a prévia) junta as fichas por e-mail sem diferença de caixa e por telefone normalizado: a mesma pessoa conta e recebe uma vez. Quem saiu das campanhas em qualquer ficha da rede com o mesmo e-mail ou o mesmo telefone fica de fora, inclusive do WhatsApp. Os telefones do WhatsApp também saem sem repetidos.

### Quadragésima sétima rodada (2026-10-19): vaga preenchida sem ninguém e conta excluída na lista de espera

Foram lidos remarcar e cancelar pelo link do cliente (estorno do sinal, aviso e lista de espera), as vagas para freelancer (taxa, aceite, encerrar), a compra de Destaque (só para quem está na vitrine), a verificação de identidade (nome trocado perde a verificação, também pelo backoffice) e a exclusão de conta do cliente e do profissional.

192. ✅ **Candidato aceito que nunca entra na equipe preenche a vaga e fica com a taxa** (back: `JobOpeningService`, `EmployeeInviteService`, `AccountDeletionService`):
     - Aceitar a candidatura cobra a taxa, marca `accepted` e cria o convite; quando as vagas aceitas chegam a `slots`, a vaga vira `filled` e as outras candidaturas são recusadas.
     - Se o profissional não aceita o convite (vence em 30 dias), a equipe cancela o convite ou o período da vaga acaba antes do aceite, nada volta: a candidatura continua `accepted`, a vaga continua preenchida e a taxa não é devolvida.
     - Conta de profissional excluída (LGPD) continua com as candidaturas pendentes, como "Conta excluída". A unidade pode aceitar, pagar a taxa e mandar o convite para o e-mail anonimizado, que ninguém recebe.
     
     **Fazer:** convite de candidatura que vence, é cancelado ou não é aceito até o fim do período da vaga devolve a candidatura (`expired`), reabre a vaga se ela tinha ficado preenchida e devolve a taxa (com aviso para quem pagou). Excluir a conta retira as candidaturas pendentes (`withdrawn`) e cancela os convites ainda não aceitos; aceitar candidatura de conta excluída é recusado.
     
     **Feito:** uma rotina de hora em hora libera a candidatura aceita cujo convite venceu, foi cancelado ou sumiu, ou cujo período acabou sem o aceite: a candidatura vira `expired`, o convite pendente deixa de valer (e o cadastro criado por ele sai da equipe ativa), a taxa volta no cartão uma vez só e a vaga preenchida reabre se o período ainda não acabou. Candidato e quem pagou recebem aviso. Excluir a conta do profissional retira as candidaturas pendentes e cancela os convites pendentes para o e-mail dele; aceitar candidatura de conta excluída é recusado.
193. ✅ **Conta de cliente excluída continua na lista de espera e recebendo avisos** (back: `ClientAuthService.deleteAccount`, `WaitlistEntry`):
     - A exclusão da conta (LGPD) apaga conversas, avaliações, favoritos e tira a ligação das fichas, mas não mexe na lista de espera.
     - A entrada online guarda o e-mail informado (`contactEmail`) e o nome. Depois da exclusão, a pessoa continua `WAITING` e recebe o aviso de vaga no e-mail, e a equipe continua vendo o nome e o e-mail na tela da lista.
     
     **Fazer:** excluir a conta cancela as entradas da lista de espera das fichas ligadas a ela (e as online com o e-mail da conta) e apaga o `contactEmail` delas, na mesma transação.
     
     **Feito:** excluir a conta do cliente cancela as entradas da lista de espera das fichas ligadas e as online com o e-mail da conta, e apaga o e-mail informado nelas, na mesma transação.

### Quadragésima oitava rodada (2026-10-19): falhas intermitentes da CI

Com o log das execuções que falharam e passaram na segunda tentativa (#282 no back, #150 no front), as duas falhas vieram de causas reais.

194. ✅ **Busca pública cai inteira quando uma unidade some no meio** (back: `searchPublicBarbershops`): a busca faz duas consultas (candidatas e, depois, os dados do card das que vão aparecer). Uma unidade apagada entre as duas (exclusão de conta do dono, por exemplo) fazia o `must` lançar "unidade N ausente" e a busca devolvia erro para quem estava buscando. Na CI, outro teste apagava uma unidade em paralelo.
     
     **Feito:** a unidade que sumiu entre as consultas sai do resultado. Teste simula a unidade apagada entre as duas consultas.
195. ✅ **E2E de avaliações falha de novo na nova tentativa** (front: `e2e/closures-reviews.spec.ts`): quando a primeira tentativa caía no meio, o horário criado pelo teste ficava, e a nova tentativa usava o mesmo horário: "Este profissional já tem um agendamento nesse horário".
     
     **Feito:** o teste apaga os horários que sobraram do cliente fixo antes de criar o novo, como o teste da agenda já fazia.

### Quadragésima nona rodada (2026-10-19): valores do catálogo

Foram lidos o clube de assinatura (sessões por ciclo, cancelamento, sessão devolvida ao apagar a venda), os produtos, o estoque e o cadastro de serviços.

196. ✅ **Catálogo aceita qualquer número: serviço sem duração, preço negativo, sinal maior que o preço** (back: `createService`, `updateService`, `createProduct`, `updateProduct`, `adjustInventory`, `updateInventoryItem`):
     - Duração do serviço zero, negativa ou fracionada passava; a agenda e os horários livres usam essa duração.
     - Preço do serviço e do produto (e o custo) podiam ser negativos ou absurdos, enquanto o resto do dinheiro do app passa por `checkMoney`.
     - O sinal online podia ser maior que o preço do serviço (o cliente pagava de sinal mais do que o atendimento custa), inclusive baixando o preço depois.
     - Custo zero do produto virava "sem custo" (`null`).
     - O ajuste manual de estoque aceitava qualquer texto como tipo (inclusive `SALE`, que é o da baixa da venda) e quantidade zero; o estoque mínimo aceitava negativo.
     
     **Feito:** duração de 1 minuto a 12 horas, em minutos inteiros; preço, sinal, preço de venda e custo passam por `checkMoney` (sem negativo, com teto na moeda da unidade); o sinal não passa do preço que vai ficar (o novo ou o atual). Custo zero fica zero. O ajuste de estoque aceita só `PURCHASE`, `ADJUSTMENT`, `LOSS` e `TRANSFER` e quantidade diferente de zero; o mínimo não pode ser negativo. O formulário de serviço do front confere a duração máxima e o sinal acima do preço antes de enviar.

### Quinquagésima rodada (2026-10-19): despesas e indicação

Foram lidos as despesas (lançar, listar, apagar e o resumo financeiro), o fechamento do caixa, o aluguel da cadeira pago à mão e a fidelidade com indicação.

197. ⬜ **Despesa aceita forma de pagamento, categoria e data quaisquer** (back: `createExpense`, `expenses`, `financialSummary`):
     - A forma de pagamento e a categoria são texto livre. O fechamento do caixa só conta `paymentMethod: 'CASH'`, então uma despesa em dinheiro gravada como "cash" ou "Dinheiro" fica fora do esperado da gaveta, e o resumo por categoria divide a mesma categoria em várias linhas. A venda já passou por isso (`SALE_PAYMENT_METHODS`).
     - A data "AAAA-MM-DD" vira meia-noite UTC, que no Brasil é o dia anterior: a despesa do dia 1º cai no mês anterior nos relatórios.
     - Data inválida (na despesa ou no `from`/`to` das consultas) vira `Invalid Date` e a API responde erro 500.
     - A despesa com data passada entra no caixa aberto de hoje e muda o esperado da gaveta de hoje.
     - Descrição sem limite de tamanho e categoria vazia passam.
     
     **Fazer:** forma de pagamento só dos valores conhecidos (os da venda) e categoria só das conhecidas (`RENT`, `UTILITIES`, `SUPPLIES`, `SALARY`, `MAINTENANCE`, `OTHER`, mais as que o sistema lança). Data só no formato de dia, gravada no fuso da unidade, e não futura. Data inválida responde 400. Só a despesa de hoje (no fuso da unidade) entra no caixa aberto. Descrição obrigatória com limite de tamanho.
198. ⬜ **Bônus da indicação fica com quem indicou depois que a venda é apagada** (back: `deleteSale`, `updateSale`): a primeira venda paga do indicado completa a indicação e dá os pontos a quem indicou (`completeReferralIfPaid`). Apagar essa venda, ou voltar ela para pendente, devolve os pontos da própria venda, mas não mexe na indicação: quem indicou continua com o bônus e a indicação continua completa. Dá para lançar uma venda paga para o indicado, apagar em seguida e o bônus fica.
     
     **Fazer:** gravar na indicação qual venda a completou. Quando essa venda é apagada ou volta para pendente, tirar o bônus de quem indicou (sem deixar o saldo negativo) e reabrir a indicação, para a próxima venda paga completar.

### Quinquagésima primeira rodada (2026-10-19): pacotes e salas

Foram lidos os pacotes de sessão (venda, baixa, desfazer a baixa, apagar a venda e devolver o que sobrou), o cartão-presente (venda, desativação e consulta do código), as fichas de consentimento e os recursos (salas e cadeiras).

199. ⬜ **Desfazer uma baixa devolve sessão a pacote já estornado ou cancelado** (back: `undoClientPackageUse` e `restorePackageUses`, usada ao apagar a venda da conta): as duas devolvem a sessão com `status: 'ACTIVE'`, sem olhar a situação do pacote.
     - Depois de "devolver o que sobrou" (`refundIssuedRemainder`), o pacote fica com o total igual ao usado e `COMPLETED`, e o cliente recebe de volta o valor das sessões que faltavam. Desfazer uma baixa (ou apagar a venda que usou uma sessão) baixa o usado, deixa o pacote `ACTIVE` e o cliente ganha uma sessão já devolvida em dinheiro.
     - Pacote `CANCELLED` (unidade encerrada) também volta a `ACTIVE` com a sessão devolvida.
     
     **Fazer:** só devolver a sessão a pacote `ACTIVE` ou `COMPLETED` por uso (não por estorno), e voltar a `ACTIVE` só o que estava `COMPLETED` por ter usado tudo. Pacote estornado ou cancelado recusa desfazer a baixa (a venda que usou a sessão continua podendo ser apagada, sem devolver a sessão). Gravar no pacote que o restante foi devolvido, para diferenciar do pacote que só acabou.
200. ⬜ **Apagar uma sala tira ela dos horários sem aviso** (back: `deleteResource`; front: `Resources.tsx`):
     - A ligação do horário com o recurso é `ON DELETE SET NULL`. Apagar a sala deixa os horários futuros marcados nela sem sala, sem aviso para a equipe. Os horários passados perdem a sala no histórico.
     - Já existe desativar (`isActive`), que tira a sala de novos horários sem apagar nada.
     - O nome pode ser vazio e o tipo é texto livre (o resto do app espera `CHAIR`, `ROOM`, `STATION` ou `BED`).
     
     **Fazer:** recusar apagar sala com horário futuro (mensagem para desativar ou trocar a sala dos horários antes). Sala com horário só no passado é desativada em vez de apagada. Nome obrigatório com limite de tamanho, e tipo só dos quatro conhecidos.

### Quinquagésima segunda rodada (2026-10-19): sessão coberta e regras de comissão

Foram lidas as regras de comissão (criar, editar e apagar), o cálculo da comissão (desconto, estorno, sessão de pacote e de clube) e a venda que usa sessão do pacote ou do clube.

201. ⬜ **Venda com o serviço do pacote ou do clube em quantidade 3 gasta uma sessão só** (back: `preparePackageSession`, `prepareClubSession`, `createSale`, `computeCommissions`):
     - Para usar a sessão, a venda precisa ter o serviço a R$ 0 com `quantity >= 1`. A baixa é sempre de uma sessão, então quantidade 3 (ou duas linhas do mesmo serviço a R$ 0) dá três atendimentos por uma sessão do pacote ou do ciclo do clube.
     - A comissão da sessão coberta é o valor da sessão vezes a quantidade: o profissional recebe por três sessões enquanto o pacote perde uma.
     
     **Fazer:** a linha coberta tem quantidade 1, e só uma linha do serviço a R$ 0 por venda (outra unidade do mesmo serviço é cobrada ou usa outra sessão em outra venda). A comissão da sessão coberta conta uma sessão por baixa.
202. ⬜ **Regra de comissão da unidade pode ficar duplicada, e o cálculo usa qualquer uma** (back: `setCommissionRule`, `computeCommissions`; banco: `CommissionRule`):
     - A chave única é `(barbershopId, barberId, itemType)`, mas no Postgres `NULL` não repete: a regra padrão da unidade (`barberId` vazio) não é protegida. `setCommissionRule` faz `findFirst` e depois `create`, então dois cliques em "Salvar" (ou duas abas) criam duas regras padrão iguais.
     - Depois disso, mudar a porcentagem atualiza só uma delas, e o cálculo pega a primeira que achar (`rules.find`), que pode ser a antiga. O relatório e o pagamento da equipe saem com a porcentagem velha.
     - O tipo do item é texto livre: "service" ou qualquer outro valor cria uma regra que nunca se aplica.
     
     **Fazer:** índice único que trate o vazio como valor (`NULLS NOT DISTINCT`, ou índice parcial para `barberId IS NULL`), migração que junta as duplicadas mantendo a mais recente, e gravação com trava (ou `ON CONFLICT`). Tipo só `ALL`, `SERVICE` ou `PRODUCT`.

### Quinquagésima terceira rodada (2026-10-19): escala e folgas da equipe

Foram lidas a escala da equipe (a tela da semana e as mutações antigas de um dia), as folgas e as checagens de conflito entre unidades.

203. ⬜ **A escala da semana não confere conflito com outra unidade** (back: `setWeeklySchedule` em `schedule.service.ts`, usada pela tela da semana; `createBarberSchedule`, `updateBarberSchedule`):
     - A mesma pessoa atendendo em duas unidades não pode ter escala sobreposta (horizonte "Identidade `Professional` + agenda única"). A checagem (`ensureShiftFreeAcrossShops`) só existe nas mutações antigas de um dia. A tela da semana, que é a que o front usa, grava sem conferir, e as duas unidades oferecem o mesmo horário na página pública. O dia "segue a unidade" também não é conferido contra a escala da outra.
     - As mutações antigas, ainda abertas na API, não conferem o formato da hora, início antes do fim, o dia da semana (0 a 6) nem o intervalo dentro do expediente, como a tela da semana confere. Repetir o dia dá erro 500 (chave única por profissional e dia).
     
     **Fazer:** a mesma checagem entre unidades na escala da semana, com a escala efetiva do dia (a própria ou a da unidade). As mutações antigas passam pela validação da tela da semana (ou saem da API, se nada mais usa).
204. ⬜ **Barbeiro vê as folgas dos colegas, inclusive o motivo** (back: `getBarberTimeOffsByBarber`): a agenda do barbeiro mostra só as folgas dele (`getBarbershopTimeOffs` filtra pelo próprio profissional), mas a consulta por profissional aceita qualquer um da unidade com o acesso mais baixo. O barbeiro lê as datas e o motivo das folgas dos colegas, inclusive afastamento por doença (`SICK`), que é dado de saúde.
     
     **Fazer:** barbeiro e barbeiro básico só consultam as próprias folgas. Recepção para cima vê o período de todos, e o motivo `SICK` aparece só para gerente e dono.

### Quinquagésima quarta rodada (2026-10-19): cancelamentos em lote

Foram lidos os fechamentos da unidade (prévia, cadastro e cancelamento dos afetados), o "cancelar daqui em diante" da série e o cancelamento e a remarcação pelo link do cliente.

205. ⬜ **"Cancelar daqui em diante" na série cancela e estorna horários que já passaram** (back: `cancelFromHere` em `appointment-series.service.ts`):
     - A busca pega os horários `CONFIRMED` da série a partir do horário clicado, sem olhar se já passaram. Muitos atendimentos feitos ficam `CONFIRMED` (ninguém marca concluído). Clicar num horário antigo, ou no de hoje que já aconteceu, cancela esses atendimentos e estorna o sinal e o pago antes pelo app de serviço que já foi feito. O fechamento da unidade já evita isso ("confirmado que já começou fica").
     - O cancelamento comum recusa horário com venda ("Apague ou estorne a venda antes"). O da série (e o do fechamento) não confere: o horário fica cancelado com a venda dele no caixa.
     - O aviso ao cliente só sai se o primeiro horário cancelado é futuro. Clicando num horário passado, os futuros são cancelados sem aviso. O e-mail usado é o da ficha, não o de contato do horário (`appointmentContactEmail`), como no resto.
     
     **Fazer:** cancelar só os horários que ainda não começaram, pular os que têm venda (e dizer quantos ficaram), e avisar o cliente pelos futuros cancelados com o e-mail de contato do horário.
206. ⬜ **Fechamento que cancela horários não atualiza a agenda nem o histórico** (back: `ClosureService.set`, `closure.resolver.ts`): com "cancelar os afetados", os horários são cancelados direto no banco. O resolver não avisa a agenda aberta (`realtime.notify`), então quem está com a agenda aberta continua vendo os horários até recarregar e pode atender ou cobrar um horário já cancelado. A notificação de atividade do cancelamento (`appointmentStatusChanged`) também não sai, ao contrário do cancelamento comum, do da série e do cliente.
     
     **Fazer:** avisar a agenda e registrar a atividade de cada horário cancelado pelo fechamento (e também quando reservas de sinal são liberadas).

### Quinquagésima quinta rodada (2026-10-19): pagamento da equipe

Foram lidos o pagamento da equipe (forma de pagamento, vales, bônus e descontos, prévia, pagar e desfazer o pagamento) e o ajuste de comissão quando muda uma venda de período já pago.

207. ⬜ **Pagar um período que ainda não terminou perde a comissão do resto dele** (back: `PayrollService.pay`, `preview`; `createSale`):
     - O período aceita fim no futuro. Pagar o mês no dia 15 grava o pagamento até o dia 31, com a comissão das vendas até o dia 15.
     - As vendas pagas do dia 16 ao 31 caem num período já pago. Não dá para pagar de novo (`overlapping`), o período seguinte começa no dia 1º, e a venda nova não gera o ajuste de comissão (`commissionAdjustment` só roda ao editar ou apagar venda). A comissão dessas vendas nunca é paga.
     - O fixo do período entra inteiro, mesmo o período não tendo acabado.
     
     **Fazer:** recusar pagamento com fim depois de hoje (no fuso da unidade), ou gravar o fim do pagamento como hoje. A prévia avisa que o período ainda não acabou.
208. ⬜ **Gerente que também atende define e paga o próprio salário e bônus** (back: `PayrollService.setConfig`, `addEntry`, `deleteEntry`, `pay`, `undoPayout`): a regra de comissão já não deixa o gerente mexer na própria comissão ("A sua comissão é definida pelo dono", `ensureNotOwnCommission`). O pagamento da equipe não tem a mesma trava: o gerente que é profissional da unidade troca a própria forma de pagamento para fixo com qualquer valor, lança bônus para si, apaga os próprios descontos e vales, e registra o próprio pagamento.
     
     **Fazer:** a mesma trava da comissão em todo o pagamento da equipe: no próprio profissional, só o dono configura, lança, apaga, paga e desfaz. O gerente continua vendo o próprio extrato.

### Quinquagésima sexta rodada (2026-10-19): avaliações nos dois sentidos

Foram lidos o pedido de avaliação (link, envio, edição), as avaliações do profissional (página pública, "minhas avaliações", resposta) e a nota que a equipe dá ao cliente (pontualidade e trato).

209. ⬜ **Quem saiu da unidade continua avaliando os clientes dela** (back: `CustomerRatingService.rate`, `forAppointment`, `pendingForMe`, `sendDailyDigest`): o lado "profissional" é dado a quem tem o `userId` do profissional do atendimento, sem conferir se a pessoa ainda está na unidade. Quem foi desligado (profissional inativo, vínculo encerrado ou acesso revogado) continua vendo a lista de pendentes com o nome dos clientes, recebe o resumo diário e dá nota a eles por até 30 dias, e essa nota entra na média do cliente que as outras equipes da rede veem.
     
     **Fazer:** o lado profissional exige o profissional ativo, com o vínculo valendo e acesso à unidade. A lista de pendentes e o resumo diário seguem a mesma regra.
210. ⬜ **O profissional sabe que estrela cada cliente deu antes de dar a nota dele** (back: `ProfessionalReviewService.mine`; front: tela de avaliações do profissional): a nota que o cliente dá ao profissional ficou fora do histórico da unidade justamente para quem atende não revidar na nota que dá ao cliente (`visitFeedback`). Mas "Minhas avaliações" mostra cada avaliação com o nome ("Carlos S."), a data e o horário do atendimento e os serviços, e a avaliação chega logo depois do atendimento. Dentro dos 30 dias para avaliar o cliente, o profissional identifica quem deu nota baixa e responde com nota baixa de pontualidade e trato.
     
     **Fazer:** avaliação às cegas: em "Minhas avaliações", a avaliação de um atendimento só aparece depois que o profissional avaliou aquele cliente ou depois que o prazo de avaliar passou. Até lá, entra só na média.

### Quinquagésima sétima rodada (2026-10-19): fotos e moderação

Foram lidos a galeria, a capa e a foto dos profissionais (envio, confirmação, ordem e remoção), a moderação de conteúdo público, a verificação de identidade (a troca de nome já tira a verificação, no app e no backoffice), o chat do atendimento e o suporte.

211. ⬜ **Foto ocultada pela moderação volta para a galeria com o mesmo arquivo** (back: `BarbershopMediaService.addPhoto`, `listPhotos`, `removePhoto`; banco: `BarbershopPhoto`):
     - A tela da galeria devolve cada foto com a chave do arquivo (`key`), inclusive a ocultada. `addPhoto` aceita qualquer chave da pasta da unidade, sem conferir se ela já está em uso. O gerente confirma de novo a chave da foto ocultada e ela volta para a página pública numa linha nova, sem `hiddenAt`.
     - A mesma chave em duas linhas também quebra a outra: apagar uma apaga o arquivo no S3 e a outra fica com a imagem quebrada.
     - A capa, o logo, a foto dos profissionais e os posts do Instagram publicados aparecem na página pública sem botão de denúncia própria (só a unidade inteira pode ser denunciada).
     
     **Fazer:** chave única por unidade na galeria, e recusar confirmar chave que já foi usada (inclusive de foto apagada ou ocultada). Não devolver a chave do arquivo na tela, só o link. Denúncia e ocultação também para a capa, a foto dos profissionais e os posts publicados.

### Quinquagésima oitava rodada (2026-10-19): convite da equipe

Foram lidos o convite da equipe (criar, reenviar, validar, aceitar criando conta e aceitar com a conta que já existe) e o vínculo temporário.

212. ⬜ **Gerente cria conta com o e-mail (e o documento) de outra pessoa, já como e-mail confirmado** (back: `EmployeeInviteService.acceptInvite`, `createInvite`, `getBarbers`):
     - O gerente recebe o link do convite: a criação devolve o convite inteiro, com o token, e a lista da equipe mostra `pendingInviteToken` para a tela oferecer o link. Assim ele pode convidar qualquer e-mail que ainda não tem conta, abrir o próprio link e criar a conta com a senha que quiser.
     - A conta nasce com `emailVerifiedAt` ("o link do convite chegou neste e-mail"), mas quem abriu não precisou receber o e-mail. O documento digitado fica gravado e passa a contar como já usado (`idDocTaken`). A dona do e-mail e do CPF não consegue se cadastrar ("Já existe uma conta com estes dados") até descobrir e recuperar a senha, e o documento continua preso.
     - Se já existe conta com esse e-mail entrando pelo Google, a busca só olha `provider: 'local'` e a chave única é e-mail + forma de entrada: o aceite cria uma segunda conta com o mesmo e-mail, em vez de mandar entrar com a conta que já existe (a tela de validação diz que a conta existe, mas o aceite direto pela API passa).
     
     **Fazer:** a conta criada pelo convite não nasce com o e-mail confirmado quando o link pode ter sido compartilhado: manda o código de confirmação para o e-mail antes de liberar o acesso (ou exige o código no aceite). O documento só passa a valer como usado depois da confirmação. Conta existente com qualquer forma de entrada leva para "entrar com a sua conta".

### Quinquagésima nona rodada (2026-10-19): caixinha e pagamento da equipe

Foram lidas a caixinha registrada à mão (registrar, apagar, a que entra no caixa e a que vira lançamento do profissional), a caixinha pelo app e o sinal online.

213. ⬜ **Apagar no pagamento da equipe a caixinha que veio do atendimento deixa a caixinha sem dono** (back: `PayrollService.deleteEntry`; `TipService.add`, `remove`):
     - A caixinha que a unidade recebe pelo profissional (cartão, maquininha ou dinheiro deixado no balcão) vira um lançamento `TIP` no pagamento da equipe (`payEntryId`). Em "Pagamento da equipe", `deleteEntry` apaga esse lançamento como qualquer avulso: só confere se já entrou num pagamento e se o caixa está aberto. A despesa que veio de vale, pagamento ou aluguel já é protegida assim ("desfaça pela tela de origem"), a caixinha não.
     - Depois disso a caixinha continua no atendimento e no caixa (o dinheiro entrou na gaveta), mas o profissional não recebe, a tela da caixinha mostra "não paga" para sempre, e apagar a caixinha depois não acha o lançamento.
     - Trocar o profissional de um atendimento concluído deixa a caixinha e o lançamento com o profissional antigo.
     
     **Fazer:** o lançamento que veio de caixinha só sai apagando a caixinha (mensagem dizendo onde). Ao trocar o profissional de um atendimento com caixinha ainda não paga, mover a caixinha e o lançamento para o novo (ou recusar a troca com aviso).

### Sexagésima rodada (2026-10-19): conta do cliente

Foram lidos a conta do cliente (perfil, favoritos, profissionais favoritos, busca de negócios, login social e histórico).

214. ⬜ **Histórico do cliente mostra o valor na moeda da rede, não na da unidade** (back: `ClientAuthService.getHistory`): a moeda de cada linha vem da rede da ficha (`network.currency`). Desde que cada unidade tem a própria moeda (`Barbershop.currency`, itens 184 e 188), a venda feita numa unidade em pesos de uma rede em reais aparece no histórico do cliente com o símbolo do real (e a caixinha do atendimento também). A venda sem ficha cai em `BRL` fixo.
     
     **Fazer:** usar a moeda da unidade de cada atendimento e de cada venda (`barbershop.currency`), como o caixa, a venda e o cartão-presente já fazem.

### Sexagésima primeira rodada (2026-10-19): fila por ordem de chegada

Foram lidas a fila de quem chega sem horário (entrar, listar, mudar a situação), o painel ("na fila agora") e o histórico de serviços do cliente.

215. ⬜ **Barbeiro põe cliente na fila "sem profissional" e depois não consegue atender** (back: `createWalkIn`, `updateWalkInStatus`): o barbeiro pode criar a entrada da fila sem profissional ("só na própria fila, ou sem profissional"). Mas mudar a situação exige que a entrada seja dele (`walkIn.barberId !== ownBarberId`), e a entrada sem profissional não é de ninguém: o barbeiro recebe "Cliente da fila não encontrado" ao começar o atendimento. Na unidade sem recepção, ninguém além do gerente ou do dono tira esse cliente da fila. Começar o atendimento (`IN_PROGRESS`) também não grava quem atendeu.
     
     **Fazer:** o barbeiro pode pegar a entrada sem profissional, e começar o atendimento grava o profissional (o barbeiro que pegou ou o escolhido pela recepção). A troca de situação segue uma ordem (não volta de concluído para esperando com a posição antiga).
216. ⬜ **A fila nunca fecha: quem ficou esperando ontem continua na frente hoje** (back: `createWalkIn`, `getWalkIns`, painel `walkInsWaiting`): não há rotina que encerre a fila do dia. Entrada que ficou `WAITING` ou `IN_PROGRESS` (o cliente foi embora, ninguém marcou) continua na fila nos dias seguintes, na frente de quem chega hoje. A posição nova é o maior número entre as que esperam, então a numeração só cresce. O painel mostra "na fila" contando essas entradas antigas.
     
     **Fazer:** a fila é do dia, no fuso da unidade: a lista e o painel mostram só as entradas de hoje, e uma rotina de madrugada marca as que sobraram como não atendidas (situação própria, fora das faltas de agendamento). A posição recomeça a cada dia.

### Sexagésima segunda rodada (2026-10-19): cupom do plano

Foram lidos os cupons do plano (validação, desconto, reserva do cupom do convite de amigo, uso registrado na ativação) e a cobrança do plano.

217. ⬜ **Cupom de uso único dá desconto em várias cobranças** (back: `PaymentsService.createPaymentIntentForCheckout`, `createSubscriptionAfterPayment`; `CouponsService.validateCoupon`, `claimUse`):
     - O cupom é só conferido ao criar a cobrança (`validateCoupon`), e o uso é registrado depois do pagamento (`claimUse`). Quando o registro falha porque o cupom já foi usado (ou esgotou), a cobrança já paga ativa o plano mesmo assim e só fica um aviso no log ("já pago, o plano vale").
     - Abrindo o checkout com o cupom em várias abas (ou guardando a cobrança criada para pagar depois), cada cobrança sai com o desconto. Pagando uma de cada vez, o usuário compra vários períodos com desconto, ou 100% grátis no caso do mês grátis com valor acima do mínimo da Stripe, com um cupom de uso único. O cupom público com limite de usos também passa do limite.
     - Na validação, o valor e o tipo do cupom não são conferidos: cupom de porcentagem negativa (erro de digitação no backoffice) aumenta o preço.
     
     **Fazer:** reservar o uso do cupom ao criar a cobrança (com prazo, como a reserva do sinal), e cancelar a cobrança anterior do mesmo usuário com o mesmo cupom. Na ativação, cobrança paga com cupom que não foi reservado para ela é estornada na diferença (ou recusada antes do pagamento). Porcentagem de 1 a 100 e valor fixo positivo ao criar e editar o cupom.

### Sexagésima terceira rodada (2026-10-19): convidar amigos

Foi lido o "Convidar amigos" (dono convida outro dono e os dois ganham 1 mês grátis): criar, listar, aceitar e os cupons.

218. ⬜ **Quem convida ganha os meses grátis sozinho, com contas inventadas** (back: `FriendInviteService.createInvite`, `getSentInvites`, `acceptInvite`; `friend-invite.controller.ts`):
     - A criação e a lista "convites enviados" devolvem a linha inteira do convite, com o `inviteToken`: quem convida tem o link de aceite sem precisar do e-mail do amigo.
     - O aceite confere só que o e-mail da conta é o do convite e que a conta foi criada depois do convite. Não confere se esse e-mail foi confirmado (o cadastro entra sem confirmar). Basta convidar um e-mail inventado, criar a conta com ele, entrar e aceitar com o próprio link: quem convidou ganha 1 mês grátis, até 5 por dia e 12 no total, sem nenhum amigo pagar nada.
     - O mês grátis de quem convida sai no aceite, não quando o amigo vira cliente pagante.
     
     **Fazer:** não devolver o token para quem convida (a tela só precisa da situação). O aceite exige o e-mail da conta confirmado. O cupom de quem convidou só sai quando o amigo paga o primeiro plano (o do amigo pode sair no aceite).
