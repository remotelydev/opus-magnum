export const SMSAPI_URL = "https://api.smsapi.pl/sms.do";

export interface SmsApiEnv {
  token: string;
  sender: string | undefined;
}

export type SendSmsResult =
  | { sent: true; id: string }
  | { sent: false; reason: "no_token" };

export class SmsApiError extends Error {
  readonly code: string;

  constructor(code: string, details: string) {
    super(`smsapi_failed:${code}:${details}`);
    this.name = "SmsApiError";
    this.code = code;
  }
}

export function resolveSmsApiEnv(env: NodeJS.Dict<string> = process.env): SmsApiEnv | null {
  const token = env.SMSAPI_TOKEN?.trim();
  if (!token) {
    return null;
  }
  return { token, sender: env.SMSAPI_SENDER?.trim() || undefined };
}

interface SmsApiResponse {
  list?: Array<{ id?: string }>;
  error?: number | string;
  message?: string;
}

export async function sendSms(options: {
  env: SmsApiEnv | null;
  to: string;
  message: string;
  log: (message: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<SendSmsResult> {
  if (!options.env) {
    options.log(`SMSAPI_TOKEN missing; SMS not sent to ${options.to}: ${options.message}`);
    return { sent: false, reason: "no_token" };
  }
  const form = new URLSearchParams({
    to: options.to.replace(/^\+/, ""),
    message: options.message,
    encoding: "utf-8",
    format: "json",
  });
  if (options.env.sender) {
    form.set("from", options.env.sender);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(SMSAPI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.env.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const raw = await response.text();
  let parsed: SmsApiResponse = {};
  try {
    parsed = JSON.parse(raw) as SmsApiResponse;
  } catch {
    throw new SmsApiError(`http_${response.status}`, raw.slice(0, 200));
  }
  const id = parsed.list?.[0]?.id;
  if (parsed.error !== undefined || !id) {
    throw new SmsApiError(String(parsed.error ?? `http_${response.status}`), parsed.message ?? "");
  }
  return { sent: true, id };
}
