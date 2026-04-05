"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, ArrowLeftRight, Cable, KeyRound, ShieldCheck,
  ShieldOff, BarChart2, History, Settings, LogOut, Menu, Sun, Moon,
  FileJson2, Users,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

const NAV_ITEMS = [
  { href: "/",               label: "Overview",       icon: LayoutDashboard },
  { href: "/proxy-hosts",    label: "Proxy Hosts",    icon: ArrowLeftRight  },
  { href: "/l4-proxy-hosts", label: "L4 Proxy Hosts", icon: Cable           },
  { href: "/access-lists",   label: "Access Lists",   icon: KeyRound        },
  { href: "/groups",          label: "Groups",          icon: Users           },
  { href: "/certificates",   label: "Certificates",   icon: ShieldCheck     },
  { href: "/waf",            label: "WAF",            icon: ShieldOff       },
  { href: "/analytics",      label: "Analytics",      icon: BarChart2       },
  { href: "/audit-log",      label: "Audit Log",      icon: History         },
  { href: "/api-docs",       label: "API Docs",       icon: FileJson2       },
  { href: "/settings",       label: "Settings",       icon: Settings        },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}

function NavContent({ pathname, user, onNavigate }: {
  pathname: string;
  user: User;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-xs">C</span>
        </div>
        <p className="font-semibold text-sm tracking-tight">Caddy Proxy Manager</p>
      </div>
      <Separator />

      {/* Nav items */}
      <ScrollArea className="flex-1 px-2 py-2">
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Button
                key={href}
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 h-9 px-3",
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60 font-normal"
                )}
                asChild
                onClick={onNavigate}
              >
                <Link href={href}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </Button>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 space-y-1">
        <Separator className="mb-2" />
        <div className="flex items-center justify-between px-1">
          <Button
            variant="ghost"
            className="flex-1 justify-start gap-3 px-2 h-auto py-2 min-w-0"
            onClick={() => { router.push("/profile"); onNavigate?.(); }}
          >
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? "User"} />
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {(user.name?.[0] ?? "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start overflow-hidden min-w-0">
              <span className="text-sm font-medium truncate w-full">{user.name ?? "Administrator"}</span>
              <span className="text-xs text-muted-foreground truncate w-full">{user.email}</span>
            </div>
          </Button>
          <div className="flex items-center shrink-0">
            <ThemeToggle />
            <form action="/api/auth/logout" method="POST">
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayoutClient({ user, children }: { user: User; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — fixed, hidden on mobile */}
      <aside className="hidden md:flex flex-col fixed inset-y-0 left-0 w-64 border-r border-border bg-card z-30">
        <NavContent pathname={pathname} user={user} />
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 h-12 flex items-center justify-between px-4 border-b border-border bg-card z-40">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
        <span className="font-semibold text-sm">Caddy Proxy Manager</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label="Go to profile" onClick={() => router.push("/profile")}>
            <Avatar className="h-6 w-6">
              <AvatarImage src={user.image ?? undefined} />
              <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                {(user.name?.[0] ?? "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </div>
      </header>

      {/* Mobile Sheet drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 sm:max-w-[256px] p-0">
          <NavContent pathname={pathname} user={user} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex-1 md:ml-64 mt-12 md:mt-0 overflow-x-hidden">
        <div className="max-w-screen-xl mx-auto px-4 md:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
