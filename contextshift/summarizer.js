const NIM_SYSTEM_PROMPT = `
You are ContextShift, an AI conversation compressor specialized in handoff paragraphs.

Write a single dense paragraph (100–180 words) that gives a brand-new AI assistant everything it needs to continue this conversation seamlessly — with zero re-reading of the original.

Structure the paragraph in this exact order:
1. Domain + topic + how technical it is (1 sentence)
2. What the user is trying to accomplish, and everything that was established, built, or decided — include ALL specific details verbatim: exact file names, API endpoints, error messages, model names, function names, variable names, values, and decisions (2–4 sentences)
3. Any blockers, constraints, or open questions that came up (1 sentence, skip if none)
4. Where the conversation ended and the user's exact next request (1 sentence)

Rules:
- Prose only — no bullet points, no headers, no markdown
- Third-person voice: "The user is building... The assistant explained... It was decided that..."
- Never paraphrase specific technical identifiers — reproduce them exactly
- If code was central, name the key function, file, or snippet inline in backticks
- 100–180 words — dense but complete
- Begin directly with the paragraph — no preamble like "Here is a summary"
`.trim();

function buildCustomSystemPrompt(customFocus) {
  return NIM_SYSTEM_PROMPT + `\n\nSPECIAL INSTRUCTION: The user wants the paragraph to focus specifically on: "${customFocus}". Emphasize details related to this topic. If the conversation did not cover it, note that briefly at the end of the paragraph.`.trim();
}

function formatConversationForNIM(messages, maxChars = 12000) {
  let raw = messages.map((m, i) =>
    `[${i + 1}] ${m.role.toUpperCase()}: ${m.content.trim()}`
  ).join("\n\n");
  if (raw.length > maxChars) {
    raw = "...[earlier messages trimmed for length]...\n\n" + raw.slice(raw.length - maxChars);
  }
  return raw;
}

async function callNIMSummarizer({ messages, mode, customFocus, config }) {
  const { NIM_API_KEY, NIM_ENDPOINT, NIM_MODEL, MAX_TOKENS_SUMMARY, MAX_TOKENS_CUSTOM, TEMPERATURE, TOP_P, MAX_INPUT_CHARS } = config;

  if (!NIM_API_KEY || NIM_API_KEY.includes("PASTE-YOUR-KEY")) {
    return { success: false, reason: "no_key", fallback: extractiveSummarize(messages) };
  }

  const conversationText = formatConversationForNIM(messages, MAX_INPUT_CHARS);
  const isCustom = mode === "custom" && customFocus?.trim().length > 0;
  const systemPrompt = isCustom ? buildCustomSystemPrompt(customFocus) : NIM_SYSTEM_PROMPT;
  const maxTokens = isCustom ? MAX_TOKENS_CUSTOM : MAX_TOKENS_SUMMARY;

  const body = {
    model: NIM_MODEL,
    temperature: TEMPERATURE,
    top_p: TOP_P,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Here is the conversation to analyze:\n\n${conversationText}` }
    ]
  };

  try {
    const response = await fetch(NIM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NIM_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 429) return { success: false, reason: "rate_limit", fallback: extractiveSummarize(messages) };
      if (response.status === 401) return { success: false, reason: "bad_key", fallback: extractiveSummarize(messages) };
      const err = await response.text();
      return { success: false, reason: "api_error", error: err, fallback: extractiveSummarize(messages) };
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim();
    if (!summary) return { success: false, reason: "empty_response", fallback: extractiveSummarize(messages) };
    return { success: true, summary };

  } catch (err) {
    return { success: false, reason: "network_error", error: err.message, fallback: extractiveSummarize(messages) };
  }
}

function extractiveSummarize(messages) {
  if (!messages || messages.length === 0) return "No conversation found.";
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const firstUser = userMessages[0]?.content?.trim() || "";
  const lastUser = userMessages[userMessages.length - 1]?.content?.trim() || "";
  const longestAssistant = assistantMessages.sort((a, b) => b.content.length - a.content.length)[0]?.content?.trim() || "";
  const hadShift = userMessages.length > 3 && lastUser.slice(0, 50).toLowerCase() !== firstUser.slice(0, 50).toLowerCase();

  const topicHint = firstUser.split(" ").slice(0, 12).join(" ");
  const shiftNote = hadShift ? ` The conversation evolved, ending with: "${lastUser.slice(0, 100)}${lastUser.length > 100 ? '...' : ''}".` : "";
  const keyResponse = longestAssistant.slice(0, 300) + (longestAssistant.length > 300 ? "..." : "");
  return `This conversation covers the topic: "${topicHint}..." across ${messages.length} messages. The user's goal was: ${firstUser.slice(0, 150)}${firstUser.length > 150 ? "..." : ""}. The assistant's key response: ${keyResponse}${shiftNote} The user's last request was: "${lastUser.slice(0, 200)}${lastUser.length > 200 ? "..." : ""}". (Note: this is a local fallback summary — add your NVIDIA NIM API key in ContextShift Settings for full AI-compressed handoffs.)`;

---
⚠️ *Auto-summarized locally — no NIM key configured.*`;
}

function wrapForInjection(nimSummary, sourcePlatform, targetPlatform) {
  const names = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity", grok: "Grok" };
  return `[ContextShift: transferred from ${names[sourcePlatform] || sourcePlatform}]\n\nI'm continuing a conversation from ${names[sourcePlatform] || sourcePlatform}. Here's the full context brief — please read it and pick up exactly where we left off.\n\n${nimSummary}\n\n---\nReady to continue. What should we do next?`;
}
