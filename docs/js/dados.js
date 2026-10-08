/* Camada de dados do painel: traduz as chamadas api('GET', '/api/...') para o Supabase. */
'use strict';

const sb = Doce.sb;
const BUCKET = 'comprovantes';
const SELECT_ORC = '*, clientes(nome, telefone), orcamento_itens(*), pagamentos(*)';
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

class ErroApi extends Error {}
const falha = msg => { throw new ErroApi(msg); };
const ok = ({ data, error }) => { if (error) throw new ErroApi(Doce.erroAmigavel(error)); return data; };

// ---------------- mapeamento ----------------
function mapPag(p, o) {
  return {
    id: p.id, orcamentoId: p.orcamento_id, valor: +p.valor, data: p.data, origem: p.origem, status: p.status,
    forma: p.forma, observacao: p.observacao, comprovanteArquivo: p.comprovante_path, comprovanteMime: p.comprovante_mime,
    comprovanteUrl: null, clienteNome: o?.clienteNome, clienteTelefone: o?.clienteTelefone,
  };
}

function mapOrc(r) {
  const o = {
    id: r.id, clienteId: r.cliente_id, clienteNome: r.clientes?.nome || '', clienteTelefone: r.clientes?.telefone || '',
    descricao: r.descricao, dataEntrega: r.data_entrega, vencimento: r.vencimento, desconto: +r.desconto,
    status: r.status, token: r.token, criadoEm: r.criado_em, enviadoEm: r.enviado_em, aprovadoEm: r.aprovado_em,
    pagoEm: r.pago_em, motivoRecusa: r.motivo_recusa,
  };
  o.itens = (r.orcamento_itens || []).sort((a, b) => a.id - b.id).map(i => ({
    id: i.id, descricao: i.descricao, quantidade: +i.quantidade, valorUnitario: +i.valor_unitario,
    custoUnitario: +i.custo_unitario, subtotal: r2(i.quantidade * i.valor_unitario),
  }));
  o.pagamentos = (r.pagamentos || []).sort((a, b) => String(a.data).localeCompare(b.data)).map(p => mapPag(p, o));
  o.totalItens = r2(o.itens.reduce((s, i) => s + i.subtotal, 0));
  o.total = Math.max(0, r2(o.totalItens - o.desconto));
  o.custo = r2(o.itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0));
  o.lucro = r2(o.total - o.custo);
  o.valorPago = r2(o.pagamentos.filter(p => p.status === 'Confirmado').reduce((s, p) => s + p.valor, 0));
  o.valorAConfirmar = r2(o.pagamentos.filter(p => p.status === 'AguardandoConfirmacao').reduce((s, p) => s + p.valor, 0));
  o.saldo = Math.max(0, r2(o.total - o.valorPago));
  return o;
}

async function assinarComprovantes(pagamentos) {
  const caminhos = [...new Set(pagamentos.map(p => p.comprovanteArquivo).filter(Boolean))];
  if (!caminhos.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(caminhos, 3600);
  const mapa = Object.fromEntries((data || []).filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
  pagamentos.forEach(p => { if (p.comprovanteArquivo) p.comprovanteUrl = mapa[p.comprovanteArquivo] || null; });
}

async function listarOrcamentos({ status, clienteId, id } = {}) {
  let q = sb.from('orcamentos').select(SELECT_ORC).order('id', { ascending: false });
  if (status) q = q.in('status', status.split(',').map(s => s.trim()).filter(Boolean));
  if (clienteId) q = q.eq('cliente_id', clienteId);
  if (id) q = q.eq('id', id);
  return ok(await q).map(mapOrc);
}

async function obterOrcamento(id) {
  const o = (await listarOrcamentos({ id }))[0];
  if (!o) falha('Pedido não encontrado.');
  return o;
}

// ---------------- loja ----------------
let lojaCache = null;
async function loja(recarregar = false) {
  if (!lojaCache || recarregar) lojaCache = ok(await sb.from('loja_config').select('*').eq('id', 1).single());
  return lojaCache;
}
const linkCliente = (l, token) => `${Doce.baseSite(l.url_publica)}/orcamento.html?t=${token}`;

// ---------------- textos do WhatsApp ----------------
const fmt = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(+v || 0);
const fmtDia = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '';
const fmtQtd = q => Number(q) % 1 === 0 ? String(Number(q)) : Number(q).toLocaleString('pt-BR');
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0];

function msgOrcamento(o, nomeLoja, link) {
  const l = [`Olá, ${primeiroNome(o.clienteNome)}! 😊`, `Segue o seu orçamento *#${o.id}* da *${nomeLoja}*:`, ''];
  if (o.descricao?.trim()) l.push(`_${o.descricao.trim()}_`, '');
  o.itens.forEach(i => l.push(`• ${fmtQtd(i.quantidade)}x ${i.descricao} — ${fmt(i.subtotal)}`));
  if (o.desconto > 0) l.push(`Desconto: -${fmt(o.desconto)}`);
  l.push('', `*Total: ${fmt(o.total)}*`);
  if (o.dataEntrega) l.push(`Entrega: ${fmtDia(o.dataEntrega)}`);
  if (o.vencimento) l.push(`Pagamento até: ${fmtDia(o.vencimento)}`);
  l.push('', 'Para *aprovar* e ver os dados de pagamento, acesse:', link);
  return l.join('\n');
}
const msgCobranca = (o, nomeLoja, link) =>
  `Olá, ${primeiroNome(o.clienteNome)}! Passando para lembrar do pagamento do pedido *#${o.id}* (${fmt(o.saldo)}) da *${nomeLoja}*` +
  (o.vencimento ? `, com vencimento em ${fmtDia(o.vencimento)}` : '') + `.\n\nDados do PIX e envio do comprovante:\n${link}`;
const msgRecibo = (o, nomeLoja) =>
  `Olá, ${primeiroNome(o.clienteNome)}! Recebemos o pagamento do pedido *#${o.id}* (${fmt(o.valorPago)}). Obrigado pela preferência! 🧁\n— ${nomeLoja}`;

// ---------------- validações ----------------
function validarCliente(c) {
  if (!c?.nome?.trim()) falha('Informe o nome do cliente.');
  const t = Doce.normalizarTelefone(c.telefone);
  if (t.length < 12 || t.length > 13) falha('Telefone inválido. Use DDD + número, ex.: (11) 98888-7777.');
  return { nome: c.nome.trim(), telefone: t, observacao: c.observacao?.trim() || null };
}

function validarOrcamento(o) {
  const itens = (o.itens || []).filter(i => i.descricao?.trim());
  if (!itens.length) falha('Inclua pelo menos um item.');
  if (itens.some(i => i.valorUnitario < 0 || i.custoUnitario < 0) || o.desconto < 0) falha('Valores não podem ser negativos.');
  return itens.map(i => ({
    descricao: i.descricao.trim(), quantidade: i.quantidade > 0 ? i.quantidade : 1,
    valor_unitario: r2(i.valorUnitario), custo_unitario: r2(i.custoUnitario),
  }));
}

async function clientePorTelefone(tel) {
  const chave = Doce.chaveTelefone(tel);
  const todos = ok(await sb.from('clientes').select('id, nome, telefone'));
  return todos.find(c => Doce.chaveTelefone(c.telefone) === chave);
}

async function mudarStatus(id, status, motivo) {
  const upd = { status };
  if (motivo) upd.motivo_recusa = motivo;
  ok(await sb.from('orcamentos').update(upd).eq('id', id));
}

async function enviarArquivo(token, arquivo) {
  const permitidos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
  const ext = permitidos[arquivo.type];
  if (!ext || arquivo.size > 10 * 1024 * 1024) falha('Envie uma imagem (JPG/PNG) ou PDF de até 10 MB.');
  const caminho = `${token}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  ok(await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type }));
  return { caminho, mime: arquivo.type };
}

// ---------------- roteador ----------------
async function api(metodo, url, corpo) {
  if (!sb) falha('O app ainda não foi configurado (js/config.js).');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { mostrarLogin(); throw new Error('Sessão expirada'); }

  const u = new URL(url, 'http://x');
  const q = Object.fromEntries(u.searchParams);
  const p = u.pathname.replace(/^\/api\//, '').split('/');
  const rota = `${metodo} ${p.map(s => /^\d+$/.test(s) ? ':id' : s).join('/')}`;
  const id = +p.find(s => /^\d+$/.test(s));

  switch (rota) {
    // ----- configuração / ajustes -----
    case 'GET config': {
      const l = await loja(true);
      return {
        loja: l.nome, pixConfigurado: !!l.chave_pix, whatsLojaConfigurado: !!l.telefone_whatsapp,
        whatsappApi: false, senhaPadrao: false, urlPublica: Doce.baseSite(l.url_publica), email: session.user.email,
      };
    }
    case 'GET ajustes': {
      const l = await loja(true);
      return { nome: l.nome, telefoneWhatsApp: l.telefone_whatsapp, chavePix: l.chave_pix, nomeRecebedorPix: l.nome_recebedor_pix, cidade: l.cidade, urlPublica: l.url_publica };
    }
    case 'PUT ajustes': {
      if (!corpo.nome?.trim()) falha('Informe o nome da loja.');
      let tel = '';
      if (corpo.telefoneWhatsApp?.trim()) {
        tel = Doce.normalizarTelefone(corpo.telefoneWhatsApp);
        if (tel.length < 12 || tel.length > 13) falha('WhatsApp da loja inválido. Use DDD + número.');
      }
      const url = (corpo.urlPublica || '').trim();
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) falha('Endereço público inválido. Ex.: https://usuario.github.io/DoceGestao');
      ok(await sb.from('loja_config').update({
        nome: corpo.nome.trim(), telefone_whatsapp: tel, chave_pix: (corpo.chavePix || '').trim(),
        nome_recebedor_pix: (corpo.nomeRecebedorPix || '').trim(), cidade: (corpo.cidade || '').trim(), url_publica: url,
      }).eq('id', 1));
      await loja(true);
      return {};
    }
    case 'POST ajustes/senha': {
      if (!corpo.nova || corpo.nova.length < 6) falha('A nova senha precisa ter pelo menos 6 caracteres.');
      const t = await sb.auth.signInWithPassword({ email: session.user.email, password: corpo.atual });
      if (t.error) falha('Senha atual incorreta.');
      ok(await sb.auth.updateUser({ password: corpo.nova }));
      return {};
    }
    case 'POST logout': await sb.auth.signOut(); return {};

    // ----- clientes -----
    case 'GET clientes': {
      const lista = ok(await sb.from('clientes').select('*, orcamentos(status)').order('nome'));
      const b = (q.busca || '').toLowerCase();
      return lista.filter(c => !b || c.nome.toLowerCase().includes(b) || c.telefone.includes(b)).map(c => ({
        id: c.id, nome: c.nome, telefone: c.telefone, observacao: c.observacao, criadoEm: c.criado_em,
        totalPedidos: (c.orcamentos || []).filter(o => ['Aprovado', 'Pago'].includes(o.status)).length,
      }));
    }
    case 'GET clientes/:id': {
      const c = (await api('GET', '/api/clientes')).find(x => x.id === id);
      if (!c) falha('Cliente não encontrado.');
      return c;
    }
    case 'POST clientes': {
      const c = validarCliente(corpo);
      const existe = await clientePorTelefone(c.telefone);
      if (existe) falha(`Já existe um cliente com esse telefone: ${existe.nome}.`);
      return { id: ok(await sb.from('clientes').insert(c).select('id').single()).id };
    }
    case 'PUT clientes/:id': ok(await sb.from('clientes').update(validarCliente(corpo)).eq('id', id)); return {};
    case 'DELETE clientes/:id': {
      const { count } = await sb.from('orcamentos').select('id', { count: 'exact', head: true }).eq('cliente_id', id);
      if (count > 0) falha('Cliente possui orçamentos e não pode ser excluído.');
      ok(await sb.from('clientes').delete().eq('id', id));
      return {};
    }

    // ----- orçamentos -----
    case 'GET orcamentos': {
      const lista = await listarOrcamentos({ status: q.status, clienteId: q.clienteId });
      return lista;
    }
    case 'GET orcamentos/:id': {
      const o = await obterOrcamento(id);
      await assinarComprovantes(o.pagamentos);
      return { orcamento: o, link: linkCliente(await loja(), o.token) };
    }
    case 'POST orcamentos': {
      const itens = validarOrcamento(corpo);
      let clienteId = corpo.clienteId;
      if (!clienteId) {
        if (!corpo.novoCliente) falha('Selecione ou cadastre o cliente.');
        const c = validarCliente(corpo.novoCliente);
        clienteId = (await clientePorTelefone(c.telefone))?.id ||
          ok(await sb.from('clientes').insert(c).select('id').single()).id;
      }
      const novo = ok(await sb.from('orcamentos').insert({
        cliente_id: clienteId, descricao: corpo.descricao?.trim() || null, data_entrega: corpo.dataEntrega || null,
        vencimento: corpo.vencimento || null, desconto: r2(corpo.desconto),
      }).select('id').single());
      const ins = await sb.from('orcamento_itens').insert(itens.map(i => ({ ...i, orcamento_id: novo.id })));
      if (ins.error) { await sb.from('orcamentos').delete().eq('id', novo.id); ok(ins); }
      return { id: novo.id };
    }
    case 'PUT orcamentos/:id': {
      const o = await obterOrcamento(id);
      if (o.status === 'Pago') falha('Pedido já pago não pode ser alterado.');
      const itens = validarOrcamento(corpo);
      const upd = { descricao: corpo.descricao?.trim() || null, data_entrega: corpo.dataEntrega || null, vencimento: corpo.vencimento || null, desconto: r2(corpo.desconto) };
      if (corpo.clienteId) upd.cliente_id = corpo.clienteId;
      ok(await sb.from('orcamentos').update(upd).eq('id', id));
      ok(await sb.from('orcamento_itens').delete().eq('orcamento_id', id));
      ok(await sb.from('orcamento_itens').insert(itens.map(i => ({ ...i, orcamento_id: id }))));
      return {};
    }
    case 'DELETE orcamentos/:id': {
      const o = await obterOrcamento(id);
      const arquivos = o.pagamentos.map(p => p.comprovanteArquivo).filter(Boolean);
      if (arquivos.length) await sb.storage.from(BUCKET).remove(arquivos);
      ok(await sb.from('orcamentos').delete().eq('id', id));
      return {};
    }
    case 'POST orcamentos/:id/status': {
      if (!['Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Cancelado'].includes(corpo.status)) falha('Status inválido.');
      await mudarStatus(id, corpo.status, corpo.motivo);
      return {};
    }
    case 'POST orcamentos/:id/whatsapp': {
      const o = await obterOrcamento(id);
      const l = await loja();
      const link = linkCliente(l, o.token);
      const tipo = q.tipo || 'orcamento';
      const texto = tipo === 'cobranca' ? msgCobranca(o, l.nome, link) : tipo === 'recibo' ? msgRecibo(o, l.nome) : msgOrcamento(o, l.nome, link);
      if (tipo === 'orcamento' && o.status === 'Rascunho') await mudarStatus(id, 'Enviado');
      return { url: `https://wa.me/${Doce.normalizarTelefone(o.clienteTelefone)}?text=${encodeURIComponent(texto)}`, texto };
    }
    case 'POST orcamentos/:id/pagamentos': {
      const o = await obterOrcamento(id);
      const valor = Number(corpo.get('valor'));
      if (!(valor > 0)) falha('Informe um valor válido.');
      if (['Rascunho', 'Enviado'].includes(o.status)) await mudarStatus(id, 'Aprovado');
      const arq = corpo.get('arquivo');
      const comp = arq && arq.size ? await enviarArquivo(o.token, arq) : null;
      const dia = corpo.get('data');
      ok(await sb.from('pagamentos').insert({
        orcamento_id: id, valor: r2(valor), data: dia ? new Date(dia + 'T12:00:00').toISOString() : new Date().toISOString(),
        origem: 'Manual', status: 'Confirmado', forma: corpo.get('forma') || null, observacao: corpo.get('observacao') || null,
        comprovante_path: comp?.caminho || null, comprovante_mime: comp?.mime || null,
      }));
      return {};
    }

    // ----- pagamentos -----
    case 'GET pagamentos/pendentes': {
      const lista = (await listarOrcamentos({ status: 'Aprovado' })).filter(o => o.saldo > 0);
      return lista.sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999') || a.id - b.id);
    }
    case 'GET pagamentos': {
      const st = q.status || 'Confirmado';
      const pags = (await listarOrcamentos()).flatMap(o => o.pagamentos).filter(p => p.status === st)
        .sort((a, b) => String(b.data).localeCompare(a.data)).slice(0, 200);
      await assinarComprovantes(pags);
      return pags;
    }
    case 'POST pagamentos/:id/confirmar': {
      const upd = { status: 'Confirmado' };
      if (q.valor && +q.valor > 0) upd.valor = r2(q.valor);
      ok(await sb.from('pagamentos').update(upd).eq('id', id));
      return {};
    }
    case 'POST pagamentos/:id/rejeitar': ok(await sb.from('pagamentos').update({ status: 'Rejeitado' }).eq('id', id)); return {};

    // Mensagens recebidas pela API do WhatsApp (não usada na versão GitHub Pages)
    case 'GET mensagens': return [];

    // ----- painel -----
    case 'GET dashboard': {
      const [a, m] = (q.mes || new Date().toISOString().slice(0, 7)).split('-').map(Number);
      const ini = new Date(a, m - 1, 1), fim = new Date(a, m, 1);
      const noMes = d => d && new Date(d) >= ini && new Date(d) < fim;
      const todos = await listarOrcamentos();
      const vendidos = todos.filter(o => ['Aprovado', 'Pago'].includes(o.status) && noMes(o.aprovadoEm));
      const emAberto = todos.filter(o => o.status === 'Aprovado');
      const hoje = new Date().toISOString().slice(0, 10);
      const agrupar = (arr, chave) => arr.reduce((acc, x) => { (acc[chave(x)] ||= []).push(x); return acc; }, {});
      return {
        mes: q.mes,
        vendasMes: r2(vendidos.reduce((s, o) => s + o.total, 0)),
        lucroMes: r2(vendidos.reduce((s, o) => s + o.lucro, 0)),
        custoInformado: vendidos.some(o => o.itens.some(i => i.custoUnitario > 0)),
        pedidosMes: vendidos.length,
        recebidoMes: r2(todos.flatMap(o => o.pagamentos).filter(p => p.status === 'Confirmado' && noMes(p.data)).reduce((s, p) => s + p.valor, 0)),
        pendentes: r2(emAberto.reduce((s, o) => s + o.saldo, 0)),
        pedidosPendentes: emAberto.filter(o => o.saldo > 0).length,
        vencidos: emAberto.filter(o => o.saldo > 0 && o.vencimento && o.vencimento < hoje).length,
        aguardandoAprovacao: todos.filter(o => o.status === 'Enviado').length,
        comprovantesAConfirmar: todos.flatMap(o => o.pagamentos).filter(p => p.status === 'AguardandoConfirmacao').length,
        maisVendidos: Object.values(agrupar(vendidos.flatMap(o => o.itens), i => i.descricao.trim().toLowerCase()))
          .map(g => ({ produto: g[0].descricao, quantidade: g.reduce((s, i) => s + i.quantidade, 0), valor: g.reduce((s, i) => s + i.subtotal, 0) }))
          .sort((x, y) => y.quantidade - x.quantidade).slice(0, 5),
        melhoresClientes: Object.values(agrupar(vendidos, o => o.clienteId))
          .map(g => ({ cliente: g[0].clienteNome, pedidos: g.length, valor: g.reduce((s, o) => s + o.total, 0) }))
          .sort((x, y) => y.pedidos - x.pedidos || y.valor - x.valor).slice(0, 5),
      };
    }
  }
  falha(`Operação não suportada: ${rota}`);
}
