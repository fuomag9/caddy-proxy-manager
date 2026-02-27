# ACME Cert Info + Sitewide Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show real expiry/issuer info for ACME-managed certs in the Certificates page, and add server-side URL-param pagination to all data tables across the dashboard.

**Architecture:** Mount `caddy-data` volume read-only to the web container so we can parse Caddy's stored `.crt` files with `X509Certificate`. For pagination, each `page.tsx` reads `searchParams.page`, queries the DB with `LIMIT`/`OFFSET`, and passes `{ total, page, perPage }` to the client. `DataTable` gains a `pagination` prop that renders MUI `Pagination` and uses `useRouter` to push `?page=N`.

**Tech Stack:** Next.js 16 server components, Drizzle ORM (`count()`, `.limit()`, `.offset()`), MUI `Pagination`, Node.js `X509Certificate`, `node:fs` glob scanning.

---

## Task 1: Mount caddy-data to web container

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add the read-only volume mount**

In `docker-compose.yml`, find the `web` service's `volumes:` block and add:
```yaml
- caddy-data:/caddy-data:ro
```

The final volumes block for the `web` service should look like:
```yaml
volumes:
  - caddy-manager-data:/app/data
  - geoip-data:/usr/share/GeoIP:ro,z
  - caddy-logs:/logs:ro
  - caddy-data:/caddy-data:ro
```

**Step 2: Verify**

```bash
docker compose config | grep -A8 "caddy-data"
```
Expected: the web service lists `caddy-data:/caddy-data:ro` in its volume bindings.

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: mount caddy-data read-only to web container for cert scanning"
```

---

## Task 2: ACME cert scanner utility

**Files:**
- Create: `src/lib/acme-certs.ts`

**Step 1: Create the scanner**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

export type AcmeCertInfo = {
  validTo: string;
  validFrom: string;
  issuer: string;
  domains: string[];
};

/**
 * Walks Caddy's certificate storage directory and parses every .crt file.
 * Returns a map from lowercase domain → cert info (most recent cert wins for
 * a given domain if multiple exist).
 *
 * Caddy stores certs under:
 *   <CADDY_CERTS_DIR>/acme-v02.api.letsencrypt.org-directory/<domain>/<domain>.crt
 *   <CADDY_CERTS_DIR>/acme.zerossl.com-v2-DV90/<domain>/<domain>.crt
 *   ...etc
 *
 * The directory is mounted at /caddy-data in the web container, so:
 *   CADDY_CERTS_DIR defaults to /caddy-data/caddy/certificates
 */
const CADDY_CERTS_DIR =
  process.env.CADDY_CERTS_DIR ?? '/caddy-data/caddy/certificates';

function walkCrtFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results; // directory doesn't exist yet (e.g. no certs issued)
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkCrtFiles(full));
      } else if (entry.endsWith('.crt')) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

export function scanAcmeCerts(): Map<string, AcmeCertInfo> {
  const map = new Map<string, AcmeCertInfo>();
  const crtFiles = walkCrtFiles(CADDY_CERTS_DIR);

  for (const file of crtFiles) {
    try {
      const pem = readFileSync(file, 'utf-8');
      const cert = new X509Certificate(pem);

      const sanDomains =
        cert.subjectAltName
          ?.split(',')
          .map(s => s.trim())
          .filter(s => s.startsWith('DNS:'))
          .map(s => s.slice(4).toLowerCase()) ?? [];

      const issuerLine = cert.issuer ?? '';
      const issuer = (
        issuerLine.match(/O=([^\n,]+)/)?.[1] ??
        issuerLine.match(/CN=([^\n,]+)/)?.[1] ??
        issuerLine
      ).trim();

      const info: AcmeCertInfo = {
        validTo: new Date(cert.validTo).toISOString(),
        validFrom: new Date(cert.validFrom).toISOString(),
        issuer,
        domains: sanDomains,
      };

      for (const domain of sanDomains) {
        // Keep the cert with the latest validTo for each domain
        const existing = map.get(domain);
        if (!existing || info.validTo > existing.validTo) {
          map.set(domain, info);
        }
      }
    } catch {
      // skip unreadable / malformed certs
    }
  }

  return map;
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/acme-certs.ts
git commit -m "feat: add ACME cert scanner utility"
```

---

## Task 3: Show ACME cert expiry in Certificates page

**Files:**
- Modify: `app/(dashboard)/certificates/page.tsx`
- Modify: `app/(dashboard)/certificates/CertificatesClient.tsx`

### page.tsx changes

**Step 1: Extend AcmeHost type and import scanner**

At the top of `page.tsx`, add:
```ts
import { scanAcmeCerts } from '@/src/lib/acme-certs';
```

Change the `AcmeHost` type to:
```ts
export type AcmeHost = {
  id: number;
  name: string;
  domains: string[];
  ssl_forced: boolean;
  enabled: boolean;
  certValidTo: string | null;
  certValidFrom: string | null;
  certIssuer: string | null;
  certExpiryStatus: CertExpiryStatus | null;
};
```

**Step 2: Add scanAcmeCerts() call in the page function**

In `CertificatesPage`, after `await requireAdmin()`, call the scanner:
```ts
const acmeCertMap = scanAcmeCerts(); // synchronous, reads from disk
```

**Step 3: Use the cert map when building acmeHosts**

Replace the `acmeHosts` mapping with:
```ts
const acmeHosts: AcmeHost[] = acmeRows.map(r => {
  const domains = JSON.parse(r.domains) as string[];
  // Find a matching cert for any of this host's domains
  let certInfo = null;
  for (const domain of domains) {
    const info = acmeCertMap.get(domain.toLowerCase());
    if (info) { certInfo = info; break; }
  }
  return {
    id: r.id,
    name: r.name,
    domains,
    ssl_forced: r.sslForced,
    enabled: r.enabled,
    certValidTo: certInfo?.validTo ?? null,
    certValidFrom: certInfo?.validFrom ?? null,
    certIssuer: certInfo?.issuer ?? null,
    certExpiryStatus: certInfo?.validTo ? getExpiryStatus(certInfo.validTo) : null,
  };
});
```

### CertificatesClient.tsx changes

**Step 4: Add Expiry and Issuer columns to the ACME DataTable**

Replace the `acmeColumns` array in `CertificatesClient.tsx`:
```ts
const acmeColumns = [
  {
    id: 'name',
    label: 'Proxy Host',
    render: (r: AcmeHost) => <Typography fontWeight={600}>{r.name}</Typography>,
  },
  {
    id: 'domains',
    label: 'Domains',
    render: (r: AcmeHost) => (
      <Typography variant="body2" color="text.secondary">
        {r.domains.join(', ')}
      </Typography>
    ),
  },
  {
    id: 'issuer',
    label: 'Issuer',
    render: (r: AcmeHost) => (
      <Typography variant="body2" color="text.secondary">
        {r.certIssuer ?? '—'}
      </Typography>
    ),
  },
  {
    id: 'expiry',
    label: 'Expiry',
    render: (r: AcmeHost) => <ExpiryChip validTo={r.certValidTo} status={r.certExpiryStatus} />,
  },
  {
    id: 'status',
    label: 'Status',
    render: (r: AcmeHost) => (
      <Chip
        label={r.enabled ? 'Active' : 'Disabled'}
        color={r.enabled ? 'success' : 'default'}
        size="small"
      />
    ),
  },
];
```

**Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 6: Commit**

```bash
git add app/(dashboard)/certificates/page.tsx app/(dashboard)/certificates/CertificatesClient.tsx
git commit -m "feat: show ACME cert expiry and issuer in certificates page"
```

---

## Task 4: Add pagination support to DataTable

**Files:**
- Modify: `src/components/ui/DataTable.tsx`

**Step 1: Rewrite DataTable with "use client" and pagination prop**

Replace the entire file with:
```tsx
"use client";

import {
  Box,
  Card,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type Column<T> = {
  id: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string | number;
  render?: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  emptyMessage?: string;
  loading?: boolean;
  pagination?: {
    total: number;
    page: number;
    perPage: number;
  };
};

export function DataTable<T>({
  columns,
  data,
  keyField,
  emptyMessage = "No data available",
  loading = false,
  pagination,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageCount = pagination
    ? Math.ceil(pagination.total / pagination.perPage)
    : 0;

  function handlePageChange(_: React.ChangeEvent<unknown>, page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Box>
      <TableContainer component={Card} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align || "left"}
                  width={col.width}
                >
                  {col.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.length === 0 && !loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 8 }}>
                  <Typography color="text.secondary">{emptyMessage}</Typography>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={String(row[keyField])}>
                  {columns.map((col) => (
                    <TableCell key={col.id} align={col.align || "left"}>
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.id] as ReactNode}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pagination && pageCount > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Pagination
            count={pageCount}
            page={pagination.page}
            onChange={handlePageChange}
            color="primary"
            shape="rounded"
          />
        </Box>
      )}
    </Box>
  );
}
```

**Note:** `Column<T>` is now exported so consumer files can import and type their columns.

**Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/components/ui/DataTable.tsx
git commit -m "feat: add pagination support to DataTable component"
```

---

## Task 5: Add paginated DB query helpers

**Files:**
- Modify: `src/lib/models/proxy-hosts.ts`
- Modify: `src/lib/models/audit.ts`
- Modify: `src/lib/models/access-lists.ts`

### proxy-hosts.ts

**Step 1: Add count function and paginated list**

At the top of the file, add `count` to the drizzle-orm imports (it's imported from `drizzle-orm`):
```ts
import { desc, eq, count } from "drizzle-orm";
```

After the existing `listProxyHosts()` function, add:
```ts
export async function countProxyHosts(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(proxyHosts);
  return row?.value ?? 0;
}

export async function listProxyHostsPaginated(limit: number, offset: number): Promise<ProxyHost[]> {
  const hosts = await db
    .select()
    .from(proxyHosts)
    .orderBy(desc(proxyHosts.createdAt))
    .limit(limit)
    .offset(offset);
  return hosts.map(parseProxyHost);
}
```

### audit.ts

**Step 2: Add count + search to audit events**

Replace `listAuditEvents` and add `countAuditEvents`:
```ts
import { desc, ilike, or, count, sql } from "drizzle-orm";

export async function countAuditEvents(search?: string): Promise<number> {
  const where = search
    ? or(
        ilike(auditEvents.summary, `%${search}%`),
        ilike(auditEvents.action, `%${search}%`),
        ilike(auditEvents.entityType, `%${search}%`)
      )
    : undefined;
  const [row] = await db.select({ value: count() }).from(auditEvents).where(where);
  return row?.value ?? 0;
}

export async function listAuditEvents(
  limit = 100,
  offset = 0,
  search?: string
): Promise<AuditEvent[]> {
  const where = search
    ? or(
        ilike(auditEvents.summary, `%${search}%`),
        ilike(auditEvents.action, `%${search}%`),
        ilike(auditEvents.entityType, `%${search}%`)
      )
    : undefined;
  const events = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return events.map((event) => ({
    id: event.id,
    user_id: event.userId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    summary: event.summary,
    created_at: toIso(event.createdAt)!,
  }));
}
```

**Note on SQLite and `ilike`:** SQLite's `LIKE` is case-insensitive for ASCII by default. Drizzle's `ilike` maps to `LIKE` on SQLite, so this works correctly.

### access-lists.ts

**Step 3: Add count function and paginated list**

Add `count` to imports:
```ts
import { asc, eq, inArray, count } from "drizzle-orm";
```

After `listAccessLists()`, add:
```ts
export async function countAccessLists(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(accessLists);
  return row?.value ?? 0;
}

export async function listAccessListsPaginated(limit: number, offset: number): Promise<AccessList[]> {
  const lists = await db.query.accessLists.findMany({
    orderBy: (table) => asc(table.name),
    limit,
    offset,
  });

  if (lists.length === 0) return [];

  const listIds = lists.map((list) => list.id);
  const entries = await db
    .select()
    .from(accessListEntries)
    .where(inArray(accessListEntries.accessListId, listIds));

  const entriesByList = new Map<number, (typeof accessListEntries.$inferSelect)[]>();
  for (const entry of entries) {
    const bucket = entriesByList.get(entry.accessListId) ?? [];
    bucket.push(entry);
    entriesByList.set(entry.accessListId, bucket);
  }

  return lists.map((list) => toAccessList(list, entriesByList.get(list.id) ?? []));
}
```

**Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 5: Commit**

```bash
git add src/lib/models/proxy-hosts.ts src/lib/models/audit.ts src/lib/models/access-lists.ts
git commit -m "feat: add paginated list functions to DB models"
```

---

## Task 6: Paginate proxy-hosts page

**Files:**
- Modify: `app/(dashboard)/proxy-hosts/page.tsx`
- Modify: `app/(dashboard)/proxy-hosts/ProxyHostsClient.tsx`

### page.tsx

**Step 1: Add searchParams + paginated queries**

Replace the file:
```tsx
import ProxyHostsClient from "./ProxyHostsClient";
import { listProxyHostsPaginated, countProxyHosts } from "@/src/lib/models/proxy-hosts";
import { listCertificates } from "@/src/lib/models/certificates";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { getAuthentikSettings } from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: { page?: string };
}

export default async function ProxyHostsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [hosts, total, certificates, accessLists, authentikDefaults] = await Promise.all([
    listProxyHostsPaginated(PER_PAGE, offset),
    countProxyHosts(),
    listCertificates(),
    listAccessLists(),
    getAuthentikSettings(),
  ]);

  return (
    <ProxyHostsClient
      hosts={hosts}
      certificates={certificates}
      accessLists={accessLists}
      authentikDefaults={authentikDefaults}
      pagination={{ total, page, perPage: PER_PAGE }}
    />
  );
}
```

### ProxyHostsClient.tsx

**Step 2: Add pagination prop and pass it to DataTable**

Find the `type Props` definition in `ProxyHostsClient.tsx` and add a `pagination` field:
```ts
type Props = {
  hosts: ProxyHost[];
  certificates: Certificate[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings;
  pagination: { total: number; page: number; perPage: number };
};
```

Update the function signature:
```ts
export default function ProxyHostsClient({ hosts, certificates, accessLists, authentikDefaults, pagination }: Props) {
```

Find the `<DataTable` call and add the pagination prop:
```tsx
<DataTable
  columns={columns}
  data={hosts}
  keyField="id"
  emptyMessage="No proxy hosts configured"
  pagination={pagination}
/>
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add app/(dashboard)/proxy-hosts/page.tsx app/(dashboard)/proxy-hosts/ProxyHostsClient.tsx
git commit -m "feat: add server-side pagination to proxy-hosts page"
```

---

## Task 7: Paginate audit-log page

**Files:**
- Modify: `app/(dashboard)/audit-log/page.tsx`
- Modify: `app/(dashboard)/audit-log/AuditLogClient.tsx`

### page.tsx

**Step 1: Replace with paginated + search-aware version**

```tsx
import AuditLogClient from "./AuditLogClient";
import { listAuditEvents, countAuditEvents } from "@/src/lib/models/audit";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 50;

interface PageProps {
  searchParams: { page?: string; search?: string };
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const search = searchParams.search?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [events, total, users] = await Promise.all([
    listAuditEvents(PER_PAGE, offset, search),
    countAuditEvents(search),
    listUsers(),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));

  return (
    <AuditLogClient
      events={events.map((event) => ({
        id: event.id,
        created_at: event.created_at,
        summary: event.summary ?? `${event.action} on ${event.entity_type}`,
        user: event.user_id
          ? userMap.get(event.user_id)?.name ??
            userMap.get(event.user_id)?.email ??
            "System"
          : "System",
      }))}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
```

### AuditLogClient.tsx

**Step 2: Replace client-side search with URL-driven search + DataTable pagination**

The client keeps a search input but now uses `useRouter` to update `?search=` in the URL (with debounce). Replace the entire file:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Chip, Stack, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { DataTable } from "@/src/components/ui/DataTable";

type EventRow = {
  id: number;
  created_at: string;
  user: string;
  summary: string;
};

type Props = {
  events: EventRow[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function AuditLogClient({ events, pagination, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
          params.set("search", value.trim());
        } else {
          params.delete("search");
        }
        params.delete("page"); // reset to page 1 on new search
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const columns = [
    {
      id: "created_at",
      label: "Time",
      width: 180,
      render: (r: EventRow) => (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {new Date(r.created_at).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: "user",
      label: "User",
      width: 160,
      render: (r: EventRow) => (
        <Chip label={r.user} size="small" variant="outlined" />
      ),
    },
    {
      id: "summary",
      label: "Event",
      render: (r: EventRow) => (
        <Typography variant="body2">{r.summary}</Typography>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Typography variant="h4" fontWeight={600}>
        Audit Log
      </Typography>
      <Typography color="text.secondary">Review configuration changes and user activity.</Typography>

      <TextField
        placeholder="Search audit log..."
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          updateSearch(e.target.value);
        }}
        slotProps={{
          input: {
            startAdornment: <SearchIcon sx={{ mr: 1, color: "rgba(255, 255, 255, 0.5)" }} />,
          },
        }}
        size="small"
        sx={{ maxWidth: 400 }}
      />

      <DataTable
        columns={columns}
        data={events}
        keyField="id"
        emptyMessage="No audit events found"
        pagination={pagination}
      />
    </Stack>
  );
}
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add app/(dashboard)/audit-log/page.tsx app/(dashboard)/audit-log/AuditLogClient.tsx
git commit -m "feat: add server-side pagination and search to audit-log page"
```

---

## Task 8: Paginate access-lists page

**Files:**
- Modify: `app/(dashboard)/access-lists/page.tsx`
- Modify: `app/(dashboard)/access-lists/AccessListsClient.tsx`

### page.tsx

**Step 1: Add searchParams + paginated queries**

```tsx
import AccessListsClient from "./AccessListsClient";
import { listAccessListsPaginated, countAccessLists } from "@/src/lib/models/access-lists";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: { page?: string };
}

export default async function AccessListsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [lists, total] = await Promise.all([
    listAccessListsPaginated(PER_PAGE, offset),
    countAccessLists(),
  ]);

  return (
    <AccessListsClient
      lists={lists}
      pagination={{ total, page, perPage: PER_PAGE }}
    />
  );
}
```

### AccessListsClient.tsx

**Step 2: Add MUI Pagination to the card-based list**

Access lists use cards, not DataTable. Add a `Pagination` component at the bottom using the same URL-push pattern.

Add these imports to `AccessListsClient.tsx`:
```ts
import { Box, Pagination } from "@mui/material";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
```

Add `pagination` to the Props type:
```ts
type Props = {
  lists: AccessList[];
  pagination: { total: number; page: number; perPage: number };
};
```

Update the function signature and add page navigation at the bottom of the returned JSX, just before the closing `</Stack>`:
```tsx
export default function AccessListsClient({ lists, pagination }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageCount = Math.ceil(pagination.total / pagination.perPage);

  function handlePageChange(_: React.ChangeEvent<unknown>, page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  // ... existing JSX ...

  // Add at the bottom of the Stack, after the lists rendering:
  {pageCount > 1 && (
    <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
      <Pagination
        count={pageCount}
        page={pagination.page}
        onChange={handlePageChange}
        color="primary"
        shape="rounded"
      />
    </Box>
  )}
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add app/(dashboard)/access-lists/page.tsx app/(dashboard)/access-lists/AccessListsClient.tsx
git commit -m "feat: add server-side pagination to access-lists page"
```

---

## Task 9: Paginate certificates page (ACME table)

**Files:**
- Modify: `app/(dashboard)/certificates/page.tsx`
- Modify: `app/(dashboard)/certificates/CertificatesClient.tsx`

### page.tsx

**Step 1: Add searchParams + paginate the ACME hosts query**

Add `PER_PAGE` and `searchParams` to the page:
```tsx
const PER_PAGE = 25;

interface PageProps {
  searchParams: { page?: string };
}

export default async function CertificatesPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;
```

Change the ACME query to use `limit`/`offset` and add a count query:
```ts
const [acmeRows, acmeTotal, certRows, usageRows] = await Promise.all([
  db
    .select({
      id: proxyHosts.id,
      name: proxyHosts.name,
      domains: proxyHosts.domains,
      sslForced: proxyHosts.sslForced,
      enabled: proxyHosts.enabled,
    })
    .from(proxyHosts)
    .where(isNull(proxyHosts.certificateId))
    .orderBy(proxyHosts.name)
    .limit(PER_PAGE)
    .offset(offset),
  db
    .select({ value: count() })
    .from(proxyHosts)
    .where(isNull(proxyHosts.certificateId))
    .then(([r]) => r?.value ?? 0),
  db.select().from(certificates),
  db
    .select({
      certId: proxyHosts.certificateId,
      hostId: proxyHosts.id,
      hostName: proxyHosts.name,
      hostDomains: proxyHosts.domains,
    })
    .from(proxyHosts)
    .where(isNotNull(proxyHosts.certificateId)),
]);
```

Add `count` to drizzle-orm imports: `import { isNull, isNotNull, count } from 'drizzle-orm';`

Pass `acmePagination` to the client:
```tsx
return (
  <CertificatesClient
    acmeHosts={acmeHosts}
    importedCerts={importedCerts}
    managedCerts={managedCerts}
    acmePagination={{ total: acmeTotal, page, perPage: PER_PAGE }}
  />
);
```

### CertificatesClient.tsx

**Step 2: Add acmePagination prop and pass to DataTable**

Add `acmePagination` to the Props type:
```ts
type Props = {
  acmeHosts: AcmeHost[];
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  acmePagination: { total: number; page: number; perPage: number };
};
```

Pass it to DataTable:
```tsx
<DataTable
  columns={acmeColumns}
  data={acmeHosts}
  keyField="id"
  emptyMessage="No proxy hosts using automatic ACME certificates"
  pagination={acmePagination}
/>
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add app/(dashboard)/certificates/page.tsx app/(dashboard)/certificates/CertificatesClient.tsx
git commit -m "feat: add pagination to certificates ACME table"
```

---

## Final Verification

```bash
npx tsc --noEmit
```
Expected: zero errors across all modified files.
