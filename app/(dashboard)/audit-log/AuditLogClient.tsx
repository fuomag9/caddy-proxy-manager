"use client";

import { useMemo, useState } from "react";
import { Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

type EventRow = {
  id: number;
  created_at: string;
  user: string;
  summary: string;
};

export default function AuditLogClient({ events }: { events: EventRow[] }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredEvents = useMemo(() => {
    if (!searchTerm.trim()) return events;

    const search = searchTerm.toLowerCase();
    return events.filter((event) => {
      // Search in user
      if (event.user.toLowerCase().includes(search)) return true;

      // Search in summary
      if (event.summary.toLowerCase().includes(search)) return true;

      // Search in timestamp
      if (new Date(event.created_at).toLocaleString().toLowerCase().includes(search)) return true;

      return false;
    });
  }, [events, searchTerm]);

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Typography variant="h4" fontWeight={600}>
        Audit Log
      </Typography>
      <Typography color="text.secondary">Review configuration changes and user activity.</Typography>

      <TextField
        placeholder="Search audit log..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        slotProps={{
          input: {
            startAdornment: <SearchIcon sx={{ mr: 1, color: "rgba(255, 255, 255, 0.5)" }} />
          }
        }}
        sx={{
          maxWidth: 500,
          "& .MuiOutlinedInput-root": {
            bgcolor: "rgba(20, 20, 22, 0.6)",
            "&:hover": {
              bgcolor: "rgba(20, 20, 22, 0.8)"
            }
          }
        }}
      />
      <TableContainer component={Paper} sx={{ bgcolor: "background.paper" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Summary</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredEvents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 6, color: "text.secondary" }}>
                  {searchTerm ? "No audit log entries match your search." : "No audit log entries found."}
                </TableCell>
              </TableRow>
            ) : (
              filteredEvents.map((event) => (
                <TableRow key={event.id} hover>
                  <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                  <TableCell>{event.user}</TableCell>
                  <TableCell>{event.summary}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
