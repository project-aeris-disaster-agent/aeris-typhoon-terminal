/** @jest-environment node */

const mockedEnsureConversation = jest.fn();

jest.mock("@/lib/minds-client", () => ({
  mindsClientAvailable: jest.fn(),
  getMindsClient: jest.fn(() => ({
    ensureConversation: mockedEnsureConversation,
  })),
  describeMindsApiError: jest.fn(() => "boom"),
}));

import { mindsClientAvailable } from "@/lib/minds-client";
import {
  ensureUserPartnerConversation,
  userPartnerAlias,
} from "@/lib/minds-user-partner";

const mockedAvailable = mindsClientAvailable as jest.MockedFunction<
  typeof mindsClientAvailable
>;

describe("minds-user-partner", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_AERIS_MIND_ID = "mind-shared";
    delete process.env.MINDS_VOLUNTEER_MIND_ID;
    delete process.env.MINDS_RESPONDER_MIND_ID;
    delete process.env.MINDS_LGU_MIND_ID;
    mockedAvailable.mockReturnValue(true);
    mockedEnsureConversation.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("normalizes Privy DIDs into stable aliases", () => {
    expect(userPartnerAlias("did:privy:cm123ABC")).toBe(
      "aeris-user-did-privy-cm123abc",
    );
    // Stable: same input, same alias.
    expect(userPartnerAlias("did:privy:cm123ABC")).toBe(
      userPartnerAlias("did:privy:cm123ABC"),
    );
  });

  it("falls back to the shared Watch Officer Mind when no role Mind is set", async () => {
    const conversation = await ensureUserPartnerConversation({
      userId: "did:privy:u1",
      role: "responder",
    });
    expect(conversation).toEqual({
      alias: "aeris-user-did-privy-u1",
      mindId: "mind-shared",
      role: "responder",
    });
    expect(mockedEnsureConversation).toHaveBeenCalledWith(
      "aeris-user-did-privy-u1",
      "mind-shared",
    );
  });

  it("uses the role Mind when provisioned", async () => {
    process.env.MINDS_LGU_MIND_ID = "mind-lgu";
    const conversation = await ensureUserPartnerConversation({
      userId: "did:privy:u2",
      role: "lgu",
    });
    expect(conversation?.mindId).toBe("mind-lgu");
  });

  it("returns null when Minds is unavailable", async () => {
    mockedAvailable.mockReturnValue(false);
    const conversation = await ensureUserPartnerConversation({
      userId: "did:privy:u3",
    });
    expect(conversation).toBeNull();
  });
});
