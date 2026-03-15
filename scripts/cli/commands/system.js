const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const os = require('os');

const prisma = new PrismaClient();

function systemCommands(program) {
  const system = program.command('system').description('Comandos para gerenciamento do sistema');

  // Status de saúde do sistema
  system
    .command('health')
    .description('Verificar saúde geral do sistema')
    .action(async () => {
      try {
        console.log('🏥 Verificando saúde do sistema...');
        console.log('================================');

        // Verificar banco de dados
        try {
          await prisma.$connect();
          console.log('✅ Banco de dados: Conectado');

          // Testar query simples
          const userCount = await prisma.user.count();
          console.log(`   Usuários: ${userCount}`);
        } catch (error) {
          console.log('❌ Banco de dados: Erro de conexão');
          console.log(`   Erro: ${error.message}`);
        }

        // Verificar variáveis de ambiente
        console.log('\n🔧 Variáveis de ambiente:');
        const requiredEnvVars = [
          'DATABASE_URL',
          'JWT_SECRET',
          'STRIPE_SECRET_KEY',
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
        ];

        requiredEnvVars.forEach((envVar) => {
          if (process.env[envVar]) {
            console.log(`   ✅ ${envVar}: Configurada`);
          } else {
            console.log(`   ❌ ${envVar}: Não configurada`);
          }
        });

        // Verificar arquivos importantes
        console.log('\n📁 Arquivos do sistema:');
        const importantFiles = ['prisma/dev.db', 'prisma/schema.prisma', '.env', 'package.json'];

        importantFiles.forEach((file) => {
          if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            const size = (stats.size / 1024).toFixed(2);
            console.log(`   ✅ ${file}: ${size} KB`);
          } else {
            console.log(`   ❌ ${file}: Não encontrado`);
          }
        });

        // Informações do sistema
        console.log('\n💻 Informações do sistema:');
        console.log(`   Plataforma: ${os.platform()}`);
        console.log(`   Arquitetura: ${os.arch()}`);
        console.log(`   Node.js: ${process.version}`);
        console.log(`   Memória livre: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Memória total: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Uptime: ${(os.uptime() / 3600).toFixed(2)} horas`);
      } catch (error) {
        console.error('❌ Erro ao verificar saúde do sistema:', error.message);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });

  // Limpeza do sistema
  system
    .command('cleanup')
    .description('Limpeza geral do sistema')
    .option('--logs', 'Limpar logs antigos')
    .option('--temp', 'Limpar arquivos temporários')
    .option('--cache', 'Limpar cache')
    .option('--all', 'Limpar tudo')
    .action(async (options) => {
      try {
        console.log('🧹 Iniciando limpeza do sistema...');

        let cleanedItems = 0;

        if (options.logs || options.all) {
          console.log('📝 Limpando logs antigos...');

          // Limpar logs de login antigos (mais de 90 dias)
          const oldLogs = await prisma.loginHistory.deleteMany({
            where: {
              createdAt: {
                lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              },
            },
          });

          // Limpar sessões expiradas
          const expiredSessions = await prisma.activeSession.deleteMany({
            where: {
              createdAt: {
                lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 dias
              },
            },
          });

          console.log(`   Logs removidos: ${oldLogs.count}`);
          console.log(`   Sessões expiradas removidas: ${expiredSessions.count}`);
          cleanedItems += oldLogs.count + expiredSessions.count;
        }

        if (options.temp || options.all) {
          console.log('🗂️  Limpando arquivos temporários...');

          // Listar arquivos temporários comuns
          const tempPatterns = [
            '*.tmp',
            '*.log',
            '*.cache',
            'node_modules/.cache',
            'dist',
            'coverage',
          ];

          let tempFiles = 0;
          tempPatterns.forEach((pattern) => {
            // Implementar lógica de limpeza de arquivos temporários
            console.log(`   Verificando: ${pattern}`);
          });

          console.log(`   Arquivos temporários processados: ${tempFiles}`);
          cleanedItems += tempFiles;
        }

        if (options.cache || options.all) {
          console.log('🗑️  Limpando cache...');

          // Limpar cache do Prisma
          try {
            const { execSync } = require('child_process');
            execSync('npx prisma generate', { stdio: 'pipe' });
            console.log('   Cache do Prisma: Limpo');
            cleanedItems++;
          } catch (error) {
            console.log('   Cache do Prisma: Erro ao limpar');
          }
        }

        console.log(`\n✅ Limpeza concluída. Total de itens processados: ${cleanedItems}`);
      } catch (error) {
        console.error('❌ Erro durante limpeza:', error.message);
        process.exit(1);
      }
    });

  // Backup do sistema
  system
    .command('backup')
    .description('Criar backup completo do sistema')
    .option('-o, --output <path>', 'Diretório de saída', './backup')
    .option('--include-logs', 'Incluir logs no backup')
    .option('--include-config', 'Incluir configurações no backup')
    .action(async (options) => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(options.output, `backup-${timestamp}`);

        console.log(`💾 Criando backup completo: ${backupDir}`);

        // Criar diretório de backup
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        // Backup do banco de dados
        console.log('📊 Fazendo backup do banco de dados...');
        const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
        const dbBackupPath = path.join(backupDir, 'database.db');

        if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, dbBackupPath);
          const dbStats = fs.statSync(dbBackupPath);
          console.log(`   Banco: ${(dbStats.size / 1024 / 1024).toFixed(2)} MB`);
        }

        // Backup de configurações
        if (options.includeConfig) {
          console.log('⚙️  Fazendo backup de configurações...');
          const configFiles = ['.env', 'package.json', 'prisma/schema.prisma', 'tsconfig.json'];

          configFiles.forEach((file) => {
            if (fs.existsSync(file)) {
              const destPath = path.join(backupDir, 'config', path.basename(file));
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.copyFileSync(file, destPath);
              console.log(`   ${file}: Copiado`);
            }
          });
        }

        // Backup de logs (se solicitado)
        if (options.includeLogs) {
          console.log('📝 Fazendo backup de logs...');
          // Implementar backup de logs se necessário
        }

        // Criar arquivo de metadados do backup
        const metadata = {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          includes: {
            database: true,
            config: options.includeConfig,
            logs: options.includeLogs,
          },
          system: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
          },
        };

        fs.writeFileSync(
          path.join(backupDir, 'backup-metadata.json'),
          JSON.stringify(metadata, null, 2),
        );

        // Calcular tamanho total
        const totalSize = calculateDirSize(backupDir);

        console.log(`\n✅ Backup concluído:`);
        console.log(`   Diretório: ${backupDir}`);
        console.log(`   Tamanho: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Timestamp: ${timestamp}`);
      } catch (error) {
        console.error('❌ Erro ao criar backup:', error.message);
        process.exit(1);
      }
    });

  // Restaurar backup
  system
    .command('restore')
    .description('Restaurar backup do sistema')
    .requiredOption('-p, --path <path>', 'Caminho do backup')
    .option('--force', 'Forçar restauração sem confirmação')
    .action(async (options) => {
      try {
        if (!fs.existsSync(options.path)) {
          console.error('❌ Diretório de backup não encontrado');
          process.exit(1);
        }

        const metadataPath = path.join(options.path, 'backup-metadata.json');
        if (!fs.existsSync(metadataPath)) {
          console.error('❌ Arquivo de metadados não encontrado');
          process.exit(1);
        }

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

        if (!options.force) {
          console.log(`⚠️  Você está prestes a restaurar o sistema:`);
          console.log(`   Backup: ${options.path}`);
          console.log(`   Timestamp: ${metadata.timestamp}`);
          console.log(
            `   Inclui: ${Object.keys(metadata.includes)
              .filter((k) => metadata.includes[k])
              .join(', ')}`,
          );
          console.log('');
          console.log('Use --force para confirmar a restauração');
          return;
        }

        console.log('🔄 Restaurando sistema...');

        // Restaurar banco de dados
        if (metadata.includes.database) {
          console.log('📊 Restaurando banco de dados...');
          const dbBackupPath = path.join(options.path, 'database.db');
          const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');

          if (fs.existsSync(dbBackupPath)) {
            // Fazer backup do banco atual
            const currentBackup = `backup-before-restore-${Date.now()}.db`;
            fs.copyFileSync(dbPath, currentBackup);

            // Restaurar backup
            fs.copyFileSync(dbBackupPath, dbPath);
            console.log(`   Banco restaurado (backup anterior: ${currentBackup})`);
          }
        }

        // Restaurar configurações
        if (metadata.includes.config) {
          console.log('⚙️  Restaurando configurações...');
          const configDir = path.join(options.path, 'config');

          if (fs.existsSync(configDir)) {
            const configFiles = fs.readdirSync(configDir);
            configFiles.forEach((file) => {
              const sourcePath = path.join(configDir, file);
              const destPath = path.join(process.cwd(), file);

              // Fazer backup do arquivo atual
              if (fs.existsSync(destPath)) {
                const backupPath = `${destPath}.backup-${Date.now()}`;
                fs.copyFileSync(destPath, backupPath);
              }

              fs.copyFileSync(sourcePath, destPath);
              console.log(`   ${file}: Restaurado`);
            });
          }
        }

        console.log('✅ Restauração concluída');
        console.log('⚠️  Reinicie o sistema para aplicar as mudanças');
      } catch (error) {
        console.error('❌ Erro ao restaurar backup:', error.message);
        process.exit(1);
      }
    });

  // Informações do sistema
  system
    .command('info')
    .description('Mostrar informações detalhadas do sistema')
    .action(async () => {
      try {
        console.log('ℹ️  Informações do Sistema');
        console.log('========================');

        // Informações do sistema operacional
        console.log('\n💻 Sistema Operacional:');
        console.log(`   Plataforma: ${os.platform()}`);
        console.log(`   Arquitetura: ${os.arch()}`);
        console.log(`   Versão: ${os.release()}`);
        console.log(`   Hostname: ${os.hostname()}`);
        console.log(`   Uptime: ${(os.uptime() / 3600).toFixed(2)} horas`);

        // Informações de memória
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        console.log('\n🧠 Memória:');
        console.log(`   Total: ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Usada: ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Livre: ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Uso: ${((usedMem / totalMem) * 100).toFixed(1)}%`);

        // Informações do Node.js
        console.log('\n🟢 Node.js:');
        console.log(`   Versão: ${process.version}`);
        console.log(`   Versão do V8: ${process.versions.v8}`);
        console.log(`   Plataforma: ${process.platform}`);
        console.log(`   Arquitetura: ${process.arch}`);
        console.log(`   PID: ${process.pid}`);

        // Informações do banco de dados
        try {
          await prisma.$connect();

          const [users, analyses, payments, sessions] = await Promise.all([
            prisma.user.count(),
            prisma.analysis.count(),
            prisma.payment.count(),
            prisma.activeSession.count(),
          ]);

          console.log('\n🗄️  Banco de Dados:');
          console.log(`   Status: Conectado`);
          console.log(`   Usuários: ${users}`);
          console.log(`   Análises: ${analyses}`);
          console.log(`   Pagamentos: ${payments}`);
          console.log(`   Sessões ativas: ${sessions}`);

          // Tamanho do banco
          const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
          if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            console.log(`   Tamanho: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          }
        } catch (error) {
          console.log('\n🗄️  Banco de Dados:');
          console.log(`   Status: Erro de conexão`);
          console.log(`   Erro: ${error.message}`);
        }

        // Informações de rede
        const networkInterfaces = os.networkInterfaces();
        console.log('\n🌐 Rede:');
        Object.keys(networkInterfaces).forEach((interfaceName) => {
          const interfaces = networkInterfaces[interfaceName];
          interfaces.forEach((interface) => {
            if (interface.family === 'IPv4' && !interface.internal) {
              console.log(`   ${interfaceName}: ${interface.address}`);
            }
          });
        });
      } catch (error) {
        console.error('❌ Erro ao buscar informações:', error.message);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
      }
    });
}

// Função auxiliar para calcular tamanho de diretório
function calculateDirSize(dirPath) {
  let totalSize = 0;

  if (fs.existsSync(dirPath)) {
    const items = fs.readdirSync(dirPath);

    items.forEach((item) => {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        totalSize += calculateDirSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    });
  }

  return totalSize;
}

module.exports = systemCommands;
