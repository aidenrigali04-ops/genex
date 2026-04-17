"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MutableRefObject, Ref } from "react";

import { cn } from "@/lib/utils";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

export type LazyVideoPlayerProps = {
  src: string;
  poster?: string;
  className?: string;
  /** Merged onto `<video>` when loaded (defaults include sizing/object-fit). */
  videoClassName?: string;
  /** Called after the lazy gate opens and the `<video>` is in the tree (and when `src` changes while loaded). */
  onVideoMount?: () => void;
} & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src" | "poster">;

/**
 * Defers mounting `<video src>` until the container nears the viewport
 * (`rootMargin: 200px`) to avoid decoding every variation at once.
 */
export const LazyVideoPlayer = forwardRef<HTMLVideoElement, LazyVideoPlayerProps>(
  function LazyVideoPlayer(
    {
      src,
      poster,
      className,
      videoClassName,
      onVideoMount,
      preload = "metadata",
      controls = true,
      ...videoProps
    },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [shouldLoad, setShouldLoad] = useState(false);
    const onVideoMountRef = useRef(onVideoMount);
    onVideoMountRef.current = onVideoMount;

    const setVideoNode = useCallback(
      (node: HTMLVideoElement | null) => {
        videoRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) setShouldLoad(true);
        },
        { rootMargin: "200px" },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
      if (!shouldLoad) return;
      onVideoMountRef.current?.();
    }, [shouldLoad, src]);

    return (
      <div ref={containerRef} className={className}>
        {shouldLoad ? (
          <video
            ref={setVideoNode}
            src={src}
            poster={poster}
            controls={controls}
            preload={preload}
            className={cn("h-full w-full object-cover", videoClassName)}
            {...videoProps}
          />
        ) : (
          <div className="flex h-full min-h-[120px] w-full items-center justify-center rounded-xl bg-white/5 animate-pulse">
            <span className="text-sm text-white/30">Loading…</span>
          </div>
        )}
      </div>
    );
  },
);
