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

function PaginationBar({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.ceil(total / perPage);

  if (pageCount <= 1) return null;

  function handlePageChange(_: React.ChangeEvent<unknown>, newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
      <Pagination
        count={pageCount}
        page={page}
        onChange={handlePageChange}
        color="primary"
        shape="rounded"
      />
    </Box>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  emptyMessage = "No data available",
  loading = false,
  pagination,
}: DataTableProps<T>) {
  return (
    <Box>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: "auto" }}>
        <Table sx={{ minWidth: 600 }}>
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

      {pagination && <PaginationBar {...pagination} />}
    </Box>
  );
}
