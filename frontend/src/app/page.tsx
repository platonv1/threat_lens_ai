import { ScanForm } from "@/components/ScanForm";

export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          AI Internet Safety Center
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Check a URL for phishing and scam risk before you visit it.
        </p>
        <div className="mt-8">
          <ScanForm />
        </div>
      </main>
    </div>
  );
}
