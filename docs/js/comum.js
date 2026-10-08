/* Funções usadas pelo painel e pela página do cliente */
'use strict';

const Doce = (() => {
  const cfg = window.DOCE_CONFIG || {};
  const configurado = /^https?:\/\/.+/.test(cfg.supabaseUrl || '') && !/SEU-PROJETO/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/COLE-AQUI/.test(cfg.supabaseAnonKey);
  const sb = configurado ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const so = s => String(s ?? '').replace(/\D/g, '');

  /** Somente dígitos, com 55 na frente quando faltar. */
  function normalizarTelefone(t) {
    let d = so(t);
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d;
  }

  /** DDD + últimos 8 dígitos: tolera +55 e o 9º dígito. */
  function chaveTelefone(t) {
    let d = so(t);
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
  }

  function semAcento(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** PIX copia e cola (BR Code) com valor e identificador do pedido. */
  function pixCopiaECola({ chave, nome, cidade, valor, txid }) {
    if (!chave) return null;
    const campo = (id, v) => id + String(v.length).padStart(2, '0') + v;
    const limpar = (s, max) => (semAcento(s).toUpperCase() || 'LOJA').slice(0, max);
    const id = (String(txid).replace(/[^A-Za-z0-9]/g, '') || '***').slice(0, 25);
    const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave).trim());
    const payload = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986') +
      (valor > 0 ? campo('54', Number(valor).toFixed(2)) : '') + campo('58', 'BR') +
      campo('59', limpar(nome, 25)) + campo('60', limpar(cidade, 15)) + campo('62', campo('05', id)) + '6304';
    let crc = 0xFFFF;
    for (const b of new TextEncoder().encode(payload)) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return payload + crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /** Endereço base do site (ex.: https://usuario.github.io/DoceGestao) */
  function baseSite(urlPublica) {
    if (urlPublica) return urlPublica.replace(/\/+$/, '');
    return new URL('.', location.href).href.replace(/\/+$/, '');
  }

  function erroAmigavel(e) {
    const m = e?.message || String(e);
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.';
    if (/User already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
    if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/row-level security|violates row-level/i.test(m)) return 'Sem permissão para esta ação.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
    return m;
  }

  return { sb, configurado, normalizarTelefone, chaveTelefone, pixCopiaECola, baseSite, erroAmigavel };
})();
