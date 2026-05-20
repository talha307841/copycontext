const NIM_SYSTEM_PROMPT = `
You are a conversation compression engine. Extract the minimum conversational context needed for a different AI to continue this conversation seamlessly.

Output ONLY this exact YAML structure. No preamble. No explanation. No markdown fences. Start your response with [ContextShift Handoff] and nothing else before it.

[ContextShift Handoff]
topic: [3-6 word label for what this conversation is about]
domain: [one word: database / coding / travel / shopping / math / writing / legal / research / general]
goal: [what the user is trying to accomplish — max 15 words]
state: [what has been confirmed, created, or established so far — max 15 words]
decisions: [key choices made, comma-separated fragments — max 25 words]
error: [exact error message verbatim if any — else "none"]
next: [the user's last unanswered request — copy as close to verbatim as possible, max 50 words]
skip: [things already tried and failed, or questions already answered — max 15 words]

RULES:
- One line per field — no multi-line values
- Preserve exact identifiers: table names, variable names, file names, API endpoints — never paraphrase
- If nothing relevant for a field, write "none"
- Do NOT include code blocks, schemas, data tables, or lists in this output — they are extracted and appended separately
- Never wrap output in markdown code blocks
`.trim();

function buildCustomSystemPrompt(customFocus) {
  return NIM_SYSTEM_PROMPT + `\n\nADDITIONAL INSTRUCTION: User wants focus on: "${customFocus}". Reflect this in the goal and next fields. If the conversation did not cover this, set next to: "Topic not covered — user wants to discuss: ${customFocus}"`;
}

function detectDomain(messages) {
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const patterns = {
    database: /create\s+table|insert\s+into|update\s+\w+\s+set|select\s+.+from|alter\s+table|drop\s+table|foreign\s+key|primary\s+key|varchar|bigint|\bschema\b|\bmigration\b|\bsql\b|postgres|mysql|sqlite|mongodb/,
    coding:   /function\s+\w+|const\s+\w+\s*=|class\s+\w+\s*\{|\bimport\s+|\bexport\s+|def\s+\w+\s*\(|\.js\b|\.ts\b|\.py\b|\bnpm\s+|\bpip\s+|console\.log|print\(/,
    travel:   /\bhotel\b|\bflight\b|\bairport\b|\bitinerary\b|\bvisa\b|\bpassport\b|\bbooking\b|\bairbnb\b|check.?in|check.?out|\bdestination\b|\btravel\b|\btrip\b|\bhostel\b|\bresort\b/,
    shopping: /\$[\d.,]+|\bprice\b|\bbuy\b|\bpurchase\b|\bcart\b|\border\b|\bproduct\b|\breview\b|\brating\b|\bamazon\b|\bebay\b|\bshipping\b|\bdiscount\b|\bcoupon\b/,
    math:     /\bequation\b|\bformula\b|\bintegral\b|\bderivative\b|\bmatrix\b|\bcalculate\b|solve\s+for|\bproof\b|\btheorem\b|\bprobability\b|\bstatistics\b/,
    writing:  /\bwrite\b|\bessay\b|blog\s+post|\bdraft\b|\bparagraph\b|\bchapter\b|\brewrite\b|\bproofread\b|\boutline\b|\bthesis\b/,
    legal:    /\bcontract\b|\bclause\b|\bliability\b|terms\s+of\s+service|\blawsuit\b|\bstatute\b|\bregulation\b|\bcompliance\b|\bagreement\b/,
    research: /research\s+paper|\bcitation\b|\bjournal\b|\bhypothesis\b|\bmethodology\b|\babstract\b|\bbibliography\b|literature\s+review/,
  };
  for (const [domain, pattern] of Object.entries(patterns)) {
    if (pattern.test(allText)) return domain;
  }
  return 'general';
}

function extractCriticalArtifacts(messages, domain) {
  const allText = messages.map(m => `[${m.role.toUpperCase()}]:\n${m.content}`).join('\n\n---\n\n');
  const sections = [];

  // 1. Fenced code blocks — extracted verbatim, never summarized
  const codeBlocks = [];
  const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  const seenCode = new Set();
  while ((match = codeRegex.exec(allText)) !== null) {
    const lang = match[1].trim();
    const code = match[2].trim();
    if (code.length > 15 && !seenCode.has(code)) {
      seenCode.add(code);
      codeBlocks.push({ lang, code });
    }
  }
  if (codeBlocks.length > 0) {
    const label = domain === 'database' ? 'Schemas & Queries'
                : domain === 'coding'   ? 'Code'
                : 'Code & Queries';
    sections.push({
      heading: label,
      content: codeBlocks.slice(-6).map(b => `\`\`\`${b.lang}\n${b.code}\n\`\`\``).join('\n\n')
    });
  }

  // 2. Markdown tables
  const tables = [];
  const tableRegex = /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|(?:\n|$))*)/g;
  const seenTables = new Set();
  while ((match = tableRegex.exec(allText)) !== null) {
    const tbl = match[1].trim();
    if (!seenTables.has(tbl)) { seenTables.add(tbl); tables.push(tbl); }
  }
  if (tables.length > 0) {
    sections.push({ heading: 'Tables', content: tables.slice(-3).join('\n\n') });
  }

  // 3. Bullet/numbered lists with 3+ items (products, trip stops, task lists)
  if (['shopping', 'travel', 'research', 'general'].includes(domain)) {
    const listBlocks = [];
    const listRegex = /^((?:(?:\d+[.)]\s+|\*\s+|-\s+)[^\n]+\n?){3,})/gm;
    while ((match = listRegex.exec(allText)) !== null) {
      const block = match[1].trim();
      if (block.length > 40) listBlocks.push(block);
    }
    if (listBlocks.length > 0) {
      const label = domain === 'shopping' ? 'Products & Options'
                  : domain === 'travel'   ? 'Itinerary & Stops'
                  : 'Key Items';
      sections.push({ heading: label, content: listBlocks.slice(-3).join('\n\n') });
    }
  }

  // 4. URLs
  const urls = [...new Set(allText.match(/https?:\/\/[^\s"')<>\]]{10,150}/g) || [])];
  if (urls.length > 0) {
    sections.push({ heading: 'Links', content: urls.slice(0, 12).join('\n') });
  }

  // 5. Database: schema CSV blocks (format from DB tools: N,colname,db,table,SQLTYPE,...)
  //    and ID/value mapping data — never in code blocks, always plain text
  if (domain === 'database') {
    const schemaCsvRegex = /(?:\d+,[a-zA-Z_][a-zA-Z0-9_]*,[^,\n]+,[a-zA-Z_][a-zA-Z0-9_]*,(?:BIGINT|INT|VARCHAR|ENUM|TINYINT|DOUBLE|TIMESTAMP|DATETIME|DATE|TEXT|BLOB)[^\n]*\n){4,}/g;
    const schemaBlocks = [];
    const seenSch = new Set();
    while ((match = schemaCsvRegex.exec(allText)) !== null) {
      const b = match[0].trim();
      if (!seenSch.has(b)) { seenSch.add(b); schemaBlocks.push(b); }
    }
    if (schemaBlocks.length > 0) {
      sections.push({ heading: 'Table Schemas', content: schemaBlocks.join('\n\n') });
    }

    // ID/value mapping rows: lines like '19932', '20562', 'dummy_repair_customer_1'
    const idRowRegex = /(?:'[^'\n]+'(?:,\s*(?:'[^'\n]+'|NULL|\d+)){2,}[^\n]*\n?){3,}/g;
    const idBlocks = [];
    while ((match = idRowRegex.exec(allText)) !== null) {
      const b = match[0].trim();
      if (b.length > 30) idBlocks.push(b);
    }
    if (idBlocks.length > 0) {
      // Keep only the last (most recent state)
      sections.push({ heading: 'Key ID Mappings', content: idBlocks.slice(-1)[0] });
    }
  }

  return sections;
}

function formatArtifactSection(sections, domain) {
  if (sections.length === 0) return '';
  const domainHeadings = {
    database: 'Preserved Context: Schemas & Queries',
    coding:   'Preserved Context: Code',
    travel:   'Preserved Context: Trip Details',
    shopping: 'Preserved Context: Products & Prices',
    math:     'Preserved Context: Calculations',
    writing:  'Preserved Context: Drafts & Excerpts',
    legal:    'Preserved Context: Key Clauses',
    research: 'Preserved Context: References & Data',
    general:  'Preserved Context: Key Details',
  };
  const heading = domainHeadings[domain] || 'Preserved Context: Key Details';
  const body = sections.map(s => `### ${s.heading}\n${s.content}`).join('\n\n');
  return `\n\n---\n## ${heading}\n\u26a0\ufe0f The following was extracted verbatim — do not summarize or paraphrase:\n\n${body}`;
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

  const domain = detectDomain(messages);
  const artifactSections = extractCriticalArtifacts(messages, domain);
  const artifactSection = formatArtifactSection(artifactSections, domain);

  if (!NIM_API_KEY || NIM_API_KEY.includes("PASTE-YOUR-KEY")) {
    return { success: false, reason: "no_key", fallback: extractiveSummarize(messages) };
  }

  const conversationText = formatConversationForNIM(messages, MAX_INPUT_CHARS);
  const isCustom = mode === "custom" && customFocus?.trim().length > 0;
  const systemPrompt = isCustom ? buildCustomSystemPrompt(customFocus) : NIM_SYSTEM_PROMPT;
  const maxTokens = isCustom ? MAX_TOKENS_CUSTOM : MAX_TOKENS_SUMMARY;

  const body = {
    model: NIM_MODEL,
    temperature: 0.1,      // Lower = more deterministic = faster, less wandering
    top_p: 0.75,           // Tighter sampling = faster generation
    max_tokens: maxTokens,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Compress this conversation:\n\n${conversationText}` }
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
    return { success: true, summary: summary + artifactSection };

  } catch (err) {
    return { success: false, reason: "network_error", error: err.message, fallback: extractiveSummarize(messages) };
  }
}

function extractiveSummarize(messages) {
  if (!messages || messages.length === 0) return "[ContextShift Handoff]\ntopic: empty conversation\ngoal: none\nstate: none\ndecisions: none\nerror: none\nnext: none\nskip: none";

  const userMsgs = messages.filter(m => m.role === "user");
  const asstMsgs = messages.filter(m => m.role === "assistant");

  const firstUser = userMsgs[0]?.content?.trim().slice(0, 80) || "none";
  const lastUser  = userMsgs[userMsgs.length - 1]?.content?.trim().slice(0, 500) || "none";
  const firstAI   = asstMsgs[0]?.content?.trim().slice(0, 80) || "none";

  const allText = messages.map(m => m.content).join(" ");
  const errorMatches = allText.match(/Error[:\s][^\n.]{5,60}/g) || [];
  const errors = [...new Set(errorMatches)].slice(0, 2);

  const domain = detectDomain(messages);
  const artifactSections = extractCriticalArtifacts(messages, domain);
  const artifactAppend = formatArtifactSection(artifactSections, domain);

  return `[ContextShift Handoff]
topic: ${firstUser.split(" ").slice(0, 5).join(" ")}
domain: ${domain}
goal: ${firstUser.slice(0, 80)}
state: ${firstAI.slice(0, 80)}
decisions: none (NIM key not configured — add in Settings)
error: ${errors[0] || "none"}
next: ${lastUser}
skip: none
⚠️ Auto-extracted locally. Add NVIDIA NIM key in Settings for AI compression.` + artifactAppend;
}

function wrapForInjection(nimSummary, sourcePlatform, targetPlatform) {
  const names = {
    chatgpt: "ChatGPT", claude: "Claude",
    gemini: "Gemini", perplexity: "Perplexity", grok: "Grok"
  };
  const from = names[sourcePlatform] || sourcePlatform;

  return `I'm continuing a conversation from ${from}. Here is the full context — please read it and continue from the next field.\n\n${nimSummary}\n\nReady. Please continue from the "next" field above.`;
}
