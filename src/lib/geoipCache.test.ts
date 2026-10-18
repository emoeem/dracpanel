import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/panel")>();
  return { ...actual, getGeoIp: vi.fn() };
});

import {
  GeoIpUnavailableError,
  getGeoIp,
  type GeoIpInfo,
} from "../api/panel";
import {
  clearGeoIpCache,
  isGeoIpUnavailable,
  lookupGeoIp,
} from "./geoipCache";

const mockedGetGeoIp = vi.mocked(getGeoIp);

beforeEach(() => {
  clearGeoIpCache();
  mockedGetGeoIp.mockReset();
});

describe("lookupGeoIp", () => {
  it("deduplicates concurrent lookups and caches the result", async () => {
    let resolve: (value: GeoIpInfo | null) => void = () => {};
    const pending = new Promise<GeoIpInfo | null>((done) => {
      resolve = done;
    });
    mockedGetGeoIp.mockReturnValue(pending);

    const first = lookupGeoIp("1.1.1.1");
    const second = lookupGeoIp("1.1.1.1");
    expect(mockedGetGeoIp).toHaveBeenCalledTimes(1);

    resolve({ lon: 151.2, lat: -33.8 });
    await expect(first).resolves.toEqual({ lon: 151.2, lat: -33.8 });
    await expect(second).resolves.toEqual({ lon: 151.2, lat: -33.8 });
    await expect(lookupGeoIp("1.1.1.1")).resolves.toEqual({
      lon: 151.2,
      lat: -33.8,
    });
    expect(mockedGetGeoIp).toHaveBeenCalledTimes(1);
  });

  it("caches private/unresolvable results as null", async () => {
    mockedGetGeoIp.mockResolvedValue(null);
    await expect(lookupGeoIp("10.0.0.1")).resolves.toBeNull();
    await expect(lookupGeoIp("10.0.0.1")).resolves.toBeNull();
    expect(mockedGetGeoIp).toHaveBeenCalledTimes(1);
  });

  it("disables further lookups after a 503", async () => {
    mockedGetGeoIp.mockRejectedValue(new GeoIpUnavailableError());
    await expect(lookupGeoIp("1.1.1.1")).rejects.toBeInstanceOf(
      GeoIpUnavailableError,
    );
    expect(isGeoIpUnavailable()).toBe(true);
    await expect(lookupGeoIp("8.8.8.8")).resolves.toBeNull();
    expect(mockedGetGeoIp).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ordinary failure", async () => {
    mockedGetGeoIp.mockRejectedValueOnce(new Error("network"));
    await expect(lookupGeoIp("1.1.1.1")).rejects.toThrow("network");
    await expect(lookupGeoIp("1.1.1.1")).resolves.toBeNull();
    expect(mockedGetGeoIp).toHaveBeenCalledTimes(1);
  });
});
