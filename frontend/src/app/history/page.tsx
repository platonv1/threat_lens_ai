import { HistoryList } from "@/components/HistoryList";

export default function HistoryPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">History</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Past scans, newest first.</p>
        <div className="mt-8">
          <HistoryList />
        </div>
      </main>
    </div>
  );
}
