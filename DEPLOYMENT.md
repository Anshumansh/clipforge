# Deploying Clipforge

Everything code-side is ready (Postgres schema, S3-compatible storage, production
Dockerfile). The steps below are the parts that need your accounts/credentials —
none of it can be done on your behalf.

## 1. Create a Postgres database (Neon — free, no card)

1. Go to https://neon.tech and sign up (GitHub login is fastest).
2. Create a project (any name/region).
3. On the project dashboard, copy the **connection string** — it looks like:
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`
4. Send me that string and I'll wire it into `.env` and verify the schema locally
   before you deploy. (Or set it yourself as `DATABASE_URL` in `.env`.)

## 2. Create object storage (Cloudflare R2 — free tier, no card for the free tier)

Rendered videos need somewhere that isn't your laptop's disk.

1. Go to https://dash.cloudflare.com, sign up, go to **R2 Object Storage**.
2. Create a bucket (e.g. `clipforge-media`).
3. In the bucket settings, enable **public access** — either the free `r2.dev`
   subdomain Cloudflare gives you, or a custom domain if you have one. Copy that
   public URL — this is `STORAGE_PUBLIC_URL`.
4. Go to **R2 → Manage API Tokens → Create API Token**. Give it read/write
   permission scoped to your bucket. You'll get:
   - Access Key ID → `STORAGE_ACCESS_KEY_ID`
   - Secret Access Key → `STORAGE_SECRET_ACCESS_KEY`
5. The endpoint is `https://<your-account-id>.r2.cloudflarestorage.com` — your
   account ID is visible in the Cloudflare dashboard URL or the R2 overview page.
   This is `STORAGE_ENDPOINT`.
6. Bucket name from step 2 → `STORAGE_BUCKET`.

Send me these 4 values (or set them in `.env`) and I'll wire them up too.

## 3. Push the code to GitHub

```bash
gh repo create clipforge --private --source=. --remote=origin
git push -u origin master
```

If you don't have the `gh` CLI, create an empty repo manually at
https://github.com/new (don't initialize with a README), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/clipforge.git
git push -u origin master
```

## 4. Deploy on Railway

Railway (not Vercel) because video rendering is slow and memory-heavy — that
doesn't fit inside a normal serverless function's time limit. Railway runs a
real persistent container instead.

1. Go to https://railway.app, sign up with GitHub.
2. **New Project → Deploy from GitHub repo** → select your `clipforge` repo.
3. Railway should detect the `Dockerfile` automatically. If it instead tries to
   use Nixpacks, go to **Settings → Build → Builder** and switch it to
   **Dockerfile**.
4. Go to **Variables** and add every one of these (values from steps 1–2, plus
   your existing `.env` values for OpenAI/Groq/Pexels/Stripe):

   ```
   DATABASE_URL=<from step 1>
   NEXTAUTH_SECRET=efd9tRJ2RUIJhQRvsWJ/Ha6w7uVBB+ZTm5H3p16KYqY=
   NEXTAUTH_URL=<your Railway URL, e.g. https://clipforge-production.up.railway.app>
   OPENAI_API_KEY=<your key>
   GROQ_API_KEY=<your key, if you have one>
   PEXELS_API_KEY=<your key>
   STRIPE_SECRET_KEY=<your key — start with test mode>
   STRIPE_WEBHOOK_SECRET=<see step 6>
   STRIPE_PRICE_CREATOR=<your price id>
   STRIPE_PRICE_BUSINESS=<your price id>
   STORAGE_BUCKET=<from step 2>
   STORAGE_ENDPOINT=<from step 2>
   STORAGE_ACCESS_KEY_ID=<from step 2>
   STORAGE_SECRET_ACCESS_KEY=<from step 2>
   STORAGE_PUBLIC_URL=<from step 2>
   ```

5. Deploy. Railway will build the Docker image (takes a few minutes the first
   time — it's downloading headless Chrome during the build).
6. Once it's live, Railway gives you a URL like
   `https://clipforge-production.up.railway.app`. Go back and set `NEXTAUTH_URL`
   to that exact URL, then redeploy (env var changes require a redeploy).

## 5. Create the database tables (one-time)

Install the Railway CLI, link it to your project, then run:

```bash
npm i -g @railway/cli
railway login
railway link
railway run npx prisma db push
```

This creates all the tables in your new Postgres database. You only need to do
this once (and again any time the schema changes).

## 6. Point Stripe's webhook at your live URL

1. In your [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks),
   click **Add endpoint**.
2. URL: `https://<your-railway-url>/api/stripe/webhook`
3. Select events: `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copy the **Signing secret** it gives you, set it as `STRIPE_WEBHOOK_SECRET`
   in Railway, redeploy.

## 7. Test it

Visit your live URL, register an account, run one script-to-video generation
end to end, and confirm the video actually plays (proves storage is wired
correctly) and Stripe checkout works (still test mode — use card `4242 4242
4242 4242`).

## Later, not blocking launch

- **Custom domain**: point it at Railway in their dashboard, update
  `NEXTAUTH_URL` and the Stripe webhook URL to match.
- **Stripe live mode**: requires business verification in the Stripe dashboard
  (identity, bank account). Swap `STRIPE_SECRET_KEY`/`STRIPE_PRICE_*` for live
  values and create a second webhook endpoint for live mode once ready to
  actually charge people.
- **Error monitoring** (Sentry), **rate limiting**, **password reset flow**,
  **Terms of Service / Privacy Policy** — see the punch list from our earlier
  conversation.
