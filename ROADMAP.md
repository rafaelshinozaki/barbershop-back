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

**Fora do backoffice, de propósito:** operações da conta de cada negócio (agenda, clientes, fichas, pagamentos da equipe) ficam no app das barbearias. A equipe não entra "como" o negócio (sem personificar). Para ajudar, usa a ficha só leitura. A ficha de saúde e o texto das conversas só aparecem quando vêm anexados a uma denúncia.

**Operações antigas a tirar** ✅ (feito): `changeUserPlan`, `changeMultipleUsersPlan`, `setUserActive`, `setMultipleUsersActive` e `removeUser` do `user.resolver` (só admin) duplicam as do `backoffice.resolver`, que declaram área. Saem do back e da lista da API do backoffice. `GET /stripe/test` também sai.

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
- **S4 — limpar o back principal.**
  - Saem os cargos de sistema, a coluna de áreas, o interceptor de auditoria, o segredo e o cabeçalho do gateway, o CORS e as variáveis.
  - Um teste garante que nenhum resolver ou rota do principal cita cargo de sistema.

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

Achados numa revisão de código. Itens 1–16 corrigidos. O restante segue 🆕.

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
17. 🆕 **Links de gerenciar e de avaliar não vencem** (`appointment-link.ts`): o token é só o id assinado, sem validade e sem como revogar. Um e-mail antigo encaminhado dá acesso ao chat do atendimento e deixa mudar a avaliação anos depois. **Fazer:** colocar validade (ex.: chat até X dias depois do atendimento, avaliação até 30 dias) e uma versão para invalidar.
18. 🆕 **Token da Página do Facebook em texto puro** (`SocialConnection.facebookAccessToken`): fica legível no banco e em backups. **Fazer:** criptografar em repouso, como os outros segredos.

**Equipe e convites**

19. 🆕 **Remover da equipe não cancela o convite pendente** (`BarbershopService.deleteBarber`):
    - Só faz `isActive: false`.
    - O convite continua `PENDING`: convidar a mesma pessoa de novo esbarra em "Já existe um convite pendente". E o link antigo ainda é aceito, ligando a conta a um vínculo desativado.
    - Os horários futuros do profissional removido ficam na agenda sem aviso a ninguém.
    - **Fazer:** cancelar os convites pendentes do vínculo ao remover, recusar convite cujo `Barber` está inativo e avisar (ou pedir para remanejar) os horários futuros.
20. 🆕 **Documento no aceite do convite** (`EmployeeInviteService.acceptInvite`):
    - Aplica a máscara de CPF em qualquer país.
    - A checagem de duplicado compara o número cru com o salvo (que no convite fica com máscara e no cadastro normal fica como foi digitado). Então o mesmo CPF passa duas vezes.
    - **Fazer:** normalizar o documento (só dígitos, por país) num lugar só, para salvar e para comparar.
21. 🆕 **Aceite do convite fora de transação e em português fixo** (`acceptInvite`):
    - Cria usuário, endereço, configuração, preferências e o vínculo em passos separados. Se um passo falha no meio, a conta fica criada e o convite pendente; tentar de novo dá "Já existe uma conta com estes dados".
    - O idioma da conta nova é sempre `pt`, mesmo em unidade do México ou dos EUA.
    - **Fazer:** uma transação e o idioma pelo país da unidade (`langForCountry`).

**Avaliações e redes sociais**

22. 🆕 **Editar a avaliação mantém a resposta antiga** (`ReviewRequestService.submitReview`): o cliente troca a nota e o texto pelo link, e a resposta pública da unidade continua lá, respondendo a um texto que não existe mais. Também não volta para moderação se tinha sido denunciada. **Fazer:** ao mudar o texto, limpar `reportedAt` e marcar a resposta como "respondeu à versão anterior" (ou avisar a unidade).
23. 🆕 **Conectar o Facebook pega sempre a primeira Página** (`SocialService.handleOAuthCallback`): quem administra várias Páginas não escolhe qual, e o post pode sair na Página errada. A volta do OAuth também não confere se a pessoa ainda é gerente da unidade. **Fazer:** tela para escolher a Página e conferir o acesso na volta.

**Limpeza**

24. 🆕 **Checagens mortas no login** (`jwt.strategy.ts`): `validate(payload, req)` espera o request, mas a estratégia não liga `passReqToCallback`. Então `req.cookies` nunca existe e a lista negra de tokens (`isTokenInvalidated`) e a checagem por `updatedAt` nunca rodam. Hoje quem revoga é a `ActiveSession`, então nada quebra. Mas ligar `passReqToCallback` sem cuidado faria qualquer `user.update` derrubar todas as sessões, inclusive a atual. **Fazer:** apagar o código morto (e a tabela `InvalidatedToken`, se não tiver outro uso) ou trocar por um campo próprio (`sessionsRevokedAt`).

### Terceira rodada (2026-10-08)

**Convite de amigos (1 mês grátis)**

25. 🆕 **O cupom de "1 mês grátis" não funciona para quem foi convidado** (`FriendInviteService.createFriendInviteCoupon`):
    - O cupom é criado com `minSubscriptionMonths: 1`. Quem acabou de criar a conta não tem assinatura, e o `validateCoupon` recusa com "Cupom requer assinatura prévia".
    - O cupom não fica ligado a ninguém: o `_userId` é ignorado e não se cria `UserCoupon`. Ele não aparece em "seus cupons" (`getCouponsForUser`), e qualquer um com o código usa.
    - **Fazer:** tirar o mínimo de meses do cupom do amigo, criar o `UserCoupon` de cada um e só aceitar o código pela conta dona.
26. 🆕 **Aceitar o convite duas vezes ao mesmo tempo** (`FriendInviteService.acceptInvite`): confere `status === 'PENDING'` e só grava depois. Dois cliques geram quatro cupons. **Fazer:** atualização condicional (`updateMany` com `status: 'PENDING'`) antes de criar os cupons, tudo numa transação.
27. 🆕 **Convite de amigo como disparador de e-mail** (`POST /friend-invites`): sem limite próprio (só o geral de 300 por minuto por IP). O e-mail leva o nome da conta, que quem envia escolhe, para qualquer endereço. Também dá para criar contas em série e ganhar meses grátis. **Fazer:** limite por conta e por dia, só para conta com e-mail confirmado, e teto de recompensas por pessoa.

**Privacidade e moderação**

28. 🆕 **O profissional vê a nota que cada cliente deu a ele** (`CustomerRatingService.visitFeedback`): a lista mostra, atendimento por atendimento, as estrelas que o cliente deu ao profissional. Ao mesmo tempo, o profissional avalia o cliente. Dá para revidar uma nota baixa e o cliente perde a confiança de avaliar com sinceridade. **Fazer:** mostrar ao profissional só a média (ou só depois de os dois lados avaliarem, como no Airbnb), nunca a nota de cada cliente.
29. 🆕 **Conta desativada continua com perfil público** (`CareerService.publicProfile`): só esconde se `Professional.suspendedAt`. O usuário desativado pela plataforma (`User.isActive = false`) continua com `/p/:slug` no ar, e provavelmente na busca. **Fazer:** tratar conta inativa como suspensa na página, na busca e no sitemap.
30. 🆕 **Fila da moderação perde denúncias antigas** (`ModerationService.queue`): pega as últimas `QUEUE_REPORTS` denúncias de tudo e só depois agrupa. Um item com denúncia aberta antiga some da fila. Um item oculto cujas denúncias saíram da janela não aparece mais para ser restaurado. É o mesmo padrão do item 7 (fila do suporte). **Fazer:** buscar primeiro os itens com denúncia aberta ou ocultos (agrupando no banco) e paginar.

### Quarta rodada (2026-10-08)

31. 🆕 **E-mail diferencia maiúsculas no cadastro e no login** (`UserService.createUser` e `verifyUser`):
    - O e-mail é gravado e procurado do jeito que foi digitado. A unicidade (`@@unique([email, provider])`) diferencia maiúsculas no Postgres.
    - `Fulano@x.com` e `fulano@x.com` viram duas contas. Quem se cadastrou com maiúscula não entra digitando minúscula.
    - Os fluxos que já usam minúscula (convite da equipe, ligação com a conta de cliente, convite de amigo) não acham a conta com maiúscula. O convite da equipe acaba criando uma segunda conta.
    - **Fazer:** normalizar (`trim().toLowerCase()`) no cadastro, no login, no "esqueci a senha" e no OAuth. Migrar os e-mails existentes, depois de juntar as duplicadas, e trocar o índice por um que ignore maiúsculas (`citext` ou índice em `lower(email)`).
32. 🆕 **Indicação de profissional perde meses e vira fábrica de meses grátis** (`ProReferralService.claim`):
    - O `grant` lê `proUntil` e grava a soma depois. Dois indicados usando o mesmo código ao mesmo tempo fazem o indicador ganhar só uma das extensões.
    - Qualquer conta, até antiga, pode usar um código. A e B podem usar o código um do outro. E não há teto para o indicador.
    - **Fazer:** soma atômica no banco (ou trava por usuário), só conta nova pode usar código, sem indicação cruzada, e teto de meses por indicador.
33. 🆕 **Estorno feito direto na Stripe não chega ao app** (`stripe.controller.ts`): não há tratamento de `charge.refunded`. Um estorno pelo painel da Stripe (ou por suporte) deixa o sinal como pago, a caixinha somando no pagamento da equipe e o atendimento como "pago pelo app". **Fazer:** tratar `charge.refunded` e `refund.updated` com a mesma lógica dos estornos feitos pelo app.
34. 🆕 **Fechar o dia cancela o que já aconteceu e esquece quem está pagando o sinal** (`ClosureService.set`):
    - Fechar o dia de hoje cancela (e estorna) também os atendimentos de mais cedo que ainda estão `CONFIRMED`.
    - Os horários `PENDING_PAYMENT` (cliente no meio do pagamento do sinal) ficam de fora e podem ser pagos para um dia fechado.
    - Trocar o fechamento por um horário especial maior (via `set`) não avisa a lista de espera. Só o `remove` avisa.
    - **Fazer:** cancelar só do horário atual para frente, incluir `PENDING_PAYMENT` (expirando a reserva) e avisar a lista de espera quando o horário aumenta.
35. 🆕 **Importação de planilha escolhe o profissional errado** (`ImportService.matchBarber`): compara nomes com "contém" nos dois sentidos e fica com o primeiro que bater. "Ana" na planilha cai na "Mariana", e "Jo" em qualquer "João" ou "Jorge". **Fazer:** igualdade exata (sem acento e maiúsculas) primeiro, "contém" só se houver um único candidato, e erro na linha quando ficar ambíguo.
36. 🆕 **Aceite do convite da equipe com e-mail em maiúscula** (efeito do item 31 em `EmployeeInviteService.acceptInvite`): o convite guarda o e-mail em minúscula e procura a conta exatamente assim. Quem já tem conta com maiúscula ganha uma segunda conta em vez de entrar com a sua. Resolve junto com o item 31.
