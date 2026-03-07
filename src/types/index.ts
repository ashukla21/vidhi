// ─── Chat & Threads ──────────────────────────────────────────────────────────

export interface ChatFolder {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  threads: ChatThread[];
}

export interface ChatThread {
  id: string;
  folderId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt: Date;
}

export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
}

// ─── Astrology Data ───────────────────────────────────────────────────────────

export type Planet =
  | "Sun"
  | "Moon"
  | "Mars"
  | "Mercury"
  | "Jupiter"
  | "Venus"
  | "Saturn"
  | "Rahu"
  | "Ketu";

export type ZodiacSign =
  | "Aries"
  | "Taurus"
  | "Gemini"
  | "Cancer"
  | "Leo"
  | "Virgo"
  | "Libra"
  | "Scorpio"
  | "Sagittarius"
  | "Capricorn"
  | "Aquarius"
  | "Pisces";

export interface PlanetPosition {
  planet: Planet;
  date: string;
  longitude: number;
  sign: ZodiacSign;
  house: number;
  isRetrograde: boolean;
  speed?: number;
}

export interface PlanetaryTrend {
  planet: Planet;
  sign: ZodiacSign;
  entryDate: string;
  exitDate: string;
  durationDays: number;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  positions: Position[];
  lastUpdated: Date;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ChatStreamChunk {
  type: "text" | "tool_start" | "tool_end" | "done" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  error?: string;
}
