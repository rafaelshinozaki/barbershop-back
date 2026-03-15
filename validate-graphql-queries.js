const fs = require('fs');
const path = require('path');

// Lê o schema GraphQL gerado
const schemaPath = path.join(__dirname, 'src/schema.gql');
const schema = fs.readFileSync(schemaPath, 'utf8');

console.log('🔍 Validando queries GraphQL com base no schema...\n');

// Queries que queremos validar
const queriesToValidate = [
  {
    name: 'GetMyAnalyses',
    query: `
      query GetMyAnalyses {
        myAnalyses {
          id
          name
          description
          type
          status
          createdAt
          updatedAt
        }
      }
    `,
    expectedFields: ['id', 'name', 'description', 'type', 'status', 'createdAt', 'updatedAt'],
    expectedType: 'Analysis'
  },
  {
    name: 'GetAnalysis',
    query: `
      query GetAnalysis($id: Int!) {
        analysis(id: $id) {
          id
          name
          description
          type
          status
          createdAt
          updatedAt
        }
      }
    `,
    expectedFields: ['id', 'name', 'description', 'type', 'status', 'createdAt', 'updatedAt'],
    expectedType: 'Analysis'
  },
  {
    name: 'GetSharedAnalyses',
    query: `
      query GetSharedAnalyses {
        sharedAnalyses {
          id
          analysisId
          sharedWithUserId
          sharedWithEmail
          invitationToken
          status
          createdAt
        }
      }
    `,
    expectedFields: ['id', 'analysisId', 'sharedWithUserId', 'sharedWithEmail', 'invitationToken', 'status', 'createdAt'],
    expectedType: 'AnalysisShare'
  },
  {
    name: 'CreateAnalysis',
    query: `
      mutation CreateAnalysis($input: CreateAnalysisInput!) {
        createAnalysis(input: $input) {
          id
          name
          description
          type
          status
          createdAt
          updatedAt
        }
      }
    `,
    expectedFields: ['id', 'name', 'description', 'type', 'status', 'createdAt', 'updatedAt'],
    expectedType: 'Analysis'
  },
  {
    name: 'UpdateAnalysis',
    query: `
      mutation UpdateAnalysis($id: Int!, $input: UpdateAnalysisInput!) {
        updateAnalysis(id: $id, input: $input) {
          id
          name
          description
          type
          status
          results
          updatedAt
        }
      }
    `,
    expectedFields: ['id', 'name', 'description', 'type', 'status', 'results', 'updatedAt'],
    expectedType: 'Analysis'
  },
  {
    name: 'DeleteAnalysis',
    query: `
      mutation DeleteAnalysis($id: Int!) {
        deleteAnalysis(id: $id)
      }
    `,
    expectedFields: [],
    expectedType: 'Boolean'
  }
];

// Função para extrair definições de tipos do schema
function extractTypeDefinitions(schema) {
  const typeRegex = /type\s+(\w+)\s*\{([^}]+)\}/g;
  const types = {};
  let match;

  while ((match = typeRegex.exec(schema)) !== null) {
    const typeName = match[1];
    const typeBody = match[2];
    
    // Extrair campos do tipo
    const fieldRegex = /(\w+):\s*([^!\n]+)(!)?/g;
    const fields = {};
    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(typeBody)) !== null) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2].trim();
      const isRequired = fieldMatch[3] === '!';
      fields[fieldName] = { type: fieldType, required: isRequired };
    }

    types[typeName] = fields;
  }

  return types;
}

// Função para extrair queries e mutations do schema
function extractQueriesAndMutations(schema) {
  const queryRegex = /(\w+)\s*\([^)]*\):\s*([^!\n]+)(!)?/g;
  const operations = {};
  let match;

  while ((match = queryRegex.exec(schema)) !== null) {
    const operationName = match[1];
    const returnType = match[2].trim();
    const isRequired = match[3] === '!';
    operations[operationName] = { type: returnType, required: isRequired };
  }

  // Também extrair operações sem parâmetros
  const simpleQueryRegex = /(\w+):\s*([^!\n]+)(!)?/g;
  while ((match = simpleQueryRegex.exec(schema)) !== null) {
    const operationName = match[1];
    const returnType = match[2].trim();
    const isRequired = match[3] === '!';
    
    // Só adicionar se não for um tipo definido
    if (!schema.includes(`type ${operationName}`) && !schema.includes(`enum ${operationName}`)) {
      operations[operationName] = { type: returnType, required: isRequired };
    }
  }

  return operations;
}

// Validar as queries
function validateQueries() {
  const types = extractTypeDefinitions(schema);
  const operations = extractQueriesAndMutations(schema);

  console.log('📊 Tipos encontrados no schema:');
  Object.keys(types).forEach(typeName => {
    console.log(`  - ${typeName}`);
  });
  console.log('');

  console.log('🔍 Operações encontradas no schema:');
  Object.keys(operations).forEach(opName => {
    console.log(`  - ${opName}: ${operations[opName].type}${operations[opName].required ? '!' : ''}`);
  });
  console.log('');

  let allValid = true;

  queriesToValidate.forEach(({ name, query, expectedFields, expectedType }) => {
    console.log(`\n✅ Validando: ${name}`);
    
    // Verificar se a operação existe no schema
    let operationName;
    if (name === 'GetMyAnalyses') operationName = 'myAnalyses';
    else if (name === 'GetAnalysis') operationName = 'analysis';
    else if (name === 'GetSharedAnalyses') operationName = 'sharedAnalyses';
    else if (name === 'CreateAnalysis') operationName = 'createAnalysis';
    else if (name === 'UpdateAnalysis') operationName = 'updateAnalysis';
    else if (name === 'DeleteAnalysis') operationName = 'deleteAnalysis';
    else operationName = name.toLowerCase();
    
    if (operations[operationName]) {
      console.log(`  ✅ Operação "${operationName}" encontrada no schema`);
    } else {
      console.log(`  ❌ Operação "${operationName}" NÃO encontrada no schema`);
      allValid = false;
    }

    // Verificar se o tipo de retorno existe
    if (types[expectedType] || expectedType === 'Boolean') {
      console.log(`  ✅ Tipo "${expectedType}" encontrado no schema`);
      
      // Verificar se os campos esperados existem no tipo
      expectedFields.forEach(field => {
        if (types[expectedType][field]) {
          console.log(`    ✅ Campo "${field}" existe no tipo ${expectedType}`);
        } else {
          console.log(`    ❌ Campo "${field}" NÃO existe no tipo ${expectedType}`);
          allValid = false;
        }
      });
    } else {
      console.log(`  ❌ Tipo "${expectedType}" NÃO encontrado no schema`);
      allValid = false;
    }
  });

  console.log('\n' + '='.repeat(50));
  if (allValid) {
    console.log('🎉 TODAS AS QUERIES ESTÃO VÁLIDAS!');
  } else {
    console.log('❌ ALGUMAS QUERIES POSSUEM PROBLEMAS!');
  }
  console.log('='.repeat(50));

  return allValid;
}

// Executar validação
validateQueries(); 