// Autenticação simples baseada em sessão de cookie httpOnly.
// Não usamos JWT: o token é só um id aleatório que aponta pra um registro
// de sessão guardado no Blobs — assim dá pra revogar (logout) de verdade,
// o que um JWT autocontido não permite sem infraestrutura extra.
//
// Cookie em vez de header Authorization de propósito: o app carrega imagens
// via <img src="/api/documents/:id/file">, e o navegador só envia cookies
// automaticamente nesse tipo de requisição — um token em header não chegaria.

import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const SESSION_COOKIE = 'digitalize_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15min
const PBKDF2_ITERATIONS = 100000;

function sessionsStore() {
  return getStore({ name: 'digitalize-sessions', consistency: 'strong' });
}
function securityStore() {
  return getStore({ name: 'digitalize-security', consistency: 'strong' });
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
}

// Compara a senha recebida com o hash configurado nas variáveis de ambiente.
// Lança erro se o servidor não tiver sido configurado (evita "logar" por acidente
// com uma verificação sempre-falsa silenciosa).
// Transição do nome antigo (DigiKof): se as variáveis DIGITALIZE_* ainda não
// existirem na Netlify, usa as DIGIKOF_*. O trio é lido sempre do mesmo
// prefixo, para nunca misturar o salt de um com o hash do outro. Quando as
// DIGITALIZE_* estiverem criadas, este fallback pode ser removido.
function credentialsFromEnv() {
  for (const prefix of ['DIGITALIZE', 'DIGIKOF']) {
    const user = process.env[prefix + '_USERNAME'];
    const salt = process.env[prefix + '_PASSWORD_SALT'];
    const hash = process.env[prefix + '_PASSWORD_HASH'];
    if (user && salt && hash) return { expectedUser: user, salt, expectedHash: hash };
  }
  return null;
}

export function verifyCredentials(username, password) {
  const creds = credentialsFromEnv();
  if (!creds) {
    throw new Error('Autenticação não configurada no servidor (variáveis de ambiente ausentes).');
  }
  const { expectedUser, salt, expectedHash } = creds;
  if (username !== expectedUser) return false;

  const computed = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

// O bloqueio por tentativas é por IP de origem, não por usuário: como só
// existe um usuário, bloquear por nome deixaria qualquer pessoa trancar o app
// inteiro errando a senha 5 vezes. Por IP, quem erra só bloqueia a si mesmo.
// (Também evita criar um registro novo para cada nome de usuário inventado.)
export function clientIp(request, context) {
  return (
    (context && context.ip) ||
    request.headers.get('x-nf-client-connection-ip') ||
    'unknown'
  );
}

function attemptsKey(ip) {
  return 'attempts-ip:' + encodeURIComponent(ip);
}

export async function checkLockout(ip) {
  const record = await securityStore().get(attemptsKey(ip), { type: 'json' });
  if (record && record.lockedUntil && record.lockedUntil > Date.now()) {
    return Math.ceil((record.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

export async function registerFailedAttempt(ip) {
  const store = securityStore();
  const key = attemptsKey(ip);
  const record = (await store.get(key, { type: 'json' })) || { count: 0 };
  record.count = (record.count || 0) + 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
    record.count = 0;
  }
  await store.setJSON(key, record);
}

export async function clearAttempts(ip) {
  await securityStore().delete(attemptsKey(ip)).catch(() => {});
}

export async function createSession(username) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sessionsStore().setJSON(token, { username, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token) {
  if (!token) return;
  await sessionsStore().delete(token).catch(() => {});
}

export async function validateSession(token) {
  if (!token) return null;
  const session = await sessionsStore().get(token, { type: 'json' });
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await destroySession(token);
    return null;
  }
  return session;
}

export function sessionCookieHeader(token, maxAgeSeconds, isHttps) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(isHttps) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

// Usado no início de cada função protegida. Retorna uma Response de erro
// pronta pra devolver se não houver sessão válida, ou null se estiver tudo certo.
export async function requireAuth(request) {
  const cookies = parseCookies(request);
  const session = await validateSession(cookies[SESSION_COOKIE]);
  if (!session) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  return null;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
