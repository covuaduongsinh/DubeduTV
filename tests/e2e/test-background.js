// Chỉ có trong bản build --test, nạp vào service worker: kịch bản ghi
// storage.local "ltvTestTts" ({ azure, gcloud }: gốc URL máy chủ giả lập) thì
// giọng AI đám mây gọi máy chủ đó, không thì gọi dịch vụ thật.
import { ENDPOINTS } from "../background/tts-cloud.js";

const real = { ...ENDPOINTS };
for (const engine of Object.keys(real)) {
  ENDPOINTS[engine] = async (region) => {
    const { ltvTestTts } = await chrome.storage.local.get("ltvTestTts");
    return ltvTestTts?.[engine] || real[engine](region);
  };
}
