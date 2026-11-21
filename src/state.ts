import type { CornerDotType, CornerSquareType, DotType, ErrorCorrectionLevel } from "qr-code-styling";

export type ContentType = "url" | "whatsapp" | "text";
export type PresetId = "wedding" | "minimal" | "custom";
export type BasePresetId = Exclude<PresetId, "custom">;
export const PRINT_SIZES_CM = [3, 4, 5] as const;
export type PrintCm = (typeof PRINT_SIZES_CM)[number];

export interface Style {
  dotColor: string;
  bgColor: string;
  dotType: DotType;
  cornerSquareType: CornerSquareType;
  cornerDotType: CornerDotType;
}

export interface State {
  contentType: ContentType;
  url: string;
  phone: string;
  message: string;
  text: string;
  preset: PresetId;
  /** Last named preset picked; "Restaurar" returns the style to it. */
  basePreset: BasePresetId;
  style: Style;
  /** Omit the background fill so PNG/SVG exports are transparent (independent of presets). */
  transparentBg: boolean;
  /** Export resolution in px (square). */
  size: number;
  /** Outer margin as a percentage of the size. */
  marginPct: number;
  /** Logo size as a fraction of the QR area (0.1–0.5). */
  logoSize: number;
  ecl: ErrorCorrectionLevel;
  fileName: string;
  /** Physical size used by the print preview and density check. */
  printCm: PrintCm;
}

export const PRESETS: Record<BasePresetId, Style> = {
  wedding: {
    dotColor: "#627A61",
    bgColor: "#FAF9F5",
    dotType: "rounded",
    cornerSquareType: "extra-rounded",
    cornerDotType: "dot",
  },
  minimal: {
    dotColor: "#000000",
    bgColor: "#FFFFFF",
    dotType: "rounded",
    cornerSquareType: "square",
    cornerDotType: "square",
  },
};

export const DEFAULT_STATE: State = {
  contentType: "whatsapp",
  url: "https://",
  phone: "+55 16 99328-0760",
  message:
    "Olá, Vivian! Tudo bem? 💚\n" +
    "Ganhei um Vale Cuidado dos Pés na raspadinha do casamento da Eveline e do Gabriel! 🎁\n" +
    "Gostaria de agendar meu atendimento e aproveitar esse presente especial.\n" +
    "Você poderia me informar os dias e horários disponíveis?\n" +
    "Muito obrigado(a)!",
  text: "",
  preset: "wedding",
  basePreset: "wedding",
  style: { ...PRESETS.wedding },
  transparentBg: false,
  size: 2048,
  marginPct: 6,
  logoSize: 0.3,
  ecl: "Q",
  fileName: "qr-code",
  printCm: 4,
};

const STORAGE_KEY = "qr-studio:v1";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ENUMS: Partial<Record<keyof State, readonly unknown[]>> = {
  contentType: ["url", "whatsapp", "text"],
  preset: ["wedding", "minimal", "custom"],
  basePreset: ["wedding", "minimal"],
  ecl: ["L", "M", "Q", "H"],
  printCm: PRINT_SIZES_CM,
};
const STYLE_ENUMS: Record<Exclude<keyof Style, "dotColor" | "bgColor">, readonly string[]> = {
  dotType: ["square", "dots", "rounded", "extra-rounded", "classy"],
  cornerSquareType: ["square", "rounded", "extra-rounded", "dot"],
  cornerDotType: ["square", "rounded", "dot"],
};
/** Same limits as the form controls. */
const RANGES: Partial<Record<keyof State, [number, number]>> = {
  size: [512, 4096],
  marginPct: [2, 15],
  logoSize: [0.15, 0.4],
};

/**
 * Builds a complete State from untrusted data (localStorage or a shared link):
 * keeps only known keys with the right type and allowed values, falling back to defaults.
 */
export function sanitizeState(input: unknown): State {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = structuredClone(DEFAULT_STATE) as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_STATE) as (keyof State)[]) {
    if (key === "style") continue;
    const value = src[key];
    if (typeof value !== typeof DEFAULT_STATE[key]) continue;
    if (ENUMS[key] && !ENUMS[key]!.includes(value)) continue;
    const range = RANGES[key];
    if (range && !(Number.isFinite(value) && (value as number) >= range[0] && (value as number) <= range[1])) continue;
    out[key] = value;
  }
  const style = (src.style && typeof src.style === "object" ? src.style : {}) as Record<string, unknown>;
  const outStyle = out.style as Record<string, unknown>;
  for (const key of ["dotColor", "bgColor"] as const)
    if (typeof style[key] === "string" && HEX_COLOR.test(style[key] as string)) outStyle[key] = style[key];
  for (const [key, allowed] of Object.entries(STYLE_ENUMS))
    if (allowed.includes(style[key] as string)) outStyle[key] = style[key];
  return out as unknown as State;
}

export function hasSavedState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or disabled: preferences just won't persist.
  }
}
