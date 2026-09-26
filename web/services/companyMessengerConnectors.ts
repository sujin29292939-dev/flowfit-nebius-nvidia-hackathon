import type { StaffConfirmationRequest } from "@/types/flowfit";

export interface CompanyMessengerConnector {
  sendStaffRequest(request: StaffConfirmationRequest): Promise<{
    externalMessageId: string;
    sentAt: string;
  }>;

  receiveStaffResponse(payload: unknown): Promise<{
    requestId: string;
    response: string;
    responseMemo?: string;
    respondedAt: string;
  }>;
}

function makeExternalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class MockConnector implements CompanyMessengerConnector {
  async sendStaffRequest(request: StaffConfirmationRequest) {
    return {
      externalMessageId: makeExternalId("mock-message"),
      sentAt: new Date().toISOString(),
    };
  }

  async receiveStaffResponse(payload: unknown) {
    const data = payload as {
      requestId?: string;
      response?: string;
      responseMemo?: string;
    };

    return {
      requestId: data.requestId ?? "",
      response: data.response ?? "확인 중",
      responseMemo: data.responseMemo,
      respondedAt: new Date().toISOString(),
    };
  }
}

class PlaceholderConnector implements CompanyMessengerConnector {
  constructor(private readonly name: string) {}

  async sendStaffRequest(): Promise<{ externalMessageId: string; sentAt: string }> {
    throw new Error(`${this.name} connector is not configured yet.`);
  }

  async receiveStaffResponse(): Promise<{ requestId: string; response: string; respondedAt: string }> {
    throw new Error(`${this.name} connector is not configured yet.`);
  }
}

export class SMSConnector extends PlaceholderConnector {
  constructor() {
    super("SMS");
  }
}

export class EmailConnector extends PlaceholderConnector {
  constructor() {
    super("Email");
  }
}

export class SlackConnector extends PlaceholderConnector {
  constructor() {
    super("Slack");
  }
}

export class TeamsConnector extends PlaceholderConnector {
  constructor() {
    super("Teams");
  }
}

export class KakaoWorkConnector extends PlaceholderConnector {
  constructor() {
    super("KakaoWork");
  }
}

export class TelegramConnector extends PlaceholderConnector {
  constructor() {
    super("Telegram");
  }
}

export const mockConnector = new MockConnector();

