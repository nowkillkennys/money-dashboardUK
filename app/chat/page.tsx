"use client";
import { MoneyShell } from "../components/money-shell";
import { ChatContent } from "./chat-content";
export default function ChatPage() {
  return (<MoneyShell>{process.env.NEXT_PUBLIC_AUTHENTICATED_APP === "true" ? <section className="money-surface p-6"><h1 className="text-2xl font-semibold">AI is disabled</h1><p>No account data is sent to an AI provider. Live AI setup remains a separate step.</p></section> : <ChatContent />}</MoneyShell>);
}
