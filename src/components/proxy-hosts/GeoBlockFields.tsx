"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Chip,
  Collapse,
  Divider,
  Grid,
  IconButton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useState, SyntheticEvent } from "react";
import { GeoBlockSettings } from "@/src/lib/settings";
import { GeoBlockMode } from "@/src/lib/models/proxy-hosts";

// ─── TagInput ────────────────────────────────────────────────────────────────

type TagInputProps = {
  name: string;
  label: string;
  initialValues?: string[];
  placeholder?: string;
  helperText?: string;
  validate?: (value: string) => boolean;
  uppercase?: boolean;
};

function TagInput({ name, label, initialValues = [], placeholder, helperText, validate, uppercase = false }: TagInputProps) {
  const [tags, setTags] = useState<string[]>(initialValues);

  function processValue(raw: string): string {
    return uppercase ? raw.trim().toUpperCase() : raw.trim();
  }

  function addTag(raw: string) {
    const value = processValue(raw);
    if (!value) return;
    if (validate && !validate(value)) return;
    if (tags.includes(value)) return;
    setTags((prev) => [...prev, value]);
  }

  return (
    <Box>
      <input type="hidden" name={name} value={tags.join(",")} />
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={tags}
        onChange={(_, newValue) => {
          const processed = newValue.map((v) => processValue(v as string)).filter((v) => {
            if (!v) return false;
            if (validate && !validate(v)) return false;
            return true;
          });
          // Deduplicate
          setTags([...new Set(processed)]);
        }}
        onBlur={(e) => {
          const input = (e.target as HTMLInputElement).value;
          if (input.trim()) addTag(input);
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => {
            const { key, ...tagProps } = getTagProps({ index });
            return <Chip key={key} label={option} size="small" {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={tags.length === 0 ? placeholder : undefined}
            helperText={helperText}
            size="small"
            onKeyDown={(e) => {
              if (e.key === "," || e.key === " ") {
                e.preventDefault();
                const input = (e.target as HTMLInputElement).value;
                if (input.trim()) {
                  addTag(input);
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
          />
        )}
      />
    </Box>
  );
}

// ─── ResponseHeadersEditor ────────────────────────────────────────────────────

type HeaderRow = { key: string; value: string };

function ResponseHeadersEditor({ initialHeaders }: { initialHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    Object.entries(initialHeaders).map(([key, value]) => ({ key, value }))
  );

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={rows.length > 0 ? 1 : 0}>
        <Typography variant="body2" color="text.secondary">
          Custom Response Headers
        </Typography>
        <Tooltip title="Add header">
          <IconButton size="small" onClick={() => setRows((prev) => [...prev, { key: "", value: "" }])}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {rows.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          No custom headers — click + to add one.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((row, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <input type="hidden" name="geoblock_response_headers_keys[]" value={row.key} />
              <input type="hidden" name="geoblock_response_headers_values[]" value={row.value} />
              <TextField
                label="Header"
                value={row.key}
                onChange={(e) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                size="small"
                fullWidth
              />
              <TextField
                label="Value"
                value={row.value}
                onChange={(e) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                size="small"
                fullWidth
              />
              <Tooltip title="Remove">
                <IconButton size="small" color="error" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} sx={{ mt: 0.5 }}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
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
  const [rulesTab, setRulesTab] = useState(0);

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "warning.main",
        bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(237,108,2,0.06)" : "rgba(237,108,2,0.04)",
        p: 2
      }}
    >
      <input type="hidden" name="geoblock_present" value="1" />

      {/* Header */}
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

      {/* Mode selector */}
      <input type="hidden" name="geoblock_mode" value={mode} />
      {showModeSelector && (
        <Box mt={1.5}>
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, v: GeoBlockMode | null) => { if (v) setMode(v); }}
          >
            <ToggleButton value="merge">Merge with global</ToggleButton>
            <ToggleButton value="override">Override global</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {/* Detail fields */}
      <Collapse in={enabled} timeout="auto" unmountOnExit>
        <Box mt={2}>
          <Divider sx={{ mb: 2 }} />

          {/* Block / Allow tabs */}
          <Tabs
            value={rulesTab}
            onChange={(_: SyntheticEvent, v: number) => setRulesTab(v)}
            variant="fullWidth"
            sx={{ mb: 2, "& .MuiTab-root": { textTransform: "none", fontWeight: 500 } }}
          >
            <Tab label="Block Rules" />
            <Tab label="Allow Rules" />
          </Tabs>

          {/* Block Rules */}
          <Box hidden={rulesTab !== 0}>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TagInput
                  name="geoblock_block_countries"
                  label="Countries"
                  initialValues={initial?.block_countries ?? []}
                  placeholder="CN, RU..."
                  helperText="ISO 3166-1 alpha-2 codes"
                  uppercase
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_block_continents"
                  label="Continents"
                  initialValues={initial?.block_continents ?? []}
                  placeholder="AS, EU..."
                  helperText="AF AN AS EU NA OC SA"
                  uppercase
                />
              </Grid>
              <Grid size={12}>
                <TagInput
                  name="geoblock_block_asns"
                  label="ASNs"
                  initialValues={(initial?.block_asns ?? []).map(String)}
                  placeholder="13335, 15169..."
                  helperText="Autonomous System Numbers"
                  validate={(v) => /^\d+$/.test(v)}
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_block_cidrs"
                  label="CIDRs"
                  initialValues={initial?.block_cidrs ?? []}
                  placeholder="10.0.0.0/8..."
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_block_ips"
                  label="IPs"
                  initialValues={initial?.block_ips ?? []}
                  placeholder="1.2.3.4..."
                />
              </Grid>
            </Grid>
          </Box>

          {/* Allow Rules */}
          <Box hidden={rulesTab !== 1}>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              Allow rules take precedence over block rules.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TagInput
                  name="geoblock_allow_countries"
                  label="Countries"
                  initialValues={initial?.allow_countries ?? []}
                  placeholder="US, DE..."
                  helperText="ISO 3166-1 alpha-2 codes"
                  uppercase
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_allow_continents"
                  label="Continents"
                  initialValues={initial?.allow_continents ?? []}
                  placeholder="NA, EU..."
                  helperText="AF AN AS EU NA OC SA"
                  uppercase
                />
              </Grid>
              <Grid size={12}>
                <TagInput
                  name="geoblock_allow_asns"
                  label="ASNs"
                  initialValues={(initial?.allow_asns ?? []).map(String)}
                  placeholder="13335, 15169..."
                  helperText="Autonomous System Numbers"
                  validate={(v) => /^\d+$/.test(v)}
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_allow_cidrs"
                  label="CIDRs"
                  initialValues={initial?.allow_cidrs ?? []}
                  placeholder="192.168.0.0/16..."
                />
              </Grid>
              <Grid size={6}>
                <TagInput
                  name="geoblock_allow_ips"
                  label="IPs"
                  initialValues={initial?.allow_ips ?? []}
                  placeholder="5.6.7.8..."
                />
              </Grid>
            </Grid>
          </Box>

          {/* Advanced: Trusted Proxies + Block Response */}
          <Box mt={2}>
            <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", border: "1px solid", borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 44, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
                <Typography variant="body2" fontWeight={500}>Trusted Proxies &amp; Block Response</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <TagInput
                    name="geoblock_trusted_proxies"
                    label="Trusted Proxies"
                    initialValues={initial?.trusted_proxies ?? []}
                    placeholder="private_ranges, 10.0.0.0/8..."
                    helperText="Used to parse X-Forwarded-For. Use private_ranges for all RFC-1918 ranges."
                  />

                  <Divider />

                  <Grid container spacing={2}>
                    <Grid size={4}>
                      <TextField
                        name="geoblock_response_status"
                        label="Status Code"
                        type="number"
                        inputProps={{ min: 100, max: 599 }}
                        defaultValue={initial?.response_status ?? 403}
                        helperText="HTTP status when blocked"
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid size={8}>
                      <TextField
                        name="geoblock_response_body"
                        label="Response Body"
                        defaultValue={initial?.response_body ?? "Forbidden"}
                        helperText="Body text returned to blocked clients"
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid size={12}>
                      <TextField
                        name="geoblock_redirect_url"
                        label="Redirect URL"
                        defaultValue={initial?.redirect_url ?? ""}
                        helperText="If set, sends a 302 redirect instead of status/body above"
                        fullWidth
                        size="small"
                        placeholder="https://example.com/blocked"
                      />
                    </Grid>
                  </Grid>

                  <ResponseHeadersEditor initialHeaders={initial?.response_headers ?? {}} />
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
