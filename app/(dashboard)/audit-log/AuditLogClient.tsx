"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import { SearchField } from "@/components/ui/SearchField";
import { PageHeader } from "@/components/ui/PageHeader";

type EventRow = {
  id: number;
  createdAt: string;
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
  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);
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
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      id: "user",
      label: "User",
      width: 160,
      render: (r: EventRow) => (
        <Badge variant="outline">{r.user}</Badge>
      ),
    },
    {
      id: "summary",
      label: "Event",
      render: (r: EventRow) => (
        <p className="text-sm">{r.summary}</p>
      ),
    },
  ];

  const mobileCard = (r: EventRow) => (
    <Card>
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <Badge variant="outline">{r.user}</Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(r.createdAt).toLocaleString()}
          </span>
        </div>
        <p className="text-sm">{r.summary}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Audit Log"
        description="Review configuration changes and user activity."
      />

      <div className="flex items-center gap-2">
      <SearchField
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          updateSearch(e.target.value);
        }}
        placeholder="Search audit log..."
      />
      </div>

      <DataTable
        columns={columns}
        data={events}
        keyField="id"
        emptyMessage="No audit events found"
        pagination={pagination}
        mobileCard={mobileCard}
      />
    </div>
  );
}
