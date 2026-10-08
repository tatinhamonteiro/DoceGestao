-- =====================================================================
--  Doce Gestão — estrutura do banco no Supabase
--  Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
--  Pode rodar de novo sem problema (não apaga dados).
-- =====================================================================

-- ---------- Tabelas ----------

create table if not exists public.loja_config (
  id                 int primary key default 1 check (id = 1),
  nome               text not null default 'Minha Confeitaria',
  telefone_whatsapp  text not null default '',
  chave_pix          text not null default '',
  nome_recebedor_pix text not null default '',
  cidade             text not null default 'SAO PAULO',
  url_publica        text not null default ''
);
insert into public.loja_config (id) values (1) on conflict do nothing;

-- Quem pode usar o painel (a 1ª conta criada vira dona automaticamente)
create table if not exists public.membros (
  user_id   uuid primary key,
  email     text,
  criado_em timestamptz not null default now()
);

create table if not exists public.clientes (
  id         bigint generated always as identity primary key,
  nome       text not null,
  telefone   text not null,
  observacao text,
  criado_em  timestamptz not null default now()
);

create table if not exists public.orcamentos (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references public.clientes(id),
  descricao     text,
  data_entrega  date,
  vencimento    date,
  desconto      numeric(12,2) not null default 0,
  status        text not null default 'Rascunho'
                check (status in ('Rascunho','Enviado','Aprovado','Recusado','Pago','Cancelado')),
  token         text not null unique default replace(gen_random_uuid()::text, '-', ''),
  criado_em     timestamptz not null default now(),
  enviado_em    timestamptz,
  aprovado_em   timestamptz,
  pago_em       timestamptz,
  motivo_recusa text
);
create index if not exists ix_orcamentos_cliente on public.orcamentos(cliente_id);

create table if not exists public.orcamento_itens (
  id             bigint generated always as identity primary key,
  orcamento_id   bigint not null references public.orcamentos(id) on delete cascade,
  descricao      text not null,
  quantidade     numeric(12,3) not null default 1,
  valor_unitario numeric(12,2) not null default 0,
  custo_unitario numeric(12,2) not null default 0
);
create index if not exists ix_itens_orcamento on public.orcamento_itens(orcamento_id);

create table if not exists public.pagamentos (
  id               bigint generated always as identity primary key,
  orcamento_id     bigint not null references public.orcamentos(id) on delete cascade,
  valor            numeric(12,2) not null,
  data             timestamptz not null default now(),
  origem           text not null default 'Manual',
  status           text not null default 'AguardandoConfirmacao'
                   check (status in ('AguardandoConfirmacao','Confirmado','Rejeitado')),
  forma            text,
  observacao       text,
  comprovante_path text,
  comprovante_mime text
);
create index if not exists ix_pagamentos_orcamento on public.pagamentos(orcamento_id);

-- ---------- Funções auxiliares ----------

create or replace function public.is_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros where user_id = auth.uid());
$$;

-- Chamada após o login. Se ainda não houver dono, quem chamou vira o dono.
create or replace function public.entrar_na_loja() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  lock table public.membros in exclusive mode;
  if not exists (select 1 from public.membros) then
    insert into public.membros (user_id, email) values (auth.uid(), auth.jwt() ->> 'email');
  end if;
  return public.is_membro();
end $$;

create or replace function public.total_orcamento(p_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select sum(round(quantidade * valor_unitario, 2)) from public.orcamento_itens where orcamento_id = p_id), 0)
                     - (select desconto from public.orcamentos where id = p_id));
$$;

create or replace function public.pago_orcamento(p_id bigint, p_status text default 'Confirmado') returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(valor), 0) from public.pagamentos where orcamento_id = p_id and status = p_status;
$$;

-- Marca como Pago quando os pagamentos confirmados cobrem o total (ou volta para Aprovado)
create or replace function public.recalcular_situacao(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_pago numeric; v_status text;
begin
  select status into v_status from public.orcamentos where id = p_id;
  if v_status is null then return; end if;
  v_total := public.total_orcamento(p_id);
  v_pago  := public.pago_orcamento(p_id);
  if v_total > 0 and v_pago >= v_total and v_status <> 'Pago' then
    update public.orcamentos set status = 'Pago', pago_em = now(), aprovado_em = coalesce(aprovado_em, now()) where id = p_id;
  elsif not (v_total > 0 and v_pago >= v_total) and v_status = 'Pago' then
    update public.orcamentos set status = 'Aprovado', pago_em = null where id = p_id;
  end if;
end $$;

create or replace function public.trg_pagamentos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_situacao(coalesce(new.orcamento_id, old.orcamento_id));
  return null;
end $$;

drop trigger if exists pagamentos_situacao on public.pagamentos;
create trigger pagamentos_situacao after insert or update or delete on public.pagamentos
for each row execute function public.trg_pagamentos();

-- Carimba as datas quando o status muda
create or replace function public.trg_orcamentos_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'Enviado'  then new.enviado_em  := coalesce(new.enviado_em, now()); end if;
    if new.status = 'Aprovado' then new.aprovado_em := coalesce(new.aprovado_em, now()); end if;
  end if;
  return new;
end $$;

drop trigger if exists orcamentos_status on public.orcamentos;
create trigger orcamentos_status before update on public.orcamentos
for each row execute function public.trg_orcamentos_status();

-- ---------- Funções públicas (página do cliente, sem login) ----------
-- O cliente só acessa o pedido cujo código (token) recebeu no link.

create or replace function public.publico_orcamento(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare o public.orcamentos; c public.clientes; l public.loja_config; v_total numeric; v_pago numeric; v_conf numeric;
begin
  select * into o from public.orcamentos where token = p_token;
  if not found then return null; end if;
  select * into c from public.clientes where id = o.cliente_id;
  select * into l from public.loja_config where id = 1;
  v_total := public.total_orcamento(o.id);
  v_pago  := public.pago_orcamento(o.id);
  v_conf  := public.pago_orcamento(o.id, 'AguardandoConfirmacao');
  return json_build_object(
    'numero', o.id,
    'loja', l.nome,
    'cliente', split_part(trim(c.nome), ' ', 1),
    'descricao', o.descricao,
    'dataEntrega', o.data_entrega,
    'vencimento', o.vencimento,
    'status', o.status,
    'itens', coalesce((select json_agg(json_build_object(
                'descricao', i.descricao, 'quantidade', i.quantidade,
                'valorUnitario', i.valor_unitario, 'subtotal', round(i.quantidade * i.valor_unitario, 2)) order by i.id)
              from public.orcamento_itens i where i.orcamento_id = o.id), '[]'::json),
    'desconto', o.desconto,
    'total', v_total,
    'valorPago', v_pago,
    'valorAConfirmar', v_conf,
    'saldo', greatest(0, v_total - v_pago),
    'chavePix', nullif(l.chave_pix, ''),
    'nomeRecebedorPix', coalesce(nullif(l.nome_recebedor_pix, ''), l.nome),
    'cidade', l.cidade,
    'whatsLoja', nullif(regexp_replace(l.telefone_whatsapp, '\D', '', 'g'), '')
  );
end $$;

create or replace function public.publico_aprovar(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.orcamentos where token = p_token;
  if v_status is null then raise exception 'Orçamento não encontrado.'; end if;
  if v_status in ('Recusado','Cancelado') then raise exception 'Este orçamento não está mais disponível. Fale com a loja.'; end if;
  if v_status in ('Rascunho','Enviado') then
    update public.orcamentos set status = 'Aprovado' where token = p_token;
    return 'Aprovado';
  end if;
  return v_status;
end $$;

create or replace function public.publico_recusar(p_token text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.orcamentos where token = p_token;
  if v_status is null then raise exception 'Orçamento não encontrado.'; end if;
  if v_status not in ('Rascunho','Enviado') then raise exception 'Este orçamento já foi respondido.'; end if;
  update public.orcamentos set status = 'Recusado', motivo_recusa = coalesce(nullif(trim(p_motivo), ''), 'Recusado pelo cliente')
   where token = p_token;
end $$;

-- Depois de subir o arquivo no Storage (pasta = token), o cliente registra o comprovante
create or replace function public.publico_comprovante(p_token text, p_path text, p_mime text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orcamentos; v_saldo numeric; v_conf numeric;
begin
  select * into o from public.orcamentos where token = p_token;
  if not found then raise exception 'Orçamento não encontrado.'; end if;
  if o.status in ('Recusado','Cancelado') then raise exception 'Este orçamento não está mais disponível.'; end if;
  if split_part(p_path, '/', 1) <> p_token then raise exception 'Arquivo inválido.'; end if;
  if o.status in ('Rascunho','Enviado') then update public.orcamentos set status = 'Aprovado' where id = o.id; end if;
  v_saldo := greatest(0, public.total_orcamento(o.id) - public.pago_orcamento(o.id));
  v_conf  := public.pago_orcamento(o.id, 'AguardandoConfirmacao');
  insert into public.pagamentos (orcamento_id, valor, origem, status, forma, comprovante_path, comprovante_mime)
  values (o.id, case when v_saldo - v_conf > 0 then v_saldo - v_conf else v_saldo end,
          'Link do cliente', 'AguardandoConfirmacao', 'PIX', p_path, p_mime);
end $$;

-- Usada pela regra do Storage: só aceita upload na pasta de um pedido ativo
create or replace function public.token_aceita_comprovante(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orcamentos where token = p_token and status in ('Rascunho','Enviado','Aprovado'));
$$;

-- ---------- Segurança (RLS) ----------

alter table public.loja_config     enable row level security;
alter table public.membros         enable row level security;
alter table public.clientes        enable row level security;
alter table public.orcamentos      enable row level security;
alter table public.orcamento_itens enable row level security;
alter table public.pagamentos      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['loja_config','clientes','orcamentos','orcamento_itens','pagamentos'] loop
    execute format('drop policy if exists membros_tudo on public.%I', t);
    execute format('create policy membros_tudo on public.%I for all to authenticated using (public.is_membro()) with check (public.is_membro())', t);
  end loop;
end $$;

drop policy if exists membros_leem on public.membros;
create policy membros_leem on public.membros for select to authenticated using (public.is_membro());

revoke all on public.loja_config, public.membros, public.clientes, public.orcamentos, public.orcamento_itens, public.pagamentos from anon;
grant select, insert, update, delete on public.loja_config, public.clientes, public.orcamentos, public.orcamento_itens, public.pagamentos to authenticated;
grant select on public.membros to authenticated;

revoke execute on function public.recalcular_situacao(bigint), public.trg_pagamentos(),
  public.total_orcamento(bigint), public.pago_orcamento(bigint, text) from public, anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.publico_orcamento(text), public.publico_aprovar(text), public.publico_recusar(text, text),
  public.publico_comprovante(text, text, text), public.token_aceita_comprovante(text) to anon, authenticated;
grant execute on function public.entrar_na_loja(), public.is_membro() to authenticated;

-- ---------- Storage: comprovantes ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists comprovantes_cliente_envia on storage.objects;
create policy comprovantes_cliente_envia on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprovantes' and public.token_aceita_comprovante((storage.foldername(name))[1]));

drop policy if exists comprovantes_loja_le on storage.objects;
create policy comprovantes_loja_le on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and public.is_membro());

drop policy if exists comprovantes_loja_apaga on storage.objects;
create policy comprovantes_loja_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'comprovantes' and public.is_membro());
