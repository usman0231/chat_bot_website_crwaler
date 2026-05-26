import { toast } from "sonner";

import { clearAuth, getAuthToken } from "@/lib/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export type BotStatus = "training" | "ready" | "failed";
export type BotStage =
  | "queued"
  | "crawling"
  | "embedding"
  | "indexing"
  | "done";
export type MatchQuality = "strong" | "weak" | "none";

export interface CreateBotPayload {
  website_url: string;
  website_name: string;
  max_pages?: number | null;
}

export interface CreateBotResponse {
  bot_id: string;
  status: "training";
  website_name: string;
}

export interface StatusResponse {
  bot_id: string;
  website_name: string;
  status: BotStatus;
  stage: BotStage | null;
  pages_crawled: number | null;
  pages_total: number | null;
  pages: number | null;
  chunks: number | null;
  elapsed_seconds: number | null;
  error: string | null;
  created_at: string | null;
  suggested_questions?: string[];
  voice_id?: string | null;
}

export interface ChatResponse {
  answer: string;
  sources: string[];
  in_scope: boolean;
  match_quality: MatchQuality;
}

export interface ChatHistoryMessage {
  role: "user" | "bot";
  content: string;
}

export interface BotSummary {
  bot_id: string;
  website_url: string;
  website_name: string;
  status: BotStatus;
  pages: number | null;
  chunks: number | null;
  created_at: string | null;
  error: string | null;
  user_id?: string | null;
  shared?: boolean;
}

export interface SourcePage {
  url: string;
  title: string;
  chunk_count: number;
}

export interface SourcesResponse {
  bot_id: string;
  sources: SourcePage[];
}

export interface DeleteBotResponse {
  bot_id: string;
  deleted: boolean;
}

export interface RecrawlResponse {
  bot_id: string;
  status: "training";
}

export interface UpdateQuestionsResponse {
  bot_id: string;
  questions: string[];
}

export interface RegenerateQuestionsResponse {
  bot_id: string;
  questions: string[];
}

export interface ApiKeyResponse {
  api_key: string;
  masked: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (API_KEY) headers.set("X-API-Key", API_KEY);
  return headers;
}

let sessionExpiredFlag = false;

function handle401(): void {
  if (sessionExpiredFlag) return;
  sessionExpiredFlag = true;
  try {
    clearAuth();
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    try {
      toast.error("Session expired, please log in again.");
    } catch {
      /* ignore */
    }
    const here = window.location.pathname;
    // Only redirect if we're inside the app — auth pages handle their own flow.
    if (!here.startsWith("/login") && !here.startsWith("/signup")) {
      window.location.href = "/login";
    }
  }
  // Allow another toast after a brief debounce window.
  setTimeout(() => {
    sessionExpiredFlag = false;
  }, 2000);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildAuthHeaders(init.headers);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new ApiError(0, msg);
  }

  if (res.status === 401) {
    handle401();
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string; message?: string };
      message = data.detail ?? data.message ?? message;
    } catch {
      // ignore body parse failure
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createBot(payload: CreateBotPayload): Promise<CreateBotResponse> {
  return request<CreateBotResponse>("/bot/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getBotStatus(botId: string): Promise<StatusResponse> {
  return request<StatusResponse>(`/bot/${botId}/status`);
}

export function chatBot(
  botId: string,
  message: string,
  history: ChatHistoryMessage[] = [],
): Promise<ChatResponse> {
  return request<ChatResponse>(`/bot/${botId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

export async function chatBotStream(
  botId: string,
  message: string,
  history: ChatHistoryMessage[] = [],
  signal?: AbortSignal,
): Promise<Response> {
  const headers = buildAuthHeaders();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/bot/${botId}/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, history }),
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new ApiError(0, msg);
  }

  if (res.status === 401) {
    handle401();
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let detail = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  return res;
}

export async function listBots(): Promise<BotSummary[]> {
  const res = await request<{ bots: BotSummary[] } | BotSummary[]>("/bots");
  return Array.isArray(res) ? res : res.bots;
}

export function deleteBot(botId: string): Promise<DeleteBotResponse> {
  return request<DeleteBotResponse>(`/bot/${botId}`, { method: "DELETE" });
}

export function getBotSources(botId: string): Promise<SourcesResponse> {
  return request<SourcesResponse>(`/bot/${botId}/sources`);
}

export function recrawlBot(botId: string): Promise<RecrawlResponse> {
  return request<RecrawlResponse>(`/bot/${botId}/recrawl`, { method: "POST" });
}

export function updateBotQuestions(
  botId: string,
  questions: string[],
): Promise<UpdateQuestionsResponse> {
  return request<UpdateQuestionsResponse>(`/bot/${botId}/questions`, {
    method: "PUT",
    body: JSON.stringify({ questions }),
  });
}

export function regenerateBotQuestions(
  botId: string,
): Promise<RegenerateQuestionsResponse> {
  return request<RegenerateQuestionsResponse>(
    `/bot/${botId}/questions/regenerate`,
    { method: "POST" },
  );
}

export interface UpdateVoiceResponse {
  bot_id: string;
  voice_id: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  gender?: string;
}

export async function listVoices(): Promise<VoiceOption[]> {
  const res = await request<{ voices: VoiceOption[] }>("/voice/voices");
  return res.voices ?? [];
}

export function updateBotVoice(
  botId: string,
  voiceId: string,
): Promise<UpdateVoiceResponse> {
  return request<UpdateVoiceResponse>(`/bot/${botId}/voice`, {
    method: "PUT",
    body: JSON.stringify({ voice_id: voiceId }),
  });
}

export function voicePreviewUrl(voiceId: string, text: string): string {
  const params = new URLSearchParams({ voice_id: voiceId, text });
  const token = getAuthToken();
  if (token) params.set("token", token);
  return `${API_BASE_URL}/voice/preview?${params.toString()}`;
}

export async function fetchVoicePreview(
  voiceId: string,
  text: string,
): Promise<Blob> {
  const headers = buildAuthHeaders();
  // Don't send JSON content-type for a GET that returns binary.
  headers.delete("Content-Type");
  const res = await fetch(voicePreviewUrl(voiceId, text), { headers });
  if (res.status === 401) {
    handle401();
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    let detail = `Voice preview failed (${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return await res.blob();
}

export function callWebSocketUrl(botId: string): string {
  const httpBase = API_BASE_URL;
  const wsBase = httpBase.replace(/^http/i, (m) =>
    m.toLowerCase() === "https" ? "wss" : "ws",
  );
  const params = new URLSearchParams();
  const token = getAuthToken();
  if (token) params.set("token", token);
  else if (API_KEY) params.set("api_key", API_KEY);
  const qs = params.toString();
  return `${wsBase}/ws/call/${encodeURIComponent(botId)}${qs ? `?${qs}` : ""}`;
}

export function getMyApiKey(): Promise<ApiKeyResponse> {
  return request<ApiKeyResponse>("/auth/api-key");
}

export function rotateMyApiKey(): Promise<ApiKeyResponse> {
  return request<ApiKeyResponse>("/auth/api-key/rotate", { method: "POST" });
}

export interface PortalResponse {
  url: string;
}

export interface PaymentIntentResponse {
  client_secret: string;
  subscription_id: string;
  publishable_key: string;
  tier: "pro" | "enterprise";
  amount: number;
  currency: string;
}

export function createPaymentIntent(
  tier: "pro" | "enterprise",
): Promise<PaymentIntentResponse> {
  return request<PaymentIntentResponse>("/stripe/payment/create-intent", {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
}

export interface ConfirmPaymentResponse {
  tier: string;
  status: string;
}

export function confirmPayment(
  subscriptionId: string,
): Promise<ConfirmPaymentResponse> {
  return request<ConfirmPaymentResponse>("/stripe/payment/confirm", {
    method: "POST",
    body: JSON.stringify({ subscription_id: subscriptionId }),
  });
}

export function createBillingPortal(): Promise<PortalResponse> {
  return request<PortalResponse>("/stripe/portal/create", {
    method: "POST",
  });
}

export const api = {
  baseUrl: API_BASE_URL,
  createBot,
  getBotStatus,
  chatBot,
  chatBotStream,
  listBots,
  deleteBot,
  getBotSources,
  recrawlBot,
  updateBotQuestions,
  regenerateBotQuestions,
  updateBotVoice,
  fetchVoicePreview,
  listVoices,
  getMyApiKey,
  rotateMyApiKey,
  createPaymentIntent,
  confirmPayment,
  createBillingPortal,
};
