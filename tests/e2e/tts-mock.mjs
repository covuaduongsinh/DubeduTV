// Máy chủ giả lập Azure AI Speech và Google Cloud Text-to-Speech cho e2e:
// đúng key thì trả danh sách giọng / âm thanh (WAV im lặng thay cho MP3),
// sai key thì trả lỗi như dịch vụ thật (Azure 401, Google 400 API_KEY_INVALID).
import { silenceWav } from "./fixtures.mjs";

export const ttsRequests = [];
export const TTS_KEYS = { azure: "good-azure-key", gcloud: "good-gcloud-key" };

const AUDIO = silenceWav(0.4);
const AZURE_VOICES = [
  {
    ShortName: "vi-VN-HoaiMyNeural",
    LocalName: "Hoài My",
    Gender: "Female",
    Locale: "vi-VN",
  },
  {
    ShortName: "vi-VN-NamMinhNeural",
    LocalName: "Nam Minh",
    Gender: "Male",
    Locale: "vi-VN",
  },
];
const GOOGLE_VOICES = {
  voices: [
    {
      name: "vi-VN-Standard-A",
      languageCodes: ["vi-VN"],
      ssmlGender: "FEMALE",
    },
    { name: "vi-VN-Wavenet-B", languageCodes: ["vi-VN"], ssmlGender: "MALE" },
  ],
};
const INVALID_KEY = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ reason: "API_KEY_INVALID" }],
  },
};

const ROUTES = {
  "azure /cognitiveservices/voices/list": () => [
    "application/json",
    JSON.stringify(AZURE_VOICES),
  ],
  "azure /cognitiveservices/v1": () => ["audio/wav", AUDIO],
  "gcloud /v1/voices": () => [
    "application/json",
    JSON.stringify(GOOGLE_VOICES),
  ],
  "gcloud /v1/text:synthesize": () => [
    "application/json",
    JSON.stringify({ audioContent: AUDIO.toString("base64") }),
  ],
};

export function isTtsRequest(pathname) {
  return pathname.startsWith("/azure/") || pathname.startsWith("/gcloud/");
}

function readBody(request) {
  return new Promise((resolve) => {
    const parts = [];
    request.on("data", (part) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  });
}

export async function handleTts(url, request, send) {
  const engine = url.pathname.startsWith("/azure/") ? "azure" : "gcloud";
  const key =
    engine === "azure"
      ? request.headers["ocp-apim-subscription-key"]
      : request.headers["x-goog-api-key"];
  const path = url.pathname.slice(engine.length + 1);
  ttsRequests.push({ engine, path, key, body: await readBody(request) });
  if (key !== TTS_KEYS[engine])
    return engine === "azure"
      ? send(401, "text/plain", "")
      : send(400, "application/json", JSON.stringify(INVALID_KEY));
  const route = ROUTES[`${engine} ${path}`];
  if (!route) return send(404, "text/plain", "");
  const [type, body] = route();
  return send(200, type, body);
}
