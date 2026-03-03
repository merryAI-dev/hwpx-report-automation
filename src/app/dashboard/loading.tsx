export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <div className="h-7 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-white p-5 shadow-sm">
              <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
              <div className="mt-2 h-8 w-16 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>
        <div className="mt-6 h-40 animate-pulse rounded-lg border bg-white" />
      </div>
    </div>
  );
}
