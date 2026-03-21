"use client";
import { useState } from "react";
import {
  Box, Button, IconButton, MenuItem, Select,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import type { RedirectRule } from "@/src/lib/models/proxy-hosts";

type Props = { initialData?: RedirectRule[] };

export function RedirectsFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RedirectRule[]>(initialData);

  const addRule = () =>
    setRules((r) => [...r, { from: "", to: "", status: 301 }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, key: keyof RedirectRule, value: string | number) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Redirects
      </Typography>
      <input type="hidden" name="redirects_json" value={JSON.stringify(rules)} />
      {rules.length > 0 && (
        <Table size="small" sx={{ mb: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>From Path</TableCell>
              <TableCell>To URL / Path</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule, i) => (
              <TableRow key={i}>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="/.well-known/carddav"
                    value={rule.from}
                    onChange={(e) => updateRule(i, "from", e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="/remote.php/dav/"
                    value={rule.to}
                    onChange={(e) => updateRule(i, "to", e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell sx={{ width: 90 }}>
                  <Select
                    size="small"
                    value={rule.status}
                    onChange={(e) => updateRule(i, "status", Number(e.target.value))}
                  >
                    {[301, 302, 307, 308].map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell sx={{ width: 40 }}>
                  <IconButton size="small" onClick={() => removeRule(i)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Button size="small" startIcon={<AddIcon />} onClick={addRule}>
        Add Redirect
      </Button>
    </Box>
  );
}
