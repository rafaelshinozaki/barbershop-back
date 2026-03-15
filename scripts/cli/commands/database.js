const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

function databaseCommands(program) {
  const db = program.command('db').description('Comandos para gerenciamento de banco de dados');

  // Status do banco
  db.command('status')
    .description('Verificar status do banco de dados')
    .action(async () => {
      try {
        console.log('🔍 Verificando status do banco de dados...');

        // Testar conexão
        await prisma.$connect();
        console.log('✅ Conexão com banco de dados: OK');

        // Verificar se as tabelas existem
        const tables = await prisma.$queryRaw`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name;
        `;

        console.log(`📊 Tabelas encontradas: ${tables.length}`);
        tables.forEach((table) => {
          console.log(`   - ${table.name}`);
        });

        // Contar registros principais
        const [users, payments, analyses] = await Promise.all([
          prisma.user.count(),
          prisma.payment.count(),
          prisma.analysis.count(),
        ]);

        console.log('\n📈 Estatísticas:');
        console.log(`   Usuários: ${users}`);
        console.log(`   Pagamentos: ${payments}`);
        console.log(`   Análises: ${analyses}`);
      } catch (error) {
        console.error('❌ Erro ao verificar status:', error.message);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Migração
  db.command('migrate')
    .description('Executar migrações do banco de dados')
    .option('--reset', 'Resetar banco e aplicar todas as migrações')
    .option('--deploy', 'Aplicar migrações pendentes')
    .action(async (options) => {
      try {
        if (options.reset) {
          console.log('🔄 Resetando banco de dados...');
          execSync('npx prisma migrate reset --force', { stdio: 'inherit' });
          console.log('✅ Banco resetado com sucesso');
        } else if (options.deploy) {
          console.log('🚀 Aplicando migrações pendentes...');
          execSync('npx prisma migrate deploy', { stdio: 'inherit' });
          console.log('✅ Migrações aplicadas com sucesso');
        } else {
          console.log('📝 Executando migrações...');
          execSync('npx prisma migrate dev', { stdio: 'inherit' });
          console.log('✅ Migrações executadas com sucesso');
        }
      } catch (error) {
        console.error('❌ Erro ao executar migrações:', error.message);
        process.exit(1);
      }
    });

  // Seed
  db.command('seed')
    .description('Executar seed do banco de dados')
    .option('--force', 'Forçar execução do seed')
    .action(async (options) => {
      try {
        if (options.force) {
          console.log('🌱 Executando seed forçado...');
          execSync('npx prisma db seed', { stdio: 'inherit' });
        } else {
          console.log('🌱 Executando seed...');
          execSync('npm run seed', { stdio: 'inherit' });
        }
        console.log('✅ Seed executado com sucesso');
      } catch (error) {
        console.error('❌ Erro ao executar seed:', error.message);
        process.exit(1);
      }
    });

  // Backup
  db.command('backup')
    .description('Criar backup do banco de dados')
    .option('-o, --output <path>', 'Caminho do arquivo de backup')
    .action(async (options) => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = options.output || `backup-${timestamp}.db`;

        console.log(`💾 Criando backup: ${backupPath}`);

        // Copiar arquivo do banco
        const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
        fs.copyFileSync(dbPath, backupPath);

        const stats = fs.statSync(backupPath);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log(`✅ Backup criado com sucesso`);
        console.log(`   Arquivo: ${backupPath}`);
        console.log(`   Tamanho: ${fileSizeInMB} MB`);
      } catch (error) {
        console.error('❌ Erro ao criar backup:', error.message);
        process.exit(1);
      }
    });

  // Restore
  db.command('restore')
    .description('Restaurar backup do banco de dados')
    .requiredOption('-f, --file <path>', 'Caminho do arquivo de backup')
    .option('--force', 'Forçar restauração sem confirmação')
    .action(async (options) => {
      try {
        if (!fs.existsSync(options.file)) {
          console.error('❌ Arquivo de backup não encontrado');
          process.exit(1);
        }

        if (!options.force) {
          console.log(`⚠️  Você está prestes a restaurar o banco de dados:`);
          console.log(`   Arquivo: ${options.file}`);
          console.log('');
          console.log('Use --force para confirmar a restauração');
          return;
        }

        console.log('🔄 Restaurando banco de dados...');

        const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');

        // Fazer backup do banco atual
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const currentBackup = `backup-before-restore-${timestamp}.db`;
        fs.copyFileSync(dbPath, currentBackup);

        // Restaurar backup
        fs.copyFileSync(options.file, dbPath);

        console.log('✅ Banco de dados restaurado com sucesso');
        console.log(`   Backup anterior salvo como: ${currentBackup}`);
      } catch (error) {
        console.error('❌ Erro ao restaurar backup:', error.message);
        process.exit(1);
      }
    });

  // Limpeza
  db.command('cleanup')
    .description('Limpar dados antigos do banco')
    .option('-d, --days <number>', 'Dias para manter dados', '30')
    .option('--users', 'Limpar usuários inativos')
    .option('--sessions', 'Limpar sessões expiradas')
    .option('--logs', 'Limpar logs antigos')
    .action(async (options) => {
      try {
        const days = parseInt(options.days);
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        console.log(`🧹 Limpando dados mais antigos que ${days} dias...`);

        let deletedCount = 0;

        if (options.sessions) {
          const sessions = await prisma.activeSession.deleteMany({
            where: {
              createdAt: {
                lt: cutoffDate,
              },
            },
          });
          deletedCount += sessions.count;
          console.log(`   Sessões removidas: ${sessions.count}`);
        }

        if (options.logs) {
          const logs = await prisma.loginHistory.deleteMany({
            where: {
              createdAt: {
                lt: cutoffDate,
              },
            },
          });
          deletedCount += logs.count;
          console.log(`   Logs removidos: ${logs.count}`);
        }

        if (options.users) {
          const users = await prisma.user.deleteMany({
            where: {
              AND: [{ lastLoginAt: { lt: cutoffDate } }, { emailVerified: false }],
            },
          });
          deletedCount += users.count;
          console.log(`   Usuários inativos removidos: ${users.count}`);
        }

        console.log(`✅ Limpeza concluída. Total de registros removidos: ${deletedCount}`);
      } catch (error) {
        console.error('❌ Erro ao limpar dados:', error.message);
        process.exit(1);
      }
    });

  // Estatísticas detalhadas
  db.command('stats')
    .description('Mostrar estatísticas detalhadas do banco')
    .action(async () => {
      try {
        console.log('📊 Estatísticas Detalhadas do Banco de Dados');
        console.log('==========================================');

        const [
          users,
          verifiedUsers,
          payments,
          successfulPayments,
          analyses,
          sharedAnalyses,
          sessions,
          activeSessions,
        ] = await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { emailVerified: true } }),
          prisma.payment.count(),
          prisma.payment.count({ where: { status: 'SUCCESS' } }),
          prisma.analysis.count(),
          prisma.analysisShare.count(),
          prisma.loginHistory.count(),
          prisma.activeSession.count(),
        ]);

        console.log(`👥 Usuários:`);
        console.log(`   Total: ${users}`);
        console.log(
          `   Verificados: ${verifiedUsers} (${((verifiedUsers / users) * 100).toFixed(1)}%)`,
        );
        console.log(`   Não verificados: ${users - verifiedUsers}`);

        console.log(`\n💳 Pagamentos:`);
        console.log(`   Total: ${payments}`);
        console.log(
          `   Sucessos: ${successfulPayments} (${((successfulPayments / payments) * 100).toFixed(
            1,
          )}%)`,
        );
        console.log(`   Falhas: ${payments - successfulPayments}`);

        console.log(`\n📈 Análises:`);
        console.log(`   Total: ${analyses}`);
        console.log(`   Compartilhadas: ${sharedAnalyses}`);

        console.log(`\n🔐 Sessões:`);
        console.log(`   Histórico: ${sessions}`);
        console.log(`   Ativas: ${activeSessions}`);

        // Tamanho do banco
        const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
        if (fs.existsSync(dbPath)) {
          const stats = fs.statSync(dbPath);
          const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`\n💾 Tamanho do banco: ${fileSizeInMB} MB`);
        }
      } catch (error) {
        console.error('❌ Erro ao buscar estatísticas:', error.message);
        process.exit(1);
      }
    });
}

module.exports = databaseCommands;
