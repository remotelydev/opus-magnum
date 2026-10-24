import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentFirstMessage,
  agentPrompt,
  AVAILABILITY_TOOL,
  HOURS_TOOL,
  TICKET_CATEGORY_VALUES,
  TICKET_TOOL,
} from "../src/agent.js";
import { findLocation, loadConfig } from "../src/config.js";
import { loadLocalEnv } from "../src/env.js";

loadLocalEnv();

const [publicUrlArg, siteArg = "turek"] = process.argv.slice(2);
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const toolSecret = process.env.ELEVENLABS_TOOL_SECRET?.trim();
const apiBase = process.env.ELEVENLABS_API_BASE?.trim() || "https://api.elevenlabs.io";
const llm = process.env.ELEVENLABS_LLM?.trim() || "gemini-2.5-flash";
const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

if (!publicUrlArg?.startsWith("https://") || !apiKey || !toolSecret) {
  console.error(
    "Usage: pnpm --filter reception-api agent:sync https://<tunnel host> [turek|poddebice]\n" +
      "Needs ELEVENLABS_API_KEY and ELEVENLABS_TOOL_SECRET in .env.",
  );
  process.exit(1);
}

const publicUrl = publicUrlArg.replace(/\/+$/, "");
const config = loadConfig();
const location = findLocation(config, siteArg);
if (!location) {
  console.error(`Unknown site "${siteArg}". Use: ${config.locations.map((l) => l.id).join(", ")}`);
  process.exit(1);
}

const statePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  `elevenlabs-${location.id}.json`,
);

interface AgentState {
  agentId?: string;
  hoursToolId?: string;
  availabilityToolId?: string;
  ticketToolId?: string;
}

async function loadState(): Promise<AgentState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as AgentState;
  } catch {
    return {};
  }
}

async function api(method: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "xi-api-key": apiKey!, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const headers = { "x-agent-secret": toolSecret };

const hoursTool = {
  type: "webhook",
  name: HOURS_TOOL,
  description:
    "Sprawdza, czy gabinet jest teraz otwarty, kiedy będzie otwarty najbliżej (z uwzględnieniem świąt), oraz podaje godziny, adres i telefon.",
  response_timeout_secs: 10,
  api_schema: {
    url: `${publicUrl}/agent/hours/${location.id}`,
    method: "GET",
    request_headers: headers,
  },
};

const availabilityTool = {
  type: "webhook",
  name: AVAILABILITY_TOOL,
  description:
    "Podaje najbliższe wolne terminy u lekarzy w tym gabinecie, z kopii kalendarza. To propozycje; recepcja potwierdza termin.",
  response_timeout_secs: 10,
  api_schema: {
    url: `${publicUrl}/agent/availability/${location.id}`,
    method: "GET",
    request_headers: headers,
    query_params_schema: {
      properties: {
        part: {
          type: "string",
          enum: ["rano", "poludnie", "popoludnie"],
          description: "Pora dnia, jeśli pacjent ją podał.",
        },
        from: {
          type: "string",
          description: "Najwcześniejszy dzień w formacie RRRR-MM-DD, jeśli pacjent podał dzień.",
        },
        doctor: {
          type: "string",
          description: "employeeId lekarza z poprzedniej odpowiedzi, jeśli pacjent chce konkretnego lekarza.",
        },
      },
    },
  },
};

const ticketTool = {
  type: "webhook",
  name: TICKET_TOOL,
  description:
    "Wysyła zgłoszenie do recepcji na WhatsApp. Użyj dopiero po zebraniu wszystkich danych i potwierdzeniu numeru telefonu.",
  response_timeout_secs: 20,
  api_schema: {
    url: `${publicUrl}/agent/ticket/${location.id}`,
    method: "POST",
    request_headers: headers,
    request_body_schema: {
      type: "object",
      description: "Dane zgłoszenia. Bez powodu wizyty i bez objawów.",
      required: ["name", "phone", "category", "slot", "urgent"],
      properties: {
        name: { type: "string", description: "Imię i nazwisko pacjenta." },
        phone: {
          type: "string",
          description: "Numer telefonu pacjenta, same cyfry, z +48 jeśli podany.",
        },
        category: {
          type: "string",
          enum: TICKET_CATEGORY_VALUES,
          description: "book = wizyta, callback = prośba o telefon, other = inna sprawa.",
        },
        slot: {
          type: "string",
          description: "Preferowany dzień i pora dnia, np. 'wtorek rano'. Najwyżej 40 znaków.",
        },
        urgent: { type: "boolean", description: "Czy sprawa jest pilna." },
        returning: {
          type: "boolean",
          description: "Czy pacjent był już w gabinecie. Pomiń, jeśli nie wiadomo.",
        },
      },
    },
  },
};

async function upsertTool(id: string | undefined, toolConfig: object): Promise<string> {
  if (id) {
    await api("PATCH", `/v1/convai/tools/${id}`, { tool_config: toolConfig });
    return id;
  }
  const created = await api("POST", "/v1/convai/tools", { tool_config: toolConfig });
  return created.id as string;
}

const state = await loadState();
state.hoursToolId = await upsertTool(state.hoursToolId, hoursTool);
state.ticketToolId = await upsertTool(state.ticketToolId, ticketTool);
state.availabilityToolId = await upsertTool(state.availabilityToolId, availabilityTool);

const agent = {
  name: `${location.name} (test)`,
  conversation_config: {
    agent: {
      first_message: agentFirstMessage(location),
      language: "pl",
      prompt: {
        prompt: agentPrompt(config, location),
        llm,
        tool_ids: [state.hoursToolId, state.availabilityToolId, state.ticketToolId],
      },
    },
    tts: {
      model_id: "eleven_flash_v2_5",
      ...(voiceId ? { voice_id: voiceId } : {}),
    },
  },
};

if (state.agentId) {
  await api("PATCH", `/v1/convai/agents/${state.agentId}`, agent);
} else {
  const created = await api("POST", "/v1/convai/agents/create", agent);
  state.agentId = created.agent_id as string;
}

await mkdir(dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2));

console.log(`Agent ready: ${agent.name}`);
console.log(`Talk to it: https://elevenlabs.io/app/agents/agents/${state.agentId}`);
console.log(`Tools call: ${publicUrl}/agent/…`);
