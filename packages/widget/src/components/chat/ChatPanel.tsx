import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import type { ChatMessage } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { Button } from '../ui/Button';

/**
 * Minimal chat UI. The realtime WebSocket wiring lives in a future
 * milestone — for now this renders a local-only conversation so the tab
 * is navigable and the UX can be previewed end-to-end.
 */
export function ChatPanel() {
  const { locale, config } = useKoe();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: 'local',
      author: { kind: 'user', user: config.user ?? { id: 'anonymous' } },
      body,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    setDraft('');
  };

  return (
    <div className="koe-flex koe-flex-col koe-h-[360px]">
      <div className="koe-flex-1 koe-overflow-y-auto koe-mb-3 koe-pr-1">
        {messages.length === 0 ? (
          <p className="koe-text-sm koe-text-koe-text-muted koe-text-center koe-mt-8">
            {locale.chat.empty}
          </p>
        ) : (
          <ul className="koe-space-y-2 koe-list-none koe-p-0 koe-m-0">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={onSend} className="koe-flex koe-gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={locale.chat.placeholder}
          className="koe-flex-1 koe-px-3 koe-py-2 koe-rounded-md koe-border koe-border-koe-border koe-bg-koe-bg focus:koe-outline-none focus:koe-border-koe-accent"
        />
        <Button type="submit">{locale.chat.send}</Button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const fromAdmin = message.author.kind === 'admin';
  return (
    <li
      className={clsx(
        'koe-max-w-[80%] koe-px-3 koe-py-2 koe-rounded-lg koe-text-sm',
        fromAdmin
          ? 'koe-bg-koe-bg-muted koe-text-koe-text koe-mr-auto'
          : 'koe-bg-koe-accent koe-text-white koe-ml-auto',
      )}
    >
      {message.body}
    </li>
  );
}
