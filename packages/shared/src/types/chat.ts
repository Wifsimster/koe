import type { WidgetUser } from './user';

export type ChatAuthor =
  | { kind: 'user'; user: WidgetUser }
  | { kind: 'admin'; adminId: string; name: string }
  | { kind: 'system' };

export interface ChatMessage {
  id: string;
  conversationId: string;
  author: ChatAuthor;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface ChatConversation {
  id: string;
  projectId: string;
  userId: string;
  lastMessageAt: string;
  unreadCount: number;
  messages: ChatMessage[];
}

/**
 * Messages pushed over the realtime WebSocket. A single discriminated
 * union keeps the client/server protocol honest.
 */
export type RealtimeEvent =
  | { type: 'hello'; conversationId: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; conversationId: string; authorId: string }
  | { type: 'read'; conversationId: string; messageId: string };
