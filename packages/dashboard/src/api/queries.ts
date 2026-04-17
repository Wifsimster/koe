import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminTicket,
  KoeAdminClient,
  Overview,
  Page,
  TicketListQuery,
} from './client';
import type { TicketPriority, TicketStatus } from '@koe/shared';

/**
 * Query-key factory. Single source of truth so invalidations don't
 * silently miss when a key shape changes. Read top-down — each level
 * narrows the cache.
 */
export const qk = {
  me: () => ['me'] as const,
  projects: () => ['projects'] as const,
  overview: (projectKey: string) => ['overview', projectKey] as const,
  tickets: (projectKey: string, query: TicketListQuery) =>
    ['tickets', projectKey, query] as const,
};

export function useMe(client: KoeAdminClient) {
  return useQuery({
    queryKey: qk.me(),
    queryFn: ({ signal }) => client.me(),
    // `me` rarely changes during a session; refetch on focus is overkill.
    staleTime: 60_000,
    retry: false,
  });
}

export function useProjects(client: KoeAdminClient, enabled = true) {
  return useQuery({
    queryKey: qk.projects(),
    queryFn: () => client.listProjects(),
    staleTime: 30_000,
    enabled,
  });
}

export function useOverview(client: KoeAdminClient, projectKey: string | null) {
  return useQuery({
    queryKey: qk.overview(projectKey ?? ''),
    queryFn: () => client.overview(projectKey as string),
    enabled: Boolean(projectKey),
    staleTime: 15_000,
  });
}

export function useTickets(
  client: KoeAdminClient,
  projectKey: string | null,
  query: TicketListQuery,
) {
  return useQuery<Page<AdminTicket>>({
    queryKey: qk.tickets(projectKey ?? '', query),
    queryFn: () => client.listTickets(projectKey as string, query),
    enabled: Boolean(projectKey),
    // Triage is fast-moving; keep the list fresh but don't hammer.
    staleTime: 5_000,
  });
}

export function usePatchTicket(client: KoeAdminClient, projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { status?: TicketStatus; priority?: TicketPriority };
    }) => client.patchTicket(id, patch),
    // Optimistic update against any ticket list currently in cache for
    // this project — we don't know which filter combination is on
    // screen, so we update every cached variant and rely on refetch
    // for pagination sanity.
    onMutate: async ({ id, patch }) => {
      if (!projectKey) return;
      const prefix = ['tickets', projectKey];
      await qc.cancelQueries({ queryKey: prefix });
      const snapshot = qc.getQueriesData<Page<AdminTicket>>({ queryKey: prefix });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        qc.setQueryData<Page<AdminTicket>>(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.snapshot) return;
      for (const [key, data] of ctx.snapshot) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      if (!projectKey) return;
      qc.invalidateQueries({ queryKey: ['tickets', projectKey] });
      qc.invalidateQueries({ queryKey: qk.overview(projectKey) });
    },
  });
}

export type { Overview };
