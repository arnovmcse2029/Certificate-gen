const corsHeadersBase = {
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

type Submission = {
  idempotencyKey: string;
  fullName: string;
  age: number;
  phoneNumber: string;
  emailAddress: string;
};

type StoredRecord = {
  serial_number: string;
  idempotency_key: string;
  full_name: string;
  age: number;
  phone_number?: string;
  email_address?: string;
  competition?: string;
  competition_date?: string;
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function isValidPhoneNumber(value: string) {
  return /^[+()0-9\s-]{7,20}$/.test(value);
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateSubmission(value: unknown): Submission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fullName = typeof record.fullName === "string" ? record.fullName.trim() : "";
  const phoneNumber = typeof record.phoneNumber === "string" ? record.phoneNumber.trim() : "";
  const emailAddress = typeof record.emailAddress === "string" ? record.emailAddress.trim() : "";
  const idempotencyKey =
    typeof record.idempotencyKey === "string" ? record.idempotencyKey.toLowerCase() : "";

  if (
    fullName.length === 0 ||
    fullName.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(fullName) ||
    !Number.isInteger(record.age) ||
    (record.age as number) < 1 ||
    (record.age as number) > 120 ||
    phoneNumber.length === 0 ||
    phoneNumber.length > 20 ||
    !isValidPhoneNumber(phoneNumber) ||
    emailAddress.length === 0 ||
    emailAddress.length > 255 ||
    !isValidEmailAddress(emailAddress) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(idempotencyKey)
  ) {
    return null;
  }

  return {
    idempotencyKey,
    fullName,
    age: record.age as number,
    phoneNumber,
    emailAddress
  };
}

function sameSubmission(stored: StoredRecord, submission: Submission) {
  return stored.full_name === submission.fullName &&
    stored.age === submission.age &&
    (stored.phone_number ?? "") === submission.phoneNumber &&
    (stored.email_address ?? "") === submission.emailAddress;
}

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { "Prefer": prefer } : {})
  };
}

function databaseRequest(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000)
  });
}

async function findByIdempotencyKey(
  restUrl: string,
  serviceKey: string,
  idempotencyKey: string
): Promise<StoredRecord | null> {
  const query = new URLSearchParams({
    select: "idempotency_key,serial_number,full_name,age,phone_number,email_address",
    idempotency_key: `eq.${idempotencyKey}`,
    limit: "1"
  });
  const response = await databaseRequest(`${restUrl}?${query}`, {
    headers: serviceHeaders(serviceKey)
  });
  if (!response.ok) {
    throw new Error("The database could not check the submission retry key.");
  }

  const records = await response.json();
  return Array.isArray(records) && records.length > 0 ? records[0] as StoredRecord : null;
}

function getAllowedOrigins() {
  return (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : "";
  const corsHeaders = {
    ...corsHeadersBase,
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {})
  };

  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigin) {
      return jsonResponse({ error: "Origin is not allowed." }, 403, corsHeaders);
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Only POST requests are supported." }, 405, corsHeaders);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415, corsHeaders);
  }
  if (origin && !allowedOrigin) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, corsHeaders);
  }
  if (allowedOrigins.length === 0) {
    return jsonResponse({ error: "The function origin allowlist is not configured." }, 500, corsHeaders);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 10_000) {
    return jsonResponse({ error: "The request is too large." }, 413, corsHeaders);
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return jsonResponse({ error: "Send a valid JSON request." }, 400, corsHeaders);
  }
  const chunks: Uint8Array[] = [];
  let bodyLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bodyLength += chunk.value.byteLength;
      if (bodyLength > 10_000) {
        await reader.cancel();
        return jsonResponse({ error: "The request is too large." }, 413, corsHeaders);
      }
      chunks.push(chunk.value);
    }
  } catch {
    return jsonResponse({ error: "Send a valid JSON request." }, 400, corsHeaders);
  }

  const bodyBytes = new Uint8Array(bodyLength);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
  } catch {
    return jsonResponse({ error: "Send a valid JSON request." }, 400, corsHeaders);
  }
  const submission = validateSubmission(body);
  if (!submission) {
    return jsonResponse({ error: "Check the required name, team code, phone number, email address, and retry token." }, 400, corsHeaders);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) {
    return jsonResponse({ error: "Database credentials are not configured on the function." }, 500, corsHeaders);
  }

  const restUrl = `${projectUrl}/rest/v1/certificate_records`;
  try {
    const prior = await findByIdempotencyKey(restUrl, serviceKey, submission.idempotencyKey);
    if (prior) {
      if (!sameSubmission(prior, submission)) {
        return jsonResponse({ error: "This retry token was already used for different form data." }, 409, corsHeaders);
      }
      return jsonResponse({ success: true, serialNumber: prior.serial_number }, 200, corsHeaders);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const serialNumber = `CERT-${crypto.randomUUID().toUpperCase()}`;
      const insertResponse = await databaseRequest(restUrl, {
        method: "POST",
        headers: serviceHeaders(serviceKey, "return=representation"),
        body: JSON.stringify({
          serial_number: serialNumber,
          full_name: submission.fullName,
          age: submission.age,
          phone_number: submission.phoneNumber,
          email_address: submission.emailAddress,
          idempotency_key: submission.idempotencyKey
        })
      });

      if (insertResponse.ok) {
        const inserted = await insertResponse.json();
        if (
          !Array.isArray(inserted) ||
          inserted.length !== 1 ||
          inserted[0].serial_number !== serialNumber
        ) {
          return jsonResponse({ error: "The database did not confirm the inserted record." }, 502, corsHeaders);
        }
        return jsonResponse({ success: true, serialNumber: inserted[0].serial_number }, 201, corsHeaders);
      }

      const databaseError = await insertResponse.json().catch(() => ({}));
      if (insertResponse.status === 409 || databaseError.code === "23505") {
        const duplicateRetry = await findByIdempotencyKey(
          restUrl,
          serviceKey,
          submission.idempotencyKey
        );
        if (duplicateRetry) {
          if (!sameSubmission(duplicateRetry, submission)) {
            return jsonResponse({ error: "This retry token was already used for different form data." }, 409, corsHeaders);
          }
          return jsonResponse({ success: true, serialNumber: duplicateRetry.serial_number }, 200, corsHeaders);
        }
        continue;
      }

      console.error("Certificate record insert failed:", databaseError.code || insertResponse.status);
      return jsonResponse({ error: "The database could not save this record. Retry synchronization." }, 502, corsHeaders);
    }

    return jsonResponse({ error: "A unique certificate serial could not be allocated. Retry synchronization." }, 503, corsHeaders);
  } catch (error) {
    console.error("Certificate submission failed:", error);
    return jsonResponse({ error: "The database could not be reached. Retry synchronization." }, 502, corsHeaders);
  }
}

Deno.serve({ port: Number(Deno.env.get("PORT") || 8000) }, handleRequest);
