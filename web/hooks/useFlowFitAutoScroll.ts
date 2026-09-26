"use client";

import * as React from "react";

export function useFlowFitAutoScroll(dependency: unknown, forceScrollDependency?: unknown) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const shouldStickRef = React.useRef(true);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const root = scrollRef.current;
    if (!root) return;

    root.scrollTo({
      top: root.scrollHeight,
      behavior,
    });
  }, []);

  React.useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const scrollRoot = root;

    function updateBottomState() {
      const distanceFromBottom = scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight;
      const nextIsAtBottom = distanceFromBottom < 96;
      shouldStickRef.current = nextIsAtBottom;
      setIsAtBottom(nextIsAtBottom);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextIsAtBottom =
          Boolean(entry?.isIntersecting) || scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight < 96;
        shouldStickRef.current = nextIsAtBottom;
        setIsAtBottom(nextIsAtBottom);
      },
      {
        root: scrollRoot,
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    scrollRoot.addEventListener("scroll", updateBottomState, { passive: true });
    updateBottomState();

    return () => {
      observer.disconnect();
      scrollRoot.removeEventListener("scroll", updateBottomState);
    };
  }, []);

  React.useLayoutEffect(() => {
    if (!shouldStickRef.current) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [dependency, scrollToBottom]);

  React.useLayoutEffect(() => {
    shouldStickRef.current = true;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [forceScrollDependency, scrollToBottom]);

  return {
    isAtBottom,
    scrollRef,
    scrollToBottom,
    sentinelRef,
  };
}
