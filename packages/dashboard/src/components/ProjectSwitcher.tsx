import { useAuth } from '../auth/AuthContext';

/**
 * Lets the operator pick which project's tickets to triage. Stored in
 * `AuthContext` (and mirrored to localStorage) so the choice survives
 * reloads. Single-membership accounts see a plain readout, no dropdown.
 */
export function ProjectSwitcher({ onChange }: { onChange?: () => void }) {
  const { state, setActiveProject } = useAuth();
  if (state.status !== 'authenticated') return null;
  const memberships = state.me.memberships;
  const active = state.activeProjectKey;

  if (memberships.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No project memberships. Ask an owner to add you.
      </div>
    );
  }

  if (memberships.length === 1) {
    return (
      <div className="text-sm font-medium text-gray-900 truncate">
        {memberships[0]!.projectName}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="sr-only">Project</span>
      <select
        value={active ?? ''}
        onChange={(e) => {
          setActiveProject(e.target.value);
          onChange?.();
        }}
        className="w-full text-sm px-2 py-2 rounded-md border border-gray-300 bg-white min-h-[44px]"
      >
        {memberships.map((m) => (
          <option key={m.projectKey} value={m.projectKey}>
            {m.projectName}
          </option>
        ))}
      </select>
    </label>
  );
}
