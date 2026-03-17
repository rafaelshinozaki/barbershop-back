#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');

// Importar comandos
const userCommands = require('./commands/user');
const databaseCommands = require('./commands/database');
const stripeCommands = require('./commands/stripe');
const systemCommands = require('./commands/system');

const program = new Command();

// Configuração básica do programa
program
  .name('barbershop-cli')
  .description('CLI para gerenciamento do backend Barbershop')
  .version('1.0.0');

// Adicionar comandos
userCommands(program);
databaseCommands(program);
stripeCommands(program);
systemCommands(program);

// Comando de ajuda personalizado
program.addHelpText(
  'after',
  `
Exemplos:
  $ barbershop-cli user create --email admin@example.com --password 123456
  $ barbershop-cli db migrate
  $ barbershop-cli stripe sync-plans
  $ barbershop-cli system health
`,
);

// Executar o programa
program.parse();
