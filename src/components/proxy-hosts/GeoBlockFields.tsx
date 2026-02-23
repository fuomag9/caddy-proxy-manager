"use client";

import {
  Box,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import { useState, KeyboardEvent } from "react";
import { GeoBlockSettings } from "@/src/lib/settings";
import { GeoBlockMode } from "@/src/lib/models/proxy-hosts";

// ─── TagInput ────────────────────────────────────────────────────────────────

type TagInputProps = {
  name: string;
  label: string;
  initialValues?: string[];
  placeholder?: string;
  validate?: (value: string) => boolean;
  uppercase?: boolean;
};

function TagInput({ name, label, initialValues = [], placeholder, validate, uppercase = false }: TagInputProps) {
  const [tags, setTags] = useState<string[]>(initialValues);
  const [inputValue, setInputValue] = useState("");

  function addTag(raw: string) {
    const value = uppercase ? raw.trim().toUpperCase() : raw.trim();
    if (!value) return;
    if (validate && !validate(value)) return;
    if (tags.includes(value)) return;
    setTags((prev) => [...prev, value]);
    setInputValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function handleBlur() {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  }

  function removeTag(index: number) {
    setTags((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Box>
      <input type="hidden" name={name} value={tags.join(",")} />
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          p: 1,
          minHeight: 56,
          display: "flex",
          flexWrap: "wrap",
          gap: 0.5,
          alignItems: "flex-start",
          "&:focus-within": {
            borderColor: "primary.main",
            borderWidth: "2px"
          },
          cursor: "text"
        }}
        onClick={(e) => {
          const input = (e.currentTarget as HTMLElement).querySelector("input[type='text']") as HTMLInputElement | null;
          input?.focus();
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            position: "relative",
            top: -8,
            left: 4,
            bgcolor: "background.paper",
            px: 0.5,
            display: "block",
            width: "fit-content",
            mb: -1
          }}
        >
          {label}
        </Typography>
        {tags.map((tag, i) => (
          <Chip
            key={i}
            label={tag}
            size="small"
            onDelete={() => removeTag(i)}
          />
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ""}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: "0.875rem",
            flexGrow: 1,
            minWidth: 80,
            padding: "2px 4px"
          }}
        />
      </Box>
    </Box>
  );
}

// ─── ResponseHeadersEditor ────────────────────────────────────────────────────

type HeaderRow = { key: string; value: string };

function ResponseHeadersEditor({ initialHeaders }: { initialHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    Object.entries(initialHeaders).map(([key, value]) => ({ key, value }))
  );

  function addRow() {
    setRows((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: "key" | "value", val: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="body2" color="text.secondary">
          Response Headers
        </Typography>
        <IconButton
          size="small"
          onClick={addRow}
          title="Add header"
          sx={{ fontSize: "1.25rem", fontWeight: "bold" }}
        >
          +
        </IconButton>
      </Stack>
      {rows.length === 0 && (
        <Typography variant="caption" color="text.disabled">
          No custom response headers. Click + to add one.
        </Typography>
      )}
      <Stack spacing={1}>
        {rows.map((row, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <input type="hidden" name="geoblock_response_headers_keys[]" value={row.key} />
            <input type="hidden" name="geoblock_response_headers_values[]" value={row.value} />
            <TextField
              label="Header Name"
              value={row.key}
              onChange={(e) => updateRow(i, "key", e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Header Value"
              value={row.value}
              onChange={(e) => updateRow(i, "value", e.target.value)}
              size="small"
              fullWidth
            />
            <IconButton size="small" onClick={() => removeRow(i)} title="Remove header" color="error">
              ×
            </IconButton>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

// ─── GeoBlockFields ───────────────────────────────────────────────────────────

type GeoBlockFieldsProps = {
  initialValues?: {
    geoblock: GeoBlockSettings | null;
    geoblock_mode: GeoBlockMode;
  };
  showModeSelector?: boolean;
};

export function GeoBlockFields({ initialValues, showModeSelector = true }: GeoBlockFieldsProps) {
  const initial = initialValues?.geoblock ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [mode, setMode] = useState<GeoBlockMode>(initialValues?.geoblock_mode ?? "merge");

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "warning.main",
        bgcolor: "rgba(237, 108, 2, 0.05)",
        p: 2.5
      }}
    >
      {/* Always-present sentinel */}
      <input type="hidden" name="geoblock_present" value="1" />

      <Stack spacing={2}>
        {/* Header row: title + toggle */}
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Geo Blocking
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Block or allow traffic by country, continent, ASN, CIDR, or IP
            </Typography>
          </Box>
          <Switch
            name="geoblock_enabled"
            checked={enabled}
            onChange={(_, checked) => setEnabled(checked)}
          />
        </Stack>

        {/* Mode selector (merge vs override) */}
        {showModeSelector && (
          <Box>
            <input type="hidden" name="geoblock_mode" value={mode} />
            <ToggleButtonGroup
              value={mode}
              exclusive
              size="small"
              onChange={(_, newMode: GeoBlockMode | null) => {
                if (newMode) setMode(newMode);
              }}
            >
              <ToggleButton value="merge">Merge with global</ToggleButton>
              <ToggleButton value="override">Override global</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {/* Collapsible detail fields */}
        <Collapse in={enabled} timeout="auto" unmountOnExit>
          <Stack spacing={2.5}>
            <Divider />

            {/* Block Rules */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Block Rules
              </Typography>
              <Stack spacing={1.5}>
                <TagInput
                  name="geoblock_block_countries"
                  label="Block Countries (ISO 3166-1 alpha-2)"
                  initialValues={initial?.block_countries ?? []}
                  placeholder="CN, RU, ..."
                  uppercase
                />
                <TagInput
                  name="geoblock_block_continents"
                  label="Block Continents"
                  initialValues={initial?.block_continents ?? []}
                  placeholder="AS, EU, ..."
                  uppercase
                />
                <TagInput
                  name="geoblock_block_asns"
                  label="Block ASNs"
                  initialValues={(initial?.block_asns ?? []).map(String)}
                  placeholder="12345, ..."
                  validate={(v) => /^\d+$/.test(v)}
                />
                <TagInput
                  name="geoblock_block_cidrs"
                  label="Block CIDRs"
                  initialValues={initial?.block_cidrs ?? []}
                  placeholder="10.0.0.0/8, ..."
                />
                <TagInput
                  name="geoblock_block_ips"
                  label="Block IPs"
                  initialValues={initial?.block_ips ?? []}
                  placeholder="1.2.3.4, ..."
                />
              </Stack>
            </Box>

            <Divider />

            {/* Allow Rules */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Allow Rules{" "}
                <Typography component="span" variant="caption" color="text.secondary">
                  (override block rules)
                </Typography>
              </Typography>
              <Stack spacing={1.5}>
                <TagInput
                  name="geoblock_allow_countries"
                  label="Allow Countries (ISO 3166-1 alpha-2)"
                  initialValues={initial?.allow_countries ?? []}
                  placeholder="US, DE, ..."
                  uppercase
                />
                <TagInput
                  name="geoblock_allow_continents"
                  label="Allow Continents"
                  initialValues={initial?.allow_continents ?? []}
                  placeholder="NA, EU, ..."
                  uppercase
                />
                <TagInput
                  name="geoblock_allow_asns"
                  label="Allow ASNs"
                  initialValues={(initial?.allow_asns ?? []).map(String)}
                  placeholder="12345, ..."
                  validate={(v) => /^\d+$/.test(v)}
                />
                <TagInput
                  name="geoblock_allow_cidrs"
                  label="Allow CIDRs"
                  initialValues={initial?.allow_cidrs ?? []}
                  placeholder="192.168.0.0/16, ..."
                />
                <TagInput
                  name="geoblock_allow_ips"
                  label="Allow IPs"
                  initialValues={initial?.allow_ips ?? []}
                  placeholder="5.6.7.8, ..."
                />
              </Stack>
            </Box>

            <Divider />

            {/* Trusted Proxies */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Trusted Proxies
              </Typography>
              <TagInput
                name="geoblock_trusted_proxies"
                label="Trusted Proxies (for X-Forwarded-For)"
                initialValues={initial?.trusted_proxies ?? []}
                placeholder="private_ranges, 10.0.0.0/8, ..."
              />
            </Box>

            <Divider />

            {/* Block Response */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Block Response
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    name="geoblock_response_status"
                    label="Response Status Code"
                    type="number"
                    inputProps={{ min: 100, max: 599 }}
                    defaultValue={initial?.response_status ?? 403}
                    helperText="HTTP status code returned when blocked"
                    fullWidth
                    size="small"
                  />
                  <TextField
                    name="geoblock_response_body"
                    label="Response Body"
                    defaultValue={initial?.response_body ?? "Forbidden"}
                    helperText="Body text returned when blocked"
                    fullWidth
                    size="small"
                  />
                </Stack>
                <TextField
                  name="geoblock_redirect_url"
                  label="Redirect URL (optional)"
                  defaultValue={initial?.redirect_url ?? ""}
                  helperText="If set, issues a 302 redirect instead of returning the status/body above"
                  fullWidth
                  size="small"
                  placeholder="https://example.com/blocked"
                />
                <ResponseHeadersEditor initialHeaders={initial?.response_headers ?? {}} />
              </Stack>
            </Box>
          </Stack>
        </Collapse>
      </Stack>
    </Box>
  );
}
