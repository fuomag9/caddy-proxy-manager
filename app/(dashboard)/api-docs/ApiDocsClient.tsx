"use client";

import { useEffect, useRef } from "react";

export default function ApiDocsClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Load Swagger UI CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
    document.head.appendChild(link);

    // Inject overrides for dark-mode compatibility
    const style = document.createElement("style");
    style.textContent = `
      .dark .swagger-ui {
        filter: invert(88%) hue-rotate(180deg);
      }
      .dark .swagger-ui .highlight-code,
      .dark .swagger-ui pre {
        filter: invert(100%) hue-rotate(180deg);
      }
      .swagger-ui .topbar { display: none; }
      .swagger-ui .information-container { padding: 1rem 0; }
    `;
    document.head.appendChild(style);

    // Load Swagger UI bundle script
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SwaggerUIBundle = (window as any).SwaggerUIBundle;
      if (SwaggerUIBundle && containerRef.current) {
        SwaggerUIBundle({
          url: "/api/v1/openapi.json",
          domNode: containerRef.current,
          presets: [SwaggerUIBundle.presets.apis],
          deepLinking: true,
          defaultModelsExpandDepth: 1,
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount
      link.remove();
      style.remove();
      script.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full min-h-[600px] -mx-4 md:-mx-8 -my-6 px-4 md:px-8 py-6"
    />
  );
}
