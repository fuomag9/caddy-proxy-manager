import { TextField } from "@mui/material";
import type { RewriteConfig } from "@/src/lib/models/proxy-hosts";

type Props = { initialData?: RewriteConfig | null };

export function RewriteFields({ initialData }: Props) {
  return (
    <TextField
      name="rewrite_path_prefix"
      label="Path Prefix Rewrite"
      placeholder="/recipes"
      defaultValue={initialData?.path_prefix ?? ""}
      helperText="Prepend this prefix to every request before proxying (e.g. /recipes → /recipes/original/path)"
      fullWidth
    />
  );
}
