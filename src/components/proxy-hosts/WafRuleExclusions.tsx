"use client";

import { Box, Chip, IconButton, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useState } from "react";

type Props = {
  value?: number[];
};

export function WafRuleExclusions({ value }: Props) {
  const [ids, setIds] = useState<number[]>(value ?? []);
  const [inputVal, setInputVal] = useState("");

  function addId() {
    const n = parseInt(inputVal.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (ids.includes(n)) { setInputVal(""); return; }
    setIds((prev) => [...prev, n]);
    setInputVal("");
  }

  function removeId(id: number) {
    setIds((prev) => prev.filter((x) => x !== id));
  }

  return (
    <Box>
      <input type="hidden" name="waf_excluded_rule_ids" value={JSON.stringify(ids)} />
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        Excluded Rule IDs
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>
        Rules listed here are disabled via <code>SecRuleRemoveById</code>
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={0.75} mb={ids.length ? 1 : 0}>
        {ids.map((id) => (
          <Chip
            key={id}
            label={id}
            size="small"
            onDelete={() => removeId(id)}
            sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: 260 }}>
        <TextField
          size="small"
          label="Rule ID"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addId(); } }}
          inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
          sx={{ flex: 1 }}
        />
        <IconButton size="small" onClick={addId} color="primary">
          <AddIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}
