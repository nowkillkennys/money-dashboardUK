"use client";
import { MoneyShell } from "../../components/money-shell";
import { ChatContent } from "../../chat/chat-content";
export default function MoneyDemoChatPage() {
  return (<MoneyShell demoMode routeBase="/demo">{process.env.NEXT_PUBLIC_UK_DEMO_ONLY === "true" ? <section className="p-6"><h1 className="text-2xl font-semibold">AI is disabled in this preview</h1><p className="mt-3">No financial information, chat or audio is sent to an AI provider. This integration needs a separate decision and privacy review.</p></section> : <ChatContent demoMode />}</MoneyShell>);
}
