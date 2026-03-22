import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InputHTMLAttributes } from "react";

type SearchFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <div className={cn("relative max-w-xs", className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder="Search..."
        className="pl-8"
        {...props}
      />
    </div>
  );
}
