export type CommentType = 'vague' | 'unsupported' | 'logical-gap' | 'ambiguous';

export interface FeedbackComment {
  id: string;
  quote: string;
  comment: string;
  type: CommentType;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CommentThread {
  commentId: string;
  messages: ChatMessage[];
}

export interface DocumentSnapshot {
  timestamp: number;
  value: unknown[];
  plainText: string;
}

export interface EditProposal {
  id: string;
  originalText: string;
  proposedText: string;
  explanation: string;
}

export interface EditSession {
  id: string;
  selectedText: string;
  proposal: EditProposal | null;
  messages: ChatMessage[];
  status: 'prompting' | 'loading' | 'proposed' | 'accepted' | 'rejected';
}
