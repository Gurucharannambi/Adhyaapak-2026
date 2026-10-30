import { useEffect } from "react";

/** Adds classes to <body> while a screen is mounted (student phone sizing, chalkboard theme). */
export function useBodyClass(...names: string[]) {
  const key = names.join(" ");
  useEffect(() => {
    const list = key.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [key]);
}
