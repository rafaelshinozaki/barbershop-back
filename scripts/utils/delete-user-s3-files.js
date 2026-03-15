const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

// Configuração do AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

/**
 * Deleta arquivos do S3 relacionados a um usuário
 */
async function deleteUserS3Files(userId, photoKey = null) {
  console.log(`🗑️  Deletando arquivos do S3 para usuário ID: ${userId}`);

  try {
    const filesToDelete = [];

    // 1. Deletar foto do perfil se existir
    if (photoKey) {
      filesToDelete.push({ Key: photoKey });
      console.log(`📸 Foto do perfil encontrada: ${photoKey}`);
    }

    // 2. Buscar e deletar análises do usuário (se houver arquivos)
    // Você pode adicionar lógica específica aqui baseada na estrutura do seu S3
    const analysisPrefix = `analyses/user-${userId}/`;

    try {
      const analysisObjects = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: analysisPrefix,
        }),
      );

      if (analysisObjects.Contents && analysisObjects.Contents.length > 0) {
        analysisObjects.Contents.forEach((obj) => {
          filesToDelete.push({ Key: obj.Key });
        });
        console.log(`📊 ${analysisObjects.Contents.length} arquivos de análise encontrados`);
      }
    } catch (error) {
      console.warn(`⚠️  Erro ao listar arquivos de análise: ${error.message}`);
    }

    // 3. Buscar outros arquivos relacionados ao usuário
    const userPrefix = `users/${userId}/`;

    try {
      const userObjects = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: userPrefix,
        }),
      );

      if (userObjects.Contents && userObjects.Contents.length > 0) {
        userObjects.Contents.forEach((obj) => {
          filesToDelete.push({ Key: obj.Key });
        });
        console.log(`👤 ${userObjects.Contents.length} arquivos do usuário encontrados`);
      }
    } catch (error) {
      console.warn(`⚠️  Erro ao listar arquivos do usuário: ${error.message}`);
    }

    // 4. Deletar todos os arquivos encontrados
    if (filesToDelete.length > 0) {
      console.log(`🗑️  Deletando ${filesToDelete.length} arquivos do S3...`);

      // Deletar em lotes de 1000 (limite do S3)
      const batchSize = 1000;
      for (let i = 0; i < filesToDelete.length; i += batchSize) {
        const batch = filesToDelete.slice(i, i + batchSize);

        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: {
              Objects: batch,
              Quiet: false,
            },
          }),
        );

        console.log(
          `   ✅ Lote ${Math.floor(i / batchSize) + 1} deletado (${batch.length} arquivos)`,
        );
      }

      console.log(`✅ Todos os arquivos do S3 deletados com sucesso!`);
    } else {
      console.log(`ℹ️  Nenhum arquivo encontrado no S3 para este usuário`);
    }

    return true;
  } catch (error) {
    console.error('❌ Erro ao deletar arquivos do S3:', error);
    return false;
  }
}

/**
 * Lista arquivos do S3 para um usuário específico
 */
async function listUserS3Files(userId) {
  console.log(`📋 Listando arquivos do S3 para usuário ID: ${userId}`);

  try {
    const files = [];

    // Buscar em diferentes prefixos
    const prefixes = [`analyses/user-${userId}/`, `users/${userId}/`, `profiles/${userId}/`];

    for (const prefix of prefixes) {
      try {
        const objects = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
          }),
        );

        if (objects.Contents && objects.Contents.length > 0) {
          objects.Contents.forEach((obj) => {
            files.push({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified,
            });
          });
        }
      } catch (error) {
        console.warn(`⚠️  Erro ao listar prefixo ${prefix}: ${error.message}`);
      }
    }

    if (files.length > 0) {
      console.log(`📁 ${files.length} arquivos encontrados:`);
      files.forEach((file) => {
        console.log(`   - ${file.key} (${(file.size / 1024).toFixed(2)} KB)`);
      });
    } else {
      console.log(`ℹ️  Nenhum arquivo encontrado no S3`);
    }

    return files;
  } catch (error) {
    console.error('❌ Erro ao listar arquivos do S3:', error);
    return [];
  }
}

// Interface de linha de comando
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'delete':
      const userId = args[1];
      const photoKey = args[2] || null;

      if (!userId) {
        console.error('❌ Uso: node delete-user-s3-files.js delete <userId> [photoKey]');
        process.exit(1);
      }

      const success = await deleteUserS3Files(userId, photoKey);
      process.exit(success ? 0 : 1);
      break;

    case 'list':
      const listUserId = args[1];
      if (!listUserId) {
        console.error('❌ Uso: node delete-user-s3-files.js list <userId>');
        process.exit(1);
      }

      await listUserS3Files(listUserId);
      break;

    default:
      console.log('📖 Uso do script:');
      console.log('');
      console.log('  Listar arquivos do S3:');
      console.log('    node delete-user-s3-files.js list <userId>');
      console.log('');
      console.log('  Deletar arquivos do S3:');
      console.log('    node delete-user-s3-files.js delete <userId> [photoKey]');
      console.log('');
      console.log('⚠️  ATENÇÃO: A exclusão de arquivos é PERMANENTE!');
      break;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { deleteUserS3Files, listUserS3Files };
