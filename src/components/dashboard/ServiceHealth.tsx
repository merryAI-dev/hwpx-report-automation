"use client";

import { useEffect, useState } from "react";

type HealthData = {
  status: string;
  timestamp: string;
  version: string;
  services: {
    openai: { configured: boolean; model: string };
    anthropic: { configured: boolean; model: string };
    database: { configured: boolean };
  };
};

export function ServiceHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => {
        if (r.ok) setData(await r.json());
        else setError(true);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">서비스 상태를 확인할 수 없습니다.</p>
      </div>
    );
  }

  if (!data) return null;

  const services = [
    {
      name: "OpenAI",
      configured: data.services.openai.configured,
      detail: data.services.openai.model,
    },
    {
      name: "Anthropic",
      configured: data.services.anthropic.configured,
      detail: data.services.anthropic.model,
    },
    {
      name: "Database",
      configured: data.services.database.configured,
      detail: "PostgreSQL",
    },
  ];

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">서비스 상태</h3>
        <span className="text-xs text-gray-400">v{data.version}</span>
      </div>

      <div className="space-y-2">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  svc.configured ? "bg-green-500" : "bg-red-400"
                }`}
                aria-label={svc.configured ? "정상" : "미설정"}
              />
              <span className="text-sm font-medium text-gray-700">{svc.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{svc.detail}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  svc.configured
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-600"
                }`}
              >
                {svc.configured ? "연결됨" : "미설정"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
