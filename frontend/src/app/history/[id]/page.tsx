"use client";

import { useParams } from "next/navigation";
import { ScanDetail } from "@/components/ScanDetail";

export default function ScanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-xl">
        {Number.isInteger(id) ? (
          <ScanDetail id={id} />
        ) : (
          <p className="text-red-600 dark:text-red-400">Invalid scan id.</p>
        )}
      </main>
    </div>
  );
}
