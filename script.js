/* Adjust these values to position and style the name on the template. */
const CONFIG = {
  templateFile: "template.png",
  nameX: 0.5,
  nameY: 0.522,
  fontSize: 0.06,
  maxWidth: 0.7,
  fontFamily: '"Georgia", "Times New Roman", serif',
  fontStyle: "bold",
  color: "#1a1a1a",
  dpi: 300,
  supabaseUrl: "https://txhcawhffakceojbfnno.supabase.co",
  supabaseAnonKey: "sb_publishable_gGEGlQBvDljSp4ran2_xcw_Kwuj5xjA"
};

const form = document.getElementById("certForm");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const message = document.getElementById("message");
const syncMessage = document.getElementById("syncMessage");
const retrySyncBtn = document.getElementById("retrySyncBtn");
const flowerBlast = document.getElementById("flowerBlast");
const canvas = document.getElementById("certificateCanvas");
const fields = ["fullName", "age", "phoneNumber", "emailAddress"]
  .map((id) => document.getElementById(id));

let pdfBlob = null;
let pdfFileName = "";
let formRevision = 0;
let syncInProgress = false;
let pendingSubmission = null;

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function resetResult() {
  pdfBlob = null;
  pdfFileName = "";
  downloadBtn.disabled = true;
}

function setSyncMessage(text, type = "") {
  syncMessage.textContent = text;
  syncMessage.className = `message ${type}`.trim();
}

function playFlowerBlast() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const origin = generateBtn.getBoundingClientRect();
  const symbols = ["🌸", "🌼", "🌺", "🌷", "💮"];
  const fragment = document.createDocumentFragment();
  const flowerCount = 28;

  for (let index = 0; index < flowerCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 100 + Math.random() * Math.min(window.innerWidth * 0.38, 300);
    const flower = document.createElement("span");
    flower.className = "flower-blast__flower";
    flower.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    flower.style.setProperty("--start-x", `${origin.left + origin.width / 2}px`);
    flower.style.setProperty("--start-y", `${origin.top + origin.height / 2}px`);
    flower.style.setProperty("--travel-x", `${Math.cos(angle) * distance}px`);
    flower.style.setProperty("--travel-y", `${Math.sin(angle) * distance}px`);
    flower.style.setProperty("--rotation", `${Math.random() * 540 - 270}deg`);
    flower.style.setProperty("--flower-size", `${18 + Math.random() * 14}px`);
    flower.style.setProperty("--duration", `${1.3 + Math.random() * 0.6}s`);
    flower.style.setProperty("--delay", `${Math.random() * 0.12}s`);
    fragment.appendChild(flower);
  }

  flowerBlast.replaceChildren(fragment);
  window.setTimeout(() => flowerBlast.replaceChildren(), 2200);
}

function getSubmissionsEndpoint() {
  const baseUrl = CONFIG.supabaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl || !CONFIG.supabaseAnonKey.trim()) {
    throw new Error("Supabase is not configured in CONFIG yet.");
  }
  return `${baseUrl}/functions/v1/submit-certificate`;
}

async function sendSubmission(submission) {
  const endpoint = getSubmissionsEndpoint();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const publicKey = CONFIG.supabaseAnonKey.trim();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publicKey
      },
      body: JSON.stringify(submission),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success !== true || typeof result.serialNumber !== "string") {
      const serverMessage = typeof result.error === "string"
        ? result.error
        : typeof result.message === "string"
          ? result.message
          : "";
      const detail = response.status === 401
        ? "Supabase rejected the public API key or bearer JWT. Check that both are current and belong to this project."
        : response.status === 404
          ? "The submit-certificate Edge Function was not found in this project. Deploy it, then try again."
          : serverMessage || `The server rejected the submission (HTTP ${response.status}).`;
      throw new Error(detail);
    }
    return result.serialNumber;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The database request timed out. Retry the submission.");
    }
    if (error instanceof TypeError) {
      throw new Error("The database could not be reached. Check your connection and retry.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function syncPendingSubmission() {
  if (syncInProgress || !pendingSubmission) {
    return;
  }
  syncInProgress = true;
  retrySyncBtn.disabled = true;

  if (!navigator.onLine) {
    retrySyncBtn.hidden = false;
    setSyncMessage(
      "Not synchronized. No details are saved on this device. Reconnect and retry in this tab, or enter the details again later.",
      "pending"
    );
    syncInProgress = false;
    retrySyncBtn.disabled = false;
    return;
  }

  try {
    const serialNumber = await sendSubmission(pendingSubmission);
    pendingSubmission = null;
    retrySyncBtn.hidden = true;
    setSyncMessage(`Record saved to the database. Serial number: ${serialNumber}`, "success");
  } catch (error) {
    console.error("Certificate record submission failed:", error);
    retrySyncBtn.hidden = false;
    setSyncMessage(
      `Not synchronized. No details are saved on this device. ${error.message} Retry in this tab while the form is still open.`,
      "pending"
    );
  } finally {
    syncInProgress = false;
    retrySyncBtn.disabled = false;
  }
}

function validateForm() {
  const [nameField, ageField, phoneField, emailField] = fields;
  const age = ageField.valueAsNumber;
  const phoneNumber = phoneField.value.trim();
  const emailAddress = emailField.value.trim();
  const phonePattern = /^[+()0-9\s-]{7,20}$/;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const fieldErrors = new Map([
    [nameField, nameField.value.trim() ? "" : "Enter the participant's full name."],
    [
      ageField,
      Number.isInteger(age) && age >= 1 && age <= 120
        ? ""
        : "Enter a whole-number age from 1 to 120."
    ],
    [phoneField, phonePattern.test(phoneNumber) ? "" : "Enter a valid phone number."],
    [emailField, emailPattern.test(emailAddress) ? "" : "Enter a valid email address."]
  ]);

  let firstError = "";
  fieldErrors.forEach((error, field) => {
    const invalid = Boolean(error) || !field.checkValidity();
    field.classList.toggle("invalid", invalid);
    if (invalid) {
      field.setAttribute("aria-invalid", "true");
      if (!firstError) {
        firstError = error || `Check the ${field.labels[0].textContent} field.`;
      }
    } else {
      field.removeAttribute("aria-invalid");
    }
  });

  if (firstError) {
    showMessage(firstError, "error");
    return false;
  }
  return true;
}

function loadTemplate() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      const error = new Error(
        `Could not load "${CONFIG.templateFile}". Keep the template image beside index.html and open the page through a local server.`
      );
      error.name = "TemplateLoadError";
      reject(error);
    };
    image.src = CONFIG.templateFile;
  });
}

async function renderCertificate(name) {
  const image = await loadTemplate();
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("The certificate template image has no usable dimensions.");
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser could not create a 2D canvas.");
  }

  context.drawImage(image, 0, 0);

  const maxWidth = canvas.width * CONFIG.maxWidth;
  let fontSize = canvas.height * CONFIG.fontSize;
  if (!(maxWidth > 0) || !(fontSize > 0)) {
    throw new Error("Check the maxWidth and fontSize values in CONFIG.");
  }

  const setFont = () => {
    context.font = `${CONFIG.fontStyle} ${fontSize}px ${CONFIG.fontFamily}`;
  };
  setFont();

  let measuredWidth = context.measureText(name).width;
  for (let attempt = 0; measuredWidth > maxWidth && attempt < 12; attempt += 1) {
    fontSize *= maxWidth / measuredWidth * 0.99;
    setFont();
    measuredWidth = context.measureText(name).width;
  }

  context.fillStyle = CONFIG.color;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(name, canvas.width * CONFIG.nameX, canvas.height * CONFIG.nameY, maxWidth);
  return canvas;
}

async function canvasToPdf(sourceCanvas) {
  if (!Number.isFinite(CONFIG.dpi) || CONFIG.dpi <= 0) {
    throw new Error("The dpi value in CONFIG must be a positive number.");
  }

  const jpegBlob = await new Promise((resolve) => {
    sourceCanvas.toBlob(resolve, "image/jpeg", 0.95);
  });
  if (!jpegBlob) {
    throw new Error("The browser could not encode the certificate image.");
  }
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const encoder = new TextEncoder();
  const pageWidth = (sourceCanvas.width * 72 / CONFIG.dpi).toFixed(4);
  const pageHeight = (sourceCanvas.height * 72 / CONFIG.dpi).toFixed(4);
  const parts = [];
  const objectOffsets = [];
  let byteLength = 0;

  const append = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    byteLength += bytes.length;
  };

  append("%PDF-1.4\n");
  objectOffsets[1] = byteLength;
  append("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objectOffsets[2] = byteLength;
  append("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objectOffsets[3] = byteLength;
  append(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );

  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  objectOffsets[4] = byteLength;
  append(`4 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`);

  objectOffsets[5] = byteLength;
  append(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${sourceCanvas.width} /Height ${sourceCanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  append(jpegBytes);
  append("\nendstream\nendobj\n");

  const xrefOffset = byteLength;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
    xref += `${String(objectOffsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  append(xref);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(parts, { type: "application/pdf" });
}

function sanitizeFileName(name) {
  const safeName = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "_");
  return `${safeName || "Certificate"}_Certificate.pdf`;
}

function handleFormEdit(event) {
  if (!fields.includes(event.target)) {
    return;
  }
  formRevision += 1;
  if (pendingSubmission) {
    pendingSubmission = null;
    retrySyncBtn.hidden = true;
    setSyncMessage("The unsynchronized submission was discarded when the form changed. Generate again to submit the updated details.", "pending");
  }
  event.target.classList.remove("invalid");
  event.target.removeAttribute("aria-invalid");
  resetResult();
  showMessage();
}

form.addEventListener("input", handleFormEdit);
form.addEventListener("change", handleFormEdit);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (generateBtn.disabled) {
    return;
  }
  resetResult();
  if (!validateForm()) {
    return;
  }

  const name = fields[0].value.trim().replace(/\s+/g, " ");
  const generationRevision = formRevision;
  const submission = {
    idempotencyKey: crypto.randomUUID(),
    fullName: name,
    age: Number(fields[1].value),
    phoneNumber: fields[2].value.trim(),
    emailAddress: fields[3].value.trim()
  };
  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";
  showMessage();

  try {
    const renderedCanvas = await renderCertificate(name);
    const generatedPdf = await canvasToPdf(renderedCanvas);
    if (generationRevision !== formRevision) {
      showMessage("The form changed while generating. Generate the certificate again.", "error");
      return;
    }

    pdfBlob = generatedPdf;
    pdfFileName = sanitizeFileName(name);
    downloadBtn.disabled = false;
    playFlowerBlast();
    showMessage("Certificate PDF generated. Your other details are not printed.");
    pendingSubmission = submission;
    await syncPendingSubmission();
  } catch (error) {
    console.error(error);
    showMessage(
      error.name === "TemplateLoadError"
        ? error.message
        : `Could not generate the certificate. ${error.message}`,
      "error"
    );
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Certificate";
  }
});

retrySyncBtn.addEventListener("click", () => syncPendingSubmission());
window.addEventListener("online", () => syncPendingSubmission());

downloadBtn.addEventListener("click", () => {
  if (!pdfBlob) {
    return;
  }

  const downloadUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = pdfFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
});
