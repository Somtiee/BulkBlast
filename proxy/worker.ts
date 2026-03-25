export interface Env {
  HELIUS_API_KEY?: string;
  JUPITER_API_KEY: string;
  DFLOW_API_KEY: string;
  BAGS_API_KEY: string;

  /**
   * Optional partner fee share configuration.
   * If set, the worker will inject these into Bags fee-share config calls.
   */
  PARTNER_WALLET?: string;
  PARTNER_CONFIG_PDA?: string;
}

function withCORS(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, x-api-key');
  return headers;
}

async function proxyRequest(
  request: Request,
  targetUrl: string,
  env: Env,
  apiKeyHeaderValue: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const incoming = new Headers(request.headers);
  incoming.delete('host');
  incoming.set('x-api-key', apiKeyHeaderValue);

  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) incoming.set(k, v);
  }

  // request.body is a stream; Cloudflare workers allow forwarding it directly.
  const res = await fetch(targetUrl, {
    method: request.method,
    headers: incoming,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'follow',
  });

  const outHeaders = withCORS(new Headers(res.headers));
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check (optional)
    if (path === '/health') {
      return new Response('ok', { status: 200, headers: withCORS(new Headers()) });
    }

    // Jupiter price + swap APIs
    if (path.startsWith('/jupiter/')) {
      // /jupiter/price/v3 -> https://api.jup.ag/price/v3
      // /jupiter/swap/v1/quote -> https://api.jup.ag/swap/v1/quote
      const suffix = path.slice('/jupiter'.length); // keep leading "/"
      const targetUrl = `https://api.jup.ag${suffix}${url.search}`;
      return proxyRequest(request, targetUrl, env, env.JUPITER_API_KEY);
    }

    // Helius RPC proxy for Solana JSON-RPC calls.
    // /helius-rpc/mainnet -> https://mainnet.helius-rpc.com/?api-key=...
    // /helius-rpc/devnet  -> https://devnet.helius-rpc.com/?api-key=...
    if (path === '/helius-rpc/mainnet' || path === '/helius-rpc/devnet') {
      if (!env.HELIUS_API_KEY) {
        return new Response('Missing HELIUS_API_KEY secret in worker', { status: 503 });
      }
      const base =
        path === '/helius-rpc/devnet'
          ? 'https://devnet.helius-rpc.com/'
          : 'https://mainnet.helius-rpc.com/';
      const targetUrl = `${base}?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`;

      const incoming = new Headers(request.headers);
      incoming.delete('host');

      const res = await fetch(targetUrl, {
        method: request.method,
        headers: incoming,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'follow',
      });

      const outHeaders = withCORS(new Headers(res.headers));
      return new Response(res.body, { status: res.status, headers: outHeaders });
    }

    // DFLOW quote + swap APIs
    if (path.startsWith('/dflow/')) {
      // /dflow/quote -> https://e.quote-api.dflow.net/quote
      const suffix = path.slice('/dflow'.length);
      const targetUrl = `https://e.quote-api.dflow.net${suffix}${url.search}`;
      return proxyRequest(request, targetUrl, env, env.DFLOW_API_KEY);
    }

    // Bags APIs
    if (path.startsWith('/bags/')) {
      const bagsBase = 'https://public-api-v2.bags.fm/api/v1';
      const suffix = path.slice('/bags'.length); // includes leading "/"
      const targetUrl = `${bagsBase}${suffix}${url.search}`;

      // Optional: inject partner fee config on this specific endpoint.
      // Client sends payer/baseMint/claimersArray/basisPointsArray/bagsConfigType.
      if (suffix === '/fee-share/config' && env.PARTNER_WALLET && env.PARTNER_CONFIG_PDA) {
        try {
          // Clone to avoid consuming the original request body stream.
          const parsed = (await request.clone().json()) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            parsed.partner = env.PARTNER_WALLET;
            parsed.partnerConfig = env.PARTNER_CONFIG_PDA;
          }

          const incoming = new Headers(request.headers);
          incoming.delete('host');
          incoming.set('x-api-key', env.BAGS_API_KEY);
          incoming.set('Content-Type', 'application/json');

          const res = await fetch(targetUrl, {
            method: request.method,
            headers: incoming,
            body: JSON.stringify(parsed),
            redirect: 'follow',
          });

          const outHeaders = withCORS(new Headers(res.headers));
          return new Response(res.body, { status: res.status, headers: outHeaders });
        } catch {
          // If body parse fails, fall back to raw proxying.
        }
      }

      return proxyRequest(request, targetUrl, env, env.BAGS_API_KEY);
    }

    return new Response(`Not found: ${path}`, { status: 404 });
  },
};

