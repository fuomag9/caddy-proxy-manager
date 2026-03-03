"use client";

import {
  Box,
  Checkbox,
  Collapse,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import GppBadIcon from "@mui/icons-material/GppBad";
import { useState } from "react";
import { type WafHostConfig } from "@/src/lib/models/proxy-hosts";

type WafMode = "merge" | "override";
type EngineMode = "Off" | "DetectionOnly" | "On";

type Props = {
  value?: WafHostConfig | null;
  showModeSelector?: boolean;
};

export function WafFields({ value, showModeSelector = true }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [wafMode, setWafMode] = useState<WafMode>(value?.waf_mode ?? "merge");
  const [engineMode, setEngineMode] = useState<EngineMode>(value?.mode ?? "DetectionOnly");
  const [loadCrs, setLoadCrs] = useState(value?.load_owasp_crs ?? true);
  const [customDirectives, setCustomDirectives] = useState(value?.custom_directives ?? "");

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "error.main",
        bgcolor: (theme) =>
          theme.palette.mode === "dark" ? "rgba(211,47,47,0.06)" : "rgba(211,47,47,0.04)",
        p: 2,
      }}
    >
      <input type="hidden" name="waf_present" value="1" />
      <input type="hidden" name="waf_mode" value={wafMode} />
      <input type="hidden" name="waf_engine_mode" value={engineMode} />
      <input type="hidden" name="waf_load_owasp_crs" value={loadCrs ? "on" : ""} />
      <input type="hidden" name="waf_custom_directives" value={customDirectives} />

      {/* Header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5} flex={1} minWidth={0}>
          <Box
            sx={{
              mt: 0.25,
              width: 32,
              height: 32,
              borderRadius: 1.5,
              bgcolor: "error.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <GppBadIcon sx={{ fontSize: 18, color: "#fff" }} />
          </Box>
          <Box minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700} lineHeight={1.3}>
              Web Application Firewall
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.25}>
              Inspect and block malicious requests via Coraza / OWASP CRS
            </Typography>
          </Box>
        </Stack>
        <Switch
          checked={enabled}
          onChange={(_, checked) => setEnabled(checked)}
          sx={{ flexShrink: 0 }}
        />
      </Stack>

      {/* Expanded content */}
      <Collapse in={enabled} timeout="auto" unmountOnExit>
        <Box mt={2}>
          {/* Override mode selector */}
          {showModeSelector && (
            <>
              <Stack direction="row" spacing={1}>
                {(["merge", "override"] as WafMode[]).map((v) => (
                  <Box
                    key={v}
                    onClick={() => setWafMode(v)}
                    sx={{
                      flex: 1,
                      py: 0.75,
                      px: 1.5,
                      borderRadius: 1.5,
                      border: "1.5px solid",
                      borderColor: wafMode === v ? "error.main" : "divider",
                      bgcolor:
                        wafMode === v
                          ? (theme) =>
                              theme.palette.mode === "dark"
                                ? "rgba(211,47,47,0.12)"
                                : "rgba(211,47,47,0.08)"
                          : "transparent",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s ease",
                      userSelect: "none",
                      "&:hover": {
                        borderColor: wafMode === v ? "error.main" : "text.disabled",
                      },
                    }}
                  >
                    <Typography
                      variant="body2"
                      fontWeight={wafMode === v ? 600 : 400}
                      color={wafMode === v ? "error.main" : "text.secondary"}
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

          {/* Engine mode */}
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={600}
            sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            Engine Mode
          </Typography>
          <Stack direction="row" spacing={1} mt={0.75}>
            {(["Off", "DetectionOnly", "On"] as EngineMode[]).map((v) => (
              <Box
                key={v}
                onClick={() => setEngineMode(v)}
                sx={{
                  flex: 1,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1.5,
                  border: "1.5px solid",
                  borderColor: engineMode === v ? "error.main" : "divider",
                  bgcolor:
                    engineMode === v
                      ? (theme) =>
                          theme.palette.mode === "dark"
                            ? "rgba(211,47,47,0.12)"
                            : "rgba(211,47,47,0.08)"
                      : "transparent",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                  userSelect: "none",
                  "&:hover": {
                    borderColor: engineMode === v ? "error.main" : "text.disabled",
                  },
                }}
              >
                <Typography
                  variant="body2"
                  fontWeight={engineMode === v ? 600 : 400}
                  color={engineMode === v ? "error.main" : "text.secondary"}
                  sx={{ transition: "all 0.15s ease", fontSize: "0.8rem" }}
                >
                  {v === "DetectionOnly" ? "Detect only" : v}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Divider sx={{ mt: 2, mb: 1.5 }} />

          {/* OWASP CRS */}
          <FormControlLabel
            control={
              <Checkbox
                checked={loadCrs}
                onChange={(_, checked) => setLoadCrs(checked)}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  Load OWASP Core Rule Set
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Covers SQLi, XSS, LFI, RCE and hundreds of other attack patterns
                </Typography>
              </Box>
            }
          />

          {/* Custom directives */}
          <Box mt={1.5}>
            <TextField
              label="Custom SecLang Directives"
              multiline
              minRows={3}
              maxRows={10}
              value={customDirectives}
              onChange={(e) => setCustomDirectives(e.target.value)}
              placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
              inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
              helperText="ModSecurity SecLang syntax. Appended after OWASP CRS if enabled."
              fullWidth
            />
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
