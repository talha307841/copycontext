const CONTEXTSHIFT_CONFIG = {
  NIM_API_KEY: "nvapi-PASTE-YOUR-KEY-HERE",
  NIM_ENDPOINT: "https://integrate.api.nvidia.com/v1/chat/completions",
  NIM_MODEL: "meta/llama-3.2-3b-instruct",
  MAX_TOKENS_SUMMARY: 1200,  // Enough for rich decisions list + context field
  MAX_TOKENS_CUSTOM: 1400,   // Slightly more for custom focus instructions
  TEMPERATURE: 0.1,          // Override — deterministic output for structured YAML
  TOP_P: 0.75,               // Override — tighter sampling
  MAX_INPUT_CHARS: 24000,    // Capture early messages where schemas are often pasted
};
