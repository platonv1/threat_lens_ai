import { ScanTabs } from "@/components/ScanTabs";

export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          AI Internet Safety Center
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Check a URL, email, or SMS message for phishing and scam risk.
        </p>
        <div className="mt-8">
          <ScanTabs />
        </div>
      </main>
    </div>
  );
}
