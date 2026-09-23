"use client";

import { useCallback, useEffect, useState } from "react";

import { APP_VERSION, isNewer } from "@/lib/app-meta";
import type { AppMeta as ServerAppMeta } from "@/lib/app-meta-server";

import {
  browserStorage,
  readGrowthState,
  writeGrowthFlag,
  type GrowthState,
} from "./growth-storage";

type AppMeta = ServerAppMeta & { feedbackUrl: string | null };

export function useAppMeta() {
  const [meta, setMeta] = useState<AppMeta>({
    version: APP_VERSION,
    latestVersion: null,
    feedbackUrl: null,
  });
  const [state, setState] = useState<GrowthState>({
    ok: false,
    seenVersion: null,
  });

  useEffect(() => {
    let cancelled = false;
    // 저장소 상태는 서버 렌더와 어긋나지 않도록 마운트 뒤, 응답과 함께 한 번에 반영한다.
    fetch("/api/app-meta")
      .then((res) => (res.ok ? (res.json() as Promise<AppMeta>) : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        setState(readGrowthState(browserStorage()));
        if (data) setMeta(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUpdate =
    state.ok &&
    isNewer(meta.latestVersion, meta.version) &&
    state.seenVersion !== meta.latestVersion;

  const markUpdateSeen = useCallback(() => {
    if (!meta.latestVersion) return;
    writeGrowthFlag(browserStorage(), "seenVersion", meta.latestVersion);
    setState((s) => ({ ...s, seenVersion: meta.latestVersion }));
  }, [meta.latestVersion]);

  return {
    ...meta,
    updateAvailable: isNewer(meta.latestVersion, meta.version),
    hasUpdate,
    markUpdateSeen,
  };
}

export type AppMetaView = ReturnType<typeof useAppMeta>;
