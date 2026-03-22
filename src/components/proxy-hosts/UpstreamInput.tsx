import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MinusCircle, Plus } from "lucide-react";
import { useState } from "react";

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

    const handleProtocolChange = (index: number, newProtocol: string) => {
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
        <div>
            <input type="hidden" name={name} value={serializedValue} />
            <p className="text-sm text-muted-foreground mb-1">Upstreams</p>
            <div className="flex flex-col gap-3">
                {entries.map((entry, index) => (
                    <div key={index} className="flex items-start gap-2">
                        <Select value={entry.protocol} onValueChange={(val) => handleProtocolChange(index, val)}>
                            <SelectTrigger className="w-28">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="http://">http://</SelectItem>
                                <SelectItem value="https://">https://</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            value={entry.address}
                            onChange={(e) => handleAddressChange(index, e.target.value)}
                            placeholder="10.0.0.5:8080"
                            className="flex-1"
                            required={index === 0}
                        />
                        <span title={entries.length === 1 ? "At least one upstream required" : "Remove upstream"}>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemove(index)}
                                disabled={entries.length === 1}
                                className="text-destructive hover:text-destructive mt-0.5"
                            >
                                <MinusCircle className="h-4 w-4" />
                            </Button>
                        </span>
                    </div>
                ))}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAdd}
                    className="self-start"
                >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Upstream
                </Button>
            </div>
            <span className="text-xs text-muted-foreground mt-0.5 block">
                Backend servers to proxy requests to
            </span>
        </div>
    );
}
