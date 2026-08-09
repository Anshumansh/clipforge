export interface LanguageOption {
  code: string;
  label: string;
  // Real Microsoft Edge neural voice names (the free TTS provider) --
  // OpenAI's TTS API has no per-language voice selection of its own, it
  // infers pronunciation from the input text, so these only matter for the
  // Edge fallback/default path. If a specific voice ID turns out to be
  // stale (Microsoft does retire/rename these occasionally), synthesis
  // fails closed to a silent mocked voiceover rather than crashing the
  // render -- see synthesizeVoiceover's existing fallback chain.
  maleVoice: string;
  femaleVoice: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", maleVoice: "en-US-GuyNeural", femaleVoice: "en-US-JennyNeural" },
  { code: "es", label: "Spanish", maleVoice: "es-ES-AlvaroNeural", femaleVoice: "es-ES-ElviraNeural" },
  { code: "fr", label: "French", maleVoice: "fr-FR-HenriNeural", femaleVoice: "fr-FR-DeniseNeural" },
  { code: "de", label: "German", maleVoice: "de-DE-ConradNeural", femaleVoice: "de-DE-KatjaNeural" },
  { code: "pt", label: "Portuguese", maleVoice: "pt-BR-AntonioNeural", femaleVoice: "pt-BR-FranciscaNeural" },
  { code: "it", label: "Italian", maleVoice: "it-IT-DiegoNeural", femaleVoice: "it-IT-ElsaNeural" },
  { code: "hi", label: "Hindi", maleVoice: "hi-IN-MadhurNeural", femaleVoice: "hi-IN-SwaraNeural" },
  { code: "ja", label: "Japanese", maleVoice: "ja-JP-KeitaNeural", femaleVoice: "ja-JP-NanamiNeural" },
  { code: "ko", label: "Korean", maleVoice: "ko-KR-InJoonNeural", femaleVoice: "ko-KR-SunHiNeural" },
  { code: "zh", label: "Mandarin Chinese", maleVoice: "zh-CN-YunxiNeural", femaleVoice: "zh-CN-XiaoxiaoNeural" },
  { code: "ar", label: "Arabic", maleVoice: "ar-SA-HamedNeural", femaleVoice: "ar-SA-ZariyahNeural" },
  { code: "ru", label: "Russian", maleVoice: "ru-RU-DmitryNeural", femaleVoice: "ru-RU-SvetlanaNeural" },
  { code: "nl", label: "Dutch", maleVoice: "nl-NL-MaartenNeural", femaleVoice: "nl-NL-ColetteNeural" },
  { code: "pl", label: "Polish", maleVoice: "pl-PL-MarekNeural", femaleVoice: "pl-PL-ZofiaNeural" },
  { code: "tr", label: "Turkish", maleVoice: "tr-TR-AhmetNeural", femaleVoice: "tr-TR-EmelNeural" },
  { code: "id", label: "Indonesian", maleVoice: "id-ID-ArdiNeural", femaleVoice: "id-ID-GadisNeural" },
  { code: "vi", label: "Vietnamese", maleVoice: "vi-VN-NamMinhNeural", femaleVoice: "vi-VN-HoaiMyNeural" },
  { code: "th", label: "Thai", maleVoice: "th-TH-NiwatNeural", femaleVoice: "th-TH-PremwadeeNeural" },
  { code: "sv", label: "Swedish", maleVoice: "sv-SE-MattiasNeural", femaleVoice: "sv-SE-SofieNeural" },
  { code: "nb", label: "Norwegian", maleVoice: "nb-NO-FinnNeural", femaleVoice: "nb-NO-PernilleNeural" },
  { code: "fil", label: "Filipino", maleVoice: "fil-PH-AngeloNeural", femaleVoice: "fil-PH-BlessicaNeural" },
];

export function getLanguage(code: string): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
