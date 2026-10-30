import { useEffect, useRef, useState } from "react";

/**
 * Listens for live "something changed" signals from the server (Server-Sent Events) and calls `onChange`, which should
 * re-read the normal API. The signals carry no data. Returns whether the live connection is up, so a screen can say so.
 *
 * Browsers reconnect on their own after a dropped connection. Where EventSource does not exist, or while the connection
 * is down, the caller's own polling (useApi's refreshMs) keeps the screen fresh, only a little slower.
 * Pass null to stay disconnected (for example before the person is signed in).
 */
export function useLive(url: string | null, onChange: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    const source = new EventSource(url, { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("change", () => {
      // Several answers can arrive together; one refresh is enough.
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 120);
    });
    source.onerror = () => setConnected(false);
    return () => {
      clearTimeout(timer);
      source.close();
      setConnected(false);
    };
  }, [url]);

  return connected;
}
