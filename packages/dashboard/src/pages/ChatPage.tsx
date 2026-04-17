import { Link } from '@tanstack/react-router';

/**
 * Chat is intentionally deferred. The route is still registered so
 * existing deep links don't 404, but the nav entry is hidden unless
 * `VITE_CHAT_ENABLED=true` — see `router.tsx`. Until SSE or WebSocket
 * lands in the API, there's no data to show here.
 */
export function ChatPage() {
  const enabled = import.meta.env.VITE_CHAT_ENABLED === 'true';

  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-semibold mb-2">Live chat</h2>
      <p className="text-sm text-gray-600">
        {enabled
          ? 'Chat is flagged on, but the realtime transport is not yet wired. This page will ship with the WebSocket milestone.'
          : 'Live chat is not part of this release. It ships once the realtime transport is in place.'}
      </p>
      <Link to="/" className="inline-block mt-4 text-sm text-indigo-600 hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
