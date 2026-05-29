"use client";

import { useState, useEffect } from "react";

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

export function useMicPermission() {
  const [permission, setPermission] = useState<MicPermission>("unknown");

  useEffect(() => {
    if (!navigator.permissions) return;
    let result: PermissionStatus | null = null;
    const onChange = () => {
      if (result) setPermission(result.state as MicPermission);
    };
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        result = status;
        setPermission(status.state as MicPermission);
        status.onchange = onChange;
      })
      .catch(() => setPermission("unknown"));
    return () => {
      if (result) result.onchange = null;
    };
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      // Stop immediately — we only wanted the permission grant.
      stream.getTracks().forEach((t) => t.stop());
      setPermission("granted");
      return true;
    } catch {
      setPermission("denied");
      return false;
    }
  };

  return { permission, requestPermission };
}
