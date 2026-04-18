import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureRequest } from '@koe/shared';
import { useKoe } from '../context/KoeContext';
import { KoeApiError } from '../api/client';
import { Button } from './ui/Button';

/**
 * Browse-and-vote screen. Sort order is server-decided (votes desc) so
 * we don't duplicate the sort here. We lazy-load on mount — piggy-backing
 * on the user's navigation to this screen rather than pre-fetching on
 * every page view that hosts the widget.
 *
 * Voting uses an optimistic toggle: we flip `hasVoted` + `voteCount`
 * locally before the POST so the tap feels instant. If the server
 * rejects (network error, identity invalid), we roll back and surface
 * the error inline. A composite PK on `ticket_votes` makes the endpoint
 * idempotent, so accidental double-taps are safe on the API side too.
 *
 * Anonymous viewers (no `config.user.id`) can browse read-only. The
 * vote button is rendered disabled with a short tooltip — the product
 * decision was "don't hide, just disable" so the feature's existence
 * stays discoverable to hosts evaluating the widget.
 */
export function BrowseList() {
  const { api, config, locale } = useKoe();
  const browse = locale.browse ?? DEFAULT_BROWSE;
  const userId = config.user?.id;
  const canVote = Boolean(userId && userId !== 'anonymous');

  const [items, setItems] = useState<FeatureRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    api
      .listFeatureRequests(userId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof KoeApiError && err.code === 'network_error') {
          setError(locale.errors.network);
        } else {
          setError(err instanceof Error ? err.message : locale.errors.generic);
        }
        setLoading(false);
      });
  }, [api, userId, locale.errors.network, locale.errors.generic]);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  if (loading && !items) {
    return <p className="koe-text-xs koe-text-koe-text-muted koe-py-4">{browse.loading}</p>;
  }

  if (error && !items) {
    return (
      <div className="koe-py-4 koe-flex koe-flex-col koe-items-start koe-gap-3">
        <p className="koe-text-xs koe-text-red-500 koe-m-0" role="alert">
          {browse.error}
        </p>
        <Button variant="outline" type="button" onClick={load}>
          {browse.retry}
        </Button>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="koe-text-xs koe-text-koe-text-muted koe-py-4 koe-text-center">{browse.empty}</p>
    );
  }

  return (
    <ul className="koe-list-none koe-m-0 koe-p-0">
      {items.map((item) => (
        <VoteRow
          key={item.id}
          item={item}
          canVote={canVote}
          onToggle={(next) => {
            setItems((prev) => prev?.map((it) => (it.id === next.id ? next : it)) ?? null);
          }}
          onError={setError}
        />
      ))}
      {error && items && (
        <li className="koe-text-xs koe-text-red-500 koe-pt-2" role="alert">
          {error}
        </li>
      )}
      {!canVote && (
        <li className="koe-text-[11px] koe-text-koe-text-muted koe-pt-3 koe-text-center">
          {browse.signInToVote}
        </li>
      )}
    </ul>
  );
}

interface VoteRowProps {
  item: FeatureRequest;
  canVote: boolean;
  onToggle: (next: FeatureRequest) => void;
  onError: (msg: string | null) => void;
}

function VoteRow({ item, canVote, onToggle, onError }: VoteRowProps) {
  const { api, config, locale } = useKoe();
  const browse = locale.browse ?? DEFAULT_BROWSE;
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const userId = config.user?.id;

  const onClick = async () => {
    if (!canVote || !userId || pending) return;

    // Optimistic flip — server is the source of truth but we render
    // what the user just did without waiting for the round-trip.
    const previous = item;
    const optimistic: FeatureRequest = {
      ...item,
      hasVoted: !item.hasVoted,
      voteCount: item.voteCount + (item.hasVoted ? -1 : 1),
    };
    onToggle(optimistic);
    onError(null);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    try {
      const next = await api.voteFeature(item.id, userId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onToggle(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      // Revert the optimistic flip so the UI matches the server again.
      onToggle(previous);
      if (err instanceof KoeApiError && err.code === 'network_error') {
        onError(locale.errors.network);
      } else {
        onError(err instanceof Error ? err.message : locale.errors.generic);
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  return (
    <li className="koe-vote-row">
      <button
        type="button"
        className="koe-vote-btn"
        aria-pressed={item.hasVoted}
        aria-label={item.hasVoted ? browse.unvoteAriaLabel : browse.voteAriaLabel}
        disabled={!canVote || pending}
        onClick={onClick}
      >
        <span className="koe-vote-arrow" aria-hidden="true">
          ▲
        </span>
        <span className="koe-vote-count">{item.voteCount}</span>
      </button>
      <div className="koe-min-w-0 koe-flex-1">
        <p className="koe-text-sm koe-font-medium koe-text-koe-text koe-m-0 koe-truncate">
          {item.title}
        </p>
        <p className="koe-text-xs koe-text-koe-text-muted koe-m-0 koe-mt-1 koe-line-clamp-2">
          {item.description}
        </p>
      </div>
    </li>
  );
}

const DEFAULT_BROWSE = {
  title: 'Ideas',
  loading: 'Loading ideas…',
  empty: 'No ideas yet — be the first to suggest one.',
  error: "Couldn't load ideas.",
  retry: 'Try again',
  voteAriaLabel: 'Upvote',
  unvoteAriaLabel: 'Remove upvote',
  signInToVote: 'Sign in to vote',
};
