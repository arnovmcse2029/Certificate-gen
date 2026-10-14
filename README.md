# Offline Certificate Generator

The certificate is generated locally in the browser. Form details are saved to Supabase through an Edge Function only when online. No IndexedDB, local database, or persistent offline queue is used. If offline or a request fails, details stay only in the current page's memory so **Retry Database Submission** can retry with the same idempotency token; closing or refreshing the page discards that unsynchronized submission. Users must submit again if that happens.

The form's numeric **TEAM CODE** field is sent to the existing table's `age` column because that is the current form/table mapping. The form also captures phone number and email address for database records.

## Supabase setup and deployment

The Supabase project and `public.certificate_records` table must already exist. The function uses a server-only service-role credential; the browser uses only the public anon/publishable key. Do not place the service-role key or a database password in `script.js`.

1. Install Node.js/npm if needed, then open PowerShell in this project folder and authenticate/link the Supabase CLI:

   ```powershell
   npx.cmd supabase@latest login
   npx.cmd supabase@latest link --project-ref txhcawhffakceojbfnno
   ```

   The linked project reference is `txhcawhffakceojbfnno`; confirm the API URL in the Supabase dashboard under **Project Settings → API**.

2. Apply the migration. The verified table already has an identity `id` and a text `serial_number` with a unique constraint, so the migration preserves them and advances the identity sequence past existing IDs. It adds the missing idempotency column and unique index.

   ```powershell
   npx.cmd supabase@latest db push --project-ref txhcawhffakceojbfnno
   ```

   Alternatively, paste the SQL from `supabase/migrations/20261013120000_certificate_record_idempotency.sql` into the dashboard's SQL Editor and run it once.

3. Configure the function origin allowlist. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into the Edge Function runtime; the latter is server-only and must never be copied into frontend code. In **Edge Functions → Secrets**, add:

   - `ALLOWED_ORIGINS` = comma-separated exact origins where the website will run, for example `http://localhost:8000,http://127.0.0.1:8000,https://your-site.example`

   Or set this non-secret value from PowerShell after linking:

   ```powershell
   $ProjectRef = "txhcawhffakceojbfnno"
   $AllowedOrigins = "http://localhost:8000,http://127.0.0.1:8000,https://your-site.example"
   npx.cmd supabase@latest secrets set --project-ref $ProjectRef "ALLOWED_ORIGINS=$AllowedOrigins"
   ```

   Replace the sample website origin with the actual hosting origin. Origins include scheme and port and must match exactly. CORS is not authentication; the function accepts public submissions but does not expose record-list or export endpoints.

4. Deploy the function with JWT verification enabled:

   ```powershell
   npx.cmd supabase@latest functions deploy submit-certificate --project-ref txhcawhffakceojbfnno
   ```

   `supabase/config.toml` keeps `verify_jwt = true`. The frontend sends the project's current publishable key in the `apikey` header. The deployed function's CORS preflight and request validation were verified using this key.

   The function validates every field, inserts with server-side service-role credentials, and creates `CERT-<UUID>` serial numbers on the server. The table records the participant name, team code, phone number, email address, and idempotency key; the unique idempotency index makes same-page retries safe. RLS stays enabled; no public SELECT/INSERT policy is needed because the Edge Function performs inserts server-side. Do not expose the service-role key or create a public record-reading policy.

5. In `script.js`, set `CONFIG.supabaseUrl` to the exact Project URL and `CONFIG.supabaseAnonKey` to the project's current publishable key from **Project Settings → API Keys**. The frontend sends this public key in the `apikey` header. The service-role key must never appear in browser code:

   ```js
   supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
   supabaseAnonKey: "sb_publishable_..."
   ```

   Deploy the static website using HTTPS for production.

6. Run locally from this folder:

   ```powershell
   python -m http.server 8000
   ```

   Open <http://localhost:8000>. For local submissions, `http://localhost:8000` (or the exact `127.0.0.1` origin) must be in `ALLOWED_ORIGINS`.

## Verify deployment

- Submit a test form while online. The page should report that the database saved the record and show its serial number.
- A safe request using the configured publishable key reached the function. Direct table access is denied as expected because public table access is revoked. Do not add anon table grants or disable RLS. Never share any secret or service-role key in chat.
- The linked project schema was inspected with the Supabase CLI: `id` is `bigint NOT NULL` and already an identity column, `serial_number` is nullable text with a unique constraint, `full_name` is required text, `age` is nullable integer, `phone_number` and `email_address` record the contact details, and `created_at` defaults to `now()`. The migration synchronizes the identity sequence and adds `idempotency_key`. To inspect the schema again in the Supabase SQL Editor:

  ```sql
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'certificate_records'
  order by ordinal_position;
  ```

  After the migration, the function requires `serial_number`, `full_name`, `age`, `phone_number`, `email_address`, and `idempotency_key`; `id` is generated by its identity sequence and `created_at` uses its existing default.
- In the Supabase SQL Editor, verify only the expected record was added:

  ```sql
  select serial_number, full_name, age, phone_number, email_address, created_at
  from public.certificate_records
  order by created_at desc
  limit 5;
  ```

- For offline behavior, disconnect from the network, submit a form, and confirm the page says the record has **not synchronized**. Reconnect or click **Retry Database Submission** in the same open page; it should save once. No offline record is written to local storage, so refreshing or closing the page before a confirmed save discards it.

The generator and PDF download remain available offline. The Supabase database remains the only persistent record store; the browser holds an unsent submission in memory only until it is saved or the page is closed. No staff listing or CSV export is included. The migration, local CORS origin, and function deployment are complete. Verify a successful save by submitting a test form from the site.

## Adjust name placement

At the top of `script.js`, adjust `CONFIG.nameX`, `nameY`, and `fontSize`. `nameX` is the horizontal position; `nameY` is the text baseline; both are fractions of the template dimensions from `0` to `1`. `fontSize` is a fraction of the image height. Long names shrink automatically to fit `maxWidth`.
