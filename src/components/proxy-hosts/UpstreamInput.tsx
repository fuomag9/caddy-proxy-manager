
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography, Autocomplete, InputAdornment } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import { useState } from "react";

const PROTOCOL_OPTIONS = ["http://", "https://"];

type UpstreamEntry = {
    protocol: string;
    address: string;
};

function parseUpstream(upstream: string): UpstreamEntry {
    if (upstream.startsWith("https://")) {
        return { protocol: "https://", address: upstream.slice(8) };
    }
    if (upstream.startsWith("http://")) {
        return { protocol: "http://", address: upstream.slice(7) };
    }
    return { protocol: "http://", address: upstream };
}

export function UpstreamInput({
    defaultUpstreams = [],
    name = "upstreams"
}: {
    defaultUpstreams?: string[];
    name?: string;
}) {
    const initialEntries: UpstreamEntry[] = defaultUpstreams.length > 0
        ? defaultUpstreams.map(parseUpstream)
        : [{ protocol: "http://", address: "" }];

    const [entries, setEntries] = useState<UpstreamEntry[]>(initialEntries);

    const handleProtocolChange = (index: number, newProtocol: string | null) => {
        const updated = [...entries];
        updated[index].protocol = newProtocol || "http://";
        setEntries(updated);
    };

    const handleAddressChange = (index: number, newAddress: string) => {
        const updated = [...entries];
        // Strip protocol if user pasted a full URL
        if (newAddress.startsWith("https://")) {
            updated[index].protocol = "https://";
            updated[index].address = newAddress.slice(8);
        } else if (newAddress.startsWith("http://")) {
            updated[index].protocol = "http://";
            updated[index].address = newAddress.slice(7);
        } else {
            updated[index].address = newAddress;
        }
        setEntries(updated);
    };

    const handleAdd = () => {
        setEntries([...entries, { protocol: "http://", address: "" }]);
    };

    const handleRemove = (index: number) => {
        if (entries.length === 1) return;
        setEntries(entries.filter((_, i) => i !== index));
    };

    const serializedValue = entries
        .filter(e => e.address.trim() !== "")
        .map(e => `${e.protocol}${e.address.trim()}`)
        .join("\n");

    return (
        <Box>
            <input type="hidden" name={name} value={serializedValue} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Upstreams
            </Typography>
            <Stack spacing={1.5}>
                {entries.map((entry, index) => (
                    <Stack key={index} direction="row" spacing={1} alignItems="flex-start">
                        <Autocomplete
                            freeSolo
                            options={PROTOCOL_OPTIONS}
                            value={entry.protocol}
                            onChange={(_, newValue) => handleProtocolChange(index, newValue)}
                            onInputChange={(_, newInputValue) => {
                                if (newInputValue) {
                                    handleProtocolChange(index, newInputValue);
                                }
                            }}
                            disableClearable
                            sx={{ width: 140 }}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    size="small"
                                    placeholder="http://"
                                />
                            )}
                        />
                        <TextField
                            value={entry.address}
                            onChange={(e) => handleAddressChange(index, e.target.value)}
                            placeholder="10.0.0.5:8080"
                            size="small"
                            fullWidth
                            required={index === 0}
                        />
                        <Tooltip title={entries.length === 1 ? "At least one upstream required" : "Remove upstream"}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={() => handleRemove(index)}
                                    disabled={entries.length === 1}
                                    color="error"
                                    sx={{ mt: 0.5 }}
                                >
                                    <RemoveCircleIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Stack>
                ))}
                <Button
                    startIcon={<AddIcon />}
                    onClick={handleAdd}
                    size="small"
                    sx={{ alignSelf: "flex-start" }}
                >
                    Add Upstream
                </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Backend servers to proxy requests to
            </Typography>
        </Box>
    );
}
