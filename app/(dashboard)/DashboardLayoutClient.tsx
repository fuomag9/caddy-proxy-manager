"use client";

import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
  useTheme,
  useMediaQuery,
  IconButton
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import BarChartIcon from "@mui/icons-material/BarChart";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import SecurityIcon from "@mui/icons-material/Security";
import SettingsIcon from "@mui/icons-material/Settings";
import HistoryIcon from "@mui/icons-material/History";
import GppBadIcon from "@mui/icons-material/GppBad";
import LogoutIcon from "@mui/icons-material/Logout";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: DashboardIcon },
  { href: "/proxy-hosts", label: "Proxy Hosts", icon: SwapHorizIcon },
  { href: "/access-lists", label: "Access Lists", icon: VpnKeyIcon },
  { href: "/certificates", label: "Certificates", icon: SecurityIcon },
  { href: "/waf", label: "WAF", icon: GppBadIcon },
  { href: "/analytics", label: "Analytics", icon: BarChartIcon },
  { href: "/audit-log", label: "Audit Log", icon: HistoryIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

const DRAWER_WIDTH = 260;
const APP_BAR_HEIGHT = 48;

export default function DashboardLayoutClient({ user, children }: { user: User; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const pathname = usePathname();
  const router = useRouter();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  const drawerContent = (
    <Stack sx={{ height: "100%", p: 2 }}>
      <Box sx={{ px: 2, py: 3, mb: 1 }}>
        <Typography variant="h6" color="primary.main" sx={{ letterSpacing: "-0.02em" }}>
          Caddy Proxy
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Manager
        </Typography>
      </Box>

      <List sx={{ flex: 1, gap: 0.5, display: "flex", flexDirection: "column" }}>
        {NAV_ITEMS.map((item) => {
          const selected = pathname === item.href;
          const Icon = item.icon;
          return (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={selected}
              sx={{
                mb: 0.5,
                borderRadius: 3,
                color: selected ? "primary.contrastText" : "text.secondary",
                "& .MuiListItemIcon-root": {
                  color: selected ? "inherit" : "text.secondary",
                  minWidth: 40,
                },
              }}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  variant: "body2",
                  fontWeight: selected ? 600 : 500,
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Box sx={{ mt: 2 }}>
        <Divider sx={{ mb: 2, borderColor: "rgba(255,255,255,0.05)" }} />
        <ListItemButton
          onClick={() => router.push("/profile")}
          sx={{
            gap: 2,
            px: 1,
            mb: 2,
            py: 1,
            borderRadius: 1,
            color: "text.primary"
          }}
        >
          <Avatar
            src={user.image || undefined}
            alt={user.name || "User"}
            sx={{ width: 40, height: 40, border: "2px solid", borderColor: "background.paper" }}
          >
            {(user.name?.[0] || "U").toUpperCase()}
          </Avatar>
          <Box sx={{ overflow: "hidden" }}>
            <Typography variant="subtitle2" noWrap sx={{ color: "text.primary" }}>
              {user.name || "Administrator"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {user.email}
            </Typography>
          </Box>
        </ListItemButton>
        <form action="/api/auth/logout" method="POST">
          <Button
            type="submit"
            fullWidth
            variant="outlined"
            color="inherit"
            startIcon={<LogoutIcon />}
            sx={{
              justifyContent: "flex-start",
              borderColor: "rgba(255,255,255,0.1)",
              color: "text.secondary",
              "&:hover": {
                borderColor: "rgba(255,255,255,0.2)",
                bgcolor: "rgba(255,255,255,0.02)",
                color: "text.primary"
              }
            }}
          >
            Sign Out
          </Button>
        </form>
      </Box>
    </Stack>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {isMobile && (
        <AppBar
          position="fixed"
          elevation={0}
          sx={{
            bgcolor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
            zIndex: theme.zIndex.drawer + 1,
          }}
        >
          <Toolbar variant="dense" sx={{ gap: 1.5 }}>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ color: "text.secondary" }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="subtitle1" color="primary.main" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
              Caddy Proxy Manager
            </Typography>
          </Toolbar>
        </AppBar>
      )}

      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant={isMobile ? "temporary" : "permanent"}
          open={isMobile ? mobileOpen : true}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              borderRight: "1px solid",
              borderColor: "divider",
              bgcolor: "background.default",
              top: { xs: `${APP_BAR_HEIGHT}px`, md: 0 },
              height: { xs: `calc(100% - ${APP_BAR_HEIGHT}px)`, md: "100%" },
            }
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 5 },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: { xs: `${APP_BAR_HEIGHT}px`, md: 0 },
          overflowX: 'hidden',
        }}
      >
        <Box sx={{ maxWidth: 1200, mx: "auto" }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
