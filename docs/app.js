/* Doce Gestão — front-end (JavaScript puro, sem build) */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const conteudo = $('#conteudo');
let CONFIG = { loja: '', whatsappApi: false, pixConfigurado: false, urlPublica: '' };

// ================= utilidades =================
const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = v => fmtMoeda.format(Number(v || 0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dia = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '';
const diaHora = d => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const qtd = q => Number(q) % 1 === 0 ? String(Number(q)) : Number(q).toLocaleString('pt-BR');
const num = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const numCampo = v => { // aceita "150", "150,5", "1.500,00" e "150.50"
  const s = String(v ?? '').trim();
  if (/^\d+(\.\d{1,2})$/.test(s)) return parseFloat(s);
  return num(s);
};
const iniciais = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const fone = t => {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
};
const STATUS = {
  Rascunho: 'Rascunho', Enviado: 'Aguardando aprovação', Aprovado: 'Aprovado', Pago: 'Pago',
  Recusado: 'Recusado', Cancelado: 'Cancelado',
  AguardandoConfirmacao: 'A confirmar', Confirmado: 'Confirmado', Rejeitado: 'Rejeitado'
};
const chip = s => `<span class="chip st-${esc(s)}">${esc(STATUS[s] || s)}</span>`;

// api(): definida em js/dados.js (Supabase)

function toast(msg, erro = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), erro ? 4500 : 2600);
}

function modal(html) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal">${html}</div>`;
  const fechar = () => fundo.remove();
  fundo.addEventListener('click', e => { if (e.target === fundo || e.target.closest('[data-fechar]')) fechar(); });
  document.body.appendChild(fundo);
  const primeiro = $('input,select,textarea', fundo);
  if (primeiro && window.innerWidth > 600) primeiro.focus();
  return { el: fundo, fechar };
}

function confirmar(msg, textoOk = 'Confirmar') {
  return new Promise(res => {
    const m = modal(`<h2>${esc(msg)}</h2><div class="botoes dois"><button class="btn claro" data-fechar>Voltar</button><button class="btn" id="ok">${esc(textoOk)}</button></div>`);
    $('#ok', m.el).onclick = () => { m.fechar(); res(true); };
    m.el.addEventListener('click', e => { if (e.target.closest('[data-fechar]') || e.target === m.el) res(false); });
  });
}

/** Abre o WhatsApp. A janela é aberta antes do await para não ser bloqueada pelo navegador. */
async function abrirWhats(promessaUrl) {
  const janela = window.open('about:blank', '_blank');
  try {
    const url = await promessaUrl;
    if (janela) janela.location.href = url; else location.href = url;
  } catch (e) { janela?.close(); toast(e.message, true); }
}

function copiar(texto) {
  navigator.clipboard?.writeText(texto).then(() => toast('Copiado!'), () => prompt('Copie:', texto));
}

function topo(titulo, icone = '🧁', voltar = null) {
  $('#titulo').textContent = titulo;
  $('#iconeTopo').textContent = icone;
  const b = $('#btnVoltar');
  b.classList.toggle('oculto', !voltar);
  b.onclick = () => voltar && (location.hash = voltar);
  document.title = `${titulo} · Doce Gestão`;
}

// ================= roteamento =================
const rotas = [
  [/^#\/orcamentos\/novo(\?.*)?$/, () => telaFormOrcamento()],
  [/^#\/orcamentos\/(\d+)\/editar$/, m => telaFormOrcamento(+m[1])],
  [/^#\/orcamentos\/(\d+)$/, m => telaOrcamento(+m[1])],
  [/^#\/orcamentos(?:\?status=(\w*))?$/, m => telaOrcamentos(m[1] || '')],
  [/^#\/pagamentos(?:\/(\w+))?$/, m => telaPagamentos(m[1] || 'pendentes')],
  [/^#\/dashboard$/, () => telaDashboard()],
  [/^#\/clientes\/(\d+)$/, m => telaCliente(+m[1])],
  [/^#\/clientes$/, () => telaClientes()],
  [/^#\/ajustes$/, () => telaAjustes()],
];

async function navegar() {
  const h = location.hash || '#/orcamentos';
  const raiz = h.split('/')[1]?.split('?')[0];
  $$('.nav button').forEach(b => b.classList.toggle('ativo', b.dataset.rota === raiz));
  for (const [re, fn] of rotas) {
    const m = h.match(re);
    if (m) {
      conteudo.innerHTML = '<div class="spinner">Carregando…</div>';
      window.scrollTo(0, 0);
      try { await fn(m); } catch (e) { if (e.message !== 'Sessão expirada') conteudo.innerHTML = `<div class="vazio">⚠️ ${esc(e.message)}</div>`; }
      atualizarBadge();
      return;
    }
  }
  location.hash = '#/orcamentos';
}

async function atualizarBadge() {
  try {
    const [aConfirmar, msgs] = await Promise.all([
      api('GET', '/api/pagamentos?status=AguardandoConfirmacao'),
      api('GET', '/api/mensagens?pendentes=true'),
    ]);
    const n = aConfirmar.length + msgs.filter(m => m.arquivo).length;
    const b = $('#badgePag');
    b.textContent = n; b.classList.toggle('oculto', !n);
  } catch { /* ignora */ }
}

// ================= ORÇAMENTOS =================
async function telaOrcamentos(status) {
  topo('Orçamentos', '🎂');
  const lista = await api('GET', '/api/orcamentos' + (status ? `?status=${status}` : ''));
  const filtros = [['', 'Todos'], ['Rascunho', 'Rascunho'], ['Enviado', 'Aguardando'], ['Aprovado', 'Aprovados'], ['Pago', 'Pagos'], ['Recusado', 'Recusados']];
  conteudo.innerHTML = `
    ${avisoAjustes()}
    <div class="filtros">${filtros.map(([v, t]) => `<button class="${v === status ? 'ativo' : ''}" data-st="${v}">${t}</button>`).join('')}</div>
    <input class="ctl busca" id="busca" placeholder="🔎 Buscar por cliente ou nº do pedido">
    <div id="lista"></div>
    <a class="btn fab" href="#/orcamentos/novo">＋ Novo orçamento</a>`;
  $$('.filtros button').forEach(b => b.onclick = () => location.hash = '#/orcamentos' + (b.dataset.st ? `?status=${b.dataset.st}` : ''));
  const desenhar = termo => {
    const t = termo.trim().toLowerCase();
    const f = lista.filter(o => !t || o.clienteNome.toLowerCase().includes(t) || String(o.id) === t.replace('#', ''));
    $('#lista').innerHTML = f.length ? f.map(cardOrcamento).join('') :
      `<div class="vazio"><span class="grande">🧁</span>Nenhum orçamento por aqui.<br><br><a class="btn" href="#/orcamentos/novo">Criar orçamento</a></div>`;
  };
  $('#busca').oninput = e => desenhar(e.target.value);
  desenhar('');
}

function cardOrcamento(o) {
  return `<div class="card clicavel" onclick="location.hash='#/orcamentos/${o.id}'">
    <div class="linha"><span class="forte">Pedido #${o.id}</span><span class="valor">${moeda(o.total)}</span></div>
    <div class="linha"><span class="forte" style="font-weight:700">${esc(o.clienteNome)}</span>${chip(o.status)}</div>
    <div class="linha suave">
      <span>${o.dataEntrega ? 'Entrega: ' + dia(o.dataEntrega) : 'Criado em ' + dia(o.criadoEm)}</span>
      <span>${o.status === 'Aprovado' && o.saldo > 0 ? 'Falta ' + moeda(o.saldo) : ''}${o.valorAConfirmar > 0 ? ' · 🧾 comprovante' : ''}</span>
    </div>
  </div>`;
}

async function telaFormOrcamento(id) {
  topo(id ? `Editar Pedido #${id}` : 'Novo Orçamento', '🍰', id ? `#/orcamentos/${id}` : '#/orcamentos');
  const [clientes, dados] = await Promise.all([
    api('GET', '/api/clientes'),
    id ? api('GET', `/api/orcamentos/${id}`) : null,
  ]);
  const o = dados?.orcamento;
  const clientePre = new URLSearchParams(location.hash.split('?')[1] || '').get('cliente');
  let mostrarCusto = !!o?.itens.some(i => i.custoUnitario > 0);

  conteudo.innerHTML = `
    <form id="form" autocomplete="off">
      <div class="card">
        <div class="campo">
          <label>Cliente</label>
          <select id="cliente">
            <option value="">— Selecione —</option>
            <option value="novo">＋ Novo cliente</option>
            ${clientes.map(c => `<option value="${c.id}">${esc(c.nome)} · ${esc(fone(c.telefone))}</option>`).join('')}
          </select>
        </div>
        <div id="novoCliente" class="grade2 oculto" style="padding-top:10px">
          <input class="ctl" id="ncNome" placeholder="Nome do cliente">
          <input class="ctl" id="ncTel" placeholder="WhatsApp (DDD + nº)" inputmode="tel">
        </div>
        <div class="grade2">
          <div class="campo"><label>Data de entrega</label><input type="date" id="entrega"></div>
          <div class="campo"><label>Pagamento até</label><input type="date" id="vencimento"></div>
        </div>
        <div class="campo" style="border:0"><label>Descrição do pedido</label>
          <textarea id="descricao" placeholder="Ex.: Bolo de chocolate com brigadeiros e 20 cupcakes de morango."></textarea></div>
      </div>

      <div class="secao">Itens do orçamento</div>
      <label class="toggle"><input type="checkbox" id="chkCusto"> Informar custo (para calcular o lucro)</label>
      <div class="itens">
        <div class="item-cab" id="cabItens"></div>
        <div id="itens"></div>
      </div>
      <button type="button" class="btn claro peq" id="addItem" style="margin-top:10px">＋ Adicionar item</button>

      <div class="grade2" style="margin-top:12px">
        <div class="campo" style="border:0"><label>Desconto (R$)</label><input id="desconto" inputmode="decimal" placeholder="0,00"></div>
        <div></div>
      </div>

      <div class="total"><span>Total:</span><strong id="total">R$ 0,00</strong></div>

      <div class="botoes">
        <button class="btn bloco" type="submit" data-acao="salvar">💾 ${id ? 'Salvar alterações' : 'Gerar Orçamento'}</button>
        <button class="btn bloco verde" type="submit" data-acao="whats">🟢 Salvar e enviar via WhatsApp</button>
        ${CONFIG.whatsappApi ? `<button class="btn bloco claro" type="submit" data-acao="api">⚡ Salvar e enviar automático (API)</button>` : ''}
      </div>
    </form>`;

  const selCli = $('#cliente');
  selCli.onchange = () => $('#novoCliente').classList.toggle('oculto', selCli.value !== 'novo');
  if (o) selCli.value = o.clienteId; else if (clientePre) selCli.value = clientePre;
  if (o) {
    $('#entrega').value = o.dataEntrega || '';
    $('#vencimento').value = o.vencimento || '';
    $('#descricao').value = o.descricao || '';
    $('#desconto').value = o.desconto ? String(o.desconto).replace('.', ',') : '';
  }

  const itensEl = $('#itens');
  const linhaItem = (i = {}) => {
    const d = document.createElement('div');
    d.className = 'item' + (mostrarCusto ? ' com-custo' : '');
    d.innerHTML = `
      <input class="desc" placeholder="Ex.: Bolo de chocolate" value="${esc(i.descricao || '')}">
      <input class="qtd" inputmode="decimal" placeholder="Qtd" value="${i.quantidade ? qtd(i.quantidade) : 1}">
      <input class="vl" inputmode="decimal" placeholder="Valor un." value="${i.valorUnitario ? String(i.valorUnitario).replace('.', ',') : ''}">
      <input class="custo ${mostrarCusto ? '' : 'oculto'}" inputmode="decimal" placeholder="Custo un." value="${i.custoUnitario ? String(i.custoUnitario).replace('.', ',') : ''}">
      <button type="button" class="rem" title="Remover">✕</button>`;
    $('.rem', d).onclick = () => { d.remove(); if (!itensEl.children.length) linhaItem(); recalcular(); };
    $$('input', d).forEach(inp => inp.oninput = recalcular);
    itensEl.appendChild(d);
    return d;
  };
  const cabecalho = () => {
    $('#cabItens').className = 'item-cab' + (mostrarCusto ? ' com-custo' : '');
    $('#cabItens').innerHTML = `<span>Descrição</span><span>Qtd</span><span>Valor un.</span>${mostrarCusto ? '<span>Custo un.</span>' : ''}<span></span>`;
  };
  const lerItens = () => $$('.item', itensEl).map(d => ({
    descricao: $('.desc', d).value.trim(),
    quantidade: numCampo($('.qtd', d).value) || 1,
    valorUnitario: numCampo($('.vl', d).value),
    custoUnitario: mostrarCusto ? numCampo($('.custo', d).value) : 0,
  })).filter(i => i.descricao);
  const recalcular = () => {
    const t = lerItens().reduce((s, i) => s + i.quantidade * i.valorUnitario, 0) - numCampo($('#desconto').value);
    $('#total').textContent = moeda(Math.max(0, t));
  };

  $('#chkCusto').checked = mostrarCusto;
  $('#chkCusto').onchange = e => {
    mostrarCusto = e.target.checked;
    $$('.item', itensEl).forEach(d => { d.classList.toggle('com-custo', mostrarCusto); $('.custo', d).classList.toggle('oculto', !mostrarCusto); });
    cabecalho();
  };
  cabecalho();
  (o?.itens.length ? o.itens : [{}]).forEach(linhaItem);
  $('#addItem').onclick = () => $('.desc', linhaItem()).focus();
  $('#desconto').oninput = recalcular;
  recalcular();

  let acao = 'salvar';
  $$('button[type=submit]').forEach(b => b.onclick = () => acao = b.dataset.acao);
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const corpo = {
      clienteId: selCli.value && selCli.value !== 'novo' ? +selCli.value : null,
      novoCliente: selCli.value === 'novo' ? { nome: $('#ncNome').value, telefone: $('#ncTel').value } : null,
      descricao: $('#descricao').value,
      dataEntrega: $('#entrega').value || null,
      vencimento: $('#vencimento').value || null,
      desconto: numCampo($('#desconto').value),
      itens: lerItens(),
    };
    if (!corpo.clienteId && !corpo.novoCliente) return toast('Selecione o cliente.', true);
    // Abre a janela já no clique (evita bloqueio de pop-up)
    const janela = acao === 'whats' ? window.open('about:blank', '_blank') : null;
    try {
      let oid = id;
      if (id) await api('PUT', `/api/orcamentos/${id}`, corpo);
      else oid = (await api('POST', '/api/orcamentos', corpo)).id;
      if (acao === 'whats') {
        const r = await api('POST', `/api/orcamentos/${oid}/whatsapp`);
        if (janela) janela.location.href = r.url; else location.href = r.url;
      } else if (acao === 'api') {
        await api('POST', `/api/orcamentos/${oid}/enviar-api`);
        toast('Orçamento enviado pelo WhatsApp!');
      } else toast('Orçamento salvo!');
      location.hash = `#/orcamentos/${oid}`;
    } catch (err) { janela?.close(); toast(err.message, true); }
  };
}

async function telaOrcamento(id) {
  const { orcamento: o, link } = await api('GET', `/api/orcamentos/${id}`);
  topo(`Pedido #${o.id}`, '🍰', '#/orcamentos');
  const aberto = ['Rascunho', 'Enviado'].includes(o.status);
  const aPagar = o.status === 'Aprovado' && o.saldo > 0;

  conteudo.innerHTML = `
    <div class="card">
      <div class="linha"><span class="forte" style="font-size:1.1rem">${esc(o.clienteNome)}</span>${chip(o.status)}</div>
      <div class="linha suave"><span>📱 ${esc(fone(o.clienteTelefone))}</span><span>Criado ${dia(o.criadoEm)}</span></div>
      ${o.dataEntrega ? `<div class="linha suave"><span>🚚 Entrega: <b>${dia(o.dataEntrega)}</b></span>${o.vencimento ? `<span>Pagar até ${dia(o.vencimento)}</span>` : ''}</div>` : ''}
      ${o.descricao ? `<hr class="sep"><div>${esc(o.descricao)}</div>` : ''}
      ${o.motivoRecusa ? `<hr class="sep"><div class="suave">Motivo: ${esc(o.motivoRecusa)}</div>` : ''}
    </div>

    <div class="secao">Itens do orçamento</div>
    <div class="lista">
      ${o.itens.map(i => `<div class="li"><span class="nome" style="font-weight:700">${qtd(i.quantidade)}× ${esc(i.descricao)}</span><span class="valor">${moeda(i.subtotal)}</span></div>`).join('')}
      ${o.desconto > 0 ? `<div class="li"><span class="nome suave">Desconto</span><span class="valor">− ${moeda(o.desconto)}</span></div>` : ''}
    </div>
    <div class="total"><span>Total:</span><strong>${moeda(o.total)}</strong></div>
    ${o.custo > 0 ? `<div class="linha suave" style="margin-top:-8px"><span>Custo ${moeda(o.custo)}</span><span>Lucro <b>${moeda(o.lucro)}</b></span></div>` : ''}
    ${o.valorPago > 0 || o.valorAConfirmar > 0 ? `
      <div class="card" style="margin-top:12px">
        <div class="linha"><span>Pago</span><span class="valor" style="color:var(--verde)">${moeda(o.valorPago)}</span></div>
        ${o.valorAConfirmar > 0 ? `<div class="linha"><span>A confirmar</span><span class="valor" style="color:#9a6400">${moeda(o.valorAConfirmar)}</span></div>` : ''}
        <div class="linha"><span>Saldo</span><span class="valor">${moeda(o.saldo)}</span></div>
      </div>` : ''}

    <div class="botoes">
      ${aberto ? `<button class="btn bloco verde" id="bWhats">🟢 Enviar orçamento via WhatsApp</button>` : ''}
      ${aberto && CONFIG.whatsappApi ? `<button class="btn bloco claro" id="bApi">⚡ Enviar automático (API)</button>` : ''}
      ${['Aprovado', 'Enviado', 'Rascunho'].includes(o.status) && o.saldo > 0 ? `<button class="btn bloco" id="bPagar">💰 Registrar pagamento</button>` : ''}
      ${aPagar ? `<button class="btn bloco verde" id="bCobrar">🟢 Cobrar via WhatsApp</button>` : ''}
      ${o.status === 'Pago' ? `<button class="btn bloco verde" id="bRecibo">🟢 Enviar agradecimento via WhatsApp</button>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="suave" style="margin-bottom:6px">Link do cliente (aprovar, ver PIX e enviar comprovante)</div>
      <div class="linha"><input class="ctl" value="${esc(link)}" readonly style="font-size:.8rem"><button class="btn claro peq" id="bCopiar">Copiar</button></div>
      ${!CONFIG.whatsLojaConfigurado ? `<div class="aviso" style="margin:10px 0 0">⚠️ Cadastre o WhatsApp da loja em <a href="#/ajustes"><b>Ajustes</b></a> para o cliente voltar direto para a sua conversa depois de enviar o comprovante.</div>` : ''}
      ${/localhost|127\.0\.0\.1/.test(link) ? `<div class="aviso" style="margin:10px 0 0">⚠️ Este link aponta para <b>localhost</b> e só abre neste computador. Informe o endereço público em <a href="#/ajustes"><b>Ajustes</b></a> ou use um Dev Tunnel (veja o LEIAME).</div>` : ''}
    </div>

    ${o.pagamentos.length ? `<div class="secao">Pagamentos</div>${o.pagamentos.map(cardPagamento).join('')}` : ''}

    <div class="botoes dois" style="margin-top:22px">
      ${o.status !== 'Pago' ? `<a class="btn claro" href="#/orcamentos/${o.id}/editar">✏️ Editar</a>` : ''}
      ${aberto ? `<button class="btn claro" id="bAprovar">✅ Marcar aprovado</button>` : ''}
      ${aberto ? `<button class="btn perigo" id="bRecusar">Recusado</button>` : ''}
      ${o.status === 'Aprovado' ? `<button class="btn perigo" id="bCancelar">Cancelar pedido</button>` : ''}
      ${['Recusado', 'Cancelado'].includes(o.status) ? `<button class="btn claro" id="bReabrir">↩️ Reabrir</button>` : ''}
      <button class="btn perigo" id="bExcluir">🗑️ Excluir</button>
    </div>`;

  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  const recarregar = () => telaOrcamento(id);
  const status = async (s, motivo) => { await api('POST', `/api/orcamentos/${id}/status`, { status: s, motivo }); recarregar(); };

  on('#bWhats', async () => { await abrirWhats(api('POST', `/api/orcamentos/${id}/whatsapp`).then(r => r.url)); setTimeout(recarregar, 600); });
  on('#bCobrar', () => abrirWhats(api('POST', `/api/orcamentos/${id}/whatsapp?tipo=cobranca`).then(r => r.url)));
  on('#bRecibo', () => abrirWhats(api('POST', `/api/orcamentos/${id}/whatsapp?tipo=recibo`).then(r => r.url)));
  on('#bApi', async () => {
    try { await api('POST', `/api/orcamentos/${id}/enviar-api`); toast('Enviado pelo WhatsApp!'); recarregar(); }
    catch (e) { toast(e.message, true); }
  });
  on('#bPagar', () => modalPagamento(o, recarregar));
  on('#bCopiar', () => copiar(link));
  on('#bAprovar', () => status('Aprovado'));
  on('#bReabrir', () => status('Enviado'));
  on('#bRecusar', async () => { if (await confirmar('Marcar orçamento como recusado?')) status('Recusado', 'Recusado pelo cliente'); });
  on('#bCancelar', async () => { if (await confirmar('Cancelar este pedido?', 'Cancelar pedido')) status('Cancelado'); });
  on('#bExcluir', async () => {
    if (!await confirmar(`Excluir o pedido #${id} e seus pagamentos?`, 'Excluir')) return;
    await api('DELETE', `/api/orcamentos/${id}`); toast('Excluído'); location.hash = '#/orcamentos';
  });
  ligarAcoesPagamento(conteudo, recarregar);
}

function cardPagamento(p, comPedido = false) {
  const img = p.comprovanteMime?.startsWith('image/');
  const url = p.comprovanteUrl || '';
  return `<div class="card">
    <div class="comp">
      ${p.comprovanteArquivo && !url ? `<div class="thumb" title="Comprovante indisponível">📎</div>` : ''}
      ${url ? `<a class="thumb" href="${url}" target="_blank">${img ? `<img src="${url}" class="thumb" style="border:0" alt="comprovante">` : '📄'}</a>` : (p.comprovanteArquivo ? '' : `<div class="thumb">💵</div>`)}
      <div style="flex:1;min-width:0">
        <div class="linha"><span class="forte">${comPedido ? `<a href="#/orcamentos/${p.orcamentoId}">Pedido #${p.orcamentoId}</a>` : esc(p.forma || 'Pagamento')}</span><span class="valor">${moeda(p.valor)}</span></div>
        ${comPedido ? `<div class="forte" style="font-weight:700">${esc(p.clienteNome || '')}</div>` : ''}
        <div class="linha suave"><span>${diaHora(p.data)} · ${esc(p.origem)}</span>${chip(p.status)}</div>
        ${p.observacao ? `<div class="suave">“${esc(p.observacao)}”</div>` : ''}
        ${p.status === 'AguardandoConfirmacao' ? `
          <div class="linha" style="margin-top:8px;justify-content:flex-end;gap:8px">
            <button class="btn perigo peq" data-rejeitar="${p.id}">Rejeitar</button>
            <button class="btn verde peq" data-confirmar="${p.id}" data-valor="${p.valor}">✔ Confirmar</button>
          </div>` : ''}
      </div>
    </div>
  </div>`;
}

function ligarAcoesPagamento(raiz, depois) {
  $$('[data-confirmar]', raiz).forEach(b => b.onclick = () => {
    const m = modal(`<h2>Confirmar recebimento</h2>
      <p class="suave">Confira o comprovante e ajuste o valor se necessário.</p>
      <div class="campo"><label>Valor recebido (R$)</label><input id="vConf" inputmode="decimal" value="${String(b.dataset.valor).replace('.', ',')}"></div>
      <div class="botoes dois"><button class="btn claro" data-fechar>Voltar</button><button class="btn verde" id="ok">Confirmar</button></div>`);
    $('#ok', m.el).onclick = async () => {
      try {
        await api('POST', `/api/pagamentos/${b.dataset.confirmar}/confirmar?valor=${numCampo($('#vConf', m.el).value)}`);
        m.fechar(); toast('Pagamento confirmado!'); depois();
      } catch (e) { toast(e.message, true); }
    };
  });
  $$('[data-rejeitar]', raiz).forEach(b => b.onclick = async () => {
    if (!await confirmar('Rejeitar este comprovante?', 'Rejeitar')) return;
    await api('POST', `/api/pagamentos/${b.dataset.rejeitar}/rejeitar`); toast('Comprovante rejeitado'); depois();
  });
}

function modalPagamento(o, depois) {
  const m = modal(`
    <h2>Registrar pagamento · #${o.id}</h2>
    <div class="suave">${esc(o.clienteNome)} — saldo ${moeda(o.saldo)}</div>
    <form id="fPag">
      <div class="grade2">
        <div class="campo"><label>Valor (R$)</label><input name="valor" inputmode="decimal" required value="${String(o.saldo).replace('.', ',')}"></div>
        <div class="campo"><label>Forma</label><select name="forma"><option>PIX</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option></select></div>
      </div>
      <div class="campo"><label>Data</label><input type="date" name="data" value="${hojeISO()}"></div>
      <div class="campo"><label>Comprovante (foto ou PDF que o cliente mandou no WhatsApp)</label><input type="file" name="arquivo" accept="image/*,application/pdf"></div>
      <div class="campo" style="border:0"><label>Observação</label><input name="observacao" placeholder="Opcional"></div>
      <div class="botoes dois"><button type="button" class="btn claro" data-fechar>Cancelar</button><button class="btn verde">Registrar</button></div>
    </form>`);
  $('#fPag', m.el).onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.set('valor', String(numCampo(fd.get('valor'))));
    try { await api('POST', `/api/orcamentos/${o.id}/pagamentos`, fd, true); m.fechar(); toast('Pagamento registrado!'); depois(); }
    catch (err) { toast(err.message, true); }
  };
}

// ================= PAGAMENTOS =================
async function telaPagamentos(aba) {
  topo('Pagamentos', '🧁');
  const abas = [['pendentes', 'Pendentes'], ['confirmar', 'A confirmar'], ['recebidos', 'Recebidos']];
  conteudo.innerHTML = `<div class="abas">${abas.map(([k, t]) => `<button class="${k === aba ? 'ativo' : ''}" data-aba="${k}">${t}</button>`).join('')}</div><div id="corpo"><div class="spinner">Carregando…</div></div>`;
  $$('.abas button').forEach(b => b.onclick = () => location.hash = `#/pagamentos/${b.dataset.aba}`);
  const corpo = $('#corpo');
  const recarregar = () => telaPagamentos(aba);

  if (aba === 'pendentes') {
    const lista = await api('GET', '/api/pagamentos/pendentes');
    const hoje = hojeISO();
    corpo.innerHTML = lista.length ? lista.map(o => `
      <div class="card">
        <div class="linha"><a class="forte" href="#/orcamentos/${o.id}" style="text-decoration:none">Pedido #${o.id}</a><span class="valor">${moeda(o.saldo)}</span></div>
        <div class="forte" style="font-weight:700">${esc(o.clienteNome)}</div>
        <div class="linha" style="margin-top:6px">
          <span class="suave">${o.vencimento ? `Vencimento:<br><b style="color:${o.vencimento < hoje ? 'var(--vermelho)' : 'inherit'}">${dia(o.vencimento)}</b>` : 'Sem vencimento'}${o.valorAConfirmar > 0 ? '<br>🧾 comprovante a confirmar' : ''}</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn verde peq" data-cobrar="${o.id}" title="Cobrar via WhatsApp">🟢 Cobrar</button>
            <button class="btn peq" data-pagar="${o.id}">Registrar Pagamento</button>
          </span>
        </div>
      </div>`).join('') : `<div class="vazio"><span class="grande">🎉</span>Nenhum pagamento pendente.</div>`;
    $$('[data-pagar]', corpo).forEach(b => b.onclick = () => modalPagamento(lista.find(o => o.id === +b.dataset.pagar), recarregar));
    $$('[data-cobrar]', corpo).forEach(b => b.onclick = () => abrirWhats(api('POST', `/api/orcamentos/${b.dataset.cobrar}/whatsapp?tipo=cobranca`).then(r => r.url)));
  }

  if (aba === 'confirmar' || aba === 'recebidos') {
    const lista = await api('GET', `/api/pagamentos?status=${aba === 'confirmar' ? 'AguardandoConfirmacao' : 'Confirmado'}`);
    corpo.innerHTML = lista.length ? lista.map(p => cardPagamento(p, true)).join('') :
      `<div class="vazio"><span class="grande">${aba === 'confirmar' ? '🧾' : '💰'}</span>${aba === 'confirmar' ? 'Nenhum comprovante aguardando conferência.' : 'Nenhum pagamento recebido ainda.'}</div>`;
    ligarAcoesPagamento(corpo, recarregar);
  }

  if (aba === 'whatsapp') {
    const [msgs, abertos] = await Promise.all([
      api('GET', '/api/mensagens?pendentes=true'),
      api('GET', '/api/orcamentos?status=Enviado,Aprovado'),
    ]);
    const intro = CONFIG.whatsappApi
      ? `<div class="aviso">Mensagens recebidas pela API que não foram vinculadas automaticamente a um pedido.</div>`
      : `<div class="aviso">A integração automática (WhatsApp Cloud API) está desligada. Quando o cliente mandar o comprovante no seu WhatsApp, use <b>Registrar Pagamento</b> e anexe a imagem — ou peça para ele enviar pelo link do pedido.</div>`;
    corpo.innerHTML = intro + (msgs.length ? msgs.map(m => {
      const url = m.arquivo ? `/api/arquivos/${encodeURIComponent(m.arquivo)}` : '';
      return `<div class="card">
        <div class="comp">
          ${url ? `<a class="thumb" href="${url}" target="_blank">${m.mime?.startsWith('image/') ? `<img src="${url}" class="thumb" style="border:0">` : '📄'}</a>` : `<div class="thumb">💬</div>`}
          <div style="flex:1;min-width:0">
            <div class="linha"><span class="forte">${esc(m.nomeContato || fone(m.telefone))}</span><span class="suave">${diaHora(m.recebidaEm)}</span></div>
            <div class="suave">${esc(fone(m.telefone))} · ${esc(m.tipo)}</div>
            ${m.texto ? `<div>${esc(m.texto)}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              ${m.arquivo ? `<select class="ctl" data-sel="${m.id}" style="flex:1;min-width:150px;padding:7px">
                  <option value="">Vincular ao pedido…</option>
                  ${abertos.map(o => `<option value="${o.id}">#${o.id} · ${esc(o.clienteNome)} · ${moeda(o.saldo)}</option>`).join('')}
                </select>
                <button class="btn verde peq" data-vincular="${m.id}">Vincular</button>` : ''}
              <button class="btn claro peq" data-arquivar="${m.id}">Arquivar</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="vazio"><span class="grande">💬</span>Nada pendente.</div>`);
    $$('[data-vincular]', corpo).forEach(b => b.onclick = async () => {
      const oid = $(`[data-sel="${b.dataset.vincular}"]`, corpo).value;
      if (!oid) return toast('Escolha o pedido.', true);
      await api('POST', `/api/mensagens/${b.dataset.vincular}/vincular?orcamentoId=${oid}`);
      toast('Comprovante vinculado — confirme em "A confirmar".'); recarregar();
    });
    $$('[data-arquivar]', corpo).forEach(b => b.onclick = async () => { await api('POST', `/api/mensagens/${b.dataset.arquivar}/arquivar`); recarregar(); });
  }
}

// ================= DASHBOARD =================
let mesDash = null;
async function telaDashboard() {
  topo('Dashboard Financeiro', '💰');
  if (!mesDash) mesDash = hojeISO().slice(0, 7);
  const d = await api('GET', `/api/dashboard?mes=${mesDash}`);
  const [a, m] = mesDash.split('-').map(Number);
  const nomeMes = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
  conteudo.innerHTML = `
    <div class="mes"><button id="mAnt">‹</button><span>${nomeMes}</span><button id="mProx">›</button></div>
    <div class="kpi rosa"><div class="rot">Vendas no mês</div><div class="num">${moeda(d.vendasMes)}</div><div class="sub">${d.pedidosMes} pedido(s) aprovado(s) · recebido ${moeda(d.recebidoMes)}</div><div class="ilu">🎂</div></div>
    <div class="kpi azul"><div class="rot">Lucro líquido</div><div class="num">${moeda(d.lucroMes)}</div><div class="sub">${d.custoInformado ? 'Vendas − custo dos itens' : 'Informe o custo nos itens para calcular'}</div><div class="ilu">📈</div></div>
    <a href="#/pagamentos/pendentes" style="text-decoration:none"><div class="kpi pessego"><div class="rot">Pendentes</div><div class="num">${moeda(d.pendentes)}</div><div class="sub">${d.pedidosPendentes} pedido(s)${d.vencidos ? ` · <b style="color:var(--vermelho)">${d.vencidos} vencido(s)</b>` : ''}</div><div class="ilu">🧁</div></div></a>
    <div class="mini">
      <a class="card" href="#/orcamentos?status=Enviado" style="text-decoration:none"><b>${d.aguardandoAprovacao}</b><span>Aguardando aprovação</span></a>
      <a class="card" href="#/pagamentos/confirmar" style="text-decoration:none"><b>${d.comprovantesAConfirmar}</b><span>Comprovantes a confirmar</span></a>
      <a class="card" href="#/pagamentos/recebidos" style="text-decoration:none"><b>${moeda(d.recebidoMes).replace(/,\d\d$/, '')}</b><span>Recebido no mês</span></a>
    </div>
    <div class="secao"><span class="seta">➜</span> Mais vendidos</div>
    <div class="lista">${d.maisVendidos.length ? d.maisVendidos.map(p => `<div class="li"><div class="av">🍫</div><span class="nome">${esc(p.produto)}</span><span class="suave">${qtd(p.quantidade)} vendas</span></div>`).join('') : '<div class="li suave">Sem vendas no mês.</div>'}</div>
    <div class="secao"><span class="seta">➜</span> Melhores clientes</div>
    <div class="lista">${d.melhoresClientes.length ? d.melhoresClientes.map(c => `<div class="li"><div class="av">${esc(iniciais(c.cliente))}</div><span class="nome">${esc(c.cliente)}</span><span class="suave">${c.pedidos} pedido(s)</span></div>`).join('') : '<div class="li suave">Sem vendas no mês.</div>'}</div>`;
  const mudar = delta => { const dt = new Date(a, m - 1 + delta, 1); mesDash = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; telaDashboard(); };
  $('#mAnt').onclick = () => mudar(-1);
  $('#mProx').onclick = () => mudar(1);
}

// ================= CLIENTES =================
async function telaClientes() {
  topo('Clientes', '👥');
  const lista = await api('GET', '/api/clientes');
  conteudo.innerHTML = `
    <input class="ctl busca" id="busca" placeholder="🔎 Buscar cliente">
    <div class="lista" id="lista"></div>
    <button class="btn fab" id="novo">＋ Novo cliente</button>`;
  const desenhar = t => {
    t = t.trim().toLowerCase();
    const f = lista.filter(c => !t || c.nome.toLowerCase().includes(t) || c.telefone.includes(t.replace(/\D/g, '') || '§'));
    $('#lista').innerHTML = f.length ? f.map(c => `
      <div class="li" style="cursor:pointer" onclick="location.hash='#/clientes/${c.id}'">
        <div class="av">${esc(iniciais(c.nome))}</div>
        <div class="nome">${esc(c.nome)}<div class="suave" style="font-weight:600">${esc(fone(c.telefone))}</div></div>
        <span class="suave">${c.totalPedidos} pedido(s)</span>
      </div>`).join('') : '<div class="vazio"><span class="grande">👥</span>Nenhum cliente.</div>';
  };
  $('#busca').oninput = e => desenhar(e.target.value);
  $('#novo').onclick = () => modalCliente(null, () => telaClientes());
  desenhar('');
}

function modalCliente(c, depois) {
  const m = modal(`
    <h2>${c ? 'Editar cliente' : 'Novo cliente'}</h2>
    <form id="fCli">
      <div class="campo"><label>Nome</label><input name="nome" required value="${esc(c?.nome || '')}"></div>
      <div class="campo"><label>WhatsApp (DDD + número)</label><input name="telefone" inputmode="tel" required value="${esc(c ? fone(c.telefone) : '')}" placeholder="(11) 98888-7777"></div>
      <div class="campo" style="border:0"><label>Observação</label><input name="observacao" value="${esc(c?.observacao || '')}" placeholder="Ex.: alérgico a amendoim"></div>
      <div class="botoes dois"><button type="button" class="btn claro" data-fechar>Cancelar</button><button class="btn">Salvar</button></div>
    </form>`);
  $('#fCli', m.el).onsubmit = async e => {
    e.preventDefault();
    const corpo = Object.fromEntries(new FormData(e.target));
    try {
      if (c) await api('PUT', `/api/clientes/${c.id}`, corpo); else await api('POST', '/api/clientes', corpo);
      m.fechar(); toast('Cliente salvo!'); depois();
    } catch (err) { toast(err.message, true); }
  };
}

async function telaCliente(id) {
  const [c, pedidos] = await Promise.all([api('GET', `/api/clientes/${id}`), api('GET', `/api/orcamentos?clienteId=${id}`)]);
  topo(c.nome, '👤', '#/clientes');
  const total = pedidos.filter(o => ['Aprovado', 'Pago'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  conteudo.innerHTML = `
    <div class="card">
      <div class="linha"><span class="forte" style="font-size:1.1rem">${esc(c.nome)}</span><span class="valor">${moeda(total)}</span></div>
      <div class="linha suave"><span>📱 ${esc(fone(c.telefone))}</span><span>${c.totalPedidos} pedido(s)</span></div>
      ${c.observacao ? `<div class="suave" style="margin-top:6px">${esc(c.observacao)}</div>` : ''}
      <div class="botoes dois">
        <a class="btn verde peq" href="https://wa.me/${esc(c.telefone)}" target="_blank">🟢 Conversar</a>
        <a class="btn peq" href="#/orcamentos/novo?cliente=${c.id}">＋ Orçamento</a>
      </div>
      <div class="botoes dois">
        <button class="btn claro peq" id="edit">✏️ Editar</button>
        <button class="btn perigo peq" id="del">Excluir</button>
      </div>
    </div>
    <div class="secao">Pedidos</div>
    ${pedidos.length ? pedidos.map(cardOrcamento).join('') : '<div class="vazio">Nenhum pedido ainda.</div>'}`;
  $('#edit').onclick = () => modalCliente(c, () => telaCliente(id));
  $('#del').onclick = async () => {
    if (!await confirmar(`Excluir ${c.nome}?`, 'Excluir')) return;
    try { await api('DELETE', `/api/clientes/${id}`); toast('Cliente excluído'); location.hash = '#/clientes'; }
    catch (e) { toast(e.message, true); }
  };
}

// ================= AJUSTES =================
function pendenciasAjustes() {
  const p = [];
  if (CONFIG.senhaPadrao) p.push('definir uma senha própria');
  if (!CONFIG.whatsLojaConfigurado) p.push('cadastrar o WhatsApp da loja');
  if (!CONFIG.pixConfigurado) p.push('informar a chave PIX');
  return p;
}
function avisoAjustes() {
  const p = pendenciasAjustes();
  if (!p.length) return '';
  const lista = p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p.at(-1) : p[0];
  return `<a href="#/ajustes" style="text-decoration:none"><div class="aviso">⚙️ Falta ${lista}. Toque aqui para configurar.</div></a>`;
}
function atualizarBadgeAjustes() { $('#badgeAjustes').classList.toggle('oculto', !pendenciasAjustes().length); }

async function telaAjustes() {
  topo('Ajustes', '⚙️');
  const a = await api('GET', '/api/ajustes');
  conteudo.innerHTML = `
    <form id="fLoja" autocomplete="off">
      <div class="secao">🏪 Dados da loja</div>
      <div class="card">
        <div class="campo"><label>Nome da loja</label><input name="nome" required value="${esc(a.nome)}"></div>
        <div class="campo"><label>WhatsApp da loja (DDD + número)</label>
          <input name="telefoneWhatsApp" inputmode="tel" placeholder="(11) 98888-7777" value="${esc(a.telefoneWhatsApp ? fone(a.telefoneWhatsApp) : '')}">
          <div class="suave" style="margin-top:4px">Depois de enviar o comprovante, o cliente volta para esta conversa.</div></div>
        <div class="campo" style="border:0"><label>Cidade</label><input name="cidade" value="${esc(a.cidade)}"></div>
      </div>

      <div class="secao">💠 PIX</div>
      <div class="card">
        <div class="campo"><label>Chave PIX</label><input name="chavePix" value="${esc(a.chavePix)}" placeholder="CPF, CNPJ, e-mail, +5511999998888 ou chave aleatória">
          <div class="suave" style="margin-top:4px">Telefone no formato +55 DDD número, sem espaços. CPF/CNPJ só números.</div></div>
        <div class="campo" style="border:0"><label>Nome do recebedor (como está no banco)</label><input name="nomeRecebedorPix" value="${esc(a.nomeRecebedorPix)}" placeholder="Opcional — usa o nome da loja"></div>
      </div>

      <div class="secao">🌐 Endereço do app</div>
      <div class="card">
        <div class="campo" style="border:0"><label>Endereço público (usado nos links enviados ao cliente)</label>
          <input name="urlPublica" inputmode="url" value="${esc(a.urlPublica)}" placeholder="Em branco = ${esc(CONFIG.urlPublica)}"></div>
      </div>
      <button class="btn bloco" style="margin-top:14px">💾 Salvar dados da loja</button>
    </form>

    <form id="fSenha" autocomplete="off">
      <div class="secao">🔒 Senha de acesso</div>
      <div class="card">
        ${CONFIG.senhaPadrao ? '<div class="aviso">Você ainda está usando a senha inicial. Defina uma senha própria.</div>' : ''}
        <div class="suave" style="margin-bottom:6px">Conta: <b>${esc(CONFIG.email || '')}</b></div>
        <div class="campo"><label>Senha atual</label><input type="password" name="atual" required autocomplete="current-password"></div>
        <div class="grade2">
          <div class="campo" style="border:0"><label>Nova senha</label><input type="password" name="nova" required minlength="6" autocomplete="new-password"></div>
          <div class="campo" style="border:0"><label>Repita a nova senha</label><input type="password" name="repete" required autocomplete="new-password"></div>
        </div>
      </div>
      <button class="btn bloco claro" style="margin-top:14px">🔒 Trocar senha</button>
    </form>

    <button class="btn bloco perigo" id="sair" style="margin-top:28px">Sair do app</button>`;

  $('#fLoja').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('PUT', '/api/ajustes', Object.fromEntries(new FormData(e.target)));
      CONFIG = await api('GET', '/api/config');
      toast('Dados da loja salvos!'); atualizarBadgeAjustes(); telaAjustes();
    } catch (err) { toast(err.message, true); }
  };
  $('#fSenha').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.nova !== f.repete) return toast('As senhas novas não conferem.', true);
    try {
      await api('POST', '/api/ajustes/senha', { atual: f.atual, nova: f.nova });
      CONFIG.senhaPadrao = false; e.target.reset();
      toast('Senha alterada!'); atualizarBadgeAjustes(); telaAjustes();
    } catch (err) { toast(err.message, true); }
  };
  $('#sair').onclick = async () => { await api('POST', '/api/logout'); location.hash = ''; mostrarLogin(); };
}

// ================= login / início =================
function mostrarLogin() {
  $('#telaApp').classList.add('oculto');
  $('#telaLogin').classList.remove('oculto');
  setTimeout(() => $('#email').focus(), 50);
}

let modoCadastro = false;
$('#trocarModo').onclick = e => {
  e.preventDefault();
  modoCadastro = !modoCadastro;
  $('#btnEntrar').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  $('#trocarModo').textContent = modoCadastro ? 'Já tenho conta — entrar' : 'Primeiro acesso? Criar conta';
  $('#senha').autocomplete = modoCadastro ? 'new-password' : 'current-password';
};

$('#formLogin').onsubmit = async e => {
  e.preventDefault();
  const email = $('#email').value.trim(), password = $('#senha').value;
  const btn = $('#btnEntrar'); btn.disabled = true;
  try {
    if (modoCadastro) {
      const r = await Doce.sb.auth.signUp({ email, password });
      if (r.error) throw r.error;
      if (!r.data.session) { toast('Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.'); $('#trocarModo').click(); return; }
    } else {
      const r = await Doce.sb.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
    }
    const { data: membro, error } = await Doce.sb.rpc('entrar_na_loja');
    if (error) throw error;
    if (!membro) { await Doce.sb.auth.signOut(); throw new Error('Não foi possível abrir a loja desta conta. Tente novamente.'); }
    $('#senha').value = '';
    iniciar();
  } catch (err) { toast(Doce.erroAmigavel(err), true); }
  finally { btn.disabled = false; }
};

$('#esqueci').onclick = async e => {
  e.preventDefault();
  const email = $('#email').value.trim();
  if (!email) return toast('Digite seu e-mail e toque em "Esqueci a senha" de novo.', true);
  const { error } = await Doce.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  toast(error ? Doce.erroAmigavel(error) : 'Enviamos um link para redefinir a senha no seu e-mail.', !!error);
};

// Volta do link "redefinir senha" enviado por e-mail
Doce.sb?.auth.onAuthStateChange(evento => {
  if (evento !== 'PASSWORD_RECOVERY') return;
  setTimeout(() => {
    const m = modal(`<h2>Nova senha</h2>
      <form id="fNova"><div class="campo"><label>Digite a nova senha</label><input type="password" id="nova" minlength="6" required autocomplete="new-password"></div>
      <div class="botoes"><button class="btn">Salvar nova senha</button></div></form>`);
    $('#fNova', m.el).onsubmit = async ev => {
      ev.preventDefault();
      const { error } = await Doce.sb.auth.updateUser({ password: $('#nova', m.el).value });
      if (error) return toast(Doce.erroAmigavel(error), true);
      m.fechar(); toast('Senha alterada!'); iniciar();
    };
  }, 300);
});

$$('.nav button').forEach(b => b.onclick = () => location.hash = '#/' + b.dataset.rota);
window.addEventListener('hashchange', navegar);

async function iniciar() {
  if (!Doce.configurado) {
    document.body.innerHTML = `<div class="login"><div class="card"><div class="logo">🛠️</div><h1>Quase lá!</h1>
      <p>Preencha o endereço e a chave do Supabase no arquivo <b>js/config.js</b> e publique de novo.</p>
      <p class="suave">Passo a passo no LEIAME.md do repositório.</p></div></div>`;
    return;
  }
  try { CONFIG = await api('GET', '/api/config'); } catch (e) { if (e.message !== 'Sessão expirada') toast(e.message, true); return; }
  atualizarBadgeAjustes();
  $('#telaLogin').classList.add('oculto');
  $('#telaApp').classList.remove('oculto');
  navegar();
}
iniciar();
