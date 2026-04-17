import { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useProjects } from '../api/queries';

/**
 * Project selector in the sidebar. We list every project the admin
 * is a member of, highlight the current one, and persist the choice
 * so reloads don't drop the operator back to the first project.
 */
export function ProjectSwitcher() {
  const { client, projectKey, setProjectKey } = useApp();
  const projects = useProjects(client);

  // Auto-select the first project if nothing is chosen yet, or if the
  // previously-stored choice points at a project the user was removed
  // from.
  useEffect(() => {
    if (!projects.data || projects.data.length === 0) return;
    const current = projects.data.find((p) => p.key === projectKey);
    if (!current) {
      setProjectKey(projects.data[0]!.key);
    }
  }, [projects.data, projectKey, setProjectKey]);

  if (projects.isLoading) {
    return <div className="text-xs text-gray-400">Loading projects…</div>;
  }

  if (projects.error || !projects.data || projects.data.length === 0) {
    return (
      <div className="text-xs text-gray-400">
        {projects.error ? 'Failed to load projects' : 'No projects yet'}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">Project</span>
      <select
        value={projectKey ?? ''}
        onChange={(e) => setProjectKey(e.target.value)}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {projects.data.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
