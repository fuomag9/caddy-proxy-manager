import { Input } from "@/components/ui/input";
import type { RewriteConfig } from "@/lib/models/proxy-hosts";

type Props = { initialData?: RewriteConfig | null };

export function RewriteFields({ initialData }: Props) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Path Prefix Rewrite</label>
      <Input
        name="rewrite_path_prefix"
        placeholder="/recipes"
        defaultValue={initialData?.path_prefix ?? ""}
      />
      <p className="text-xs text-muted-foreground mt-1">
        Prepend this prefix to every request before proxying (e.g. /recipes → /recipes/original/path)
      </p>
    </div>
  );
}
