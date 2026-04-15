export function BugsPage() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Bug reports</h2>
      <p className="text-gray-600">
        Incoming bug reports from your projects will appear here. Wire this page up to
        <code className="mx-1 px-1 bg-gray-100 rounded">GET /v1/admin/bugs</code>
        once the admin API is in place.
      </p>
    </div>
  );
}
