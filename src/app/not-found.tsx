import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8">
      <div className="text-center">
        <p className="text-6xl font-bold text-gray-200">404</p>
        <h2 className="mt-4 text-xl font-semibold text-gray-900">
          페이지를 찾을 수 없습니다
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            편집기로 돌아가기
          </Link>
          <Link
            href="/documents"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            문서 목록
          </Link>
        </div>
      </div>
    </div>
  );
}
