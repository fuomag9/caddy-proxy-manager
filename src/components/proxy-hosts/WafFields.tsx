"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SecurityIcon from "@mui/icons-material/Security";
import { useState } from "react";
import { type WafHostConfig } from "@/src/lib/models/proxy-hosts";

type Props = {
  value?: WafHostConfig | null;
};

export function WafFields({ value }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [engineMode, setEngineMode] = useState<"Off" | "DetectionOnly" | "On">(
    value?.mode ?? "DetectionOnly"
  );
  const [loadCrs, setLoadCrs] = useState(value?.load_owasp_crs ?? true);
  const [customDirectives, setCustomDirectives] = useState(value?.custom_directives ?? "");
  const [wafMode, setWafMode] = useState<"merge" | "override">(value?.waf_mode ?? "merge");

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SecurityIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <Typography variant="subtitle2">Web Application Firewall (WAF)</Typography>
          {enabled && (
            <Typography variant="caption" color={engineMode === "On" ? "error" : "warning.main"} sx={{ ml: 1 }}>
              {engineMode === "On" ? "Blocking" : engineMode === "DetectionOnly" ? "Detection Only" : "Off"}
            </Typography>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {/* Hidden marker so the server action knows WAF config was submitted */}
        <input type="hidden" name="waf_present" value="1" />
        <input type="hidden" name="waf_mode" value={wafMode} />
        <input type="hidden" name="waf_engine_mode" value={engineMode} />
        <input type="hidden" name="waf_load_owasp_crs" value={loadCrs ? "on" : ""} />
        <input type="hidden" name="waf_custom_directives" value={customDirectives} />

        <Stack spacing={2}>
          {/* Enable toggle */}
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(_, checked) => setEnabled(checked)}
                size="small"
              />
            }
            label="Enable WAF for this host"
          />

          {enabled && (
            <>
              {/* Override mode */}
              <Box>
                <FormLabel sx={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Override Mode
                </FormLabel>
                <ToggleButtonGroup
                  value={wafMode}
                  exclusive
                  onChange={(_, v) => v && setWafMode(v)}
                  size="small"
                  sx={{ mt: 0.5 }}
                >
                  <ToggleButton value="merge">Merge with global</ToggleButton>
                  <ToggleButton value="override">Override global</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {/* Engine mode */}
              <FormControl>
                <FormLabel sx={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Engine Mode
                </FormLabel>
                <RadioGroup
                  row
                  value={engineMode}
                  onChange={(e) => setEngineMode(e.target.value as "Off" | "DetectionOnly" | "On")}
                >
                  <FormControlLabel value="Off" control={<Radio size="small" />} label="Off" />
                  <FormControlLabel value="DetectionOnly" control={<Radio size="small" />} label="Detection Only" />
                  <FormControlLabel value="On" control={<Radio size="small" />} label="On (Blocking)" />
                </RadioGroup>
              </FormControl>

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
                  <span>
                    Load OWASP Core Rule Set{" "}
                    <Typography component="span" variant="caption" color="text.secondary">
                      (covers SQLi, XSS, LFI, RCE)
                    </Typography>
                  </span>
                }
              />

              {/* Custom directives */}
              <TextField
                label="Custom SecLang Directives"
                multiline
                minRows={3}
                maxRows={10}
                value={customDirectives}
                onChange={(e) => setCustomDirectives(e.target.value)}
                placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
                inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
                helperText="ModSecurity SecLang syntax. Applied after OWASP CRS if enabled."
                fullWidth
              />
            </>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
