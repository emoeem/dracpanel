import { describe, expect, it } from "vitest";

import { ServiceStatus_Type } from "../gen/daemon/started_service_pb";
import { shouldResetStatusHistory } from "./daemon";

describe("shouldResetStatusHistory", () => {
  it("clears samples when the core enters STARTING after a previous run", () => {
    expect(shouldResetStatusHistory(ServiceStatus_Type.STARTED, ServiceStatus_Type.STARTING)).toBe(
      true,
    );
    expect(shouldResetStatusHistory(ServiceStatus_Type.IDLE, ServiceStatus_Type.STARTING)).toBe(
      true,
    );
  });

  it("clears on the first STARTING and ignores repeated STARTING events", () => {
    expect(shouldResetStatusHistory(null, ServiceStatus_Type.STARTING)).toBe(true);
    expect(
      shouldResetStatusHistory(ServiceStatus_Type.STARTING, ServiceStatus_Type.STARTING),
    ).toBe(false);
  });
});
