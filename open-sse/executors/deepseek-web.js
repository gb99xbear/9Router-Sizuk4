import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import crypto from "node:crypto";
import http from "node:http";

const CDP_HTTP = "http://127.0.0.1:9222";
const DEEPSEEK_HOST = "chat.deepseek.com";
let queue = Promise.resolve();

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 8000 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`CDP target returned HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error("CDP target JSON unavailable")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("CDP target request timed out")));
    request.on("error", reject);
  });
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error("CDP websocket connection failed")); });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) { this.pending.get(message.id)(message); this.pending.delete(message.id); }
      if (message.method) for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    };
  }
  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener); this.listeners.set(method, list);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter(item => item !== listener));
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, message => { clearTimeout(timer); resolve(message); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, timeout = 15000) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    const output = result.result?.result;
    if (output?.subtype === "error") throw new Error(output.description || "DeepSeek page JavaScript error");
    return output?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function getCdp() {
  const targets = await httpJson(`${CDP_HTTP}/json/list`);
  const page = targets.find(target => target.type === "page" && target.url.includes(DEEPSEEK_HOST));
  if (!page) throw new Error("No active chat.deepseek.com browser tab - login to DeepSeek Web first");
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

function promptFromMessages(messages) {
  return messages.map(message => `${message.role === "system" ? "System" : message.role === "assistant" ? "Assistant" : "User"}: ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`).join("\n\n");
}

function extractSseContent(body) {
  let content = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.slice(6));
      const initial = data?.v?.response?.fragments;
      if (Array.isArray(initial)) for (const fragment of initial) if (fragment?.type === "RESPONSE" && typeof fragment.content === "string") content += fragment.content;
      if (data?.p === "response/fragments/-1/content" && data?.o === "APPEND" && typeof data.v === "string") content += data.v;
      else if (!data?.p && typeof data?.v === "string") content += data.v;
    } catch {}
  }
  return content.trim();
}

async function browserCompletion(messages) {
  const cdp = await getCdp();
  try {
    await cdp.call("Network.enable");
    const marker = `router-${crypto.randomUUID()}`;
    const matchedRequestIds = new Set();
    const offRequest = cdp.on("Network.requestWillBeSent", params => {
      const request = params.request || {};
      if (request.url?.includes("/api/v0/chat/completion") && request.postData?.includes(marker)) matchedRequestIds.add(params.requestId);
    });
    const prompt = `${promptFromMessages(messages)}\n\n[${marker}]`;
    const completion = new Promise((resolve, reject) => {
      let offFinished = () => {};
      const timer = setTimeout(() => { offRequest(); offFinished(); reject(new Error("Timed out waiting for matching DeepSeek completion stream")); }, 120000);
      offFinished = cdp.on("Network.loadingFinished", async params => {
        if (!matchedRequestIds.has(params.requestId)) return;
        try {
          const result = await cdp.call("Network.getResponseBody", { requestId: params.requestId });
          const content = extractSseContent(result.result?.body || "");
          if (!content) throw new Error("Matching DeepSeek completion stream contained no response text");
          clearTimeout(timer); offRequest(); offFinished(); resolve(content);
        } catch (error) { clearTimeout(timer); offRequest(); offFinished(); reject(error); }
      });
    });
    const submitted = await cdp.eval(`(async () => {
      const input = document.querySelector('textarea[placeholder="Message DeepSeek"]');
      if (!input) return { ok: false, reason: "DeepSeek composer is not ready" };
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(prompt)});
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(prompt)} }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      return { ok: true };
    })()`);
    if (!submitted?.ok) throw new Error(submitted?.reason || "Could not submit DeepSeek browser message");
    return await completion;
  } finally { cdp.close(); }
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() { super("deepseek-web", { baseUrl: "browser://chat.deepseek.com" }); }
  async execute({ model, body }) {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    const id = `chatcmpl-dsw-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const frame = (delta, finishReason = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ role: "assistant", content: "" })));
        try {
          await previous;
          const content = await browserCompletion(body?.messages || []);
          controller.enqueue(encoder.encode(frame({ content }, "stop")));
        } catch (error) { controller.enqueue(encoder.encode(frame({ content: `DeepSeek browser relay error: ${error.message}` }, "stop"))); }
        finally { controller.enqueue(encoder.encode(SSE_DONE)); controller.close(); release(); }
      },
    });
    return { response: new Response(stream, { status: 200, headers: SSE_HEADERS_NO_BUFFER }), url: "browser://chat.deepseek.com", headers: {}, transformedBody: body };
  }
}
export default DeepSeekWebExecutor;
