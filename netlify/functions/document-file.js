import { filesStore, ALLOWED_IMAGE_TYPES } from '../../src/db.js';
import { requireAuth } from '../../src/auth.js';

export default async (request, context) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = context.params;
    const result = await filesStore().getWithMetadata(id, { type: 'arrayBuffer' });
    if (!result) return new Response('Não encontrado', { status: 404 });

    const storedType = (result.metadata && result.metadata.contentType) || 'image/jpeg';
    // Arquivos antigos com tipo fora da lista (ex.: SVG, que pode conter script)
    // são entregues como download genérico, nunca renderizados na nossa origem.
    const safe = ALLOWED_IMAGE_TYPES.includes(storedType);
    const headers = {
      'Content-Type': safe ? storedType : 'application/octet-stream',
      // "private": só o navegador de quem está logado guarda a imagem — a CDN
      // não pode guardar e entregar para quem não tem sessão.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    };
    if (!safe) headers['Content-Disposition'] = 'attachment';

    return new Response(result.data, { headers });
  } catch (e) {
    console.error(e);
    return new Response('Erro ao carregar arquivo.', { status: 500 });
  }
};

export const config = { path: '/api/documents/:id/file' };
