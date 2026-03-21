"use client";

import { ReactNode, useState } from "react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { CssBaseline, ThemeProvider, createTheme, responsiveFontSizes } from "@mui/material";

const theme = responsiveFontSizes(
  createTheme({
          palette: {
            mode: "dark",
            background: {
              default: "#09090b", // Zinc-950
              paper: "#18181b"    // Zinc-900
            },
            primary: {
              main: "#6366f1", // Indigo-500
              light: "#818cf8",
              dark: "#4f46e5",
              contrastText: "#ffffff"
            },
            secondary: {
              main: "#06b6d4", // Cyan-500
              light: "#22d3ee",
              dark: "#0891b2",
              contrastText: "#ffffff"
            },
            error: {
              main: "#ef4444", // Red-500
              light: "#f87171",
              dark: "#dc2626"
            },
            success: {
              main: "#22c55e", // Green-500
              light: "#4ade80",
              dark: "#16a34a"
            },
            warning: {
              main: "#f59e0b", // Amber-500
              light: "#fbbf24",
              dark: "#d97706"
            },
            info: {
              main: "#3b82f6", // Blue-500
              light: "#60a5fa",
              dark: "#2563eb"
            },
            text: {
              primary: "#f4f4f5", // Zinc-100
              secondary: "#a1a1aa" // Zinc-400
            }
          },
          typography: {
            fontFamily: ['"Inter"', '"Segoe UI"', "Roboto", "sans-serif"].join(","),
            h4: {
              fontWeight: 700,
              letterSpacing: "-0.02em"
            },
            h6: {
              fontWeight: 600
            },
            button: {
              fontWeight: 600,
              textTransform: "none"
            }
          },
          shape: {
            borderRadius: 12
          },
          components: {
            MuiCssBaseline: {
              styleOverrides: {
                body: {
                  backgroundColor: "#09090b",
                  backgroundImage:
                    "radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.15), transparent 40%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.1), transparent 30%)",
                  backgroundAttachment: "fixed"
                }
              }
            },
            MuiButton: {
              defaultProps: {
                disableElevation: true
              },
              styleOverrides: {
                root: {
                  borderRadius: 8,
                  padding: "8px 16px",
                  transition: "all 0.2s ease-in-out"
                },
                contained: {
                  "&:hover": {
                    transform: "translateY(-1px)",
                    boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)"
                  }
                }
              }
            },
            MuiCard: {
              styleOverrides: {
                root: {
                  backgroundImage: "none",
                  backgroundColor: "rgba(24, 24, 27, 0.6)", // Zinc-900 / 60%
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  backdropFilter: "blur(12px)",
                  transition: "all 0.3s ease",
                  "&:hover": {
                    borderColor: "rgba(255, 255, 255, 0.15)",
                    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)"
                  }
                }
              }
            },
            MuiPaper: {
              styleOverrides: {
                root: {
                  backgroundImage: "none"
                }
              }
            },
            MuiTableCell: {
              styleOverrides: {
                root: {
                  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                  padding: "16px 24px"
                },
                head: {
                  fontWeight: 600,
                  backgroundColor: "rgba(24, 24, 27, 0.4)",
                  color: "#a1a1aa",
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em"
                }
              }
            },
            MuiTableRow: {
              styleOverrides: {
                root: {
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.02)"
                  }
                }
              }
            },
            MuiDialog: {
              styleOverrides: {
                paper: {
                  backgroundColor: "#18181b",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  backgroundImage: "none",
                  boxShadow: "0 24px 48px rgba(0, 0, 0, 0.5)"
                }
              }
            },
            MuiTextField: {
              styleOverrides: {
                root: {
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 10,
                    backgroundColor: "rgba(9, 9, 11, 0.5)",
                    "& fieldset": {
                      borderColor: "rgba(255, 255, 255, 0.08)"
                    },
                    "&:hover fieldset": {
                      borderColor: "rgba(255, 255, 255, 0.2)"
                    },
                    "&.Mui-focused fieldset": {
                      borderColor: "#6366f1"
                    }
                  }
                }
              }
            }
          }
        })
      );

function EmotionRegistry({ children }: { children: ReactNode }) {
  const [{ cache, flush }] = useState(() => {
    const cache = createCache({ key: "mui", prepend: true });
    cache.compat = true;
    const prevInsert = cache.insert;
    let inserted: string[] = [];
    cache.insert = (...args) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name);
      }
      return prevInsert(...args);
    };
    const flush = () => {
      const prevInserted = inserted;
      inserted = [];
      return prevInserted;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) {
      styles += cache.inserted[name];
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <EmotionRegistry>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </EmotionRegistry>
  );
}
