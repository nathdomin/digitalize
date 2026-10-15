# Digitalize — versão Netlify

Mesma interface do projeto original, mas o backend foi adaptado para rodar como
**Netlify Functions** (serverless) em vez de um servidor Express contínuo — porque
a Netlify não mantém um processo Node ligado nem um disco persistente entre
requisições. Os dados agora ficam no **Netlify Blobs** (armazenamento de objetos
nativo da plataforma, sem precisar configurar nenhum banco separado).

## O que mudou em relação à versão Node/Express

| | Versão Node/Express | Versão Netlify |
|---|---|---|
| Servidor | `server.js` sempre rodando | Funções sob demanda em `netlify/functions/` |
| Metadados (pastas/documentos) | `data/db.json` em disco | Netlify Blobs, store `digitalize-meta` |
| Imagens digitalizadas | `uploads/*.jpg` em disco | Netlify Blobs, store `digitalize-files` |
| Front-end (`/public`) | Servido pelo próprio Express | Servido diretamente pela Netlify (hospedagem estática) |

O front-end (`public/index.html`, `css/styles.css`, `js/app.js`) é **exatamente o
mesmo** — ele já falava com a API por `fetch('/api/...')`, então não precisou mudar.

## Mudança de nome: DigiKof → Digitalize

O projeto se chamava **DigiKof**. Com a troca de nome, os identificadores
internos também mudaram. Num site que já estava publicado, faça isto na Netlify:

1. **Variáveis de ambiente** (Site configuration → Environment variables):
   crie `DIGITALIZE_USERNAME`, `DIGITALIZE_PASSWORD_SALT` e
   `DIGITALIZE_PASSWORD_HASH` com os **mesmos valores** de `DIGIKOF_USERNAME`,
   `DIGIKOF_PASSWORD_SALT` e `DIGIKOF_PASSWORD_HASH` (a senha continua a mesma).
   Depois apague as três `DIGIKOF_*`. Enquanto as `DIGITALIZE_*` não existirem,
   o login continua funcionando com as `DIGIKOF_*` (compatibilidade temporária
   em `src/auth.js`, que pode ser removida depois da troca).
2. **Novo deploy** depois de trocar as variáveis (Deploys → Trigger deploy).
3. **Dados:** pastas e documentos ficam nos stores `digitalize-meta` e
   `digitalize-files`. O que foi salvo antes continua nos stores antigos
   `digikof-meta` e `digikof-files`, mas não aparece no app novo.
4. **Sessões:** o cookie mudou de nome (`digitalize_session`), então todo mundo
   precisa entrar de novo uma vez.
5. **Opcional:** trocar o endereço do site em Site configuration → Change site
   name (ex.: `digitalize.netlify.app`). Se o repositório do GitHub também foi
   renomeado, confira em Build & deploy → Repository se o vínculo continua certo.

## Configurando o login (obrigatório antes do primeiro deploy)

O app agora exige usuário e senha — sem isso configurado, ninguém entra (inclusive
você). O acesso é validado num usuário/senha único, guardado como variável de
ambiente (nada de senha em texto puro no código ou no repositório).

1. Gere o hash da senha localmente:

   ```bash
   node scripts/hash-password.mjs "a-senha-que-voce-quer-usar"
   ```

2. O script imprime 3 variáveis. Adicione-as em **Netlify → Site settings →
   Environment variables**:

   - `DIGITALIZE_USERNAME`
   - `DIGITALIZE_PASSWORD_SALT`
   - `DIGITALIZE_PASSWORD_HASH`

3. Faça (ou refaça) o deploy — as funções só leem essas variáveis quando sobem.

Como funciona por baixo dos panos:
- A senha nunca fica salva — só um hash (PBKDF2, 100.000 iterações) é comparado a cada login.
- Login bem-sucedido cria uma sessão (guardada no Blobs) e devolve um cookie `httpOnly`, `Secure`, `SameSite=Strict` — inacessível a JavaScript malicioso e não enviado entre sites.
- Toda rota de dados (`/api/folders/*`, `/api/documents/*`, inclusive o endpoint que serve a imagem) exige essa sessão válida — sem cookie de sessão, a API responde `401` e o front-end manda de volta pra tela de login.
- Depois de **5 tentativas de senha erradas** vindas do mesmo IP, novas tentativas desse IP ficam bloqueadas por 15 minutos. O bloqueio é por IP, e não por usuário, para que ninguém consiga trancar o app inteiro só errando a senha de propósito.
- As imagens são servidas com `Cache-Control: private`, para que a CDN não guarde nem entregue arquivos a quem não tem sessão. O upload só aceita JPEG, PNG ou WebP de até 5 MB (SVG é recusado, porque pode conter script).
- O `netlify.toml` define cabeçalhos de segurança (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) para o site estático.
- A sessão expira sozinha em 12h — depois disso, é preciso logar de novo.

Se quiser um usuário por pessoa (em vez de uma credencial compartilhada) ou login
via conta corporativa, a troca natural é usar o **Netlify Identity** ou um
provedor de SSO — dá mais trabalho de configurar, mas o `requireAuth()` em
`src/auth.js` é o único lugar que precisaria mudar.



### Opção A — pelo painel da Netlify (mais simples)

1. Suba esta pasta para um repositório no GitHub/GitLab/Bitbucket.
2. Na Netlify: **Add new site → Import an existing project** e aponte pro repositório.
3. A Netlify já vai detectar o `netlify.toml` (publish = `public`, functions = `netlify/functions`) — não precisa configurar build command, é um site estático + funções.
4. Deploy.

### Opção B — pela CLI

```bash
npm install
npx netlify-cli login
npx netlify-cli init      # ou: npx netlify-cli link, se o site já existir
npx netlify-cli deploy --prod
```

## Testando localmente antes do deploy

Como agora depende de Netlify Functions e Netlify Blobs, `node server.js` não existe
mais nessa versão — o jeito certo de testar localmente é com o próprio CLI da Netlify,
que emula funções e Blobs na sua máquina:

```bash
npm install
npx netlify-cli dev
```

Isso sobe o site em algo como `http://localhost:8888`, com `/api/*` já roteado para as
funções em `netlify/functions/`.

## HTTPS e câmera

Depois do deploy, a Netlify já serve tudo em HTTPS automaticamente (certificado
gratuito incluso) — então a câmera do celular (`capture="environment"`) funciona
direto, sem configuração extra. Em `localhost` durante o desenvolvimento também
funciona, por ser exceção de contexto seguro.

## Limites que valem saber

- **Tamanho de upload**: funções da Netlify (modo síncrono) aceitam corpos de
  requisição de até alguns MB (o servidor recusa acima de 5 MB). As imagens já
  saem do navegador comprimidas em JPEG (lado maior até 2000px, qualidade 0.9),
  então na prática ficam bem abaixo do limite.

## Como funciona a digitalização

O tratamento da foto acontece no navegador, antes do envio (`processImage` em
`public/js/app.js`). Ao digitalizar, dá para escolher entre três modos, e o
navegador lembra o último usado:

- **Digitalizado P&B** (padrão): fundo branco, texto preto e nítido.
- **Digitalizado colorido**: fundo branco, mas mantém a cor de canetas,
  carimbos e assinaturas, e corrige o tom amarelado da luz.
- **Foto original**: sem tratamento, só redimensionada.

**Recorte e correção de perspectiva.** O app detecta a folha na foto, procurando
a região clara que contrasta com o fundo, e endireita a página como se ela
tivesse sido fotografada exatamente de cima. Com uma foto só, abre um editor
com os 4 cantos detectados para conferir e ajustar arrastando. Também dá para
escolher "Foto inteira" para não recortar. Com várias fotos de uma vez, o
recorte é aplicado sozinho em cada uma (exceto no modo "Foto original"). Se a
página não for detectada, a foto inteira é usada.

A detecção funciona melhor com a folha sobre um fundo mais escuro que ela.
Pode errar quando o fundo é tão claro quanto o papel ou quando uma área
escura da folha encosta na borda dela (ex.: cabeçalho preto sem margem). Por
isso o editor mostra os cantos antes de enviar. A proporção da página
endireitada é aproximada, porque a foto não informa o ângulo exato da câmera.

**Tratamento.** O efeito estima o brilho do papel em cada região da foto e divide a imagem por
ele. Áreas escuras grandes dentro do documento (faixas pretas, logotipos,
fotos) são reconhecidas e não clareiam. Isso remove sombras e luz desigual. Depois, uma curva de níveis deixa o
papel branco puro e escurece a tinta, inclusive texto fraco ou a lápis, e um
leve realce de nitidez define as bordas das letras. Os parâmetros de ajuste
ficam no topo da seção (`SCAN_WHITE_POINT`, `SCAN_GAMMA`, `SCAN_SHARPEN`).
- **Sem transação entre escritas simultâneas**: os metadados ficam num único
  JSON no Blobs. Duas pessoas criando pasta ou enviando documento no mesmíssimo
  instante, em teoria, podem sobrescrever uma a outra (é uma limitação de usar
  um blob de objeto único como "banco"). Para o volume normal de uso departamental
  isso raramente aparece; se virar um problema real, migrar `src/db.js` para o
  Netlify DB (Postgres gerenciado pela própria Netlify) resolve, sem precisar
  tocar nas funções de rota.
- **Sem autenticação por usuário individual**: existe um único usuário/senha
  compartilhado (ver seção de login acima). Suficiente pra restringir acesso
  de quem não deveria estar ali, mas não dá pra saber *quem* fez cada ação —
  se isso for necessário, é o gatilho pra evoluir pra login individual (Netlify
  Identity/SSO).

## Estrutura

```
digitalize/
  netlify.toml
  package.json
  scripts/
    hash-password.mjs         # gera as credenciais de login
  src/
    db.js                      # acesso ao Netlify Blobs (metadados + arquivos)
    auth.js                    # sessões, hash de senha, bloqueio por tentativas
  netlify/functions/
    auth-login.js               # POST /api/auth/login
    auth-logout.js              # POST /api/auth/logout
    auth-me.js                  # GET /api/auth/me
    folders.js                  # GET/POST /api/folders
    folder-item.js               # DELETE /api/folders/:id
    folder-documents.js          # GET/POST /api/folders/:id/documents
    document-item.js             # PATCH/DELETE /api/documents/:id
    document-file.js             # GET /api/documents/:id/file
  public/
    index.html
    css/styles.css
    js/app.js
```
