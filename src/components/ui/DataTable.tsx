
import {
    Card,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    Box
} from "@mui/material";
import { ReactNode } from "react";

type Column<T> = {
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
};

export function DataTable<T>({
    columns,
    data,
    keyField,
    emptyMessage = "No data available",
    loading = false
}: DataTableProps<T>) {
    return (
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
                                        {col.render ? col.render(row) : (row as any)[col.id]}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
