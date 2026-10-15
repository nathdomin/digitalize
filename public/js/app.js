// ================= API helper =================
async function api(path, options = {}) {
  try {
    const res = await fetch('/api' + path, {
      headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...options
    });
    setOnline(true);
    if (res.status === 401) {
      showLogin('Sua sessão expirou. Entre novamente.');
      throw new Error('Sessão expirada.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* sem corpo */ }
    if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
    return data;
  } catch (err) {
    if (err instanceof TypeError) setOnline(false); // falha de rede real
    throw err;
  }
}

function setOnline(isOnline) {
  const el = document.getElementById('connStatus');
  if (!el) return;
  el.classList.toggle('offline', !isOnline);
  const label = isOnline ? 'Conectado' : 'Sem conexão com o servidor';
  el.innerHTML = `<span class="dot"></span><span class="status-label">${label}</span>`;
  el.title = label;
}

// ================= Toasts =================
function showToast(message, type = 'default') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'default' ? ' ' + type : '');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

// ================= State =================
let folders = [];
let currentFolderId = null;
let currentDocs = [];
let docSearch = '';
let pendingFolderColor = '#E1001A';
let lastAddedDocId = null;
// Modo de digitalização escolhido por último (fica salvo neste navegador).
let scanMode = (() => {
  try {
    const saved = localStorage.getItem('digitalize_scan_mode');
    return ['bw', 'color', 'none'].includes(saved) ? saved : 'bw';
  } catch (e) { return 'bw'; }
})();

const FOLDER_COLORS = ['#E1001A', '#2B2B2B', '#AE0014', '#6E6560', '#181818', '#8C2F2F'];

const foldersWrap = document.getElementById('foldersWrap');
const detailWrap = document.getElementById('detailWrap');
const modalRoot = document.getElementById('modalRoot');

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================= Init =================
async function init() {
  renderFolderSkeleton();
  renderWelcome();
  try {
    const { folders: list } = await api('/folders');
    folders = list;
  } catch (e) {
    showToast('Não foi possível carregar as pastas: ' + e.message, 'error');
    folders = [];
  }
  renderFolders();
}

// ================= Folders sidebar =================
function renderFolderSkeleton() {
  foldersWrap.innerHTML = `
    <div class="skeleton-grid folders-skel">
      ${[1, 2, 3].map(() => '<div class="skel"></div>').join('')}
    </div>
  `;
}

function renderFolders() {
  if (folders.length === 0) {
    foldersWrap.innerHTML = `
      <div class="empty">
        <strong>Nenhuma pasta ainda</strong>
        Crie a primeira pasta para começar a organizar seus documentos digitalizados.
      </div>
    `;
    return;
  }
  foldersWrap.innerHTML = `<div class="folder-grid" id="folderGrid"></div>`;
  const grid = document.getElementById('folderGrid');
  folders.forEach((f, i) => {
    const card = document.createElement('div');
    card.className = 'folder-card' + (f.id === currentFolderId ? ' active' : '');
    card.style.background = f.color;
    card.style.animationDelay = Math.min(i * 30, 180) + 'ms';
    card.innerHTML = `
      <button class="fdel" title="Excluir pasta" data-id="${f.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="fname">${escapeHtml(f.name)}</div>
      <div class="fcount">${f.count || 0} documento${(f.count || 0) === 1 ? '' : 's'}</div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.fdel')) return;
      openFolder(f.id);
    });
    card.querySelector('.fdel').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteFolder(f.id, f.name);
    });
    grid.appendChild(card);
  });
}

async function confirmDeleteFolder(id, name) {
  showConfirm(`Excluir "${escapeHtml(name)}"?`, 'Todos os documentos dentro desta pasta serão apagados permanentemente do servidor.', async () => {
    try {
      await api('/folders/' + id, { method: 'DELETE' });
      folders = folders.filter((f) => f.id !== id);
      if (currentFolderId === id) {
        currentFolderId = null;
        document.body.classList.remove('showing-detail');
        renderWelcome();
      }
      renderFolders();
      showToast('Pasta excluída.', 'success');
    } catch (e) {
      showToast('Não foi possível excluir a pasta: ' + e.message, 'error');
    }
  });
}

function openNewFolderModal() {
  pendingFolderColor = FOLDER_COLORS[0];
  modalRoot.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="modal">
        <h3>Nova pasta</h3>
        <label for="folderNameInput">Nome da pasta</label>
        <input type="text" id="folderNameInput" placeholder="Ex.: Contratos, RH, Notas fiscais" maxlength="40">
        <label>Cor</label>
        <div class="color-row" id="colorRow"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelFolder">Cancelar</button>
          <button class="btn btn-primary" id="createFolder">Criar pasta</button>
        </div>
      </div>
    </div>
  `;
  const colorRow = document.getElementById('colorRow');
  FOLDER_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      pendingFolderColor = c;
      colorRow.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
    colorRow.appendChild(sw);
  });
  document.getElementById('cancelFolder').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  const nameInput = document.getElementById('folderNameInput');
  nameInput.focus();
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreateFolder(); });
  document.getElementById('createFolder').onclick = doCreateFolder;
}

async function doCreateFolder() {
  const nameInput = document.getElementById('folderNameInput');
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  const btn = document.getElementById('createFolder');
  btn.disabled = true;
  try {
    const { folder } = await api('/folders', {
      method: 'POST',
      body: JSON.stringify({ name, color: pendingFolderColor })
    });
    folders.push(folder);
    closeModal();
    renderFolders();
    showToast('Pasta criada.', 'success');
  } catch (e) {
    showToast('Não foi possível criar a pasta: ' + e.message, 'error');
    btn.disabled = false;
  }
}

function closeModal() { modalRoot.innerHTML = ''; }

function showConfirm(title, body, onConfirm) {
  modalRoot.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="modal">
        <h3>${title}</h3>
        <p style="color:var(--ink-soft);font-size:14px;line-height:1.5;">${body}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelConfirm">Cancelar</button>
          <button class="btn" style="background:var(--danger);color:#fff;" id="okConfirm">Excluir</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('cancelConfirm').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  document.getElementById('okConfirm').onclick = async () => { closeModal(); await onConfirm(); };
}

// ================= Detail pane (documents) =================
// O botão "Digitalizar" fica fora do painel (no index.html): o painel desliza
// com transform no celular, e um position:fixed dentro dele deixaria de ficar
// preso à tela.
const scanBtn = document.getElementById('scanBtn');
scanBtn.onclick = openCaptureModal;

function renderWelcome() {
  scanBtn.hidden = true;
  detailWrap.innerHTML = `
    <div class="welcome">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3"/><circle cx="12" cy="12" r="3"/></svg>
      <strong>Selecione uma pasta</strong>
      <p>Escolha uma pasta ao lado para ver os documentos digitalizados, ou crie uma nova pasta para começar.</p>
    </div>
  `;
}

// No celular, lista de pastas e pasta aberta são "telas" que deslizam.
// Guarda onde a lista estava para voltar ao mesmo ponto.
const isMobileLayout = () => window.matchMedia('(max-width: 899px)').matches;
let foldersScrollY = 0;

async function openFolder(id) {
  currentFolderId = id;
  docSearch = '';
  if (isMobileLayout()) {
    foldersScrollY = window.scrollY;
    window.scrollTo(0, 0);
  }
  document.body.classList.add('showing-detail');
  renderFolders(); // atualiza o destaque da pasta ativa
  renderDetailSkeleton();

  try {
    const { documents } = await api('/folders/' + id + '/documents');
    currentDocs = documents;
    renderFolderDetail();
  } catch (e) {
    detailWrap.innerHTML = `<div class="empty"><strong>Não foi possível carregar esta pasta</strong>${escapeHtml(e.message)}</div>`;
  }
}

function renderDetailSkeleton() {
  scanBtn.hidden = true;
  const folder = folders.find((f) => f.id === currentFolderId);
  detailWrap.innerHTML = `
    <div class="section-head"><h2>${folder ? escapeHtml(folder.name) : ''}</h2></div>
    <div class="skeleton-grid" style="grid-template-columns:repeat(2,1fr);">
      ${[1, 2, 3, 4].map(() => '<div class="skel" style="height:150px;"></div>').join('')}
    </div>
  `;
}

function renderFolderDetail() {
  const folder = folders.find((f) => f.id === currentFolderId);
  detailWrap.innerHTML = `
    <div class="section-head">
      <h2>${escapeHtml(folder.name)}</h2>
    </div>
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="Buscar nesta pasta…" value="${escapeHtml(docSearch)}">
    </div>
    <div id="docGridWrap"></div>
  `;
  scanBtn.hidden = false;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    docSearch = e.target.value;
    renderDocGrid();
  });
  renderDocGrid();
}

document.getElementById('backBtn').onclick = () => {
  document.body.classList.remove('showing-detail');
  if (isMobileLayout()) requestAnimationFrame(() => window.scrollTo(0, foldersScrollY));
};

function renderDocGrid() {
  const wrap = document.getElementById('docGridWrap');
  if (!wrap) return;
  const filtered = currentDocs.filter((d) => d.name.toLowerCase().includes(docSearch.toLowerCase()));

  if (currentDocs.length === 0) {
    wrap.innerHTML = `
      <div class="empty">
        <strong>Esta pasta está vazia</strong>
        Toque em "Digitalizar" para adicionar o primeiro documento, pela câmera ou enviando um arquivo.
      </div>
    `;
    return;
  }
  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="empty">Nenhum documento encontrado para "${escapeHtml(docSearch)}".</div>`;
    return;
  }

  wrap.innerHTML = `<div class="doc-grid" id="docGrid"></div>`;
  const grid = document.getElementById('docGrid');
  filtered.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'doc-card' + (d.id === lastAddedDocId ? ' new-item' : '');
    card.style.animationDelay = Math.min(i * 25, 150) + 'ms';
    card.innerHTML = `<div class="thumb"><img src="${d.url}" alt="${escapeHtml(d.name)}" loading="lazy"></div><div class="dname">${escapeHtml(d.name)}</div>`;
    card.addEventListener('click', () => openViewer(d.id));
    grid.appendChild(card);
  });
  lastAddedDocId = null;
}

// ================= Capture modal =================
function openCaptureModal() {
  modalRoot.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="modal">
        <h3>Adicionar documento</h3>
        <div class="modal-actions" style="justify-content:stretch;flex-direction:column;">
          <button class="btn btn-primary" id="btnCam" style="justify-content:center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3"/><circle cx="12" cy="12" r="3"/></svg>
            Usar a câmera
          </button>
          <button class="btn btn-ghost" id="btnUp" style="justify-content:center;margin-top:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
            Enviar arquivo da galeria
          </button>
        </div>
        <fieldset class="scan-modes">
          <legend>Aparência</legend>
          <label><input type="radio" name="scanMode" value="bw" ${scanMode === 'bw' ? 'checked' : ''}> <span><strong>Digitalizado P&amp;B</strong> fundo branco, texto preto e nítido</span></label>
          <label><input type="radio" name="scanMode" value="color" ${scanMode === 'color' ? 'checked' : ''}> <span><strong>Digitalizado colorido</strong> fundo branco, mantém cor de caneta e carimbo</span></label>
          <label><input type="radio" name="scanMode" value="none" ${scanMode === 'none' ? 'checked' : ''}> <span><strong>Foto original</strong> sem tratamento</span></label>
        </fieldset>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelCap">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('cancelCap').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  modalRoot.querySelectorAll('input[name=scanMode]').forEach((r) => {
    r.addEventListener('change', () => {
      scanMode = r.value;
      try { localStorage.setItem('digitalize_scan_mode', scanMode); } catch (e) { /* sem storage */ }
    });
  });
  document.getElementById('btnCam').onclick = () => { document.getElementById('fileInputCamera').click(); };
  document.getElementById('btnUp').onclick = () => { document.getElementById('fileInputUpload').click(); };
}

document.getElementById('fileInputCamera').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) await handleNewFiles(files, scanMode);
});
document.getElementById('fileInputUpload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) await handleNewFiles(files, scanMode);
});

async function handleNewFiles(files, mode) {
  closeModal();
  // Fixa a pasta de destino no início: se o usuário abrir outra pasta no meio
  // de um envio múltiplo, os arquivos restantes continuam indo para esta.
  const targetFolderId = currentFolderId;

  // Uma foto: abre o editor para conferir/ajustar os cantos da página.
  // Várias: recorta sozinho quando a página é detectada (no modo "Foto
  // original" não recorta), para não precisar ajustar uma por uma.
  let preloaded = null, singleQuad = null;
  if (files.length === 1) {
    try {
      preloaded = await loadImage(files[0]);
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    singleQuad = await openCropEditor(preloaded, detectPageQuad(preloaded.img));
    if (!singleQuad) { URL.revokeObjectURL(preloaded.url); return; }
  }

  const wrap = document.getElementById('docGridWrap');
  if (wrap && currentFolderId === targetFolderId) {
    wrap.insertAdjacentHTML('afterbegin', `
      <div class="loading-row" id="processingRow">
        <div class="spinner"></div> <span id="processingText">Digitalizando e enviando…</span>
        <div class="progress-bar" style="flex:1;"><div class="fill"></div></div>
      </div>
    `);
  }

  for (let k = 0; k < files.length; k++) {
    const file = files[k];
    const label = document.getElementById('processingText');
    if (label && files.length > 1) label.textContent = `Digitalizando e enviando ${k + 1} de ${files.length}…`;
    // Deixa o navegador desenhar o aviso antes do processamento pesado.
    await new Promise((r) => setTimeout(r, 30));
    let loaded = null;
    try {
      loaded = preloaded || await loadImage(file);
      const quad = preloaded ? singleQuad : (mode === 'none' ? null : detectPageQuad(loaded.img));
      const blob = await renderScan(loaded.img, quad, mode);
      const name = file.name.replace(/\.[^.]+$/, '') || 'Documento';
      const form = new FormData();
      form.append('file', blob, name + '.jpg');
      form.append('name', name);
      const { document: doc } = await api('/folders/' + targetFolderId + '/documents', { method: 'POST', body: form });
      const f = folders.find((f) => f.id === targetFolderId);
      if (f) f.count = (f.count || 0) + 1;
      // Só mexe na lista em tela se ela ainda for a da pasta de destino.
      if (currentFolderId === targetFolderId) {
        currentDocs.unshift(doc);
        lastAddedDocId = doc.id;
      }
    } catch (err) {
      showToast('Falha ao enviar documento: ' + err.message, 'error');
    } finally {
      if (loaded) URL.revokeObjectURL(loaded.url);
    }
  }

  const pr = document.getElementById('processingRow');
  if (pr) pr.remove();
  if (currentFolderId === targetFolderId) renderDocGrid();
  renderFolders();
}

// ================= Image processing: real "scan" look =================
// Como funciona (o mesmo princípio dos apps de scanner):
//  1. Estima o "papel" — o brilho do fundo em cada região da foto — usando
//     um percentil alto de blocos pequenos (o papel entre as letras), não a
//     média (que é puxada pra baixo pelo texto).
//  2. Divide cada pixel por esse fundo. Isso remove sombra e luz desigual:
//     o papel vira ~1.0 em toda a página e o texto fica proporcionalmente
//     mais escuro, independente de estar no lado claro ou na sombra.
//  3. Aplica uma curva de níveis: tudo acima de ~90% do brilho do papel vira
//     branco puro, a tinta mais escura vira preto e os tons médios escurecem
//     (texto fraco/lápis fica legível).
//  4. Um leve realce de nitidez deixa as bordas das letras mais definidas.
// No modo colorido o fundo é estimado por canal, o que também corrige o tom
// amarelado da luz e mantém a cor de canetas, carimbos e assinaturas.
// Antes disso, a página é recortada e endireitada (detectPageQuad +
// warpPerspective), como se tivesse sido fotografada exatamente de cima.
const SCAN_MAX_SIDE = 2000; // resolução suficiente para letra pequena continuar legível
const SCAN_WHITE_POINT = 0.9;
const SCAN_GAMMA = 1.8;
const SCAN_SHARPEN = 0.6;

const SCAN_SOURCE_MAX_SIDE = 2800; // resolução de trabalho antes do recorte

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar a imagem.')); };
    img.src = url;
  });
}

// quad: cantos da página em coordenadas normalizadas (0..1), na ordem
// [superior-esq., superior-dir., inferior-dir., inferior-esq.], ou null para
// usar a foto inteira.
function renderScan(img, quad, mode) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let canvas;
  if (quad && !isFullFrame(quad)) {
    const s = Math.min(1, SCAN_SOURCE_MAX_SIDE / Math.max(iw, ih));
    const src = document.createElement('canvas');
    src.width = Math.round(iw * s); src.height = Math.round(ih * s);
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, src.width, src.height);
    canvas = warpPerspective(sctx.getImageData(0, 0, src.width, src.height), quad);
  } else {
    const s = Math.min(1, SCAN_MAX_SIDE / Math.max(iw, ih));
    canvas = document.createElement('canvas');
    canvas.width = Math.round(iw * s); canvas.height = Math.round(ih * s);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (mode === 'bw' || mode === 'color') applyScanEffect(ctx, canvas.width, canvas.height, mode === 'color');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob); else reject(new Error('Falha ao gerar a imagem.'));
    }, 'image/jpeg', 0.9);
  });
}

const FULL_FRAME = [[0, 0], [1, 0], [1, 1], [0, 1]];

function isFullFrame(quad) {
  return quad.every((p, i) => Math.abs(p[0] - FULL_FRAME[i][0]) < 0.005 && Math.abs(p[1] - FULL_FRAME[i][1]) < 0.005);
}

// ---------- Detecção automática da página ----------
// Funciona quando a folha contrasta com o fundo (folha clara sobre mesa mais
// escura, o caso comum): separa claro/escuro pelo limiar de Otsu, pega a
// maior região clara e usa os pontos extremos dela como cantos. Se o
// resultado não parecer uma página (muito pequena, ocupando a foto inteira
// ou com formato estranho), devolve null e a foto inteira é usada.
function detectPageQuad(img) {
  const maxSide = 360;
  const s = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'blur(2px)';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) gray[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;

  const thr = otsuThreshold(gray);
  // Maior região clara conectada (busca em largura).
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let bestLabel = -1, bestSize = 0;
  for (let start = 0, lbl = 0; start < n; start++) {
    if (label[start] !== -1 || gray[start] <= thr) continue;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = start; label[start] = lbl;
    while (head < tail) {
      const p = queue[head++]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && label[p - 1] === -1 && gray[p - 1] > thr) { label[p - 1] = lbl; queue[tail++] = p - 1; }
      if (x < w - 1 && label[p + 1] === -1 && gray[p + 1] > thr) { label[p + 1] = lbl; queue[tail++] = p + 1; }
      if (y > 0 && label[p - w] === -1 && gray[p - w] > thr) { label[p - w] = lbl; queue[tail++] = p - w; }
      if (y < h - 1 && label[p + w] === -1 && gray[p + w] > thr) { label[p + w] = lbl; queue[tail++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = lbl; }
    lbl++;
  }
  if (bestLabel === -1) return null;

  // Cantos = pontos extremos nas diagonais.
  let tl, tr, br, bl;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % w, y = (p / w) | 0;
    const sum = x + y, diff = x - y;
    if (sum < minSum) { minSum = sum; tl = [x, y]; }
    if (sum > maxSum) { maxSum = sum; br = [x, y]; }
    if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
    if (diff < minDiff) { minDiff = diff; bl = [x, y]; }
  }
  const quad = [tl, tr, br, bl].map(([x, y]) => [(x + 0.5) / w, (y + 0.5) / h]);

  const quadArea = polygonArea(quad.map(([x, y]) => [x * w, y * h]));
  if (quadArea < n * 0.15 || quadArea > n * 0.97) return null;
  // A região clara precisa preencher o quadrilátero. Áreas escuras dentro da
  // folha (texto, faixas, fotos) contam como página: só não é página o que
  // se alcança a partir da borda da foto sem atravessar a região clara.
  const outside = new Uint8Array(n);
  let head = 0, tail = 0;
  const pushOut = (p) => { if (!outside[p] && label[p] !== bestLabel) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { pushOut(x); pushOut((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pushOut(y * w); pushOut(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) pushOut(p - 1);
    if (x < w - 1) pushOut(p + 1);
    if (y > 0) pushOut(p - w);
    if (y < h - 1) pushOut(p + w);
  }
  const pageArea = n - tail;
  if (pageArea / quadArea < 0.85) return null;
  if (!isConvex(quad)) return null;
  return quad;
}

function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = v; }
  }
  return thr;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], [cx, cy] = pts[(i + 2) % pts.length];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// ---------- Correção de perspectiva ----------
// Leva o quadrilátero da página para um retângulo, como se a folha tivesse
// sido fotografada exatamente de cima. O tamanho de saída segue o tamanho
// real da página na foto (lado maior limitado a SCAN_MAX_SIDE).
function warpPerspective(srcData, quad) {
  const sw = srcData.width, sh = srcData.height, src = srcData.data;
  const p = quad.map(([x, y]) => [x * sw, y * sh]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
  let H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const s = Math.min(1, SCAN_MAX_SIDE / Math.max(W, H));
  W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));

  const m = squareToQuad(p);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  const outData = octx.createImageData(W, H);
  const dst = outData.data;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const den = m.g * u + m.h * v + 1;
      let sx = (m.a * u + m.b * v + m.c) / den - 0.5;
      let sy = (m.d * u + m.e * v + m.f) / den - 0.5;
      sx = Math.max(0, Math.min(sw - 1.001, sx));
      sy = Math.max(0, Math.min(sh - 1.001, sy));
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        dst[o + c] = top + (bot - top) * fy;
      }
      dst[o + 3] = 255;
    }
  }
  octx.putImageData(outData, 0, 0);
  return out;
}

// Homografia do quadrado unitário para o quadrilátero p (Heckbert, 1989):
// (0,0)→p0, (1,0)→p1, (1,1)→p2, (0,1)→p3.
function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 };
  }
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0,
    d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0,
    g, h
  };
}

function applyScanEffect(ctx, w, h, keepColor) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const n = w * h;

  const gray = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  const grayBg = estimatePaper(gray, w, h);
  const grayRatio = new Float32Array(n);
  for (let i = 0; i < n; i++) grayRatio[i] = gray[i] / grayBg[i];

  // Ponto preto: a tinta mais escura da página (percentil bem baixo). Com
  // teto, para uma página quase sem texto não virar "tudo escuro".
  const black = Math.max(0, Math.min(0.55, ratioPercentile(grayRatio, 0.004)));
  const lut = buildToneLut(black);

  if (!keepColor) {
    const out = sharpen(applyLut(grayRatio, lut), w, h);
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const v = out[i];
      data[o] = v; data[o + 1] = v; data[o + 2] = v;
    }
  } else {
    for (let c = 0; c < 3; c++) {
      const chan = new Float32Array(n);
      for (let i = 0, o = c; i < n; i++, o += 4) chan[i] = data[o];
      const bg = estimatePaper(chan, w, h);
      for (let i = 0; i < n; i++) chan[i] = chan[i] / bg[i];
      const out = sharpen(applyLut(chan, lut), w, h);
      for (let i = 0, o = c; i < n; i++, o += 4) data[o] = out[i];
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Brilho do papel por região: percentil 90 de blocos de ~1,5% do lado maior
// (pega o papel entre as linhas de texto), suavização e interpolação de volta
// ao tamanho original. Blocos pequenos acompanham bem a borda de sombras
// duras (mão, celular) sem deixar um halo cinza em volta.
function estimatePaper(chan, w, h) {
  const B = Math.max(8, Math.round(Math.max(w, h) / 64));
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  let grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);

  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * B, y1 = Math.min(h, y0 + B);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * B, x1 = Math.min(w, x0 + B);
      hist.fill(0);
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) hist[chan[row + x] | 0]++;
      }
      const target = (y1 - y0) * (x1 - x0) * 0.9;
      let cum = 0, v = 0;
      for (; v < 255; v++) { cum += hist[v]; if (cum >= target) break; }
      grid[gy * gw + gx] = v;
    }
  }

  grid = fillNonPaperBlocks(grid, gw, gh);
  for (let k = 0; k < 2; k++) grid = gridBlur(grid, gw, gh);

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) / B - 0.5;
    fy = Math.max(0, Math.min(gh - 1, fy));
    const gy0 = Math.floor(fy), gy1 = Math.min(gh - 1, gy0 + 1), ty = fy - gy0;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) / B - 0.5;
      fx = Math.max(0, Math.min(gw - 1, fx));
      const gx0 = Math.floor(fx), gx1 = Math.min(gw - 1, gx0 + 1), tx = fx - gx0;
      const top = grid[gy0 * gw + gx0] * (1 - tx) + grid[gy0 * gw + gx1] * tx;
      const bot = grid[gy1 * gw + gx0] * (1 - tx) + grid[gy1 * gw + gx1] * tx;
      out[y * w + x] = Math.max(8, top * (1 - ty) + bot * ty);
    }
  }
  return out;
}

// Blocos muito mais escuros que o papel ao redor não são papel: são uma área
// cheia de tinta (faixa preta de cabeçalho, logotipo, foto dentro do
// documento). Se ficassem como "fundo", a divisão deixaria essa área clara.
// Eles são descartados e preenchidos com o papel dos vizinhos. Sombras reais
// raramente escurecem o papel pela metade, por isso o limite é 50% do bloco
// mais claro num raio de ~1/5 da página (grande o bastante para alcançar
// papel mesmo no meio de uma área escura grande).
const PAPER_MIN_RATIO = 0.5;

function fillNonPaperBlocks(grid, gw, gh) {
  const R = Math.max(3, Math.round(Math.max(gw, gh) / 5));
  const n = grid.length;
  let valid = new Uint8Array(n);
  let invalidCount = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let localMax = 0;
      for (let yy = Math.max(0, y - R); yy <= Math.min(gh - 1, y + R); yy++) {
        for (let xx = Math.max(0, x - R); xx <= Math.min(gw - 1, x + R); xx++) {
          localMax = Math.max(localMax, grid[yy * gw + xx]);
        }
      }
      const ok = grid[y * gw + x] >= localMax * PAPER_MIN_RATIO;
      valid[y * gw + x] = ok ? 1 : 0;
      if (!ok) invalidCount++;
    }
  }
  if (invalidCount === 0 || invalidCount === n) return grid;

  // Preenche de fora para dentro: a cada passada, os blocos descartados que
  // encostam em blocos válidos recebem a média deles.
  const out = Float32Array.from(grid);
  while (invalidCount > 0) {
    const next = Uint8Array.from(valid);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (valid[i]) continue;
        let sum = 0, count = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(gh - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(gw - 1, x + 1); xx++) {
            if (valid[yy * gw + xx]) { sum += out[yy * gw + xx]; count++; }
          }
        }
        if (count) { out[i] = sum / count; next[i] = 1; invalidCount--; }
      }
    }
    valid = next;
  }
  return out;
}

// Média 3x3 na grade de blocos (suaviza a transição entre regiões).
function gridBlur(grid, gw, gh) {
  const out = new Float32Array(grid.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          sum += grid[yy * gw + xx];
          count++;
        }
      }
      out[y * gw + x] = sum / count;
    }
  }
  return out;
}

const RATIO_MAX = 1.5;
const LUT_SIZE = 1024;

function ratioPercentile(ratio, p) {
  const hist = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < ratio.length; i++) {
    hist[Math.min(LUT_SIZE - 1, (ratio[i] / RATIO_MAX * (LUT_SIZE - 1)) | 0)]++;
  }
  const target = p * ratio.length;
  let cum = 0;
  for (let b = 0; b < LUT_SIZE; b++) {
    cum += hist[b];
    if (cum >= target) return b / (LUT_SIZE - 1) * RATIO_MAX;
  }
  return 1;
}

function buildToneLut(black) {
  const lut = new Float32Array(LUT_SIZE);
  const span = Math.max(0.1, SCAN_WHITE_POINT - black);
  for (let b = 0; b < LUT_SIZE; b++) {
    const r = b / (LUT_SIZE - 1) * RATIO_MAX;
    const t = Math.max(0, Math.min(1, (r - black) / span));
    lut[b] = 255 * Math.pow(t, SCAN_GAMMA);
  }
  return lut;
}

function applyLut(ratio, lut) {
  const out = new Float32Array(ratio.length);
  for (let i = 0; i < ratio.length; i++) {
    out[i] = lut[Math.min(LUT_SIZE - 1, (ratio[i] / RATIO_MAX * (LUT_SIZE - 1)) | 0)];
  }
  return out;
}

// Realce de nitidez (unsharp mask 3x3). O papel já está em 255 e continua
// branco; só as bordas da tinta ganham contraste.
function sharpen(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const blur = (
        src[ym * w + xm] + src[ym * w + x] + src[ym * w + xp] +
        src[y * w + xm] + src[y * w + x] + src[y * w + xp] +
        src[yp * w + xm] + src[yp * w + x] + src[yp * w + xp]
      ) / 9;
      const v = src[y * w + x];
      out[y * w + x] = Math.max(0, Math.min(255, v + SCAN_SHARPEN * (v - blur)));
    }
  }
  return out;
}

// ================= Crop editor =================
// Mostra a foto com os 4 cantos da página (detectados automaticamente) para o
// usuário conferir e ajustar arrastando. Resolve com o quad escolhido, ou
// null se o usuário cancelar.
function openCropEditor(loaded, initialQuad) {
  const { img: source, url: imgUrl } = loaded;
  return new Promise((resolve) => {
    let quad = (initialQuad || FULL_FRAME).map((p) => p.slice());
    modalRoot.innerHTML = `
      <div class="overlay" id="overlay">
        <div class="modal crop-modal" role="dialog" aria-label="Ajustar recorte">
          <h3>Ajustar recorte</h3>
          <p class="crop-hint">${initialQuad ? 'Página detectada. Arraste os cantos se precisar ajustar.' : 'Não foi possível detectar a página. Arraste os cantos até as pontas da folha.'}</p>
          <div class="crop-wrap"><div class="crop-stage" id="cropStage">
            <img src="${imgUrl}" alt="Foto a recortar" draggable="false">
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              <path id="cropShade" fill-rule="evenodd"></path>
              <polygon id="cropPoly"></polygon>
            </svg>
            ${[0, 1, 2, 3].map((i) => `<div class="crop-handle" data-i="${i}" aria-label="Canto ${i + 1}"></div>`).join('')}
          </div></div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="cropFull">Foto inteira</button>
            <button class="btn btn-ghost" id="cropCancel" style="margin-left:auto;">Cancelar</button>
            <button class="btn btn-primary" id="cropOk">Confirmar</button>
          </div>
        </div>
      </div>
    `;
    const stage = document.getElementById('cropStage');
    const handles = stage.querySelectorAll('.crop-handle');
    const poly = document.getElementById('cropPoly');
    const shade = document.getElementById('cropShade');

    // Tamanho calculado em JS: com CSS puro (largura "fit-content" + imagem
    // em %), o navegador encolhe a imagem em vez de ocupar o espaço livre.
    const stageImg = stage.querySelector('img');
    function fit() {
      const availW = stage.parentElement.clientWidth - 36;
      const availH = window.innerHeight * 0.58;
      const s = Math.min(availW / source.naturalWidth, availH / source.naturalHeight);
      stageImg.style.width = Math.round(source.naturalWidth * s) + 'px';
      stageImg.style.height = Math.round(source.naturalHeight * s) + 'px';
    }
    window.addEventListener('resize', fit);

    function draw() {
      const pts = quad.map(([x, y]) => x + ',' + y).join(' ');
      poly.setAttribute('points', pts);
      shade.setAttribute('d', 'M0,0H1V1H0Z M' + quad.map(([x, y]) => x + ',' + y).join(' L') + 'Z');
      handles.forEach((hd, i) => {
        hd.style.left = quad[i][0] * 100 + '%';
        hd.style.top = quad[i][1] * 100 + '%';
      });
    }

    handles.forEach((hd) => {
      const i = Number(hd.dataset.i);
      hd.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hd.setPointerCapture(e.pointerId);
        hd.classList.add('dragging');
      });
      hd.addEventListener('pointermove', (e) => {
        if (!hd.hasPointerCapture(e.pointerId)) return;
        const r = stage.getBoundingClientRect();
        quad[i] = [
          Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
        ];
        draw();
      });
      const end = (e) => {
        if (hd.hasPointerCapture(e.pointerId)) hd.releasePointerCapture(e.pointerId);
        hd.classList.remove('dragging');
      };
      hd.addEventListener('pointerup', end);
      hd.addEventListener('pointercancel', end);
    });

    const finish = (result) => {
      window.removeEventListener('resize', fit);
      closeModal();
      resolve(result);
    };
    document.getElementById('cropFull').onclick = () => { quad = FULL_FRAME.map((p) => p.slice()); draw(); };
    document.getElementById('cropCancel').onclick = () => finish(null);
    document.getElementById('cropOk').onclick = () => {
      if (!isConvex(quad) || polygonArea(quad) < 0.01) {
        showToast('Os cantos estão cruzados ou muito próximos. Ajuste o recorte.', 'error');
        return;
      }
      finish(quad);
    };
    fit();
    draw();
  });
}

// ================= Document viewer =================
function openViewer(docId) {
  const d = currentDocs.find((x) => x.id === docId);
  if (!d) return;
  modalRoot.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="modal viewer-modal">
        <div class="viewer-img-wrap"><img src="${d.url}"></div>
        <div class="viewer-body">
          <input type="text" id="docNameInput" value="${escapeHtml(d.name)}" maxlength="60">
          <div class="viewer-actions">
            <a class="btn btn-primary" id="downloadBtn" download="${escapeHtml(d.name)}.jpg" href="${d.url}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
              Baixar
            </a>
            <button class="btn btn-ghost" id="saveNameBtn">Salvar nome</button>
            <button class="btn btn-danger" id="deleteDocBtn">Excluir</button>
            <button class="btn btn-ghost" id="closeViewer" style="margin-left:auto;">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('closeViewer').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  document.getElementById('saveNameBtn').onclick = async () => {
    const newName = document.getElementById('docNameInput').value.trim();
    if (!newName) return;
    try {
      const { document: updated } = await api('/documents/' + d.id, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
      d.name = updated.name;
      closeModal();
      renderDocGrid();
      showToast('Nome atualizado.', 'success');
    } catch (e) {
      showToast('Não foi possível renomear: ' + e.message, 'error');
    }
  };
  document.getElementById('deleteDocBtn').onclick = () => {
    showConfirm('Excluir este documento?', 'Esta ação não pode ser desfeita.', async () => {
      try {
        await api('/documents/' + d.id, { method: 'DELETE' });
        currentDocs = currentDocs.filter((x) => x.id !== d.id);
        const f = folders.find((f) => f.id === currentFolderId);
        if (f) f.count = currentDocs.length;
        renderDocGrid();
        renderFolders();
        showToast('Documento excluído.', 'success');
      } catch (e) {
        showToast('Não foi possível excluir: ' + e.message, 'error');
      }
    });
  };
}

document.getElementById('btnAddFolder').onclick = openNewFolderModal;

// ================= Auth gate =================
function showLogin(message) {
  document.getElementById('appShell').hidden = true;
  document.getElementById('loginScreen').hidden = false;
  const err = document.getElementById('loginError');
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.hidden = true;
  }
  document.getElementById('loginPass').value = '';
}

function showApp() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginSubmit');
  const err = document.getElementById('loginError');
  err.hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha no login.');
    showApp();
    init();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('logoutBtn').onclick = async () => {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* segue o baile */ }
  location.reload();
};

async function bootstrap() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated) {
      showApp();
      init();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin('Não foi possível verificar a sessão. Tente novamente.');
  }
}

bootstrap();
