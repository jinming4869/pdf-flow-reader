// proxy-bootstrap: inject undici ProxyAgent into global fetch for external requests only.
// Bypasses localhost/127.0.0.1 to avoid breaking in-app HTTP servers.
import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";

const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || "http://127.0.0.1:7897";

function isLocalhost(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

try {
  const proxyAgent = new ProxyAgent(proxyUrl);
  const originalDispatcher = getGlobalDispatcher();

  // Wrap: proxy for external, original for localhost
  const wrappedDispatcher = {
    dispatch(opts, handler) {
      const origin = opts.origin;
      if (isLocalhost(origin)) {
        return originalDispatcher.dispatch(opts, handler);
      }
      return proxyAgent.dispatch(opts, handler);
    },
    close() {
      proxyAgent.close();
      return originalDispatcher.close?.();
    },
    destroy() {
      proxyAgent.destroy();
      return originalDispatcher.destroy?.();
    },
  };

  setGlobalDispatcher(wrappedDispatcher);
  console.error("[proxy] using", proxyUrl, "(localhost bypassed)");
} catch (e) {
  console.error("[proxy] failed to set up:", e.message);
}
