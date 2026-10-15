#!/usr/bin/env node
// Gera as credenciais para configurar o login do Digitalize.
// Uso:  node scripts/hash-password.mjs "a-senha-que-voce-quer-usar"
//
// A senha em si NUNCA é salva em lugar nenhum — só o hash. Guarde a senha
// original em um cofre de senhas para compartilhar com quem for usar o app.

import { randomBytes, pbkdf2Sync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.mjs "sua-senha"');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Use uma senha com pelo menos 8 caracteres.');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');

console.log('\nAdicione estas 3 variáveis em Netlify → Site settings → Environment variables:\n');
console.log('DIGITALIZE_USERNAME=escolha-um-usuario');
console.log('DIGITALIZE_PASSWORD_SALT=' + salt);
console.log('DIGITALIZE_PASSWORD_HASH=' + hash);
console.log('\nDepois de adicionar, faça um novo deploy para as funções lerem os valores novos.\n');
