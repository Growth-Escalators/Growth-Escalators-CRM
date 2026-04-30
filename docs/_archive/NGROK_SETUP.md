# How to connect Meta WhatsApp webhook

## Step 1 — Get your Meta credentials

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Select your app
3. Go to **WhatsApp > API Setup**
4. Copy your **Phone Number ID**
5. Copy your **WhatsApp Business Account ID**
6. Go to **System Users** in Business Manager
   - Create a system user with Admin role
   - Generate a token with these permissions:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
7. Copy the token

---

## Step 2 — Add credentials to .env

```
META_ACCESS_TOKEN=your_token_here
META_PHONE_NUMBER_ID=your_phone_number_id_here
META_APP_SECRET=your_app_secret_here
```

Your app secret is found at: **App Dashboard > App Settings > Basic > App Secret**

---

## Step 3 — Start ngrok for local testing

Run in a **separate terminal** (keep it running):

```bash
ngrok http 3000
```

Copy the `https` URL that ngrok gives you — it looks like:
```
https://abc123.ngrok-free.app
```

---

## Step 4 — Register webhook with Meta

1. Go to [developers.facebook.com](https://developers.facebook.com) > your app > **WhatsApp > Configuration**
2. Under **Webhook**, click **Edit**
3. Set **Callback URL**:
   ```
   https://abc123.ngrok-free.app/webhooks/meta-wa
   ```
   *(replace with your actual ngrok URL)*
4. Set **Verify Token**:
   ```
   ge_verify_2026
   ```
5. Click **Verify and Save**
6. Under **Webhook fields**, subscribe to the **messages** field

---

## Step 5 — Test it

1. Send a WhatsApp message to your test number
2. Then check the queue:
   ```bash
   curl http://localhost:3000/webhooks/test-queue
   ```
   You should see a new `inbound_wa` job in `recentJobs`

---

## Step 6 — For production (Railway deployment)

1. Deploy the backend to Railway
2. In your Railway service environment variables, set:
   - `META_ACCESS_TOKEN` — your real number's token
   - `META_PHONE_NUMBER_ID` — your real number's ID
   - `META_APP_SECRET` — from your Meta app settings
   - `META_VERIFY_TOKEN` — `ge_verify_2026`
3. Go back to Meta > WhatsApp > Configuration > Webhook
4. Replace the ngrok URL with your Railway backend URL:
   ```
   https://your-app.up.railway.app/webhooks/meta-wa
   ```
5. Re-verify and save
6. Restart the Railway service
