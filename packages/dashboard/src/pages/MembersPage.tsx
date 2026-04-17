import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { AdminApiError, type ProjectMember } from '../api/client';

type Role = ProjectMember['role'];

/**
 * Project members page. Two surfaces:
 *   - List of current members with per-row role / remove controls.
 *   - Invite form that either adds an existing admin or provisions a
 *     new admin_users row on the fly (with an initial password) when
 *     the email is unknown.
 *
 * Owner-gated on the server; the UI reads `membership.role` from
 * `/me` and hides the mutation controls for non-owners. A non-owner
 * who somehow hits the endpoints directly gets a 403 — same outcome,
 * the UI just avoids surfacing buttons that would fail.
 */
export function MembersPage() {
  const { api, state, refreshMe } = useAuth();
  const { key: projectKey } = useParams({ from: '/_authenticated/projects/$key/members' });

  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ userId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await api.listProjectMembers(projectKey);
      setMembers(rows);
    } catch (err) {
      setLoadError(humanise(err));
    }
  }, [api, projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentUserId = state.status === 'authenticated' ? state.me.user.id : null;
  const myMembership = useMemo(() => {
    if (state.status !== 'authenticated') return null;
    return state.me.memberships.find((m) => m.projectKey === projectKey) ?? null;
  }, [state, projectKey]);
  const canManage = myMembership?.role === 'owner';

  const ownerCount = useMemo(
    () => (members ?? []).filter((m) => m.role === 'owner').length,
    [members],
  );

  const onChangeRole = async (member: ProjectMember, nextRole: Role) => {
    if (!canManage || nextRole === member.role) return;
    setBusyUserId(member.userId);
    setRowError(null);
    try {
      const updated = await api.updateProjectMember(projectKey, member.userId, nextRole);
      setMembers((prev) =>
        prev ? prev.map((m) => (m.userId === updated.userId ? updated : m)) : prev,
      );
      // If the caller demoted themselves, /me now carries the new role —
      // refresh so the UI hides controls that the server would refuse.
      if (member.userId === currentUserId) {
        await refreshMe();
      }
    } catch (err) {
      setRowError({ userId: member.userId, message: humanise(err) });
    } finally {
      setBusyUserId(null);
    }
  };

  const onRemove = async (member: ProjectMember) => {
    if (!canManage) return;
    const confirmed = window.confirm(
      member.userId === currentUserId
        ? 'Remove yourself from this project? You will lose access immediately.'
        : `Remove ${member.email} from this project?`,
    );
    if (!confirmed) return;
    setBusyUserId(member.userId);
    setRowError(null);
    try {
      await api.removeProjectMember(projectKey, member.userId);
      setMembers((prev) => (prev ? prev.filter((m) => m.userId !== member.userId) : prev));
      if (member.userId === currentUserId) {
        await refreshMe();
      }
    } catch (err) {
      setRowError({ userId: member.userId, message: humanise(err) });
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <header>
          <h3 className="text-base font-semibold text-gray-900">Members</h3>
          <p className="text-sm text-gray-600">
            People who can see and triage tickets in <Code>{projectKey}</Code>.
          </p>
        </header>

        {loadError && <ErrorLine>{loadError}</ErrorLine>}
        {members === null && !loadError && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {members && members.length === 0 && (
          <p className="text-sm text-gray-500">No members yet.</p>
        )}

        {members && members.length > 0 && (
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
            {members.map((m) => {
              const isLastOwner = m.role === 'owner' && ownerCount <= 1;
              const rowHasError = rowError?.userId === m.userId;
              return (
                <li key={m.userId} className="px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{m.email}</div>
                      {m.displayName && (
                        <div className="text-xs text-gray-500 truncate">{m.displayName}</div>
                      )}
                      {m.userId === currentUserId && (
                        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                          You
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage ? (
                        <select
                          value={m.role}
                          disabled={
                            busyUserId === m.userId ||
                            (isLastOwner && m.role === 'owner')
                          }
                          onChange={(e) => void onChangeRole(m, e.target.value as Role)}
                          className="text-sm px-2 py-1.5 rounded-md border border-gray-300 bg-white"
                          aria-label={`Role for ${m.email}`}
                        >
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className="text-sm capitalize text-gray-500">{m.role}</span>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          disabled={busyUserId === m.userId || isLastOwner}
                          title={
                            isLastOwner
                              ? 'Cannot remove the last owner. Promote another member first.'
                              : undefined
                          }
                          onClick={() => void onRemove(m)}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {rowHasError && <ErrorLine>{rowError!.message}</ErrorLine>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && <InviteForm projectKey={projectKey} onInvited={() => void load()} />}

      {!canManage && (
        <p className="text-xs text-gray-500">
          Only owners can invite or remove members.{' '}
          <Link
            to="/"
            search={{ kind: 'all', status: 'open', assignee: 'all', q: '' }}
            className="text-indigo-700 underline"
          >
            Back to inbox
          </Link>
        </p>
      )}
    </div>
  );
}

function InviteForm({
  projectKey,
  onInvited,
}: {
  projectKey: string;
  onInvited: () => void;
}) {
  const { api } = useAuth();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Email is required.');
      return;
    }
    if (showPassword && password.length > 0 && password.length < 12) {
      setError('Initial password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.inviteProjectMember(projectKey, {
        email: trimmed,
        role,
        initialPassword: showPassword && password ? password : undefined,
      });
      setSuccess(`Added ${created.email} as ${created.role}.`);
      setEmail('');
      setPassword('');
      setShowPassword(false);
      onInvited();
    } catch (err) {
      // The server returns a 422 pointing to initialPassword when the
      // user doesn't exist yet — auto-open the password field so the
      // operator's next click lands on the right input.
      const message = humanise(err);
      setError(message);
      if (err instanceof AdminApiError && /initialPassword/i.test(err.message)) {
        setShowPassword(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-base font-semibold text-gray-900">Invite a member</h3>
        <p className="text-sm text-gray-600">
          Existing admins are added directly. For a new email, provide an initial password — the
          user can change it later.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-4 max-w-md rounded-md border border-gray-200 bg-white p-4"
      >
        <div className="space-y-1.5">
          <label htmlFor="invite-email" className="block text-xs font-medium text-gray-700">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            disabled={submitting}
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="block text-xs font-medium text-gray-700">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={submitting}
            className="w-full text-sm px-2 py-2 rounded-md border border-gray-300 bg-white min-h-[40px]"
          >
            <option value="owner">Owner — manage members + triage</option>
            <option value="member">Member — triage tickets</option>
            <option value="viewer">Viewer — read-only</option>
          </select>
        </div>

        {!showPassword && (
          <button
            type="button"
            className="text-xs text-gray-600 underline hover:text-gray-900"
            onClick={() => setShowPassword(true)}
          >
            This person doesn't have an account yet — set an initial password
          </button>
        )}

        {showPassword && (
          <div className="space-y-1.5">
            <label htmlFor="invite-password" className="block text-xs font-medium text-gray-700">
              Initial password
            </label>
            <input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              disabled={submitting}
              minLength={12}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
            />
            <p className="text-xs text-gray-500">
              Ignored if the email already matches an admin user.
            </p>
          </div>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
        {success && (
          <p className="border-l-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Inviting…' : 'Invite'}
        </button>
      </form>
    </section>
  );
}

function humanise(err: unknown): string {
  if (err instanceof AdminApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700">
      {children}
    </p>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}
