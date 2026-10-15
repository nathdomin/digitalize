import {
  verifyCredentials,
  checkLockout,
  registerFailedAttempt,
  clearAttempts,
  createSession,
  sessionCookieHeader,
  clientIp
} from '../../src/auth.js';

export default async (request, context) => {
  try {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const body = await request.json();
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) {
      return Response.json({ error: 'Informe usuário e senha.' }, { status: 400 });
    }

    const ip = clientIp(request, context);
    const lockedSeconds = await checkLockout(ip);
    if (lockedSeconds > 0) {
      return Response.json(
        { error: `Muitas tentativas incorretas. Tente novamente em ${Math.ceil(lockedSeconds / 60)} min.` },
        { status: 429 }
      );
    }

    let valid;
    try {
      valid = verifyCredentials(username, password);
    } catch (e) {
      // Servidor sem as variáveis de ambiente configuradas — erro de configuração, não de senha.
      return Response.json({ error: e.message }, { status: 500 });
    }

    if (!valid) {
      await registerFailedAttempt(ip);
      return Response.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    await clearAttempts(ip);
    const { token, expiresAt } = await createSession(username);
    const isHttps = new URL(request.url).protocol === 'https:';
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000);

    return Response.json(
      { ok: true },
      { status: 200, headers: { 'Set-Cookie': sessionCookieHeader(token, maxAge, isHttps) } }
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: e.message || 'Erro inesperado no servidor.' }, { status: 500 });
  }
};

export const config = { path: '/api/auth/login' };
