# 🧁 Doce Gestão

Orçamentos para confeitaria com aprovação e pagamento pelo WhatsApp.

- A loja cria o orçamento e envia pelo WhatsApp com um link.
- O cliente abre o link, **aprova**, paga com **PIX (QR Code / copia e cola)** e **envia o comprovante**.
- Depois do envio, o cliente volta automaticamente para a conversa da loja no WhatsApp.
- A loja confere o comprovante, confirma e acompanha tudo no painel financeiro.

O repositório tem duas versões:

| Pasta | O que é | Onde roda |
|---|---|---|
| `docs/` | **Versão web (GitHub Pages + Supabase)** — a que está publicada | `https://<seu-usuario>.github.io/DoceGestao/` |
| `DoceGestao/` | Versão ASP.NET Core + SQLite (Visual Studio), com integração opcional à API oficial do WhatsApp | Servidor próprio / Azure — ver `LEIAME.md` |

---

## Publicar a versão web (uma vez só, ~15 minutos)

### 1. Banco de dados — Supabase (gratuito)

1. Crie uma conta em <https://supabase.com> → **New project** (região *South America (São Paulo)*). Guarde a senha do banco.
2. Abra **SQL Editor → New query**, cole todo o conteúdo de [`docs/supabase/schema.sql`](docs/supabase/schema.sql) e clique **Run**.
   Isso cria as tabelas, as regras de segurança e a pasta privada dos comprovantes.
3. Em **Authentication → Sign In / Providers → Email**:
   - para testar mais rápido, desligue **Confirm email** (senão é preciso clicar no link que chega por e-mail ao criar a conta).
4. Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço do GitHub Pages (passo 3 abaixo).
5. Em **Project Settings → API**, copie **Project URL** e a chave **anon public**.

### 2. Configurar o site

Edite [`docs/js/config.js`](docs/js/config.js) com os dois valores copiados:

```js
window.DOCE_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

> A chave **anon** é pública por natureza (vai para o navegador). A proteção dos dados está nas regras do `schema.sql`.
> **Nunca** use a chave `service_role` aqui.

### 3. Ligar o GitHub Pages

No repositório: **Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: **main** — pasta **/docs** → **Save**

Em 1–2 minutos o link fica disponível: `https://<seu-usuario>.github.io/DoceGestao/`

### 4. Primeiro acesso

1. Abra o link → **Primeiro acesso? Criar conta** com o e-mail e a senha da loja.
   **A primeira conta criada vira a dona da loja.** Contas criadas depois não conseguem entrar.
2. Vá em **⚙️ Ajustes** e preencha nome da loja, **WhatsApp da loja** e **chave PIX**.
3. Pronto: crie um orçamento e use **Enviar via WhatsApp**.

---

## Como funciona por dentro

```
Navegador (GitHub Pages)          Supabase
 ├─ index.html  painel  ──login──▶ Auth (e-mail/senha)
 │                       ──dados─▶ Postgres (RLS: só a dona da loja)
 └─ orcamento.html?t=…  ─funções─▶ publico_orcamento / aprovar / recusar / comprovante
     (cliente, sem login) ─upload─▶ Storage "comprovantes" (privado, pasta = código do pedido)
```

- O cliente só enxerga o pedido cujo código (32 caracteres aleatórios) recebeu no link.
- Comprovantes ficam num bucket privado; o painel mostra por links temporários de 1 hora.
- Pedidos ficam **Pago** automaticamente quando os pagamentos confirmados cobrem o total.

**Dar acesso a outra pessoa da loja:** ela cria a conta pelo link; depois, no Supabase → *Authentication → Users*,
copie o *UID* dela e rode no SQL Editor:

```sql
insert into public.membros (user_id, email) values ('UID-AQUI', 'email@dela.com');
```

**Esqueceu a senha:** na tela de login, digite o e-mail e toque em **Esqueci a senha**. O link que chega por e-mail
abre o app pedindo a nova senha (o *Site URL* do passo 1.4 precisa estar preenchido).
