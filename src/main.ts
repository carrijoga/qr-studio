import QRCodeStyling, { type Options } from "qr-code-styling";
import "./style.css";
import { buildContent, geometry, printWarnings } from "./content";
import { loadLogo, optimizeLogo, saveLogo, type Logo } from "./logo";
import { buildShareUrl, clearShareHash, hasSharedHash, readShareHash, type Shared } from "./share";
import { PRESETS, hasSavedState, loadState, saveState, type State, type Style } from "./state";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const form = $<HTMLFormElement>("#settings");
const previewCard = $<HTMLDivElement>(".preview-card");
const preview = $<HTMLDivElement>("#preview");
const statusEl = $<HTMLParagraphElement>("#status");
const qrMeta = $<HTMLParagraphElement>("#qr-meta");
const warningsEl = $<HTMLUListElement>("#warnings");
const printImg = $<HTMLImageElement>("#print-img");
const printMeta = $<HTMLParagraphElement>("#print-meta");
const contentMeta = $<HTMLParagraphElement>("#content-meta");
const fileNameInput = $<HTMLInputElement>("#fileName");
const logoInput = form.elements.namedItem("logo") as HTMLInputElement;
const logoLabel = $<HTMLSpanElement>("#logo-label");
const logoRemove = $<HTMLButtonElement>("#logo-remove");
const presetReset = $<HTMLButtonElement>("#preset-reset");
const eclSelect = form.elements.namedItem("ecl") as HTMLSelectElement;
const transparentInput = form.elements.namedItem("transparentBg") as HTMLInputElement;
const bgColorInput = form.elements.namedItem("bgColor") as HTMLInputElement;
const buttons = {
  png: $<HTMLButtonElement>("#dl-png"),
  svg: $<HTMLButtonElement>("#dl-svg"),
  copy: $<HTMLButtonElement>("#copy"),
  test: $<HTMLButtonElement>("#test"),
  share: $<HTMLButtonElement>("#share"),
};

const STYLE_KEYS = ["dotColor", "bgColor", "dotType", "cornerSquareType", "cornerDotType"] as const;
const NUMBER_KEYS = new Set(["size", "marginPct", "logoSize", "printCm"]);
const PRESET_NAMES = { wedding: "Wedding Sage", minimal: "Minimal Black" } as const;

const state: State = loadState();
let logo: Logo | null = loadLogo();
let logoNotice: string | null = null;
let qr: QRCodeStyling | null = null;
let lastGoodOptions: Partial<Options> | null = null;
let currentLink: string | null = null;
let currentData: string | null = null;
let renderId = 0;
let printUrl: string | null = null;

/* ---------- Form <-> state ---------- */

function setField(name: string, value: string | number) {
  const el = form.elements.namedItem(name) ?? document.querySelector(`[name="${name}"]`);
  if (el instanceof RadioNodeList) el.value = String(value);
  else if (el instanceof HTMLInputElement && el.type === "radio")
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => (r.checked = r.value === String(value)));
  else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    el.value = String(value);
}

function applyStyle(style: Style) {
  state.style = { ...style };
  for (const key of STYLE_KEYS) setField(key, state.style[key]);
}

function hydrateForm() {
  for (const key of ["contentType", "url", "phone", "message", "text", "preset", "size", "marginPct", "logoSize", "ecl", "printCm"] as const)
    setField(key, state[key]);
  for (const key of STYLE_KEYS) setField(key, state.style[key]);
  fileNameInput.value = state.fileName;
  transparentInput.checked = state.transparentBg;
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const name = el.name;
  if (!name || name === "logo") return;

  if (name === "preset") {
    state.preset = el.value as State["preset"];
    if (state.preset !== "custom") {
      state.basePreset = state.preset;
      applyStyle(PRESETS[state.preset]);
    }
  } else if ((STYLE_KEYS as readonly string[]).includes(name)) {
    (state.style as unknown as Record<string, string>)[name] = el.value;
    state.preset = "custom";
    setField("preset", "custom");
  } else if (name === "transparentBg") {
    state.transparentBg = el.checked;
  } else if (name === "fileName") {
    state.fileName = el.value;
    saveState(state);
    return;
  } else if (name in state) {
    (state as unknown as Record<string, unknown>)[name] = NUMBER_KEYS.has(name) ? Number(el.value) : el.value;
  }
  scheduleRender();
}

presetReset.addEventListener("click", () => {
  state.preset = state.basePreset;
  setField("preset", state.preset);
  applyStyle(PRESETS[state.basePreset]);
  scheduleRender();
});

/* ---------- QR rendering ---------- */

/** qr-code-styling encodes each char as one byte; feed it UTF-8 bytes so accents/emoji survive. */
function toUtf8ByteString(text: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(text)) out += String.fromCharCode(b);
  return out;
}

const marginPx = () => Math.round((state.size * state.marginPct) / 100);

function buildOptions(data: string, style: Style): Partial<Options> {
  return {
    type: "svg",
    width: state.size,
    height: state.size,
    margin: marginPx(),
    data: toUtf8ByteString(data),
    image: logo?.data ?? undefined,
    qrOptions: { errorCorrectionLevel: logo ? "H" : state.ecl },
    imageOptions: { hideBackgroundDots: true, imageSize: state.logoSize, margin: Math.round(state.size / 200) },
    dotsOptions: { type: style.dotType, color: style.dotColor },
    cornersSquareOptions: { type: style.cornerSquareType, color: style.dotColor },
    cornersDotOptions: { type: style.cornerDotType, color: style.dotColor },
    // An empty color makes qr-code-styling skip the background <rect>; the margin stays as empty space.
    backgroundOptions: { color: state.transparentBg ? "" : style.bgColor },
  };
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    if (renderQueued) render();
  });
}

function setStatus(message: string, kind: "ok" | "warn" | "error" = "ok") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function setValid(valid: boolean) {
  preview.classList.toggle("stale", !valid);
  printImg.classList.toggle("stale", !valid);
  buttons.png.disabled = buttons.svg.disabled = buttons.copy.disabled = !valid;
  buttons.test.disabled = !valid || !currentLink;
  if (!valid) {
    qrMeta.textContent = "";
    warningsEl.replaceChildren();
    printMeta.textContent = "";
  }
}

function render() {
  renderQueued = false;
  renderId++;
  saveState(state);
  syncUi();

  const content = buildContent(state);
  if (!content.ok) {
    currentLink = currentData = null;
    setValid(false);
    setStatus(content.error, "error");
    contentMeta.textContent = "";
    return;
  }

  const options = buildOptions(content.data, state.style);
  try {
    if (!qr) {
      qr = new QRCodeStyling(options);
      qr.append(preview);
    } else {
      qr.update(options);
    }
  } catch (err) {
    // Usually "code length overflow": restore the last valid code so the preview isn't blank.
    if (qr && lastGoodOptions) qr.update(lastGoodOptions);
    currentLink = currentData = null;
    setValid(false);
    const overflow = String(err).includes("overflow");
    setStatus(
      overflow
        ? "Conteúdo longo demais para um QR Code. Encurte o texto ou reduza a correção de erros."
        : "Não foi possível gerar o QR Code com essas configurações.",
      "error",
    );
    return;
  }

  lastGoodOptions = options;
  currentLink = content.link;
  currentData = content.data;
  setValid(true);

  contentMeta.textContent =
    state.contentType === "whatsapp"
      ? `${content.data.length} caracteres no link`
      : `${new TextEncoder().encode(content.data).length} bytes codificados`;

  const modules = qr._qr?.getModuleCount() ?? 0;
  const g = geometry(modules, state.size, marginPx(), state.printCm);
  const fmt1 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  qrMeta.textContent = `${modules} × ${modules} módulos · versão ${(modules - 17) / 4} · margem de ${fmt1(g.quietModules)} módulos`;
  printMeta.textContent =
    `Módulo de ${g.moduleMm.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mm · ` +
    `${Math.round(state.size / (state.printCm / 2.54))} dpi neste tamanho. A escala na tela é aproximada.`;

  const warnings = printWarnings(g, state.printCm, state.style.dotColor, state.style.bgColor, state.transparentBg);
  if (logoNotice) warnings.push(logoNotice);
  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      return li;
    }),
  );
  setStatus(`Pronto · ${state.size} × ${state.size} px`);
  void updatePrintPreview(renderId);
}

/** Shows the exact SVG that will be exported, at physical size. */
async function updatePrintPreview(id: number) {
  try {
    const blob = await getSvgBlob();
    if (id !== renderId) return;
    if (printUrl) URL.revokeObjectURL(printUrl);
    printUrl = URL.createObjectURL(blob);
    printImg.src = printUrl;
  } catch {
    // Preview-only: export reports its own errors.
  }
}

function syncUi() {
  for (const panel of form.querySelectorAll<HTMLElement>("[data-show]"))
    panel.hidden = panel.dataset.show !== state.contentType;
  for (const label of form.querySelectorAll<HTMLElement>("[data-color-label]"))
    label.textContent = state.style[label.dataset.colorLabel as "dotColor" | "bgColor"].toUpperCase();
  $("#size-out").textContent = `${state.size} px`;
  $("#margin-out").textContent = `${state.marginPct}%`;
  $("#logoSize-out").textContent = `${Math.round(state.logoSize * 100)}%`;
  form.querySelector<HTMLElement>("[data-logo-only]")!.hidden = !logo;
  logoRemove.hidden = !logo;
  logoLabel.textContent = logo?.name ?? "Escolher imagem";
  eclSelect.disabled = !!logo;
  eclSelect.value = logo ? "H" : state.ecl;
  $("#ecl-hint").hidden = !logo;
  buttons.test.hidden = state.contentType === "text";
  buttons.copy.textContent = state.contentType === "text" ? "Copiar texto" : "Copiar link";
  const name = PRESET_NAMES[state.basePreset];
  presetReset.textContent = `Restaurar ${name}`;
  presetReset.disabled = state.preset === state.basePreset;
  preview.classList.toggle("transparent", state.transparentBg);
  printImg.classList.toggle("transparent", state.transparentBg);
  bgColorInput.disabled = state.transparentBg;
  printImg.style.width = printImg.style.height = `${state.printCm}cm`;
}

/* ---------- Logo ---------- */

logoInput.addEventListener("change", async () => {
  const file = logoInput.files?.[0];
  logoInput.value = "";
  if (!file) return;
  try {
    logo = await optimizeLogo(file);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Não foi possível ler a imagem.", "error");
    return;
  }
  logoNotice = saveLogo(logo) ? null : "Logo em uso, mas não foi salvo: armazenamento do navegador cheio.";
  scheduleRender();
});

logoRemove.addEventListener("click", () => {
  logo = null;
  logoNotice = null;
  saveLogo(null);
  scheduleRender();
});

/* ---------- Export ---------- */

function safeFileName(): string {
  const cleaned = state.fileName.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.(png|svg)$/i, "");
  return cleaned || "qr-code";
}

function downloadBlob(blob: Blob, ext: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function getSvgBlob(): Promise<Blob> {
  const blob = await qr!.getRawData("svg");
  if (!(blob instanceof Blob)) throw new Error("SVG vazio");
  return blob;
}

/** Rasterizes the exact SVG shown in the preview, so PNG and SVG are always identical. */
async function svgToPng(svg: Blob, size: number): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG vazio"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportFile(button: HTMLButtonElement, ext: "png" | "svg") {
  // Apply any edit still waiting for the next frame, so the file matches what's on screen.
  if (renderQueued) render();
  if (button.disabled || !currentData) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando…";
  try {
    const svg = await getSvgBlob();
    downloadBlob(ext === "svg" ? svg : await svgToPng(svg, state.size), ext);
  } catch {
    setStatus("Falha ao exportar. Tente novamente.", "error");
  } finally {
    button.textContent = label;
    button.disabled = !currentData;
  }
}

buttons.svg.addEventListener("click", () => exportFile(buttons.svg, "svg"));
buttons.png.addEventListener("click", () => exportFile(buttons.png, "png"));

buttons.copy.addEventListener("click", async () => {
  const value = currentLink ?? currentData;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const label = buttons.copy.textContent;
    buttons.copy.textContent = "Copiado ✓";
    setTimeout(() => (buttons.copy.textContent = label), 1400);
  } catch {
    setStatus("Não foi possível copiar. Copie manualmente.", "error");
  }
});

buttons.test.addEventListener("click", () => {
  if (currentLink) window.open(currentLink, "_blank", "noopener,noreferrer");
});

/* ---------- Share link ---------- */

/** Above this, some chat apps may truncate the link (only happens with a logo). */
const LONG_LINK_CHARS = 8000;

buttons.share.addEventListener("click", async () => {
  if (renderQueued) render();
  const label = buttons.share.textContent;
  buttons.share.disabled = true;
  try {
    const url = await buildShareUrl(state, logo);
    await navigator.clipboard.writeText(url);
    buttons.share.textContent = "Link copiado ✓";
    setTimeout(() => (buttons.share.textContent = label), 1400);
    if (url.length > LONG_LINK_CHARS)
      setStatus(
        `Link copiado (${Math.round(url.length / 1024)} KB, inclui o logo). Alguns apps de mensagem cortam links longos.`,
        "warn",
      );
  } catch {
    setStatus("Não foi possível gerar ou copiar o link de compartilhamento.", "error");
  } finally {
    buttons.share.disabled = false;
  }
});

function sameAsCurrent(shared: Shared): boolean {
  return JSON.stringify(shared.state) === JSON.stringify(state) && shared.logo?.data === logo?.data;
}

/** Applies a #s=… link. Asks first when it would replace a different saved configuration. */
async function openSharedLink(hasOwnConfig: boolean): Promise<void> {
  if (!hasSharedHash()) return;
  const shared = await readShareHash();
  clearShareHash();
  if (!shared) {
    setStatus("Link de compartilhamento inválido ou corrompido.", "error");
    return;
  }
  if (sameAsCurrent(shared)) return;
  if (hasOwnConfig && !confirm("Este link traz um QR Code compartilhado. Substituir as configurações salvas neste navegador?"))
    return;
  Object.assign(state, shared.state);
  logo = shared.logo;
  logoNotice = saveLogo(logo) ? null : "Logo em uso, mas não foi salvo: armazenamento do navegador cheio.";
  hydrateForm();
  render();
}

/* ---------- Boot ---------- */

form.addEventListener("input", onInput);
previewCard.addEventListener("input", onInput);
form.addEventListener("submit", (e) => e.preventDefault());
// Pasting a shared link into a tab that already has the app open only changes the hash.
window.addEventListener("hashchange", () => void openSharedLink(true));

// Checked before the first render, which saves the defaults.
const hadSavedConfig = hasSavedState();
hydrateForm();
render();
void openSharedLink(hadSavedConfig);
