export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <div className="h-7 w-16 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-gray-100" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-6 rounded-lg border bg-white p-5 shadow-sm">
            <div className="mb-4 h-5 w-24 animate-pulse rounded bg-gray-200" />
            <div className="space-y-3">
              <div className="h-10 animate-pulse rounded bg-gray-100" />
              <div className="h-10 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
