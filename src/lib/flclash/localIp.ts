import { useEffect, useState } from "react";

const IPV4 = /(\d{1,3}(?:\.\d{1,3}){3})/;

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function chooseAddress(addresses: Iterable<string>): string | null {
  let fallback: string | null = null;
  for (const address of addresses) {
    if (address === "0.0.0.0" || address.startsWith("127.")) {
      continue;
    }
    if (isPrivateIpv4(address)) {
      return address;
    }
    fallback ??= address;
  }
  return fallback;
}

/**
 * Best-effort LAN IP when the panel does not expose one. Modern browsers may
 * return mDNS hostnames instead of host candidates; the caller shows a neutral
 * "无网络" in that case rather than inventing an address.
 */
export function detectLocalIp(timeoutMs = 1500): Promise<string | null> {
  if (typeof window === "undefined" || typeof window.RTCPeerConnection === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const addresses = new Set<string>();
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    let peer: RTCPeerConnection;
    try {
      peer = new RTCPeerConnection({ iceServers: [] });
    } catch {
      finish(null);
      return;
    }
    const close = () => {
      try {
        peer.close();
      } catch {
        // Closing an already-closed peer is harmless.
      }
    };
    const timer = setTimeout(() => {
      close();
      finish(chooseAddress(addresses));
    }, timeoutMs);
    peer.addEventListener("icecandidate", (event) => {
      const candidate = event.candidate?.candidate ?? "";
      const match = candidate.match(IPV4);
      if (match) {
        addresses.add(match[1]);
      }
    });
    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timer);
        close();
        finish(chooseAddress(addresses));
      }
    });
    try {
      const channel = peer.createDataChannel("flclash-local-ip");
      channel.close();
      void peer
        .createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          close();
          finish(null);
        });
    } catch {
      clearTimeout(timer);
      close();
      finish(null);
    }
  });
}

export function useLocalIp(panelIp: string | null | undefined): string | null {
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    if (panelIp) {
      return;
    }
    let active = true;
    void detectLocalIp().then((value) => {
      if (active) {
        setDetected(value);
      }
    });
    return () => {
      active = false;
    };
  }, [panelIp]);
  return panelIp || detected;
}
