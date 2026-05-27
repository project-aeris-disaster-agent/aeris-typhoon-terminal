import { renderHook, waitFor } from "@testing-library/react";
import { useAgentSpeech } from "@/hooks/useAgentSpeech";

type SpeechHookProps = Parameters<typeof useAgentSpeech>[0];
type SpeechHookReturn = ReturnType<typeof useAgentSpeech>;

const speakMock = jest.fn(
  (
    _text: string,
    _emotion: string,
    callbacks: { onStart?: () => void; onEnd?: () => void },
  ) => {
    callbacks.onStart?.();
    return Promise.resolve().then(() => callbacks.onEnd?.());
  },
);

jest.mock("@/lib/agent-speech/create-driver", () => ({
  createAgentSpeechDriver: async () => ({
    prepare: jest.fn().mockResolvedValue(undefined),
    speak: speakMock,
    stop: jest.fn(),
    subscribeMouthLevel: (listener: (n: number) => void) => {
      listener(0);
      return () => undefined;
    },
    dispose: jest.fn(),
  }),
}));

describe("useAgentSpeech", () => {
  beforeEach(() => {
    speakMock.mockClear();
  });

  it("does not speak until history ids are seeded", async () => {
    const { rerender } = renderHook<SpeechHookReturn, SpeechHookProps>(
      (props) => useAgentSpeech(props),
      {
        initialProps: {
          messages: [
            {
              id: "hist-1",
              role: "assistant",
              content: "Old brief from database.",
              source: "assistant",
            },
          ],
          isActive: true,
          muted: false,
          seededMessageIds: null,
        },
      },
    );

    await waitFor(() => {
      expect(speakMock).not.toHaveBeenCalled();
    });

    rerender({
      messages: [
        {
          id: "hist-1",
          role: "assistant",
          content: "Old brief from database.",
          source: "assistant",
        },
      ],
      isActive: true,
      muted: false,
      seededMessageIds: new Set(["hist-1"]),
    });

    await waitFor(() => {
      expect(speakMock).not.toHaveBeenCalled();
    });
  });

  it("speaks new assistant messages after seeding", async () => {
    const { rerender } = renderHook<SpeechHookReturn, SpeechHookProps>(
      (props) => useAgentSpeech(props),
      {
        initialProps: {
          messages: [
            {
              id: "hist-1",
              role: "assistant",
              content: "Prior message.",
              source: "assistant",
            },
          ],
          isActive: true,
          muted: false,
          seededMessageIds: new Set(["hist-1"]),
        },
      },
    );

    rerender({
      messages: [
        {
          id: "hist-1",
          role: "assistant",
          content: "Prior message.",
          source: "assistant",
        },
        {
          id: "new-1",
          role: "assistant",
          content: "Fresh response for the operator.",
          source: "assistant",
        },
      ],
      isActive: true,
      muted: false,
      seededMessageIds: new Set(["hist-1"]),
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock.mock.calls[0][0]).toContain("Fresh response");
    });
  });

  it("does not speak when muted", async () => {
    renderHook(() =>
      useAgentSpeech({
        messages: [
          {
            id: "new-2",
            role: "assistant",
            content: "Should stay silent.",
            source: "assistant",
          },
        ],
        isActive: true,
        muted: true,
        seededMessageIds: new Set(),
      }),
    );

    await waitFor(() => {
      expect(speakMock).not.toHaveBeenCalled();
    });
  });
});
