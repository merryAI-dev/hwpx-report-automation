export default function DocumentsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <div className="h-7 w-28 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="h-5 flex-1 animate-pulse rounded bg-gray-100" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
