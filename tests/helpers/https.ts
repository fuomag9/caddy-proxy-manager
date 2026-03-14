import https from 'node:https';

export interface HttpsResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ClientTlsIdentity {
  cert?: string;
  key?: string;
}

export interface HttpsOutcome {
  response?: HttpsResponse;
  error?: Error;
}

export function httpsGet(
  domain: string,
  path = '/',
  tlsIdentity: ClientTlsIdentity = {},
  extraHeaders: Record<string, string> = {}
): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: 443,
        path,
        method: 'GET',
        headers: { Host: domain, ...extraHeaders },
        servername: domain,
        rejectUnauthorized: false,
        cert: tlsIdentity.cert,
        key: tlsIdentity.key,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as HttpsResponse['headers'],
            body,
          })
        );
      }
    );

    req.setTimeout(10_000, () => {
      req.destroy(new Error(`HTTPS request to "${domain}" timed out`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function httpsGetOutcome(
  domain: string,
  path = '/',
  tlsIdentity: ClientTlsIdentity = {},
  extraHeaders: Record<string, string> = {}
): Promise<HttpsOutcome> {
  try {
    const response = await httpsGet(domain, path, tlsIdentity, extraHeaders);
    return { response };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function waitForHttpsRoute(
  domain: string,
  tlsIdentity: ClientTlsIdentity = {},
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await httpsGet(domain, '/', tlsIdentity);
      lastStatus = res.status;
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `HTTPS route for "${domain}" not ready after ${timeoutMs}ms (last status: ${lastStatus}, last error: ${lastError || 'none'})`
  );
}
