export interface ScriptResult {
  title: string;
  script: string;
  sceneKeywords: string[];
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
}

export type BrollScene =
  | { type: "gradient"; from: string; to: string; label: string }
  | { type: "image"; url: string; label: string }
  | { type: "video"; url: string; label: string };
