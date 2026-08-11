export interface ScriptResult {
  title: string;
  script: string;
  sceneKeywords: string[];
  /** Which LLM provider generated this script. "mock" means all providers
   * failed and the system fell back to a template (see mockScript()). */
  provider?: "openai" | "groq" | "mock";
  /** Real token counts from the provider's usage field. Null when mocked or
   * when the provider did not include usage data in its response. */
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface VoiceoverResult {
  audioUrl: string | null;
  durationSec: number;
  words: WordTiming[];
  mocked: boolean;
  /** Which TTS provider synthesized the audio. Undefined for mock results. */
  provider?: "openai" | "edge";
  /** Character count of the input script — basis for TTS cost calculation. */
  characterCount?: number;
}

export type BrollScene =
  | { type: "gradient"; from: string; to: string; label: string }
  | { type: "image"; url: string; label: string }
  | { type: "video"; url: string; label: string };
