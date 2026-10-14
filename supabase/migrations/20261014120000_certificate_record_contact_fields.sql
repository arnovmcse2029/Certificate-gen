ALTER TABLE public.certificate_records
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS email_address text;
