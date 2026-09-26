import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies before importing
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    run: vi.fn(),
  },
  nowIso: () => new Date().toISOString(),
}));

vi.mock('maxmind', () => ({
  default: { open: vi.fn().mockResolvedValue(null) },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  createReadStream: vi.fn(),
}));

import { extractBracketField, parseLine, ruleInfoFromAuditEntry, redactAuditEntry } from '@/src/lib/waf-log-parser';

/**
 * Regression (issue #233): rule attribution must come from the audit entry's own
 * `messages` array (audit log part H), not from a join against waf-rules.log.
 *
 * The join only lands when Coraza's audit line and Caddy's rule line happen to be
 * written within the same 30s parse tick. When it misses, `parseLine` used to drop
 * the whole event unless it was blocked — so every detected-but-not-blocked event
 * disappeared. Each test here passes an EMPTY ruleMap to simulate that miss.
 */
describe('rule attribution from the audit entry itself', () => {
  const CRS_XSS =
    '[client "1.2.3.4"] Coraza: Warning. XSS Attack Detected '
    + '[file "@owasp_crs/REQUEST-941-APPLICATION-ATTACK-XSS.conf"] [line "123"] '
    + '[id "941100"] [rev ""] [msg "XSS Attack Detected"] [severity "CRITICAL"] '
    + '[unique_id "tx-xss"]';
  const CRS_ANOMALY =
    '[client "1.2.3.4"] Coraza: Access denied (phase 2). Inbound Anomaly Score Exceeded '
    + '[file "@owasp_crs/REQUEST-949-BLOCKING-EVALUATION.conf"] [line "7663"] '
    + '[id "949110"] [msg "Inbound Anomaly Score Exceeded"] [severity "CRITICAL"] '
    + '[unique_id "tx-xss"]';

  function auditLine(opts: { interrupted: boolean; messages?: unknown[] }): string {
    return JSON.stringify({
      transaction: {
        id: 'tx-xss',
        client_ip: '1.2.3.4',
        unix_timestamp: 1_700_000_000_000_000_000,
        is_interrupted: opts.interrupted,
        request: { method: 'GET', uri: '/?q=<script>', headers: { host: ['example.com'] } },
      },
      ...(opts.messages ? { messages: opts.messages } : {}),
    });
  }

  it('keeps a detected-but-not-blocked event when the rules-log join misses', () => {
    const row = parseLine(
      auditLine({ interrupted: false, messages: [{ error_message: CRS_XSS }] }),
      new Map()
    );

    expect(row).not.toBeNull();
    expect(row?.blocked).toBe(false);
    expect(row?.rule_id).toBe(941100);
    expect(row?.rule_message).toBe('XSS Attack Detected');
    expect(row?.severity).toBe('CRITICAL');
  });

  it('attributes a blocked event to the attack rule, not the anomaly evaluation rule', () => {
    const row = parseLine(
      auditLine({ interrupted: true, messages: [{ error_message: CRS_XSS }, { error_message: CRS_ANOMALY }] }),
      new Map()
    );

    expect(row?.rule_id).toBe(941100);
  });

  it('skips a leading anomaly-evaluation rule to find the real attack rule', () => {
    const row = parseLine(
      auditLine({ interrupted: true, messages: [{ error_message: CRS_ANOMALY }, { error_message: CRS_XSS }] }),
      new Map()
    );

    expect(row?.rule_id).toBe(941100);
  });

  it('still drops audit entries with no rule match and no interruption', () => {
    // Coraza logs every 4xx/5xx under SecAuditLogRelevantStatus even when no rule
    // fired; those are ordinary traffic and must not show up as WAF events.
    expect(parseLine(auditLine({ interrupted: false }), new Map())).toBeNull();
  });

  it('falls back to the rules-log join when Coraza emits no messages', () => {
    const ruleMap = new Map([['tx-xss', { ruleId: 941100, ruleMessage: 'XSS Attack Detected', severity: 'CRITICAL' }]]);
    const row = parseLine(auditLine({ interrupted: false }), ruleMap);

    expect(row?.rule_id).toBe(941100);
  });

  it('reads the legacy `message` field when `error_message` is absent', () => {
    expect(ruleInfoFromAuditEntry({ messages: [{ message: CRS_XSS }] })?.ruleId).toBe(941100);
  });

  it('returns null when the entry has no messages', () => {
    expect(ruleInfoFromAuditEntry({})).toBeNull();
  });
});

describe('extractBracketField', () => {
  it('extracts id from [id "941100"]', () => {
    expect(extractBracketField('[id "941100"]', 'id')).toBe('941100');
  });

  it('extracts msg from [msg "XSS Attack Detected"]', () => {
    expect(extractBracketField('[msg "XSS Attack Detected"]', 'msg')).toBe('XSS Attack Detected');
  });

  it('extracts severity from [severity "critical"]', () => {
    expect(extractBracketField('[severity "critical"]', 'severity')).toBe('critical');
  });

  it('extracts unique_id from [unique_id "abc123"]', () => {
    expect(extractBracketField('[unique_id "abc123"]', 'unique_id')).toBe('abc123');
  });

  it('returns null for field not present', () => {
    expect(extractBracketField('[msg "something"]', 'id')).toBeNull();
  });

  it('works when multiple fields are present in one string', () => {
    const msg = '[id "941100"] [msg "XSS Attack"] [severity "critical"] [unique_id "abc123"]';
    expect(extractBracketField(msg, 'id')).toBe('941100');
    expect(extractBracketField(msg, 'msg')).toBe('XSS Attack');
    expect(extractBracketField(msg, 'severity')).toBe('critical');
    expect(extractBracketField(msg, 'unique_id')).toBe('abc123');
  });

  it('handles special characters in field values', () => {
    const msg = '[msg "SQL Injection: SELECT * FROM users WHERE id=1"]';
    expect(extractBracketField(msg, 'msg')).toBe('SQL Injection: SELECT * FROM users WHERE id=1');
  });

  it('returns null for empty string input', () => {
    expect(extractBracketField('', 'id')).toBeNull();
  });
});

describe('parseLine host header contract', () => {
  const ruleMap = new Map([
    ['tx-1', { ruleId: 941100, ruleMessage: 'XSS', severity: 'critical' }],
  ]);

  function makeAuditLine(hostHeader: string): string {
    return JSON.stringify({
      transaction: {
        id: 'tx-1',
        client_ip: '1.2.3.4',
        unix_timestamp: 1_700_000_000_000_000_000,
        is_interrupted: true,
        request: {
          method: 'GET',
          uri: '/',
          headers: { host: [hostHeader] },
        },
      },
    });
  }

  it('stores host header verbatim — bare hostname has no port', () => {
    const row = parseLine(makeAuditLine('example.com'), ruleMap);
    expect(row?.host).toBe('example.com');
  });

  it('stores host header verbatim — port suffix is preserved (downstream must strip)', () => {
    // Some HTTPS clients (e.g. HTTP/2 :authority, explicit "Host: foo:443" header)
    // include the port. Suppression code in settings/actions.ts must normalize.
    const row = parseLine(makeAuditLine('app.example.com:443'), ruleMap);
    expect(row?.host).toBe('app.example.com:443');
  });

  it('handles missing host header without throwing', () => {
    const line = JSON.stringify({
      transaction: {
        id: 'tx-1',
        client_ip: '1.2.3.4',
        unix_timestamp: 1_700_000_000_000_000_000,
        is_interrupted: true,
        request: { method: 'GET', uri: '/', headers: {} },
      },
    });
    const row = parseLine(line, ruleMap);
    expect(row?.host).toBe('');
  });
});

describe('stored WAF event redaction', () => {
  const line = JSON.stringify({
    transaction: {
      id: 'tx-cred',
      client_ip: '1.2.3.4',
      unix_timestamp: 1_700_000_000_000_000_000,
      is_interrupted: true,
      request: {
        method: 'GET',
        uri: '/?q=<script>',
        headers: {
          host: ['example.com'],
          cookie: ['_cpm_fa=session-secret; other=1'],
          Authorization: ['Bearer api-secret'],
          'user-agent': ['curl/8'],
        },
      },
      response: { status: 403, headers: { 'Set-Cookie': ['sid=response-secret'] } },
    },
    messages: [{ error_message: '[id "941100"] [msg "XSS"] [severity "CRITICAL"]' }],
  });

  it('replaces credential header values but keeps the rest of the entry', () => {
    const row = parseLine(line, new Map());
    expect(row).not.toBeNull();
    expect(row!.raw_data).not.toMatch(/session-secret|api-secret|response-secret/);
    const stored = JSON.parse(row!.raw_data ?? "{}");
    expect(stored.transaction.request.headers.cookie).toEqual(['[redacted]']);
    expect(stored.transaction.request.headers.Authorization).toEqual(['[redacted]']);
    expect(stored.transaction.response.headers['Set-Cookie']).toEqual(['[redacted]']);
    expect(stored.transaction.request.headers['user-agent']).toEqual(['curl/8']);
    expect(stored.transaction.request.uri).toBe('/?q=<script>');
  });

  it('does not mutate the parsed input', () => {
    const entry = JSON.parse(line);
    redactAuditEntry(entry);
    expect(entry.transaction.request.headers.cookie).toEqual(['_cpm_fa=session-secret; other=1']);
  });
});

// With audit part H, Coraza writes each matched rule's ModSecurity-format
// string to messages[].error_message; CRS logdata echoes the matched value
// ("Matched Data: … found within REQUEST_COOKIES:<name>: <value>"). When a
// legitimate session cookie or Authorization header trips a rule, that value
// must not reach storage either.
describe('stored WAF event redaction — rule messages', () => {
  const SQLI_ON_COOKIE =
    '[client "1.2.3.4"] Coraza: Access denied (phase 2). SQL Injection Attack Detected via libinjection '
    + '[file "@owasp_crs/REQUEST-942-APPLICATION-ATTACK-SQLI.conf"] [line "46"] [id "942100"] [rev ""] '
    + '[msg "SQL Injection Attack Detected via libinjection"] '
    + '[data "Matched Data: s&sos found within REQUEST_COOKIES:session: abc\' or 1=1--COOKIE-SECRET"] '
    + '[severity "critical"] [ver "OWASP_CRS/4.25.0"] [maturity "0"] [accuracy "0"] '
    + '[tag "attack-sqli"] [hostname "10.0.0.1"] [uri "/"] [unique_id "tx-cookie"]';

  function lineWith(messages: unknown[]): string {
    return JSON.stringify({
      transaction: {
        id: 'tx-cookie',
        client_ip: '1.2.3.4',
        is_interrupted: true,
        request: { method: 'GET', uri: '/', headers: { host: ['example.com'] } },
      },
      messages,
    });
  }

  it('redacts the matched cookie value in error_message but keeps the rule fields', () => {
    const row = parseLine(lineWith([{ error_message: SQLI_ON_COOKIE }]), new Map());
    expect(row?.rule_id).toBe(942100);
    expect(row!.raw_data).not.toContain('COOKIE-SECRET');
    expect(row!.raw_data).not.toContain('s&sos');

    const stored = JSON.parse(row!.raw_data ?? '{}');
    const message: string = stored.messages[0].error_message;
    expect(message).toContain(
      '[data "Matched Data: [redacted] found within REQUEST_COOKIES:session: [redacted]"]'
    );
    expect(extractBracketField(message, 'id')).toBe('942100');
    expect(extractBracketField(message, 'msg')).toBe('SQL Injection Attack Detected via libinjection');
    expect(extractBracketField(message, 'severity')).toBe('critical');
    expect(extractBracketField(message, 'unique_id')).toBe('tx-cookie');
  });

  it('redacts credential headers and part K message data, in any logdata shape', () => {
    const row = parseLine(lineWith([
      {
        error_message: '[client "1.2.3.4"] Coraza: Warning. Bad header [id "920000"] '
          + '[data "REQUEST_HEADERS:Authorization=Bearer HEADER-SECRET"] [severity "warning"]',
        message: 'Matched Data: Header REQUEST_HEADERS:x-plex-token: PLEX-SECRET',
        data: {
          id: 920001,
          msg: 'Bad value',
          data: 'Matched Data: TOKEN-PART found within REQUEST_HEADERS:x-api-key: API-SECRET-TOKEN-PART',
        },
      },
    ]), new Map());
    expect(row!.raw_data).not.toMatch(/HEADER-SECRET|PLEX-SECRET|API-SECRET|TOKEN-PART/);
    const stored = JSON.parse(row!.raw_data ?? '{}');
    expect(extractBracketField(stored.messages[0].error_message, 'data')).toBe(
      'REQUEST_HEADERS:Authorization=[redacted]'
    );
    expect(stored.messages[0].message).toBe('Matched Data: Header REQUEST_HEADERS:x-plex-token: [redacted]');
    expect(stored.messages[0].data.data).toBe(
      'Matched Data: [redacted] found within REQUEST_HEADERS:x-api-key: [redacted]'
    );
    expect(stored.messages[0].data.msg).toBe('Bad value');
  });

  it('leaves messages about other variables untouched', () => {
    const xss =
      '[client "1.2.3.4"] Coraza: Warning. XSS [id "941100"] '
      + '[data "Matched Data: <script> found within ARGS:q: <script>alert(1)</script>"] '
      + '[severity "critical"]';
    const cookieNames = 'Matched Data: x found within REQUEST_COOKIES_NAMES:session: session';
    const row = parseLine(lineWith([{ error_message: xss, message: cookieNames }]), new Map());
    const stored = JSON.parse(row!.raw_data ?? '{}');
    expect(stored.messages[0].error_message).toBe(xss);
    expect(stored.messages[0].message).toBe(cookieNames);
  });
});

// Coraza cuts rule data to 280 bytes before logging it, so a long CRS
// "Matched Data: … found within <VAR>: <value>" can end before <VAR> does,
// leaving only the start of what matched — possibly a session cookie.
describe('stored WAF event redaction — truncated rule data', () => {
  const MAX_DATA = 280;
  // What Coraza keeps of a match inside a 300-character session cookie.
  const cookieSecret = `SECRET${'x'.repeat(294)}`;
  const truncated = `Matched Data: ${cookieSecret}`.slice(0, MAX_DATA);

  function lineWith(headers: Record<string, string[]>, errorMessage: string, message?: string): string {
    return JSON.stringify({
      transaction: {
        id: 'tx-trunc',
        client_ip: '1.2.3.4',
        is_interrupted: true,
        request: { method: 'GET', uri: '/', headers: { host: ['example.com'], ...headers } },
      },
      messages: [{ error_message: errorMessage, ...(message ? { message } : {}) }],
    });
  }

  function ruleMessage(data: string, extra = ''): string {
    return `[client "1.2.3.4"] Coraza: Access denied (phase 2). SQL Injection Attack [id "942100"] `
      + `[msg "SQL Injection Attack"] [data "${data}"] [severity "critical"]${extra}`;
  }

  it('redacts a match excerpt whose variable name was cut off when the request carried credentials', () => {
    const row = parseLine(
      lineWith(
        { cookie: [`session=${cookieSecret}`] },
        ruleMessage(truncated, ` [msg_match_1 ""] [data_match_1 "${truncated}"]`),
        truncated
      ),
      new Map()
    );
    expect(row!.raw_data).not.toContain('SECRET');
    const stored = JSON.parse(row!.raw_data ?? '{}');
    expect(extractBracketField(stored.messages[0].error_message, 'data')).toBe('Matched Data: [redacted]');
    expect(extractBracketField(stored.messages[0].error_message, 'data_match_1')).toBe('Matched Data: [redacted]');
    expect(stored.messages[0].message).toBe('Matched Data: [redacted]');
    expect(row!.rule_id).toBe(942100);
  });

  it('redacts the excerpt when the cut falls inside the variable name', () => {
    const data = `Matched Data: ${'S'.repeat(40)}SECRET found within REQUEST_COO`;
    const row = parseLine(lineWith({ authorization: ['Bearer token'] }, ruleMessage(data)), new Map());
    const stored = JSON.parse(row!.raw_data ?? '{}');
    expect(extractBracketField(stored.messages[0].error_message, 'data')).toBe(
      'Matched Data: [redacted] found within REQUEST_COO'
    );
  });

  it('keeps the excerpt when the request carried no credentials, or the variable name survived', () => {
    const withoutCredentials = parseLine(lineWith({}, ruleMessage(truncated)), new Map());
    expect(extractBracketField(JSON.parse(withoutCredentials!.raw_data ?? '{}').messages[0].error_message, 'data'))
      .toBe(truncated);

    const attributed = 'Matched Data: union select found within ARGS:q: 1 union select password from users';
    const withCredentials = parseLine(lineWith({ cookie: ['session=abc'] }, ruleMessage(attributed)), new Map());
    expect(extractBracketField(JSON.parse(withCredentials!.raw_data ?? '{}').messages[0].error_message, 'data'))
      .toBe(attributed);
  });

  it('stores the rule message from the redacted entry', () => {
    const msg = 'REQUEST_COOKIES:session=MSG-SECRET';
    const row = parseLine(
      lineWith({ cookie: ['session=MSG-SECRET'] }, `[client "1.2.3.4"] Coraza: Warning. ${msg} [id "990001"] [msg "${msg}"] [severity "warning"]`),
      new Map()
    );
    expect(row!.rule_message).toBe('REQUEST_COOKIES:session=[redacted]');
    expect(row!.raw_data).not.toContain('MSG-SECRET');
  });

  it('measures the cap in bytes of the unquoted data', () => {
    // 133 two-byte characters: 280 bytes, but 147 characters.
    const data = `Matched Data: ${'é'.repeat(133)}`;
    const row = parseLine(lineWith({ cookie: ['session=abc'] }, ruleMessage(data)), new Map());
    expect(extractBracketField(JSON.parse(row!.raw_data ?? '{}').messages[0].error_message, 'data'))
      .toBe('Matched Data: [redacted]');

    const short = `Matched Data: ${'é'.repeat(132)}`;
    const kept = parseLine(lineWith({ cookie: ['session=abc'] }, ruleMessage(short)), new Map());
    expect(extractBracketField(JSON.parse(kept!.raw_data ?? '{}').messages[0].error_message, 'data')).toBe(short);
  });
});

// The variable name is only read where logdata puts it. Matched values are
// request data: whatever they contain must not decide what gets redacted.
describe('stored WAF event redaction — where the variable name sits', () => {
  function storedData(data: string, headers: Record<string, string[]> = {}): string | null {
    const line = JSON.stringify({
      transaction: {
        id: 'tx-anchor',
        client_ip: '1.2.3.4',
        is_interrupted: true,
        request: { method: 'POST', uri: '/', headers: { host: ['example.com'], ...headers } },
      },
      messages: [{
        error_message: `[client "1.2.3.4"] Coraza: Warning. Attack [id "944110"] [msg "Attack"] [data "${data}"] [severity "critical"]`,
      }],
    });
    return extractBracketField(JSON.parse(parseLine(line, new Map())!.raw_data ?? '{}').messages[0].error_message, 'data');
  }

  it('keeps an excerpt whose logdata names the variable with no value after it, cookies or not', () => {
    // CRS 933200 and 944100-944300: "Matched Data: %{MATCHED_VAR} found within %{MATCHED_VAR_NAME}".
    const data = 'Matched Data: java.lang.ProcessBuilder found within ARGS:payload';
    expect(storedData(data, { cookie: ['theme=dark'] })).toBe(data);
    expect(storedData(data)).toBe(data);
  });

  it('keeps a payload that spells out a credential variable name', () => {
    const data = 'Matched Data: <script> found within ARGS_POST:body: REQUEST_COOKIES: <script>alert(1)</script>';
    expect(storedData(data, { cookie: ['theme=dark'] })).toBe(data);
    expect(storedData(data)).toBe(data);

    const forged = 'Matched Data: java.lang.Runtime found within REQUEST_COOKIES:a: x found within ARGS:payload';
    expect(storedData(forged, { cookie: ['a=1'] })).toBe(forged);
    const forgedHeader = 'Matched Data: Header REQUEST_HEADERS:authorization: java.lang.Runtime found within ARGS:x';
    expect(storedData(forgedHeader, { authorization: ['Bearer t'] })).toBe(forgedHeader);
    const forgedPair = 'ARGS:x=REQUEST_COOKIES:a=java.lang.Runtime';
    expect(storedData(forgedPair, { cookie: ['a=1'] })).toBe(forgedPair);
  });

  it('redacts a credential value named after " found within ", with or without a value after it', () => {
    expect(storedData('Matched Data: Bearer java.lang.Runtime-SECRET found within REQUEST_HEADERS:authorization'))
      .toBe('Matched Data: [redacted] found within REQUEST_HEADERS:authorization');
    expect(storedData('Matched Data: java.lang.Runtime found within REQUEST_COOKIES:session: x=java.lang.Runtime-SECRET'))
      .toBe('Matched Data: [redacted] found within REQUEST_COOKIES:session: [redacted]');
  });

  it('redacts a cookie reported as NAME=VALUE', () => {
    expect(storedData('REQUEST_COOKIES:session=abc\\u1234SECRET')).toBe('REQUEST_COOKIES:session=[redacted]');
    expect(storedData('REQUEST_HEADERS:cookie=session=SECRET')).toBe('REQUEST_HEADERS:cookie=[redacted]');
  });

  it('redacts a credential reported as NAME: VALUE, but not a variable name inside another value', () => {
    // A custom rule's logdata:'%{MATCHED_VAR_NAME}: %{MATCHED_VAR}'.
    expect(storedData('REQUEST_COOKIES:session: secretvalue', { cookie: ['session=secretvalue'] }))
      .toBe('REQUEST_COOKIES:session: [redacted]');
    expect(storedData('REQUEST_HEADERS:X-Plex-Token: abc=SECRET')).toBe('REQUEST_HEADERS:X-Plex-Token: [redacted]');
    const forged = 'ARGS:q: REQUEST_COOKIES:session: java.lang.Runtime';
    expect(storedData(forged, { cookie: ['session=1'] })).toBe(forged);
  });

  it('redacts an excerpt cut inside the credential variable name, but not inside another', () => {
    const cookies = { cookie: ['session=abc'] };
    expect(storedData('Matched Data: SECRET found within REQUEST_HEADERS:auth', cookies))
      .toBe('Matched Data: [redacted] found within REQUEST_HEADERS:auth');
    expect(storedData('Matched Data: SECRET found within REQUEST_HEADERS:authorization:', cookies))
      .toBe('Matched Data: [redacted] found within REQUEST_HEADERS:authorization:');
    expect(storedData('Matched Data: SECRET found within ', cookies)).toBe('Matched Data: [redacted] found within ');
    expect(storedData('Matched Data: payload found within REQUEST_HEADERS:user-ag', cookies))
      .toBe('Matched Data: payload found within REQUEST_HEADERS:user-ag');
  });
});

describe('stored WAF event serialization', () => {
  it('keeps a header named __proto__ as an ordinary header', () => {
    const line = '{"transaction":{"id":"tx-proto","client_ip":"1.2.3.4","is_interrupted":true,'
      + '"request":{"method":"GET","uri":"/","headers":{"host":["example.com"],"__proto__":["hidden"]}}}}';
    const row = parseLine(line, new Map());
    const stored = JSON.parse(row!.raw_data ?? '{}');
    expect(Object.keys(stored.transaction.request.headers)).toContain('__proto__');
    expect(row!.raw_data).toContain('"__proto__":["hidden"]');
  });

  it('keeps the nanosecond unix_timestamp digits of the original line', () => {
    const line = '{"transaction":{"timestamp":"2023/11/14 22:13:20","unix_timestamp":1700000000123456789,'
      + '"id":"tx-ts","client_ip":"1.2.3.4","is_interrupted":true,'
      + '"request":{"method":"GET","uri":"/","headers":{"host":["example.com"]}}}}';
    const row = parseLine(line, new Map());
    expect(row!.ts).toBe(1700000000);
    expect(row!.raw_data).toContain('"unix_timestamp":1700000000123456789');
  });
});
