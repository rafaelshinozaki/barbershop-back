const { PrismaClient } = require('@prisma/client');
const { Stripe } = require('stripe');

const prisma = new PrismaClient();

// Configuração do Stripe (se necessário)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

/**
 * Script para deletar completamente uma conta de usuário
 * Remove todos os dados relacionados: análises, sessões, histórico, etc.
 */
async function deleteUserAccount(userId) {
  console.log(`🗑️  Iniciando exclusão completa da conta do usuário ID: ${userId}`);

  try {
    // 1. Verificar se o usuário existe
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: {
        subscriptions: true,
        address: true,
        userSystemConfig: true,
        emailNotification: true,
        emailLogger: true,
        verificationCodes: true,
        LoginHistory: true,
        ActiveSession: true,
        notifications: true,
        invalidatedTokens: true,
        analyses: true,
        sharedAnalyses: true,
      },
    });

    if (!user) {
      console.error('❌ Usuário não encontrado');
      return false;
    }

    console.log(`📋 Usuário encontrado: ${user.fullName} (${user.email})`);
    console.log(`📊 Dados relacionados encontrados:`);
    console.log(`   - Subscriptions: ${user.subscriptions.length}`);
    console.log(`   - Análises: ${user.analyses.length}`);
    console.log(`   - Sessões ativas: ${user.ActiveSession.length}`);
    console.log(`   - Histórico de login: ${user.LoginHistory.length}`);
    console.log(`   - Notificações: ${user.notifications.length}`);
    console.log(`   - Códigos de verificação: ${user.verificationCodes.length}`);
    console.log(`   - Logs de email: ${user.emailLogger.length}`);

    // 2. Cancelar assinaturas no Stripe (se aplicável)
    if (user.stripeCustomerId) {
      console.log(`💳 Cancelando assinaturas no Stripe para customer: ${user.stripeCustomerId}`);
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: 'active',
        });

        for (const subscription of subscriptions.data) {
          await stripe.subscriptions.cancel(subscription.id);
          console.log(`   ✅ Assinatura ${subscription.id} cancelada`);
        }

        // Opcional: deletar o customer do Stripe
        // await stripe.customers.del(user.stripeCustomerId);
        // console.log(`   ✅ Customer ${user.stripeCustomerId} deletado do Stripe`);
      } catch (stripeError) {
        console.warn(`⚠️  Erro ao cancelar assinaturas no Stripe: ${stripeError.message}`);
      }
    }

    // 3. Deletar dados relacionados em ordem (respeitando foreign keys)
    console.log(`🗑️  Deletando dados relacionados...`);

    // Deletar análises compartilhadas onde o usuário é o compartilhado
    const sharedAnalysesCount = await prisma.analysisShare.deleteMany({
      where: { sharedWithUserId: parseInt(userId) },
    });
    console.log(`   ✅ ${sharedAnalysesCount.count} análises compartilhadas removidas`);

    // Deletar análises do usuário
    const analysesCount = await prisma.analysis.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${analysesCount.count} análises deletadas`);

    // Deletar tokens invalidados
    const invalidatedTokensCount = await prisma.invalidatedToken.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${invalidatedTokensCount.count} tokens invalidados deletados`);

    // Deletar notificações do usuário
    const notificationsCount = await prisma.userNotification.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${notificationsCount.count} notificações deletadas`);

    // Deletar sessões ativas
    const activeSessionsCount = await prisma.activeSession.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${activeSessionsCount.count} sessões ativas deletadas`);

    // Deletar histórico de login
    const loginHistoryCount = await prisma.loginHistory.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${loginHistoryCount.count} registros de histórico de login deletados`);

    // Deletar códigos de verificação
    const verificationCodesCount = await prisma.verificationCode.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${verificationCodesCount.count} códigos de verificação deletados`);

    // Deletar logs de email
    const emailLogsCount = await prisma.emailLogger.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${emailLogsCount.count} logs de email deletados`);

    // Deletar pagamentos (através das subscriptions)
    const paymentsCount = await prisma.payment.deleteMany({
      where: {
        subscription: {
          userId: parseInt(userId),
        },
      },
    });
    console.log(`   ✅ ${paymentsCount.count} pagamentos deletados`);

    // Deletar subscriptions
    const subscriptionsCount = await prisma.subscription.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${subscriptionsCount.count} assinaturas deletadas`);

    // Deletar configurações do sistema
    const systemConfigCount = await prisma.userSystemConfig.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${systemConfigCount.count} configurações do sistema deletadas`);

    // Deletar configurações de email
    const emailConfigCount = await prisma.emailNotification.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${emailConfigCount.count} configurações de email deletadas`);

    // Deletar endereço
    const addressCount = await prisma.address.deleteMany({
      where: { userId: parseInt(userId) },
    });
    console.log(`   ✅ ${addressCount.count} endereços deletados`);

    // 4. Deletar o usuário
    console.log(`👤 Deletando usuário...`);
    await prisma.user.delete({
      where: { id: parseInt(userId) },
    });

    console.log(`✅ Usuário ${user.fullName} (${user.email}) deletado com sucesso!`);
    console.log(`📊 Resumo da exclusão:`);
    console.log(`   - Análises: ${analysesCount.count}`);
    console.log(`   - Sessões: ${activeSessionsCount.count}`);
    console.log(`   - Histórico: ${loginHistoryCount.count}`);
    console.log(`   - Assinaturas: ${subscriptionsCount.count}`);
    console.log(`   - Pagamentos: ${paymentsCount.count}`);
    console.log(`   - Notificações: ${notificationsCount.count}`);
    console.log(`   - Códigos: ${verificationCodesCount.count}`);
    console.log(`   - Logs: ${emailLogsCount.count}`);

    return true;
  } catch (error) {
    console.error('❌ Erro ao deletar conta do usuário:', error);
    console.error('Stack trace:', error.stack);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Função para listar usuários com informações básicas
 */
async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            analyses: true,
            subscriptions: true,
            ActiveSession: true,
            LoginHistory: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('📋 Lista de usuários:');
    console.log('');
    users.forEach((user) => {
      console.log(`ID: ${user.id}`);
      console.log(`Nome: ${user.fullName}`);
      console.log(`Email: ${user.email}`);
      console.log(`Ativo: ${user.isActive ? '✅' : '❌'}`);
      console.log(`Criado: ${user.createdAt.toLocaleDateString('pt-BR')}`);
      console.log(
        `Dados: ${user._count.analyses} análises, ${user._count.subscriptions} assinaturas, ${user._count.ActiveSession} sessões`,
      );
      console.log('---');
    });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Interface de linha de comando
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'delete':
      const userId = args[1];
      if (!userId) {
        console.error('❌ Uso: node delete-user-account.js delete <userId>');
        process.exit(1);
      }

      const success = await deleteUserAccount(userId);
      process.exit(success ? 0 : 1);
      break;

    case 'list':
      await listUsers();
      break;

    default:
      console.log('📖 Uso do script:');
      console.log('');
      console.log('  Listar usuários:');
      console.log('    node delete-user-account.js list');
      console.log('');
      console.log('  Deletar conta de usuário:');
      console.log('    node delete-user-account.js delete <userId>');
      console.log('');
      console.log('⚠️  ATENÇÃO: A exclusão é PERMANENTE e não pode ser desfeita!');
      console.log('   Todos os dados relacionados serão removidos.');
      break;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { deleteUserAccount, listUsers };
