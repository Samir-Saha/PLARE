# Deploying PLARE

The API goes on **Render**, the website on **Vercel**, and the database is your existing **Supabase** project. All three have free tiers. It takes about 20 minutes, and you do the steps in this order because each one needs a URL from the step before.

| Piece | Service | URL you'll get |
| --- | --- | --- |
| API | Render | `https://plare-api.onrender.com` (or similar) |
| Website | Vercel | `https://plare.vercel.app` (or similar) |
| Database and sign-in | Supabase | already set up |

## 1. Get the database connection string (Supabase)

1. Open your PLARE project in Supabase and click **Connect** at the top.
2. Choose **Session pooler**, not "Direct connection." Render can't reach the direct address.
3. Copy the URI. It looks like `postgresql://postgres.cswawrqsrbmnenhtaytp:[YOUR-PASSWORD]@aws-....pooler.supabase.com:5432/postgres`.
4. Replace `[YOUR-PASSWORD]` with your database password. If you don't have it, reset it under **Project Settings → Database → Reset database password**.

Keep this string private. It gives full access to the database.

## 2. Deploy the API (Render)

1. Sign in at https://render.com with GitHub.
2. Click **New → Blueprint**, pick the **Samir-Saha/PLARE** repo, and confirm. Render reads `render.yaml` from the repo.
3. Render asks for two values:
   - **DATABASE_URL:** the string from step 1.
   - **CORS_ORIGINS:** put `http://localhost:3000` for now. You'll change it in step 4.
4. Click **Apply**. The first build takes a few minutes.
5. Open `https://<your-render-url>/health`. You should see `{"ok":true,...}`.

The app creates its database tables on first start and, with `DEMO_AUTH=true`, adds the fictional demo group.

## 3. Deploy the website (Vercel)

1. Sign in at https://vercel.com with GitHub.
2. Click **Add New → Project** and import **Samir-Saha/PLARE**.
3. Set **Root Directory** to `web`.
4. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` = your Render URL from step 2, with no trailing slash
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://cswawrqsrbmnenhtaytp.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase publishable key (`sb_publishable_...`)
5. Click **Deploy**.

## 4. Connect them

1. **Render:** go to plare-api → **Environment** and set `CORS_ORIGINS` to your Vercel URL, for example `https://plare.vercel.app`. To keep local development working too, separate the two with a comma: `https://plare.vercel.app,http://localhost:3000`. Save, and Render redeploys.
2. **Supabase:** go to Authentication → **URL Configuration**. Set **Site URL** to your Vercel URL, and add `https://plare.vercel.app/**` (your real URL) under Redirect URLs. Keep the localhost entry.
3. **Google Cloud:** go to Google Auth Platform → **Clients** → PLARE. Under **Authorized JavaScript origins**, add your Vercel URL. Don't change the redirect URI.

## 5. Test it

- Open the Vercel URL and click **Enter as a pledge**. If tasks load, the website, API, and database are all connected.
- Click **Continue with Google** with an account on your test-user list.
- **On your phone:** open the URL. On iPhone, tap Share → **Add to Home Screen** in Safari. On Android, tap **Install app** in Chrome.

## Before a demo

- **Wake the API.** Render's free tier sleeps after 15 minutes without traffic, and the first request then takes up to a minute. Open `https://<your-render-url>/health` a few minutes before presenting.
- **Expect lost uploads.** Uploaded photos are stored on Render's temporary disk and are lost when it restarts. That's fine for a demo. For real use, move uploads to Supabase Storage.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| "Can't reach the PLARE server" on the website | `NEXT_PUBLIC_API_URL` is wrong, or the API is still waking up. Check `/health`. |
| Browser console shows a CORS error | `CORS_ORIGINS` on Render doesn't exactly match the Vercel URL. Check `https` and remove any trailing slash. |
| Render build fails on the database | `DATABASE_URL` has `[YOUR-PASSWORD]` still in it, or it's the direct connection instead of the session pooler. |
| Google says `redirect_uri_mismatch` | The Google client's redirect URI must be exactly `https://cswawrqsrbmnenhtaytp.supabase.co/auth/v1/callback`. |
| Google says access blocked | The account isn't on the test-user list (Google Auth Platform → Audience). |
| "Sign in required" right after Google sign-in | `SUPABASE_URL` is missing on Render. |
