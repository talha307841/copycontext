const NIM_SYSTEM_PROMPT = `
You are ContextShift, an expert AI conversation analyst and handoff specialist.

Your job: analyze a conversation between a user and an AI assistant, then produce a STRUCTURED HANDOFF BRIEF that lets a brand-new AI instantly understand everything it needs — with zero re-reading required.

You MUST follow this exact output format. Do not deviate:

---

## 🧠 EXTRACT
**Topic(s):** [comma-separated list of the core subjects discussed. Be specific. e.g. "Chrome Extension Manifest V3, NVIDIA NIM CORS issue, icon PNG export"]
**Domain:** [single word category: e.g. "Engineering" / "Design" / "Research" / "Writing" / "Business" / "Math" / "Legal"]
**Depth:** [Beginner / Intermediate / Expert — how technical was the conversation?]
**User goal:** [One sentence — what is the user ultimately trying to accomplish?]

---

## 🔀 CONVERSATION DIVERGENCE
[Describe in 2–4 bullet points how the conversation EVOLVED or SHIFTED. Note any pivots, new directions, corrections, or topic jumps. If it was linear, say so.]
- [First focus]
- [Where it shifted]
- [Any corrections or dead ends]
- [Where it ended up]

---

## 💬 COMPRESSED CONVERSATION
[Compress the full conversation into a tight, information-dense summary. Rules:
- Keep ALL specific details: numbers, names, file names, code snippets, API endpoints, decisions made
- Remove: greetings, filler, repetition, meta-commentary
- Format as flowing paragraph or short labeled sections if multiple topics
- Max 200 words
- Write in third person: "The user asked about X. The assistant explained Y. It was decided that Z."
- If there is code, include the key snippet (max 20 lines) in a code block]

---

## ⚡ CRITICAL FACTS
[Bullet list of ONLY the most important specific facts, decisions, or constraints the next AI MUST know. If there are 8 facts, list all 8.]
- 
- 
- 

---

## 🎯 NEXT STEP
**Immediate ask:** [The exact thing the user needs next — copy their last question/request if possible.]
**Context for next AI:** [One sentence of advice for the receiving AI on how to continue.]

---

RULES:
- Never add preamble like "Here is your summary" — start directly with ## 🧠 EXTRACT
- Never truncate the CRITICAL FACTS section
- Output must be clean markdown — no extra explanation after the last section
`.trim();

function buildCustomSystemPrompt(customFocus) {
  return NIM_SYSTEM_PROMPT + `\n\nSPECIAL INSTRUCTION: The user has asked you to focus specifically on: "${customFocus}"\nEmphasize this topic in your COMPRESSED CONVERSATION and CRITICAL FACTS sections.\nIf the conversation did not cover this topic, say so clearly in the EXTRACT section.`.trim();
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

  return `## 🧠 EXTRACT
**Topic(s):** ${firstUser.split(" ").slice(0, 10).join(" ")}...
**Domain:** Auto-detected (NIM key not configured)
**Depth:** Unknown
**User goal:** ${firstUser.slice(0, 120)}

---

## 🔀 CONVERSATION DIVERGENCE
- Started with: ${firstUser.slice(0, 80)}
${hadShift ? `• Shifted to: ${lastUser.slice(0, 80)}` : "• Conversation stayed on topic throughout"}
- ${messages.length} total messages exchanged

---

## 💬 COMPRESSED CONVERSATION
${longestAssistant.slice(0, 400)}${longestAssistant.length > 400 ? "..." : ""}

---

## ⚡ CRITICAL FACTS
- ${firstUser.slice(0, 120)}
- ${lastUser.slice(0, 120)}
- (Add your NIM API key in Settings for intelligent extraction)

---

## 🎯 NEXT STEP
**Immediate ask:** ${lastUser.slice(0, 200)}
**Context for next AI:** Auto-extracted summary — add NVIDIA NIM key in ContextShift Settings for full AI analysis.

---
⚠️ *Auto-summarized locally — no NIM key configured.*`;
}

function wrapForInjection(nimSummary, sourcePlatform, targetPlatform) {
  const names = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity", grok: "Grok" };
  return `[ContextShift: transferred from ${names[sourcePlatform] || sourcePlatform}]\n\nI'm continuing a conversation from ${names[sourcePlatform] || sourcePlatform}. Here's the full context brief — please read it and pick up exactly where we left off.\n\n${nimSummary}\n\n---\nReady to continue. What should we do next?`;
}
