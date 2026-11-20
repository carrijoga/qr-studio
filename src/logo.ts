export interface Logo {
  name: string;
  /** Data URL, embedded directly in the exported SVG. */
  data: string;
}

const STORAGE_KEY = "qr-studio:logo";
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Small SVGs stay vector: sharpest result for print. */
const MAX_INLINE_SVG_BYTES = 150 * 1024;
/** At 30% of a 5 cm code, 768 px is ~1300 dpi: plenty for print, small for storage. */
const MAX_SIDE_PX = 768;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Validates the file is a decodable image and shrinks it for storage. Throws a user-facing message. */
export async function optimizeLogo(file: File): Promise<Logo> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Imagem muito grande (máx. 10 MB).");

  const original = await readAsDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await decodeImage(original);
  } catch {
    throw new Error("Não foi possível ler a imagem.");
  }

  if (file.type === "image/svg+xml" && file.size <= MAX_INLINE_SVG_BYTES) {
    return { name: file.name, data: original };
  }

  const w = img.naturalWidth || MAX_SIDE_PX;
  const h = img.naturalHeight || MAX_SIDE_PX;
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);

  // PNG keeps transparency losslessly; WebP (also with alpha) is used when it's clearly smaller.
  const png = canvas.toDataURL("image/png");
  const webp = canvas.toDataURL("image/webp", 0.92);
  const data = webp.startsWith("data:image/webp") && webp.length < png.length * 0.8 ? webp : png;
  return { name: file.name, data };
}

export function loadLogo(): Logo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const logo = JSON.parse(raw) as Logo;
    return typeof logo?.data === "string" && logo.data.startsWith("data:image/") ? logo : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is full or unavailable (the logo still works for this session). */
export function saveLogo(logo: Logo | null): boolean {
  try {
    if (logo) localStorage.setItem(STORAGE_KEY, JSON.stringify(logo));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
