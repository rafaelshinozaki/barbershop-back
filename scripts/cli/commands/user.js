const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function userCommands(program) {
  const user = program.command('user').description('Comandos para gerenciamento de usuários');

  // Criar usuário
  user
    .command('create')
    .description('Criar um novo usuário')
    .requiredOption('-e, --email <email>', 'Email do usuário')
    .requiredOption('-p, --password <password>', 'Senha do usuário')
    .option('-n, --name <name>', 'Nome do usuário')
    .option('-r, --role <role>', 'Role do usuário (USER, ADMIN, MANAGER)', 'USER')
    .option('--verified', 'Marcar usuário como verificado', false)
    .action(async (options) => {
      try {
        const hashedPassword = await bcrypt.hash(options.password, 10);

        const user = await prisma.user.create({
          data: {
            email: options.email,
            password: hashedPassword,
            name: options.name || options.email.split('@')[0],
            role: options.role,
            emailVerified: options.verified,
            systemConfig: {
              create: {
                theme: 'light',
                language: 'pt',
                notifications: true,
              },
            },
          },
        });

        console.log('✅ Usuário criado com sucesso:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Verificado: ${user.emailVerified ? 'Sim' : 'Não'}`);
      } catch (error) {
        console.error('❌ Erro ao criar usuário:', error.message);
        process.exit(1);
      }
    });

  // Listar usuários
  user
    .command('list')
    .description('Listar todos os usuários')
    .option('-l, --limit <number>', 'Limite de resultados', '10')
    .option('-o, --offset <number>', 'Offset para paginação', '0')
    .option('--role <role>', 'Filtrar por role')
    .option('--verified', 'Apenas usuários verificados')
    .action(async (options) => {
      try {
        const where = {};

        if (options.role) {
          where.role = options.role;
        }

        if (options.verified) {
          where.emailVerified = true;
        }

        const users = await prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            emailVerified: true,
            createdAt: true,
            lastLoginAt: true,
          },
          take: parseInt(options.limit),
          skip: parseInt(options.offset),
          orderBy: { createdAt: 'desc' },
        });

        console.log(`📋 Usuários encontrados: ${users.length}`);
        console.log('');

        users.forEach((user) => {
          console.log(`ID: ${user.id}`);
          console.log(`Email: ${user.email}`);
          console.log(`Nome: ${user.name}`);
          console.log(`Role: ${user.role}`);
          console.log(`Verificado: ${user.emailVerified ? '✅' : '❌'}`);
          console.log(`Criado em: ${user.createdAt.toLocaleDateString('pt-BR')}`);
          console.log(
            `Último login: ${
              user.lastLoginAt ? user.lastLoginAt.toLocaleDateString('pt-BR') : 'Nunca'
            }`,
          );
          console.log('---');
        });
      } catch (error) {
        console.error('❌ Erro ao listar usuários:', error.message);
        process.exit(1);
      }
    });

  // Atualizar usuário
  user
    .command('update')
    .description('Atualizar um usuário')
    .requiredOption('-i, --id <id>', 'ID do usuário')
    .option('-e, --email <email>', 'Novo email')
    .option('-n, --name <name>', 'Novo nome')
    .option('-r, --role <role>', 'Nova role')
    .option('--verify', 'Marcar como verificado')
    .option('--unverify', 'Marcar como não verificado')
    .action(async (options) => {
      try {
        const updateData = {};

        if (options.email) updateData.email = options.email;
        if (options.name) updateData.name = options.name;
        if (options.role) updateData.role = options.role;
        if (options.verify) updateData.emailVerified = true;
        if (options.unverify) updateData.emailVerified = false;

        const user = await prisma.user.update({
          where: { id: parseInt(options.id) },
          data: updateData,
        });

        console.log('✅ Usuário atualizado com sucesso:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Nome: ${user.name}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Verificado: ${user.emailVerified ? 'Sim' : 'Não'}`);
      } catch (error) {
        console.error('❌ Erro ao atualizar usuário:', error.message);
        process.exit(1);
      }
    });

  // Deletar usuário
  user
    .command('delete')
    .description('Deletar um usuário')
    .requiredOption('-i, --id <id>', 'ID do usuário')
    .option('--force', 'Forçar exclusão sem confirmação')
    .action(async (options) => {
      try {
        if (!options.force) {
          const user = await prisma.user.findUnique({
            where: { id: parseInt(options.id) },
            select: { email: true, name: true },
          });

          if (!user) {
            console.error('❌ Usuário não encontrado');
            process.exit(1);
          }

          console.log(`⚠️  Você está prestes a deletar o usuário:`);
          console.log(`   Email: ${user.email}`);
          console.log(`   Nome: ${user.name}`);
          console.log('');
          console.log('Use --force para confirmar a exclusão');
          return;
        }

        await prisma.user.delete({
          where: { id: parseInt(options.id) },
        });

        console.log('✅ Usuário deletado com sucesso');
      } catch (error) {
        console.error('❌ Erro ao deletar usuário:', error.message);
        process.exit(1);
      }
    });

  // Estatísticas de usuários
  user
    .command('stats')
    .description('Mostrar estatísticas de usuários')
    .action(async () => {
      try {
        const [totalUsers, verifiedUsers, adminUsers, managerUsers, recentUsers] =
          await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { emailVerified: true } }),
            prisma.user.count({ where: { role: 'ADMIN' } }),
            prisma.user.count({ where: { role: 'MANAGER' } }),
            prisma.user.count({
              where: {
                createdAt: {
                  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 dias
                },
              },
            }),
          ]);

        console.log('📊 Estatísticas de Usuários:');
        console.log(`   Total: ${totalUsers}`);
        console.log(
          `   Verificados: ${verifiedUsers} (${((verifiedUsers / totalUsers) * 100).toFixed(1)}%)`,
        );
        console.log(`   Admins: ${adminUsers}`);
        console.log(`   Managers: ${managerUsers}`);
        console.log(`   Novos (30 dias): ${recentUsers}`);
      } catch (error) {
        console.error('❌ Erro ao buscar estatísticas:', error.message);
        process.exit(1);
      }
    });
}

module.exports = userCommands;
