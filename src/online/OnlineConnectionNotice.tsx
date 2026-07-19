export function ConnectionNotice({ connected, context }: { connected: boolean; context: "lobby" | "game" }) {
  if (connected) return null;
  return <div className="online-connection-notice" role="status" aria-live="polite"><strong>Reconnecting…</strong><span>{context === "game" ? "The table is read-only until your connection returns." : "Room controls will return when you’re connected."}</span></div>;
}
