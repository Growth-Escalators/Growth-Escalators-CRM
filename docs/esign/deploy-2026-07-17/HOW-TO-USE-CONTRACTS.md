# How to use Contracts & E-Signature — from the start

The feature is **live** at `crm.growthescalators.com` (and for Wizmatch). Here's the whole flow.

## 0. Where it is
- **Growth Escalators:** log in to the CRM → left nav → **Finance → Contracts**.
- **Wizmatch:** log in → **More → Finance → Contracts** (`/wizmatch/contracts`).
- **Who can see it:** users with role `admin`, `manager_ops`, `team_lead`, or `sales` (or anyone
  granted the `contractsView` permission).

## 1. Create a contract (→ DRAFT)
1. Click **New contract**.
2. Fill in:
   - **Title** (e.g. "Retainer Agreement — Acme Corp").
   - **Recipients / parties** — name + email of who signs. Add your client as the signer.
   - **Countersignature (optional):** add an internal signer (e.g. you) to sign *after* the client.
     Signing order is enforced — client first, then your countersignature.
   - **Terms** — the body of the contract.
   - **Expiry (optional)** and **reminders (optional).**
3. Click **Create draft**. Status → **DRAFT**.

## 2. Generate the PDF (→ GENERATED)
- Click **Generate**. The system renders your title + parties + terms into a PDF. Status → **GENERATED**.
- This is the exact document that will be sent for signature.

## 3. Approve (→ READY_TO_SEND)
- Click **Approve**. This is the internal gate before anything goes out. Status → **READY_TO_SEND**.

## 4. Send (→ SENT)
- Click **Send**. The system:
  - Registers the document in Documenso (the signing engine),
  - **Emails the first signer their unique signing link** (sent by the CRM over its own email, not
    Documenso), and
  - Moves status → **SENT**.
- In the contract's detail drawer you'll also see **Copy link** — grab the signer's link to send over
  WhatsApp/manually if you prefer.

## 5. The signer's experience (no login needed)
1. They open the link → a consent page (they tick the required consent statements).
2. The **signing surface loads embedded in the page** — they sign there.
3. When they finish, a verified webhook from Documenso tells the CRM, and status advances:
   - single signer → **COMPLETED**
   - with a countersignature → **PARTIALLY_SIGNED** (waiting on your side)

## 6. Countersign (if you added one)
- Once the client has signed (**PARTIALLY_SIGNED**), the internal signer gets their turn (enforced
  order). After they sign → **COMPLETED**.

## 7. Done (→ COMPLETED) — download + audit
- On a **COMPLETED** contract you can download:
  - **Signed PDF** — the finished, signed document.
  - **Audit certificate** — Documenso's tamper-evidence record (who signed, when, from where).
- The detail drawer shows the full **Audit timeline** (every state change, immutable).

## Other actions
- **Void** — cancel a contract that hasn't completed (→ **VOIDED**).
- **Expiry / reminders** — if set, unsigned contracts auto-expire and signers get reminder nudges
  (handled by background jobs).
- **Filters** — the list has status pills (Draft / Sent / Completed / …) to find contracts fast.

## Good to know
- **Emails to signers** go out via the CRM's Brevo (HTTP) integration — reliable. Documenso's own
  email is intentionally **off** (Railway blocks outbound SMTP, and we don't need it — the CRM owns
  notifications). If a signer says they didn't get the email, use **Copy link** and send it directly.
- **Documents are stored privately** in Cloudflare R2; download links are short-lived signed URLs.
- **Completion is authoritative only via Documenso's verified webhook** — never a browser signal —
  so a contract can't be marked signed by anyone tampering client-side.
- **Documenso admin console** (rarely needed): https://documenso-production-71b3.up.railway.app —
  login `jatin@growthescalators.com`.

## First-run check (recommended)
Do one dry run with a throwaway document and **your own email** as the signer, so you see the whole
loop (create → generate → approve → send → sign → completed → download) before using it with a real client.
