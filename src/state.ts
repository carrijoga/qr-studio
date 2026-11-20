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

export function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const saved = JSON.parse(raw) as Partial<State>;
    return {
      ...DEFAULT_STATE,
      ...saved,
      style: { ...DEFAULT_STATE.style, ...saved.style },
    };
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
