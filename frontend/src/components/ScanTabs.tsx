"use client";

import { useState } from "react";
import { ScanForm } from "./ScanForm";
import { MessageScanForm } from "./MessageScanForm";

const TABS = [
  { id: "url", label: "URL" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ScanTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("url");

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? "border-b-2 border-black text-black dark:border-white dark:text-white"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {activeTab === "url" && <ScanForm />}
        {activeTab === "email" && <MessageScanForm scanType="email" />}
        {activeTab === "sms" && <MessageScanForm scanType="sms" />}
      </div>
    </div>
  );
}
