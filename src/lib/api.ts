import type { FeedbackComment, ChatMessage, EditProposal } from './types';
import { getSessionId } from './session';

/** Get document ID from current URL path */
function getDocumentId(): string {
  const match = window.location.pathname.match(/^\/d\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : 'unknown';
}

const FEEDBACK_FORMAT_INSTRUCTIONS = `
For each issue you find, return a JSON object with:
- "quote": the EXACT text from the document (copy it verbatim, including punctuation)
- "comment": a specific question or challenge addressed directly to the author. Never be generic ("this is vague"). Instead, ask what they actually mean.
- "type": one of "vague", "unsupported", "logical-gap", "ambiguous"

Types:
- vague: Claims that lack specificity or precision
- unsupported: Assertions made without evidence or reasoning
- logical-gap: Missing steps in an argument, non-sequiturs
- ambiguous: Phrasing that could be read multiple ways

Return a JSON array of comment objects. Scale the number of comments to the document length:
- Under 200 words: return at most 3 comments
- 200-500 words: return at most 5 comments
- 500+ words: return at most 8 comments

PRIORITIZE ruthlessly: return only the issues that would most improve the writing. Order them from highest to lowest priority. If the writing is strong, return fewer comments. If the text is too short or empty, return an empty array.

IMPORTANT: Return ONLY the JSON array, no markdown formatting, no code fences, no explanation.`;

const PERSONA_PROMPTS: Record<string, string> = {
  argument_coach: `You are the Argument Coach — a demanding but fair reader who focuses on thesis strength, position-taking, evidence quality, and logical structure. Your job is to push students who hedge, summarize both sides without choosing, or make claims without backing them up.

Challenge weak arguments directly: "You claim X, but your only evidence is Y — is that sufficient?" Push students who hedge: "You say 'many experts believe' — which experts? What specifically do they believe? Taking a position requires specificity." Flag arguments that merely describe rather than argue.
${FEEDBACK_FORMAT_INSTRUCTIONS}`,

  clarity_coach: `You are the Clarity Coach — a precise reader who focuses on jargon, vague claims, sentence-level clarity, and concision. Your job is to flag writing that "sounds smart but says nothing" and push students toward concrete, specific prose.

Flag academic filler: "What does 'significant implications' actually mean here? Name the implications." Challenge jargon: "You use 'paradigm shift' — can you say what specifically changed, for whom, and why it matters?" Push for concision: "This 18-word sentence makes one point — can you make it in 8?"
${FEEDBACK_FORMAT_INSTRUCTIONS}`,
};

const DEFAULT_FEEDBACK_PROMPT = `You are a rigorous but generous reader reviewing a draft document. Your job is to identify specific weaknesses in the writing — not to rewrite it, but to challenge the author to think more clearly.
${FEEDBACK_FORMAT_INSTRUCTIONS}`;

export type ReviewPersona = 'argument_coach' | 'clarity_coach';

const ALL_PERSONAS: ReviewPersona[] = ['argument_coach', 'clarity_coach'];

async function fetchFeedbackForPersona(
  documentText: string,
  persona: ReviewPersona,
  rubric?: string,
  context?: string,
): Promise<FeedbackComment[]> {
  let system = PERSONA_PROMPTS[persona];

  if (rubric?.trim()) {
    system += `\n\nThe author has specified the following rubric for feedback. Prioritize these areas:\n${rubric.trim()}`;
  }
  if (context?.trim()) {
    system += `\n\nAdditional context about the document provided by the author:\n${context.trim()}`;
  }

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: documentText }],
      system,
      max_tokens: 2048,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: `feedback_${persona}`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  const comments: FeedbackComment[] = JSON.parse(text);
  return comments.map((c, i) => ({ ...c, id: `comment-${persona}-${Date.now()}-${i}` }));
}

export async function requestFeedback(
  documentText: string,
  options?: { rubric?: string; context?: string }
): Promise<FeedbackComment[]> {
  // Run both personas in parallel, merge results
  const results = await Promise.all(
    ALL_PERSONAS.map(persona =>
      fetchFeedbackForPersona(documentText, persona, options?.rubric, options?.context)
        .catch(() => [] as FeedbackComment[])
    )
  );
  return results.flat();
}

// ── Document flow feedback (holistic critique) ──

const DOCUMENT_FLOW_SYSTEM_PROMPT = `You are a rigorous essay editor giving HOLISTIC, ESSAY-LEVEL feedback on a draft. You are not a sentence-level copy editor. Do NOT comment on individual phrasings, word choice, or per-sentence issues. Instead, step back and evaluate the piece as a whole.

Your feedback should be PROPORTIONAL to the draft's length and complexity:
- For short drafts (under 200 words): 1-2 focused paragraphs. Identify the single biggest structural issue and one concrete next step.
- For medium drafts (200-800 words): 2-3 paragraphs. Cover the top 2-3 issues in priority order.
- For longer drafts (800+ words): 3-5 paragraphs. Cover up to 5 dimensions.

ALWAYS lead with the highest-priority issue first. Prioritize by what would most improve the piece.

Dimensions to consider (in priority order — skip any that aren't relevant):
1. Thesis clarity — Is there a clear central claim?
2. Argumentative gaps — Unsupported leaps, claims needing scaffolding
3. Section-to-section logical flow — Do sections connect?
4. Pacing — Does it drag, rush, or repeat?
5. Whether the conclusion earns its claims

Write as a trusted editor's private note. Be direct and specific. Quote short phrases only when necessary. Do NOT use bullet points, numbered lists, or markdown headers. Don't pad with praise — if something works, say so briefly and move on.

Return ONLY the prose critique, no preamble, no sign-off.`;

export async function getDocumentFlowFeedback(
  documentText: string,
  options?: { rubric?: string; context?: string }
): Promise<string> {
  let system = DOCUMENT_FLOW_SYSTEM_PROMPT;

  if (options?.rubric?.trim()) {
    system += `\n\nThe author has specified the following rubric for feedback. Weigh these priorities in your critique:\n${options.rubric.trim()}`;
  }
  if (options?.context?.trim()) {
    system += `\n\nAdditional context about the document provided by the author:\n${options.context.trim()}`;
  }

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: documentText }],
      system,
      max_tokens: 2048,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: 'feedback_document_flow',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text as string;
}

export async function chatWithClaude(
  documentContext: string,
  feedbackComment: FeedbackComment,
  threadMessages: ChatMessage[]
): Promise<string> {
  const system = `You are a thoughtful writing advisor discussing a specific piece of feedback on the user's document. Be conversational, specific, and constructive. Help the author think through the issue without being prescriptive.

Here is the full document for context:
---
${documentContext}
---

The specific feedback being discussed:
- Quote: "${feedbackComment.quote}"
- Issue: ${feedbackComment.comment}
- Type: ${feedbackComment.type}

Help the author work through this specific issue. Ask clarifying questions. Suggest concrete alternatives only when asked.`;

  const messages = threadMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system,
      max_tokens: 1024,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: 'chat',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

export async function chatAboutDocumentStream(
  documentText: string,
  message: string,
  history: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<string> {
  const system = `You are a helpful writing assistant. The user is working on a document and wants to chat about it. Be conversational, specific, and constructive. You may use markdown formatting in your responses.

Here is the full document:
---
${documentText}
---

Help the user with questions about their document, brainstorm ideas, suggest improvements, or discuss any aspect of their writing.`;

  const messages = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, max_tokens: 1024, stream: true, session_id: getSessionId(), document_id: getDocumentId(), request_type: 'stream_chat' }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(fullText);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  }

  return fullText;
}

export interface Citation {
  id: number;
  text: string;
  source: string;
  url: string;
  authors: string;
  year: string;
}

// Placeholder — returns a hardcoded citation for now
export async function getCitation(selectedText: string): Promise<Citation> {
  // Simulate search delay
  await new Promise((r) => setTimeout(r, 1200));

  const citations: Citation[] = [
    {
      id: 0,
      text: selectedText,
      source: 'Nature Machine Intelligence',
      url: 'https://doi.org/10.1038/s42256-023-00626-4',
      authors: 'Smith, J., Chen, L., & Park, S.',
      year: '2024',
    },
    {
      id: 0,
      text: selectedText,
      source: 'Science',
      url: 'https://doi.org/10.1126/science.adf6369',
      authors: 'Johnson, A., Williams, R., & Brown, K.',
      year: '2023',
    },
    {
      id: 0,
      text: selectedText,
      source: 'Proceedings of the National Academy of Sciences',
      url: 'https://doi.org/10.1073/pnas.2307692120',
      authors: 'Davis, M., Thompson, E., & Garcia, F.',
      year: '2024',
    },
  ];

  const citation = citations[Math.floor(Math.random() * citations.length)];
  return citation;
}

// ── Translation ──

const TRANSLATE_SYSTEM_PROMPT = `You are a professional translator. Translate the given text to the target language. Preserve the tone, style, and formatting of the original. Return ONLY the translated text — no explanations, no quotes, no labels.`;

export async function translateText(
  text: string,
  targetLanguage: string
): Promise<string> {
  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: `Translate the following text to ${targetLanguage}:\n\n${text}`,
      }],
      system: TRANSLATE_SYSTEM_PROMPT,
      max_tokens: 2048,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: 'translate',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ── Edit proposals ──

const EDIT_SYSTEM_PROMPT = `You are a surgical text editor. The user will give you a selected passage from their document and an instruction for how to edit it. You must return ONLY a JSON object with:
- "proposedText": the rewritten version of the selected text (ONLY the selected portion, preserving the same scope)
- "explanation": a brief one-sentence explanation of what you changed

Rules:
- Only modify the selected text, not surrounding context
- Preserve the author's voice and style
- Make minimal changes to achieve the requested edit
- Do NOT add markdown formatting
- Return ONLY the JSON object, no code fences

IMPORTANT: Return ONLY the JSON object, no markdown formatting, no code fences, no explanation outside the JSON.`;

export async function proposeEdit(
  documentText: string,
  selectedText: string,
  instruction: string
): Promise<EditProposal> {
  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: `Full document for context:\n---\n${documentText}\n---\n\nSelected text to edit:\n"${selectedText}"\n\nInstruction: ${instruction}`,
      }],
      system: EDIT_SYSTEM_PROMPT,
      max_tokens: 2048,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: 'edit',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  const parsed = JSON.parse(text);

  return {
    id: `edit-${Date.now()}`,
    originalText: selectedText,
    proposedText: parsed.proposedText,
    explanation: parsed.explanation,
  };
}

const EDIT_CHAT_SYSTEM_PROMPT = `You are a surgical text editor refining a proposed edit. The user will discuss the edit with you. When they ask for changes, return a JSON object with:
- "proposedText": the updated rewritten text
- "explanation": a brief explanation of what changed

If the user is just asking a question (not requesting a change), respond with plain text (no JSON).

Rules:
- Only modify the selected text scope
- Preserve the author's voice
- Make minimal changes

Context will be provided about the document, selected text, and current proposal.`;

export async function chatAboutEdit(
  documentText: string,
  selectedText: string,
  currentProposal: string,
  messages: ChatMessage[]
): Promise<{ type: 'proposal'; proposal: EditProposal } | { type: 'message'; content: string }> {
  const system = `${EDIT_CHAT_SYSTEM_PROMPT}

Document context:
---
${documentText}
---

Original selected text: "${selectedText}"
Current proposed edit: "${currentProposal}"`;

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      system,
      max_tokens: 2048,
      session_id: getSessionId(),
      document_id: getDocumentId(),
      request_type: 'edit_chat',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  try {
    const parsed = JSON.parse(text);
    if (parsed.proposedText) {
      return {
        type: 'proposal',
        proposal: {
          id: `edit-${Date.now()}`,
          originalText: selectedText,
          proposedText: parsed.proposedText,
          explanation: parsed.explanation || '',
        },
      };
    }
  } catch {
    // Not JSON, treat as plain message
  }

  return { type: 'message', content: text };
}
