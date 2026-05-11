"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/utils";

export function RelativeTime({
  ts,
  className,
}: {
  ts: string | null | undefined;
  className?: string;
}) {
  // Render empty on server to avoid hydration mismatch (server/client clocks differ).
  const [text, setText] = useState<string>("");
  useEffect(() => {
    setText(formatRelative(ts));
    const t = setInterval(() => setText(formatRelative(ts)), 30_000);
    return () => clearInterval(t);
  }, [ts]);
  if (!ts) {
    return (
      <span className={className} suppressHydrationWarning>
        {text}
      </span>
    );
  }
  return (
    <time
      dateTime={ts}
      title={new Date(ts).toLocaleString()}
      className={className}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}
