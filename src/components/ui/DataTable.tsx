"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  onRowClick?: (row: T) => void;
  pagination?: {
    total: number;
    page: number;
    perPage: number;
  };
  mobileCard?: (row: T) => ReactNode;
};

function PaginationBar({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.ceil(total / perPage);

  if (pageCount <= 1) return null;

  function goTo(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <Button
        variant="outline"
        size="icon"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="outline"
        size="icon"
        onClick={() => goTo(page + 1)}
        disabled={page >= pageCount}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function DesktopTable<T>({
  columns, data, keyField, emptyMessage, onRowClick, isEmpty,
}: {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  emptyMessage: string;
  onRowClick?: (row: T) => void;
  isEmpty: boolean;
}) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.id}
                style={{ width: col.width }}
                className={col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isEmpty ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row) => (
              <TableRow
                key={String(row[keyField])}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.id}
                    className={col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}
                  >
                    {col.render ? col.render(row) : (row as Record<string, unknown>)[col.id] as ReactNode}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  emptyMessage = "No data available",
  loading = false,
  onRowClick,
  pagination,
  mobileCard,
}: DataTableProps<T>) {
  const isEmpty = data.length === 0 && !loading;

  if (mobileCard) {
    return (
      <div>
        <div className="block md:hidden">
          {isEmpty ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {emptyMessage}
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {data.map((row) => (
                <div key={String(row[keyField])}>{mobileCard(row)}</div>
              ))}
            </div>
          )}
          {pagination && <PaginationBar {...pagination} />}
        </div>
        <div className="hidden md:block">
          <DesktopTable
            columns={columns} data={data} keyField={keyField}
            emptyMessage={emptyMessage} onRowClick={onRowClick}
            isEmpty={isEmpty}
          />
          {pagination && <PaginationBar {...pagination} />}
        </div>
      </div>
    );
  }

  return (
    <div>
      <DesktopTable
        columns={columns} data={data} keyField={keyField}
        emptyMessage={emptyMessage} onRowClick={onRowClick}
        isEmpty={isEmpty}
      />
      {pagination && <PaginationBar {...pagination} />}
    </div>
  );
}
