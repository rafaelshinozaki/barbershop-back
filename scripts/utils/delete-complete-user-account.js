const { deleteUserAccount, listUsers } = require('./delete-user-account');
const { deleteUserS3Files, listUserS3Files } = require('./delete-user-s3-files');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Script completo para deletar uma conta de usuário
 * Remove todos os dados do banco e arquivos do S3
 */
async function deleteCompleteUserAccount(userId) {
  console.log(`🚀 Iniciando exclusão completa da conta do usuário ID: ${userId}`);
  console.log('='.repeat(60));

  try {
    // 1. Verificar se o usuário existe e obter informações
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: {
        id: true,
        email: true,
        fullName: true,
        photoKey: true,
        stripeCustomerId: true,
        _count: {
          select: {
            analyses: true,
            subscriptions: true,
            ActiveSession: true,
            LoginHistory: true,
            notifications: true,
            verificationCodes: true,
            emailLogger: true,
          },
        },
      },
    });

    if (!user) {
      console.error('❌ Usuário não encontrado');
      return false;
    }

    console.log(`📋 Usuário: ${user.fullName} (${user.email})`);
    console.log(`📊 Dados relacionados:`);
    console.log(`   - Análises: ${user._count.analyses}`);
    console.log(`   - Assinaturas: ${user._count.subscriptions}`);
    console.log(`   - Sessões ativas: ${user._count.ActiveSession}`);
    console.log(`   - Histórico de login: ${user._count.LoginHistory}`);
    console.log(`   - Notificações: ${user._count.notifications}`);
    console.log(`   - Códigos de verificação: ${user._count.verificationCodes}`);
    console.log(`   - Logs de email: ${user._count.emailLogger}`);
    console.log(`   - Foto do perfil: ${user.photoKey ? 'Sim' : 'Não'}`);
    console.log(`   - Customer Stripe: ${user.stripeCustomerId || 'Não'}`);
    console.log('');

    // 2. Confirmar exclusão
    console.log('⚠️  ATENÇÃO: Esta operação é IRREVERSÍVEL!');
    console.log('   Todos os dados do usuário serão permanentemente removidos.');
    console.log('');

    // Em um ambiente de produção, você pode querer adicionar uma confirmação interativa aqui
    // const readline = require('readline');
    // const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // const answer = await new Promise(resolve => rl.question('Digite "CONFIRMAR" para continuar: ', resolve));
    // rl.close();
    // if (answer !== 'CONFIRMAR') {
    //   console.log('❌ Operação cancelada pelo usuário');
    //   return false;
    // }

    // 3. Deletar arquivos do S3 primeiro
    console.log('🗑️  Passo 1: Deletando arquivos do S3...');
    const s3Success = await deleteUserS3Files(userId, user.photoKey);
    if (!s3Success) {
      console.warn('⚠️  Erro ao deletar arquivos do S3, mas continuando...');
    }
    console.log('');

    // 4. Deletar dados do banco de dados
    console.log('🗑️  Passo 2: Deletando dados do banco de dados...');
    const dbSuccess = await deleteUserAccount(userId);
    if (!dbSuccess) {
      console.error('❌ Erro ao deletar dados do banco de dados');
      return false;
    }

    console.log('');
    console.log('✅ Exclusão completa realizada com sucesso!');
    console.log('='.repeat(60));
    console.log(`📊 Resumo da exclusão:`);
    console.log(`   - Usuário: ${user.fullName} (${user.email})`);
    console.log(`   - ID: ${user.id}`);
    console.log(`   - Arquivos S3: ${s3Success ? 'Deletados' : 'Erro'}`);
    console.log(`   - Dados do banco: Deletados`);
    console.log(`   - Análises removidas: ${user._count.analyses}`);
    console.log(`   - Assinaturas canceladas: ${user._count.subscriptions}`);
    console.log(`   - Sessões encerradas: ${user._count.ActiveSession}`);
    console.log(`   - Histórico limpo: ${user._count.LoginHistory} registros`);

    return true;
  } catch (error) {
    console.error('❌ Erro durante a exclusão completa:', error);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Função para fazer backup antes da exclusão
 */
async function backupUserData(userId) {
  console.log(`💾 Fazendo backup dos dados do usuário ID: ${userId}`);

  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: {
        subscriptions: {
          include: {
            payments: true,
            plan: true,
          },
        },
        address: true,
        userSystemConfig: true,
        emailNotification: true,
        analyses: true,
        LoginHistory: true,
        ActiveSession: true,
        notifications: true,
        verificationCodes: true,
        emailLogger: true,
        invalidatedTokens: true,
        sharedAnalyses: true,
        role: true,
      },
    });

    if (!user) {
      console.error('❌ Usuário não encontrado');
      return null;
    }

    // Remover senha e dados sensíveis
    const backupData = {
      ...user,
      password: '[REDACTED]',
      verificationCodes: user.verificationCodes.map((code) => ({
        ...code,
        code: '[REDACTED]',
      })),
    };

    const fs = require('fs');
    const path = require('path');
    const backupDir = path.join(__dirname, 'backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `user-${userId}-backup-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));

    console.log(`✅ Backup salvo em: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error('❌ Erro ao fazer backup:', error);
    return null;
  }
}

// Interface de linha de comando
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'delete':
      const userId = args[1];
      const skipBackup = args[2] === '--skip-backup';

      if (!userId) {
        console.error(
          '❌ Uso: node delete-complete-user-account.js delete <userId> [--skip-backup]',
        );
        process.exit(1);
      }

      // Fazer backup antes da exclusão (opcional)
      if (!skipBackup) {
        console.log('💾 Fazendo backup antes da exclusão...');
        await backupUserData(userId);
        console.log('');
      }

      const success = await deleteCompleteUserAccount(userId);
      process.exit(success ? 0 : 1);
      break;

    case 'list':
      await listUsers();
      break;

    case 'backup':
      const backupUserId = args[1];
      if (!backupUserId) {
        console.error('❌ Uso: node delete-complete-user-account.js backup <userId>');
        process.exit(1);
      }

      await backupUserData(backupUserId);
      break;

    case 's3-list':
      const s3UserId = args[1];
      if (!s3UserId) {
        console.error('❌ Uso: node delete-complete-user-account.js s3-list <userId>');
        process.exit(1);
      }

      await listUserS3Files(s3UserId);
      break;

    default:
      console.log('📖 Script de Exclusão Completa de Conta de Usuário');
      console.log('='.repeat(50));
      console.log('');
      console.log('Comandos disponíveis:');
      console.log('');
      console.log('  Listar usuários:');
      console.log('    node delete-complete-user-account.js list');
      console.log('');
      console.log('  Fazer backup de um usuário:');
      console.log('    node delete-complete-user-account.js backup <userId>');
      console.log('');
      console.log('  Listar arquivos do S3:');
      console.log('    node delete-complete-user-account.js s3-list <userId>');
      console.log('');
      console.log('  Deletar conta completa:');
      console.log('    node delete-complete-user-account.js delete <userId>');
      console.log('    node delete-complete-user-account.js delete <userId> --skip-backup');
      console.log('');
      console.log('⚠️  ATENÇÃO: A exclusão é PERMANENTE e não pode ser desfeita!');
      console.log('   Use o comando backup antes de deletar para preservar os dados.');
      break;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { deleteCompleteUserAccount, backupUserData };
