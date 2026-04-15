export function HomePage() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Overview</h2>
      <p className="text-gray-600 mb-8">
        Welcome to the Koe admin dashboard. Manage bug reports, feature requests, and live chat
        across all your projects from a single place.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Open bugs" value="—" />
        <StatCard label="Feature requests" value="—" />
        <StatCard label="Unread chats" value="—" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
