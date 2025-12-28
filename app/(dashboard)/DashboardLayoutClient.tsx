"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, Box, Button, Divider, Stack, Typography } from "@mui/material";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/proxy-hosts", label: "Proxy Hosts" },
  { href: "/redirects", label: "Redirects" },
  { href: "/dead-hosts", label: "Dead Hosts" },
  { href: "/access-lists", label: "Access Lists" },
  { href: "/certificates", label: "Certificates" },
  { href: "/settings", label: "Settings" },
  { href: "/audit-log", label: "Audit Log" }
] as const;

// Stable background styles defined outside component to prevent regeneration
const MAIN_BACKGROUND =
  "radial-gradient(circle at 12% -20%, rgba(99, 102, 241, 0.28), transparent 45%), radial-gradient(circle at 88% 8%, rgba(45, 212, 191, 0.24), transparent 46%), linear-gradient(160deg, rgba(2, 3, 9, 1) 0%, rgba(4, 10, 22, 1) 40%, rgba(2, 6, 18, 1) 100%)";

const OVERLAY_BACKGROUND =
  "radial-gradient(circle at 18% -12%, rgba(56, 189, 248, 0.18), transparent 42%), radial-gradient(circle at 86% 0%, rgba(168, 85, 247, 0.15), transparent 45%)";

export default function DashboardLayoutClient({ user, children }: { user: User; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        position: "relative",
        background: MAIN_BACKGROUND
      }}
    >
      <Box
        component="aside"
        sx={{
          width: 240,
          minWidth: 240,
          maxWidth: 240,
          height: "100vh",
          position: "fixed",
          top: 0,
          left: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 3,
          px: 2,
          py: 3,
          background: "rgba(20, 20, 22, 0.95)",
          borderRight: "0.5px solid rgba(255, 255, 255, 0.08)",
          zIndex: 1000,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          overflowY: "auto",
          overflowX: "hidden"
        }}
      >
        <Stack spacing={2} sx={{ flex: 1 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, px: 1.5, pt: 1 }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 600,
                fontSize: "1.125rem",
                letterSpacing: "-0.02em",
                color: "rgba(255, 255, 255, 0.95)"
              }}
            >
              Caddy Proxy
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontSize: "0.75rem",
                color: "rgba(255, 255, 255, 0.4)",
                letterSpacing: "0.01em"
              }}
            >
              Manager
            </Typography>
          </Box>

          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.06)" }} />

          <Box
            component="nav"
            sx={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              py: 0.5,
              gap: 0.25
            }}
          >
            {NAV_ITEMS.map((item) => {
              const selected = pathname === item.href;
              return (
                <Box
                  key={item.href}
                  component={Link}
                  href={item.href}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    textDecoration: "none",
                    borderRadius: 1.25,
                    px: 2,
                    py: 1,
                    height: 36,
                    minHeight: 36,
                    maxHeight: 36,
                    backgroundColor: selected ? "rgba(255, 255, 255, 0.1)" : "transparent",
                    transition: "background-color 0.15s ease",
                    cursor: "pointer",
                    "&:hover": {
                      backgroundColor: selected ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.05)"
                    }
                  }}
                >
                  <Typography
                    sx={{
                      fontWeight: 400,
                      fontSize: "0.875rem",
                      letterSpacing: "-0.005em",
                      color: selected ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.65)",
                      lineHeight: "20px"
                    }}
                  >
                    {item.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Stack>

        <Stack spacing={2}>
          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.06)" }} />
          <Box
            component={Link}
            href="/profile"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 1.25,
              textDecoration: "none",
              transition: "background-color 0.15s ease",
              cursor: "pointer",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.05)"
              }
            }}
          >
            <Avatar
              src={user.image || undefined}
              alt={user.name || user.email || "User"}
              sx={{
                bgcolor: "rgba(100, 100, 255, 0.2)",
                border: "0.5px solid rgba(255, 255, 255, 0.15)",
                color: "rgba(255, 255, 255, 0.95)",
                fontSize: 13,
                fontWeight: 500,
                width: 32,
                height: 32
              }}
            >
              {(user.name ?? user.email ?? "A").slice(0, 2).toUpperCase()}
            </Avatar>
            <Box sx={{ overflow: "hidden" }}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 500,
                  fontSize: "0.8125rem",
                  color: "rgba(255, 255, 255, 0.85)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {user.name ?? user.email ?? "Admin"}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.6875rem",
                  color: "rgba(255, 255, 255, 0.4)"
                }}
              >
                Administrator
              </Typography>
            </Box>
          </Box>

          <form action="/api/auth/logout" method="POST">
            <Button
              type="submit"
              variant="text"
              fullWidth
              sx={{
                color: "rgba(255, 255, 255, 0.6)",
                py: 1,
                fontSize: "0.8125rem",
                fontWeight: 400,
                textTransform: "none",
                borderRadius: 1.25,
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  color: "rgba(255, 255, 255, 0.8)"
                }
              }}
            >
              Sign Out
            </Button>
          </form>
        </Stack>
      </Box>

      <Stack
        component="main"
        sx={{
          flex: 1,
          position: "relative",
          marginLeft: "240px",
          px: { xs: 3, md: 6, xl: 8 },
          py: { xs: 5, md: 6 },
          gap: 4,
          bgcolor: "transparent",
          overflowX: "hidden",
          minHeight: "100vh"
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: OVERLAY_BACKGROUND
          }}
        />
        <Stack sx={{ position: "relative", gap: 4, width: "100%", maxWidth: 1160, mx: "auto" }}>{children}</Stack>
      </Stack>
    </Box>
  );
}
