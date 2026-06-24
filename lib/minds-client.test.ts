/** @jest-environment node */

import {
  mindsClientAvailable,
  resetMindsClientForTests,
  describeMindsApiError,
} from "@/lib/minds-client";
import { MindsApiError } from "@animocabrands/minds-client-lib";

describe("minds-client", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    resetMindsClientForTests();
    delete process.env.MINDS_BUILDER_API_KEY;
    delete process.env.MINDS_AERIS_MIND_ID;
  });

  afterEach(() => {
    process.env = env;
    resetMindsClientForTests();
  });

  it("reports unavailable when builder key or mind id is missing", () => {
    expect(mindsClientAvailable()).toBe(false);

    process.env.MINDS_BUILDER_API_KEY = "key";
    expect(mindsClientAvailable()).toBe(false);

    process.env.MINDS_AERIS_MIND_ID = "mind-1";
    expect(mindsClientAvailable()).toBe(true);
  });

  it("maps MindsApiError status codes to operator messages", () => {
    expect(
      describeMindsApiError(
        new MindsApiError({
          status: 401,
          code: "unauthorized",
          message: "bad key",
        }),
      ),
    ).toContain("missing, invalid, or revoked");

    expect(
      describeMindsApiError(
        new MindsApiError({
          status: 429,
          code: "rate_limit",
          message: "slow down",
        }),
      ),
    ).toContain("rate limit");
  });
});
