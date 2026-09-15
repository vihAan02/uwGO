import { useCallback, useEffect, useRef } from "react";

type Marked = { uwgoLayer?: string } | null;
const holds = (name: string) => (window.history.state as Marked)?.uwgoLayer === name;

/**
 * Back closes an open layer (the settings sheet) instead of leaving the page under it, the way Back ends a
 * trip. While `open`, the layer keeps a history entry of its own, and Back pops it. Closing from the screen
 * (the close button, the scrim, Escape) goes through the returned `close`, which steps back over that entry
 * as well, so the next Back is never a dead press.
 */
export function useBackCloses(name: string, open: boolean, onClose: () => void): () => void {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    // Under React's development double effects the entry is already there, and is not stacked twice.
    if (!holds(name)) window.history.pushState({ ...(window.history.state ?? {}), uwgoLayer: name }, "");
    const onPop = () => { if (!holds(name)) onCloseRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [name, open]);
  return useCallback(() => {
    if (holds(name)) window.history.back();
    onCloseRef.current();
  }, [name]);
}
