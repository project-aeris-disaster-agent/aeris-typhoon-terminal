export class MindsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
  }) {
    super(args.message);
    this.name = "MindsApiError";
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
  }
}

export function createMindsClient() {
  return {
    listMinds: jest.fn(),
    createConversation: jest.fn(),
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    sendMessage: jest.fn(),
    getHistory: jest.fn(),
    getLatestHistoryFingerprint: jest.fn(),
    subscribeEvents: jest.fn(),
    eventsIterator: jest.fn(),
    waitForReply: jest.fn(),
    ensureConversation: jest.fn(),
    getMindIdForAlias: jest.fn(),
  };
}

export const BUILDER_API_KEY_ENV = "MINDS_BUILDER_API_KEY";
