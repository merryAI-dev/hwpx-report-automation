export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-gray-500">로딩 중...</p>
      </div>
    </div>
  );
}
