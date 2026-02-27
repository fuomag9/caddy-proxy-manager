"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import PublicIcon from "@mui/icons-material/Public";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { useState, useEffect, useMemo, useCallback, SyntheticEvent } from "react";
import { GeoBlockSettings } from "@/src/lib/settings";
import { GeoBlockMode } from "@/src/lib/models/proxy-hosts";
import { COUNTRIES, flagEmoji } from "./countries";

// ─── GeoIpStatus ─────────────────────────────────────────────────────────────

type GeoIpStatusData = { country: boolean; asn: boolean } | null;

function GeoIpStatus() {
  const [status, setStatus] = useState<GeoIpStatusData>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/geoip-status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <CircularProgress size={12} sx={{ color: "text.disabled" }} />;
  }

  const allLoaded = status?.country && status?.asn;
  const noneLoaded = !status?.country && !status?.asn;

  const color = allLoaded ? "success" : noneLoaded ? "error" : "warning";
  const Icon = allLoaded ? CheckCircleIcon : noneLoaded ? ErrorIcon : WarningAmberIcon;
  const label = allLoaded ? "GeoIP ready" : noneLoaded ? "GeoIP missing" : "GeoIP partial";
  const tooltip = noneLoaded
    ? "GeoIP databases not found — country/continent/ASN blocking will not work. Enable the geoipupdate service."
    : !status?.country
    ? "GeoLite2-Country database missing — country/continent blocking disabled"
    : !status?.asn
    ? "GeoLite2-ASN database missing — ASN blocking disabled"
    : "GeoLite2-Country and GeoLite2-ASN databases loaded";

  return (
    <Tooltip title={tooltip} placement="right">
      <Chip
        size="small"
        icon={<Icon sx={{ fontSize: "14px !important" }} />}
        label={label}
        color={color}
        variant="outlined"
        sx={{ height: 22, fontSize: "0.7rem", fontWeight: 600, letterSpacing: 0.3, cursor: "default", "& .MuiChip-icon": { ml: "6px" } }}
      />
    </Tooltip>
  );
}

// ─── CountryPicker ────────────────────────────────────────────────────────────

const CONTINENTS = [
  { code: "AF", name: "Africa", emoji: "🌍" },
  { code: "AN", name: "Antarctica", emoji: "🧊" },
  { code: "AS", name: "Asia", emoji: "🌏" },
  { code: "EU", name: "Europe", emoji: "🌍" },
  { code: "NA", name: "N. America", emoji: "🌎" },
  { code: "OC", name: "Oceania", emoji: "🌏" },
  { code: "SA", name: "S. America", emoji: "🌎" },
];

type CountryPickerProps = {
  name: string;
  initialValues?: string[];
  accentColor?: "warning" | "success";
};

function CountryPicker({ name, initialValues = [], accentColor = "warning" }: CountryPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialValues.map((c) => c.toUpperCase()).filter(Boolean))
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().startsWith(q)
    );
  }, [search]);

  const toggle = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const selectFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.add(c.code));
      return next;
    });
  }, [filtered]);

  const clearFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.delete(c.code));
      return next;
    });
  }, [filtered]);

  const selectedInFiltered = filtered.filter((c) => selected.has(c.code)).length;
  const allFilteredSelected = filtered.length > 0 && selectedInFiltered === filtered.length;

  return (
    <Box>
      <input type="hidden" name={name} value={[...selected].join(",")} />

      {/* Search */}
      <TextField
        fullWidth
        size="small"
        placeholder="Search by country name or code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: "text.disabled" }} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch("")} edge="end" sx={{ p: 0.25 }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
          },
        }}
        sx={{ mb: 0.75 }}
      />

      {/* Toolbar */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.75}>
        <Typography variant="caption" color="text.secondary">
          {selected.size > 0 ? (
            <>{selected.size} selected{search && `, ${selectedInFiltered} shown`}</>
          ) : (
            <Box component="span" sx={{ opacity: 0.5 }}>None selected</Box>
          )}
        </Typography>
        <Stack direction="row" spacing={0.25}>
          <Button
            size="small"
            onClick={selectFiltered}
            disabled={allFilteredSelected}
            sx={{ fontSize: "0.7rem", py: 0.25, px: 0.75, minWidth: 0, textTransform: "none" }}
          >
            {search ? "Select matching" : "Select all"}
          </Button>
          <Typography variant="caption" color="text.disabled" sx={{ alignSelf: "center" }}>·</Typography>
          <Button
            size="small"
            onClick={clearFiltered}
            disabled={selectedInFiltered === 0}
            sx={{ fontSize: "0.7rem", py: 0.25, px: 0.75, minWidth: 0, textTransform: "none" }}
          >
            {search ? "Clear matching" : "Clear all"}
          </Button>
        </Stack>
      </Stack>

      {/* Grid */}
      <Box
        sx={{
          maxHeight: 220,
          overflowY: "auto",
          display: "flex",
          flexWrap: "wrap",
          gap: 0.5,
          p: 0.75,
          borderRadius: 1.5,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: (t) => t.palette.mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
          "&::-webkit-scrollbar": { width: 5 },
          "&::-webkit-scrollbar-thumb": { borderRadius: 3, bgcolor: "divider" },
          "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        }}
      >
        {filtered.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ p: 0.5 }}>
            No countries match &ldquo;{search}&rdquo;
          </Typography>
        ) : (
          filtered.map((country) => {
            const isSelected = selected.has(country.code);
            return (
              <Chip
                key={country.code}
                label={
                  <Box component="span" sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <Box component="span" sx={{ fontSize: "0.85rem", lineHeight: 1 }}>
                      {flagEmoji(country.code)}
                    </Box>
                    <Box component="span">{country.name}</Box>
                    <Box component="span" sx={{ opacity: 0.55, fontSize: "0.6rem", fontFamily: "monospace" }}>
                      {country.code}
                    </Box>
                  </Box>
                }
                size="small"
                onClick={() => toggle(country.code)}
                color={isSelected ? accentColor : "default"}
                variant={isSelected ? "filled" : "outlined"}
                sx={{
                  cursor: "pointer",
                  fontSize: "0.72rem",
                  height: 26,
                  transition: "all 0.1s ease",
                  "& .MuiChip-label": { px: 0.75 },
                  ...(!isSelected && {
                    borderColor: "divider",
                    "&:hover": { borderColor: "text.disabled", bgcolor: "action.hover" },
                  }),
                  ...(isSelected && {
                    fontWeight: 600,
                    boxShadow: accentColor === "warning"
                      ? "0 0 0 1px rgba(237,108,2,0.3)"
                      : "0 0 0 1px rgba(46,125,50,0.3)",
                  }),
                }}
              />
            );
          })
        )}
      </Box>

      {/* Selected summary chips (shown when search is active and selected items are hidden) */}
      {search && selected.size > 0 && (
        <Box mt={0.75}>
          <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>
            All selected ({selected.size}):
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxHeight: 72, overflowY: "auto" }}>
            {[...selected].map((code) => {
              const country = COUNTRIES.find((c) => c.code === code);
              return (
                <Chip
                  key={code}
                  label={
                    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <Box component="span" sx={{ fontSize: "0.8rem" }}>{flagEmoji(code)}</Box>
                      <Box component="span">{country?.name ?? code}</Box>
                    </Box>
                  }
                  size="small"
                  onDelete={() => toggle(code)}
                  color={accentColor}
                  variant="filled"
                  sx={{ fontSize: "0.7rem", height: 22, fontWeight: 600, "& .MuiChip-label": { px: 0.6 } }}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── ContinentPicker ──────────────────────────────────────────────────────────

type ContinentPickerProps = {
  name: string;
  initialValues?: string[];
  accentColor?: "warning" | "success";
};

function ContinentPicker({ name, initialValues = [], accentColor = "warning" }: ContinentPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialValues.map((c) => c.toUpperCase()).filter(Boolean))
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const isWarning = accentColor === "warning";

  return (
    <Box>
      <input type="hidden" name={name} value={[...selected].join(",")} />
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.75}>
        <Typography variant="caption" color="text.secondary">
          {selected.size > 0 ? `${selected.size} selected` : <Box component="span" sx={{ opacity: 0.5 }}>None selected</Box>}
        </Typography>
        <Stack direction="row" spacing={0.25}>
          <Button
            size="small"
            onClick={() => setSelected(new Set(CONTINENTS.map((c) => c.code)))}
            disabled={selected.size === CONTINENTS.length}
            sx={{ fontSize: "0.7rem", py: 0.25, px: 0.75, minWidth: 0, textTransform: "none" }}
          >
            Select all
          </Button>
          <Typography variant="caption" color="text.disabled" sx={{ alignSelf: "center" }}>·</Typography>
          <Button
            size="small"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            sx={{ fontSize: "0.7rem", py: 0.25, px: 0.75, minWidth: 0, textTransform: "none" }}
          >
            Clear all
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {CONTINENTS.map((c) => {
          const isSelected = selected.has(c.code);
          return (
            <Box
              key={c.code}
              onClick={() => toggle(c.code)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.25,
                py: 0.75,
                borderRadius: 1.5,
                border: "1.5px solid",
                borderColor: isSelected
                  ? isWarning ? "warning.main" : "success.main"
                  : "divider",
                bgcolor: isSelected
                  ? (t) => t.palette.mode === "dark"
                    ? isWarning ? "rgba(237,108,2,0.15)" : "rgba(46,125,50,0.15)"
                    : isWarning ? "rgba(237,108,2,0.08)" : "rgba(46,125,50,0.08)"
                  : "transparent",
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.12s ease",
                "&:hover": {
                  borderColor: isSelected
                    ? isWarning ? "warning.dark" : "success.dark"
                    : "text.disabled",
                  bgcolor: isSelected
                    ? (t) => t.palette.mode === "dark"
                      ? isWarning ? "rgba(237,108,2,0.22)" : "rgba(46,125,50,0.22)"
                      : isWarning ? "rgba(237,108,2,0.13)" : "rgba(46,125,50,0.13)"
                    : "action.hover",
                },
                ...(isSelected && {
                  boxShadow: isWarning
                    ? "0 0 0 1px rgba(237,108,2,0.25)"
                    : "0 0 0 1px rgba(46,125,50,0.25)",
                }),
              }}
            >
              <Typography sx={{ fontSize: "1rem", lineHeight: 1 }}>{c.emoji}</Typography>
              <Box>
                <Typography
                  variant="caption"
                  fontWeight={isSelected ? 700 : 400}
                  color={isSelected
                    ? isWarning ? "warning.main" : "success.main"
                    : "text.primary"}
                  display="block"
                  lineHeight={1.2}
                  sx={{ transition: "all 0.12s ease" }}
                >
                  {c.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ fontSize: "0.62rem", fontFamily: "monospace" }}
                >
                  {c.code}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

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
  const [inputValue, setInputValue] = useState("");

  function processValue(raw: string): string {
    return uppercase ? raw.trim().toUpperCase() : raw.trim();
  }

  function commitInput(raw: string) {
    const value = processValue(raw);
    if (!value) return;
    if (validate && !validate(value)) return;
    if (tags.includes(value)) {
      setInputValue("");
      return;
    }
    setTags((prev) => [...prev, value]);
    setInputValue("");
  }

  return (
    <Box>
      <input type="hidden" name={name} value={tags.join(",")} />
      <TextField
        label={label}
        size="small"
        fullWidth
        value={inputValue}
        placeholder={tags.length === 0 ? placeholder : undefined}
        helperText={helperText}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "," || e.key === " " || e.key === "Enter") {
            e.preventDefault();
            commitInput(inputValue);
          }
          if (e.key === "Backspace" && !inputValue && tags.length > 0) {
            setTags((prev) => prev.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (inputValue.trim()) commitInput(inputValue);
        }}
        slotProps={{
          input: {
            startAdornment: tags.length > 0 ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mr: 0.5, my: 0.25 }}>
                {tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    onDelete={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    sx={{ height: 20, fontSize: "0.68rem", "& .MuiChip-label": { px: 0.6 }, "& .MuiChip-deleteIcon": { fontSize: 12 } }}
                  />
                ))}
              </Box>
            ) : undefined,
          },
        }}
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
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

// ─── RulesPanel ───────────────────────────────────────────────────────────────

type RulesPanelProps = {
  prefix: "block" | "allow";
  initial: GeoBlockSettings | null;
};

function RulesPanel({ prefix, initial }: RulesPanelProps) {
  const accentColor = prefix === "block" ? "warning" : "success";
  const countries = prefix === "block" ? (initial?.block_countries ?? []) : (initial?.allow_countries ?? []);
  const continents = prefix === "block" ? (initial?.block_continents ?? []) : (initial?.allow_continents ?? []);
  const asns = prefix === "block" ? (initial?.block_asns ?? []) : (initial?.allow_asns ?? []);
  const cidrs = prefix === "block" ? (initial?.block_cidrs ?? []) : (initial?.allow_cidrs ?? []);
  const ips = prefix === "block" ? (initial?.block_ips ?? []) : (initial?.allow_ips ?? []);

  return (
    <Stack spacing={2.5}>
      {/* Countries */}
      <Box>
        <Typography variant="body2" fontWeight={600} mb={1} color="text.primary">
          Countries
        </Typography>
        <CountryPicker
          name={`geoblock_${prefix}_countries`}
          initialValues={countries}
          accentColor={accentColor}
        />
      </Box>

      <Divider />

      {/* Continents */}
      <Box>
        <Typography variant="body2" fontWeight={600} mb={1} color="text.primary">
          Continents
        </Typography>
        <ContinentPicker
          name={`geoblock_${prefix}_continents`}
          initialValues={continents}
          accentColor={accentColor}
        />
      </Box>

      <Divider />

      {/* ASNs */}
      <TagInput
        name={`geoblock_${prefix}_asns`}
        label="ASNs"
        initialValues={asns.map(String)}
        placeholder="13335, 15169…"
        helperText="Autonomous System Numbers — press Enter or comma to add"
        validate={(v) => /^\d+$/.test(v)}
      />

      {/* CIDRs + IPs */}
      <Grid container spacing={2}>
        <Grid size={6}>
          <TagInput
            name={`geoblock_${prefix}_cidrs`}
            label="CIDRs"
            initialValues={cidrs}
            placeholder="10.0.0.0/8…"
            helperText="Press Enter or comma to add"
          />
        </Grid>
        <Grid size={6}>
          <TagInput
            name={`geoblock_${prefix}_ips`}
            label="IP Addresses"
            initialValues={ips}
            placeholder="1.2.3.4…"
            helperText="Press Enter or comma to add"
          />
        </Grid>
      </Grid>
    </Stack>
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
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5} flex={1} minWidth={0}>
          <Box
            sx={{
              mt: 0.25,
              width: 32,
              height: 32,
              borderRadius: 1.5,
              bgcolor: "warning.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <PublicIcon sx={{ fontSize: 18, color: "#fff" }} />
          </Box>
          <Box minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <Typography variant="subtitle1" fontWeight={700} lineHeight={1.3}>
                Geo Blocking
              </Typography>
              <GeoIpStatus />
            </Stack>
            <Typography variant="body2" color="text.secondary" mt={0.25}>
              Block or allow traffic by country, continent, ASN, CIDR, or IP
            </Typography>
          </Box>
        </Stack>
        <Switch
          name="geoblock_enabled"
          checked={enabled}
          onChange={(_, checked) => setEnabled(checked)}
          sx={{ flexShrink: 0 }}
        />
      </Stack>

      {/* Mode selector */}
      <input type="hidden" name="geoblock_mode" value={mode} />

      {/* Detail fields */}
      <Collapse in={enabled} timeout="auto" unmountOnExit>
        <Box mt={2}>
          {showModeSelector && (
            <>
              <Stack direction="row" spacing={1}>
                {(["merge", "override"] as GeoBlockMode[]).map((v) => (
                  <Box
                    key={v}
                    onClick={() => setMode(v)}
                    sx={{
                      flex: 1,
                      py: 0.75,
                      px: 1.5,
                      borderRadius: 1.5,
                      border: "1.5px solid",
                      borderColor: mode === v ? "warning.main" : "divider",
                      bgcolor: mode === v
                        ? (theme) => theme.palette.mode === "dark" ? "rgba(237,108,2,0.12)" : "rgba(237,108,2,0.08)"
                        : "transparent",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s ease",
                      userSelect: "none",
                      "&:hover": {
                        borderColor: mode === v ? "warning.main" : "text.disabled",
                      },
                    }}
                  >
                    <Typography
                      variant="body2"
                      fontWeight={mode === v ? 600 : 400}
                      color={mode === v ? "warning.main" : "text.secondary"}
                      sx={{ transition: "all 0.15s ease" }}
                    >
                      {v === "merge" ? "Merge with global" : "Override global"}
                    </Typography>
                  </Box>
                ))}
              </Stack>
              <Divider sx={{ mt: 2, mb: 2 }} />
            </>
          )}
          {!showModeSelector && <Divider sx={{ mb: 2 }} />}

          {/* Block / Allow tabs */}
          <Tabs
            value={rulesTab}
            onChange={(_: SyntheticEvent, v: number) => setRulesTab(v)}
            variant="fullWidth"
            sx={{ mb: 2.5, "& .MuiTab-root": { textTransform: "none", fontWeight: 500 } }}
          >
            <Tab label="Block Rules" />
            <Tab label="Allow Rules" />
          </Tabs>

          <Box hidden={rulesTab !== 0}>
            <RulesPanel prefix="block" initial={initial} />
          </Box>

          <Box hidden={rulesTab !== 1}>
            <Box mb={1.5}>
              <Typography variant="caption" color="text.secondary">
                Allow rules take precedence over block rules.
              </Typography>
            </Box>
            <RulesPanel prefix="allow" initial={initial} />
          </Box>

          {/* Advanced: Trusted Proxies + Block Response */}
          <Box mt={2.5}>
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
                    placeholder="private_ranges, 10.0.0.0/8…"
                    helperText="Used to parse X-Forwarded-For. Use private_ranges for all RFC-1918 ranges."
                  />

                  <Tooltip title="When enabled, requests where the real client IP cannot be determined (e.g. behind a trusted proxy with no usable X-Forwarded-For) are blocked. Default: off (fail-open).">
                    <FormControlLabel
                      control={
                        <Checkbox
                          name="geoblock_fail_closed"
                          defaultChecked={initial?.fail_closed ?? false}
                          size="small"
                        />
                      }
                      label={<Typography variant="body2">Fail closed (block indeterminate IPs)</Typography>}
                    />
                  </Tooltip>

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
