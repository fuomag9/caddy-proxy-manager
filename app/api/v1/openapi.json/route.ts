import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { APP_VERSION } from "@/src/lib/app-version";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Caddy Proxy Manager API",
    version: APP_VERSION,
    description:
      "REST API for managing Caddy reverse proxy configurations, certificates, access lists, and more.",
  },
  servers: [{ url: "/" }],
  security: [{ bearerAuth: [] }, { sessionAuth: [] }],
  tags: [
    { name: "Tokens", description: "API token management" },
    { name: "Proxy Hosts", description: "HTTP/HTTPS reverse proxy hosts" },
    { name: "L4 Proxy Hosts", description: "Layer 4 (TCP/UDP) proxy hosts" },
    { name: "Certificates", description: "TLS certificate management" },
    { name: "CA Certificates", description: "Certificate Authority certificates" },
    { name: "Client Certificates", description: "Client certificate management" },
    { name: "Access Lists", description: "HTTP basic-auth access lists" },
    { name: "Settings", description: "Application settings" },
    { name: "Instances", description: "Multi-instance management" },
    { name: "Users", description: "User management" },
    { name: "Groups", description: "User groups for forward auth access control" },
    { name: "mTLS Roles", description: "Role-based access control for mTLS client certificates" },
    { name: "Forward Auth", description: "Forward auth sessions and per-host access control" },
    { name: "Audit Log", description: "Audit log" },
    { name: "Caddy", description: "Caddy server operations" },
    { name: "Sessions", description: "Your active management-UI sessions" },
    { name: "OAuth Providers", description: "External OIDC/OAuth2 identity providers for SSO" },
  ],
  paths: {
    // ── Tokens ──────────────────────────────────────────────────────
    "/api/v1/tokens": {
      get: {
        tags: ["Tokens"],
        summary: "List tokens",
        operationId: "listTokens",
        responses: {
          "200": {
            description: "List of tokens",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Token" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Tokens"],
        summary: "Create a token",
        description:
          "Requires an interactive cookie-authenticated management session. Bearer tokens cannot create replacement credentials.",
        security: [{ sessionAuth: [] }],
        operationId: "createToken",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TokenInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Token created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { $ref: "#/components/schemas/Token" },
                    raw_token: {
                      type: "string",
                      description:
                        "Plain-text token value. Only returned at creation time.",
                    },
                  },
                  required: ["token", "raw_token"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/tokens/{id}": {
      delete: {
        tags: ["Tokens"],
        summary: "Delete a token",
        operationId: "deleteToken",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Sessions ────────────────────────────────────────────────────
    "/api/v1/sessions": {
      get: {
        tags: ["Sessions"],
        summary: "List your active sessions",
        operationId: "listSessions",
        responses: {
          "200": {
            description: "Active sessions for the authenticated user",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      createdAt: { type: "string" },
                      updatedAt: { type: "string" },
                      expiresAt: { type: "string" },
                      ipAddress: { type: "string", nullable: true },
                      userAgent: { type: "string", nullable: true },
                      current: { type: "boolean", description: "True for the session making this request" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Revoke all of your other sessions",
        operationId: "revokeOtherSessions",
        responses: {
          "200": {
            description: "Count of revoked sessions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { revoked: { type: "integer" } },
                  required: ["revoked"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/sessions/{id}": {
      delete: {
        tags: ["Sessions"],
        summary: "Revoke one of your sessions",
        operationId: "revokeSession",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Proxy Hosts ─────────────────────────────────────────────────
    "/api/v1/proxy-hosts": {
      get: {
        tags: ["Proxy Hosts"],
        summary: "List proxy hosts",
        operationId: "listProxyHosts",
        responses: {
          "200": {
            description: "List of proxy hosts",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ProxyHost" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Proxy Hosts"],
        summary: "Create a proxy host",
        operationId: "createProxyHost",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProxyHostInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Proxy host created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProxyHost" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/proxy-hosts/{id}": {
      get: {
        tags: ["Proxy Hosts"],
        summary: "Get a proxy host",
        operationId: "getProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "Proxy host",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProxyHost" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["Proxy Hosts"],
        summary: "Update a proxy host",
        operationId: "updateProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProxyHostInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "Proxy host updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProxyHost" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Proxy Hosts"],
        summary: "Delete a proxy host",
        operationId: "deleteProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── L4 Proxy Hosts ──────────────────────────────────────────────
    "/api/v1/l4-proxy-hosts": {
      get: {
        tags: ["L4 Proxy Hosts"],
        summary: "List L4 proxy hosts",
        operationId: "listL4ProxyHosts",
        responses: {
          "200": {
            description: "List of L4 proxy hosts",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/L4ProxyHost" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["L4 Proxy Hosts"],
        summary: "Create an L4 proxy host",
        operationId: "createL4ProxyHost",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/L4ProxyHostInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "L4 proxy host created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/L4ProxyHost" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/l4-proxy-hosts/{id}": {
      get: {
        tags: ["L4 Proxy Hosts"],
        summary: "Get an L4 proxy host",
        operationId: "getL4ProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "L4 proxy host",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/L4ProxyHost" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["L4 Proxy Hosts"],
        summary: "Update an L4 proxy host",
        operationId: "updateL4ProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/L4ProxyHostInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "L4 proxy host updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/L4ProxyHost" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["L4 Proxy Hosts"],
        summary: "Delete an L4 proxy host",
        operationId: "deleteL4ProxyHost",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Certificates ────────────────────────────────────────────────
    "/api/v1/certificates": {
      get: {
        tags: ["Certificates"],
        summary: "List certificates",
        operationId: "listCertificates",
        responses: {
          "200": {
            description: "List of certificates",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Certificate" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Certificates"],
        summary: "Create a certificate",
        operationId: "createCertificate",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CertificateInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Certificate created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Certificate" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/certificates/{id}": {
      get: {
        tags: ["Certificates"],
        summary: "Get a certificate",
        operationId: "getCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "Certificate",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Certificate" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["Certificates"],
        summary: "Update a certificate",
        operationId: "updateCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CertificateInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "Certificate updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Certificate" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Certificates"],
        summary: "Delete a certificate",
        operationId: "deleteCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── CA Certificates ─────────────────────────────────────────────
    "/api/v1/ca-certificates": {
      get: {
        tags: ["CA Certificates"],
        summary: "List CA certificates",
        operationId: "listCaCertificates",
        responses: {
          "200": {
            description: "List of CA certificates",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/CaCertificate" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["CA Certificates"],
        summary: "Create a CA certificate",
        operationId: "createCaCertificate",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CaCertificateInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "CA certificate created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CaCertificate" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/ca-certificates/{id}": {
      get: {
        tags: ["CA Certificates"],
        summary: "Get a CA certificate",
        operationId: "getCaCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "CA certificate",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CaCertificate" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["CA Certificates"],
        summary: "Update a CA certificate",
        operationId: "updateCaCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CaCertificateInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "CA certificate updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CaCertificate" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["CA Certificates"],
        summary: "Delete a CA certificate",
        operationId: "deleteCaCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Client Certificates ─────────────────────────────────────────
    "/api/v1/client-certificates": {
      get: {
        tags: ["Client Certificates"],
        summary: "List client certificates",
        operationId: "listClientCertificates",
        responses: {
          "200": {
            description: "List of client certificates",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ClientCertificate" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Client Certificates"],
        summary: "Create a client certificate",
        operationId: "createClientCertificate",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClientCertificateInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Client certificate created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClientCertificate" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/client-certificates/{id}": {
      get: {
        tags: ["Client Certificates"],
        summary: "Get a client certificate",
        operationId: "getClientCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "Client certificate",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClientCertificate" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Client Certificates"],
        summary: "Revoke a client certificate",
        operationId: "revokeClientCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Access Lists ────────────────────────────────────────────────
    "/api/v1/access-lists": {
      get: {
        tags: ["Access Lists"],
        summary: "List access lists",
        operationId: "listAccessLists",
        responses: {
          "200": {
            description: "List of access lists",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AccessList" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Access Lists"],
        summary: "Create an access list",
        operationId: "createAccessList",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AccessListInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Access list created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccessList" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/access-lists/{id}": {
      get: {
        tags: ["Access Lists"],
        summary: "Get an access list",
        operationId: "getAccessList",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "Access list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccessList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["Access Lists"],
        summary: "Update an access list",
        operationId: "updateAccessList",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AccessListInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "Access list updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccessList" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Access Lists"],
        summary: "Delete an access list",
        operationId: "deleteAccessList",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/access-lists/{id}/entries": {
      post: {
        tags: ["Access Lists"],
        summary: "Add an entry to an access list",
        operationId: "addAccessListEntry",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  username: { type: "string" },
                  password: { type: "string" },
                },
                required: ["username", "password"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Entry added",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccessListEntry" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/access-lists/{id}/entries/{entryId}": {
      delete: {
        tags: ["Access Lists"],
        summary: "Remove an entry from an access list",
        operationId: "removeAccessListEntry",
        parameters: [
          { $ref: "#/components/parameters/IdPath" },
          {
            name: "entryId",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Entry ID",
          },
        ],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Settings ────────────────────────────────────────────────────
    "/api/v1/settings/{group}": {
      get: {
        tags: ["Settings"],
        summary: "Get settings for a group",
        operationId: "getSettings",
        parameters: [
          {
            name: "group",
            in: "path",
            required: true,
            schema: {
              type: "string",
              enum: [
                "general",
                "acme",
                "cloudflare",
                "dns-provider",
                "authentik",
                "metrics",
                "logging",
                "dns",
                "upstream-dns",
                "geoblock",
                "waf",
                "error-pages",
                "default-response",
                "instance-mode",
                "sync-token",
              ],
            },
            description: "Settings group name",
          },
        ],
        responses: {
          "200": {
            description: "Settings object (shape varies by group). For instance-mode: `{mode}`. For sync-token: `{has_token}`.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/GeneralSettings" },
                    { $ref: "#/components/schemas/CloudflareStatus" },
                    { $ref: "#/components/schemas/DnsProviderStatus" },
                    { $ref: "#/components/schemas/AuthentikSettings" },
                    { $ref: "#/components/schemas/MetricsSettings" },
                    { $ref: "#/components/schemas/LoggingSettings" },
                    { $ref: "#/components/schemas/DnsSettings" },
                    { $ref: "#/components/schemas/UpstreamDnsSettings" },
                    { $ref: "#/components/schemas/GeoBlockConfig" },
                    { $ref: "#/components/schemas/WafSettings" },
                    { $ref: "#/components/schemas/DefaultResponseSettings" },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      put: {
        tags: ["Settings"],
        summary: "Update settings for a group",
        operationId: "updateSettings",
        parameters: [
          {
            name: "group",
            in: "path",
            required: true,
            schema: {
              type: "string",
              enum: [
                "general",
                "acme",
                "cloudflare",
                "dns-provider",
                "authentik",
                "metrics",
                "logging",
                "dns",
                "upstream-dns",
                "geoblock",
                "waf",
                "error-pages",
                "default-response",
                "instance-mode",
                "sync-token",
              ],
            },
            description: "Settings group name",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/GeneralSettings" },
                  { $ref: "#/components/schemas/CloudflareSettings" },
                  { $ref: "#/components/schemas/AuthentikSettings" },
                  { $ref: "#/components/schemas/MetricsSettings" },
                  { $ref: "#/components/schemas/LoggingSettings" },
                  { $ref: "#/components/schemas/DnsSettings" },
                  { $ref: "#/components/schemas/DnsProviderSettings" },
                  { $ref: "#/components/schemas/UpstreamDnsSettings" },
                  { $ref: "#/components/schemas/GeoBlockConfig" },
                  { $ref: "#/components/schemas/WafSettings" },
                  { $ref: "#/components/schemas/DefaultResponseSettings" },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Settings updated",
            content: {
              "application/json": { schema: { $ref: "#/components/responses/Ok" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    // ── Instances ───────────────────────────────────────────────────
    "/api/v1/instances": {
      get: {
        tags: ["Instances"],
        summary: "List instances",
        operationId: "listInstances",
        responses: {
          "200": {
            description: "List of instances",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Instance" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Instances"],
        summary: "Create an instance",
        operationId: "createInstance",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InstanceInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Instance created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Instance" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/instances/{id}": {
      put: {
        tags: ["Instances"],
        summary: "Update an instance",
        description:
          "Changes the name, base URL, sync token or enabled flag; fields left out are kept. A new token keeps the sync key pin. " +
          "A base URL that reaches another sync endpoint removes the pin of the old one, unless another instance or an INSTANCE_SLAVES entry uses it.",
        operationId: "updateInstance",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InstanceUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Instance updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Instance" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Instances"],
        summary: "Delete an instance",
        description:
          "Also removes the sync key pin of the instance's base URL, unless another instance or an INSTANCE_SLAVES entry uses the same URL. " +
          "To change an instance's name or token, update it instead: that keeps its sync key pin. An instance added again, or moved to a new base URL, is pinned on first use.",
        operationId: "deleteInstance",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/instances/{id}/sync-key-pin": {
      put: {
        tags: ["Instances"],
        summary: "Pin an instance's sync key",
        description:
          "Pins the given sync public key for the instance's base URL, replacing any pin (source \"manual\"), so syncs are sealed to that key only. " +
          "Read the key from the slave itself (its Settings page, or GET /api/v1/instances/sync-key there) over a channel you trust. " +
          "Unlike a reset, this leaves no sync that trusts whatever key answers. Instances and INSTANCE_SLAVES entries with the same URL share the pin.",
        operationId: "pinInstanceSyncKey",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SyncKeyPinInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "The new pin",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SyncKeyPin" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Instances"],
        summary: "Reset an instance's sync key pin",
        description:
          "Removes the sync key pinned for the instance's base URL, so the next sync pins whatever key the slave presents, without a rotation proof. " +
          "Until a key is pinned again, a slave that answers the key request with HTTP 405 (v1.12.0 or earlier) receives the legacy payload, with certificate private keys unsealed. " +
          "Only reset after verifying that the slave was re-keyed on purpose (compare with GET /api/v1/instances/sync-key on the slave); pinning the slave's new key with PUT avoids both risks. " +
          "Instances and INSTANCE_SLAVES entries with the same URL share the pin.",
        operationId: "resetInstanceSyncKeyPin",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Instance not found, or no sync key is pinned for it", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/instances/sync-key-pins": {
      get: {
        tags: ["Instances"],
        summary: "List sync key pins",
        description:
          "The slave sync keys this master has pinned, by normalized slave base URL, with the instances and INSTANCE_SLAVES entries that sync to each URL. " +
          "INSTANCE_SLAVES entries with a syncKeyId are checked against it instead of the stored pin.",
        operationId: "listSyncKeyPins",
        responses: {
          "200": {
            description: "Sync key pins",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SyncKeyPinListing" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
      put: {
        tags: ["Instances"],
        summary: "Pin the sync key of a slave URL",
        description:
          "Like PUT /api/v1/instances/{id}/sync-key-pin, by slave base URL: for INSTANCE_SLAVES entries, and for slaves not added yet.",
        operationId: "pinSyncKey",
        parameters: [{ $ref: "#/components/parameters/SyncKeyPinUrl" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SyncKeyPinInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "The new pin",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SyncKeyPin" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
      delete: {
        tags: ["Instances"],
        summary: "Reset the sync key pin of a slave URL",
        description:
          "Like DELETE /api/v1/instances/{id}/sync-key-pin, by slave base URL: for INSTANCE_SLAVES entries, and pins no slave uses any more.",
        operationId: "resetSyncKeyPin",
        parameters: [{ $ref: "#/components/parameters/SyncKeyPinUrl" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "No sync key is pinned for the URL", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/v1/instances/sync-key": {
      get: {
        tags: ["Instances"],
        summary: "Get this instance's sync key",
        description:
          "The sync public key this instance presents as a slave (derived from its SESSION_SECRET). Compare it with the key a master pinned for this slave, " +
          "or pin it on the master (PUT /api/v1/instances/{id}/sync-key-pin there). Compare the full publicKey where it matters: the keyId is a 64-bit fingerprint.",
        operationId: "getInstanceSyncKey",
        responses: {
          "200": {
            description: "Sync public key",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InstanceSyncKey" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/instances/sync": {
      post: {
        tags: ["Instances"],
        summary: "Trigger instance sync",
        operationId: "syncInstances",
        responses: {
          "200": {
            description: "Sync result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    total: { type: "integer" },
                    success: { type: "integer" },
                    failed: { type: "integer" },
                    skippedHttp: { type: "integer" },
                  },
                  required: ["total", "success", "failed", "skippedHttp"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    // ── Users ───────────────────────────────────────────────────────
    "/api/v1/users": {
      get: {
        tags: ["Users"],
        summary: "List users",
        operationId: "listUsers",
        responses: {
          "200": {
            description: "List of users",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get a user",
        operationId: "getUser",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "User",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["Users"],
        summary: "Update a user",
        operationId: "updateUser",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: ["string", "null"] },
                  email: { type: "string" },
                  role: { type: "string", enum: ["admin", "user"] },
                  status: { type: "string", enum: ["active", "disabled"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "User updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Audit Log ───────────────────────────────────────────────────
    "/api/v1/audit-log": {
      get: {
        tags: ["Audit Log"],
        summary: "List audit log events",
        operationId: "listAuditLog",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
            description: "Page number",
          },
          {
            name: "per_page",
            in: "query",
            schema: { type: "integer", default: 50 },
            description: "Items per page",
          },
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Search term",
          },
        ],
        responses: {
          "200": {
            description: "Paginated audit log",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuditLogResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    // ── Groups ──────────────────────────────────────────────────────
    "/api/v1/groups": {
      get: {
        tags: ["Groups"],
        summary: "List groups",
        operationId: "listGroups",
        responses: {
          "200": { description: "List of groups", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Group" } } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Groups"],
        summary: "Create a group",
        operationId: "createGroup",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } } },
        responses: {
          "201": { description: "Group created", content: { "application/json": { schema: { $ref: "#/components/schemas/Group" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/groups/{id}": {
      get: {
        tags: ["Groups"],
        summary: "Get a group",
        operationId: "getGroup",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { description: "Group details", content: { "application/json": { schema: { $ref: "#/components/schemas/Group" } } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Groups"],
        summary: "Update a group",
        operationId: "updateGroup",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } } } } } },
        responses: {
          "200": { description: "Group updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Group" } } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Groups"],
        summary: "Delete a group",
        operationId: "deleteGroup",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/groups/{id}/members": {
      post: {
        tags: ["Groups"],
        summary: "Add a member to a group",
        operationId: "addGroupMember",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["userId"], properties: { userId: { type: "integer" } } } } } },
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/groups/{id}/members/{userId}": {
      delete: {
        tags: ["Groups"],
        summary: "Remove a member from a group",
        operationId: "removeGroupMember",
        parameters: [
          { $ref: "#/components/parameters/IdPath" },
          { name: "userId", in: "path", required: true, schema: { type: "integer" }, description: "User ID to remove" },
        ],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── mTLS Roles ─────────────────────────────────────────────────
    "/api/v1/mtls-roles": {
      get: {
        tags: ["mTLS Roles"],
        summary: "List mTLS roles",
        operationId: "listMtlsRoles",
        responses: {
          "200": { description: "List of roles", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/MtlsRole" } } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["mTLS Roles"],
        summary: "Create an mTLS role",
        operationId: "createMtlsRole",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } } },
        responses: {
          "201": { description: "Role created", content: { "application/json": { schema: { $ref: "#/components/schemas/MtlsRole" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/mtls-roles/{id}": {
      get: {
        tags: ["mTLS Roles"],
        summary: "Get an mTLS role",
        operationId: "getMtlsRole",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { description: "Role details", content: { "application/json": { schema: { $ref: "#/components/schemas/MtlsRole" } } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["mTLS Roles"],
        summary: "Update an mTLS role",
        operationId: "updateMtlsRole",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } } } } } },
        responses: {
          "200": { description: "Role updated", content: { "application/json": { schema: { $ref: "#/components/schemas/MtlsRole" } } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["mTLS Roles"],
        summary: "Delete an mTLS role",
        operationId: "deleteMtlsRole",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/mtls-roles/{id}/certificates": {
      post: {
        tags: ["mTLS Roles"],
        summary: "Assign a certificate to an mTLS role",
        operationId: "assignMtlsRoleCertificate",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["certificateId"], properties: { certificateId: { type: "integer" } } } } } },
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/mtls-roles/{id}/certificates/{certId}": {
      delete: {
        tags: ["mTLS Roles"],
        summary: "Remove a certificate from an mTLS role",
        operationId: "removeMtlsRoleCertificate",
        parameters: [
          { $ref: "#/components/parameters/IdPath" },
          { name: "certId", in: "path", required: true, schema: { type: "integer" }, description: "Client certificate ID" },
        ],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Forward Auth ───────────────────────────────────────────────
    "/api/v1/proxy-hosts/{id}/forward-auth-access": {
      get: {
        tags: ["Forward Auth"],
        summary: "Get forward auth access list for a proxy host",
        operationId: "getForwardAuthAccess",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { description: "Access list with user IDs and group IDs", content: { "application/json": { schema: { type: "object", properties: { userIds: { type: "array", items: { type: "integer" } }, groupIds: { type: "array", items: { type: "integer" } } } } } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["Forward Auth"],
        summary: "Set forward auth access list for a proxy host",
        operationId: "setForwardAuthAccess",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { userIds: { type: "array", items: { type: "integer" } }, groupIds: { type: "array", items: { type: "integer" } } } } } } },
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/forward-auth-sessions": {
      get: {
        tags: ["Forward Auth"],
        summary: "List forward auth sessions",
        operationId: "listForwardAuthSessions",
        parameters: [{ name: "userId", in: "query", schema: { type: "integer" }, description: "Filter by user ID" }],
        responses: {
          "200": { description: "List of sessions", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      delete: {
        tags: ["Forward Auth"],
        summary: "Delete forward auth sessions",
        operationId: "deleteForwardAuthSessions",
        parameters: [{ name: "userId", in: "query", schema: { type: "integer" }, description: "Delete sessions for a specific user" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/forward-auth-sessions/{id}": {
      delete: {
        tags: ["Forward Auth"],
        summary: "Delete a specific forward auth session",
        operationId: "deleteForwardAuthSession",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Caddy ───────────────────────────────────────────────────────
    "/api/v1/caddy/apply": {
      post: {
        tags: ["Caddy"],
        summary: "Apply Caddy configuration",
        operationId: "applyCaddyConfig",
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },

    // ── OAuth Providers ─────────────────────────────────────────────
    "/api/v1/oauth-providers": {
      get: {
        tags: ["OAuth Providers"],
        summary: "List OAuth providers",
        operationId: "listOauthProviders",
        responses: {
          "200": {
            description: "List of OAuth providers",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/OauthProvider" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["OAuth Providers"],
        summary: "Create an OAuth provider",
        operationId: "createOauthProvider",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OauthProviderInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "OAuth provider created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OauthProvider" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/oauth-providers/{id}": {
      get: {
        tags: ["OAuth Providers"],
        summary: "Get an OAuth provider",
        operationId: "getOauthProvider",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": {
            description: "OAuth provider",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OauthProvider" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        tags: ["OAuth Providers"],
        summary: "Update an OAuth provider",
        description:
          "Environment-sourced providers only allow toggling `enabled`. A blank or omitted clientSecret preserves the stored secret.",
        operationId: "updateOauthProvider",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OauthProviderUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "OAuth provider updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OauthProvider" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["OAuth Providers"],
        summary: "Delete an OAuth provider",
        description: "Environment-sourced providers cannot be deleted.",
        operationId: "deleteOauthProvider",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API token created from the Profile page",
      },
      sessionAuth: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description: "Cookie-based session from browser login",
      },
    },
    parameters: {
      IdPath: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "integer" },
        description: "Resource ID",
      },
      SyncKeyPinUrl: {
        name: "url",
        in: "query",
        required: true,
        schema: { type: "string" },
        example: "https://replica.example.com",
        description:
          "The slave base URL, compared after normalization (lowercase scheme and host, no default port, dot segments or trailing slashes); " +
          "the url GET /api/v1/instances/sync-key-pins lists works as is",
      },
    },
    responses: {
      Ok: {
        description: "Success",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { ok: { type: "boolean", enum: [true] } },
              required: ["ok"],
            },
          },
        },
      },
      BadRequest: {
        description: "Bad request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      Unauthorized: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      Forbidden: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      NotFound: {
        description: "Not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      InternalError: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Token: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          createdBy: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          expiresAt: { type: ["string", "null"], format: "date-time" },
        },
        required: ["id", "name", "createdBy", "createdAt"],
      },
      TokenInput: {
        type: "object",
        description: "Note: this endpoint accepts expires_at (snake_case) for input; the rest of the API uses camelCase.",
        properties: {
          name: { type: "string", example: "CI/CD Pipeline" },
          expires_at: { type: "string", format: "date-time", description: "Optional expiration date (ISO 8601). Field name is snake_case for this endpoint." },
        },
        required: ["name"],
      },

      // ── Shared sub-schemas ──────────────────────────────────────
      AuthentikConfig: {
        type: "object",
        description: "Authentik SSO forward-auth configuration",
        properties: {
          enabled: { type: "boolean" },
          outpostDomain: { type: ["string", "null"], example: "auth.example.com" },
          outpostUpstream: { type: ["string", "null"], example: "http://authentik:9000" },
          authEndpoint: { type: ["string", "null"] },
          copyHeaders: { type: "array", items: { type: "string" }, description: "Headers to copy from Authentik response" },
          trustedProxies: { type: "array", items: { type: "string" }, example: ["private_ranges"] },
          setOutpostHostHeader: { type: "boolean" },
          protectedPaths: { type: ["array", "null"], items: { type: "string" }, description: "Paths to protect (null = all)" },
          excludedPaths: { type: ["array", "null"], items: { type: "string" }, description: "Paths to exclude from auth (bypassed while rest is protected)" },
        },
      },
      LoadBalancerConfig: {
        type: "object",
        description: "Load balancing configuration for multiple upstreams",
        properties: {
          enabled: { type: "boolean" },
          policy: { type: "string", enum: ["random", "round_robin", "least_conn", "ip_hash", "first", "header", "cookie", "uri_hash"] },
          policyHeaderField: { type: ["string", "null"], description: "Header name for 'header' policy" },
          policyCookieName: { type: ["string", "null"], description: "Cookie name for 'cookie' policy" },
          policyCookieSecret: { type: ["string", "null"] },
          tryDuration: { type: ["string", "null"], example: "5s" },
          tryInterval: { type: ["string", "null"], example: "250ms" },
          retries: { type: ["integer", "null"] },
          activeHealthCheck: {
            type: ["object", "null"],
            properties: {
              enabled: { type: "boolean" },
              uri: { type: ["string", "null"], example: "/health" },
              port: { type: ["integer", "null"] },
              interval: { type: ["string", "null"], example: "30s" },
              timeout: { type: ["string", "null"], example: "5s" },
              status: { type: ["integer", "null"], example: 200 },
              body: { type: ["string", "null"] },
            },
          },
          passiveHealthCheck: {
            type: ["object", "null"],
            properties: {
              enabled: { type: "boolean" },
              failDuration: { type: ["string", "null"], example: "30s" },
              maxFails: { type: ["integer", "null"], example: 3 },
              unhealthyStatus: { type: ["array", "null"], items: { type: "integer" } },
              unhealthyLatency: { type: ["string", "null"], example: "5s" },
            },
          },
        },
      },
      L4LoadBalancerConfig: {
        type: "object",
        description: "L4 load balancing configuration",
        properties: {
          enabled: { type: "boolean" },
          policy: { type: "string", enum: ["random", "round_robin", "least_conn", "ip_hash", "first"] },
          tryDuration: { type: ["string", "null"] },
          tryInterval: { type: ["string", "null"] },
          retries: { type: ["integer", "null"] },
          activeHealthCheck: {
            type: ["object", "null"],
            properties: {
              enabled: { type: "boolean" },
              port: { type: ["integer", "null"] },
              interval: { type: ["string", "null"] },
              timeout: { type: ["string", "null"] },
            },
          },
          passiveHealthCheck: {
            type: ["object", "null"],
            properties: {
              enabled: { type: "boolean" },
              failDuration: { type: ["string", "null"] },
              maxFails: { type: ["integer", "null"] },
              unhealthyLatency: { type: ["string", "null"] },
            },
          },
        },
      },
      DnsResolverConfig: {
        type: "object",
        description: "Custom DNS resolver for upstream resolution",
        properties: {
          enabled: { type: "boolean" },
          resolvers: { type: "array", items: { type: "string" }, example: ["1.1.1.1", "8.8.8.8"] },
          fallbacks: { type: ["array", "null"], items: { type: "string" } },
          timeout: { type: ["string", "null"], example: "5s" },
        },
      },
      UpstreamDnsResolutionConfig: {
        type: "object",
        description: "Upstream DNS address family preference",
        properties: {
          enabled: { type: ["boolean", "null"] },
          family: { type: ["string", "null"], enum: ["ipv4", "ipv6", "both", null] },
        },
      },
      GeoBlockConfig: {
        type: "object",
        description: "Geographic/network-based access control",
        properties: {
          enabled: { type: "boolean" },
          block_countries: { type: "array", items: { type: "string" }, example: ["CN", "RU"], description: "ISO 3166-1 alpha-2 codes" },
          block_continents: { type: "array", items: { type: "string" }, example: ["AS"], description: "AF, AN, AS, EU, NA, OC, SA" },
          block_asns: { type: "array", items: { type: "integer" } },
          block_cidrs: { type: "array", items: { type: "string" }, example: ["10.0.0.0/8"] },
          block_ips: { type: "array", items: { type: "string" } },
          allow_countries: { type: "array", items: { type: "string" } },
          allow_continents: { type: "array", items: { type: "string" } },
          allow_asns: { type: "array", items: { type: "integer" } },
          allow_cidrs: { type: "array", items: { type: "string" } },
          allow_ips: { type: "array", items: { type: "string" } },
          trusted_proxies: { type: "array", items: { type: "string" }, description: "Trusted proxy CIDRs for X-Forwarded-For" },
          fail_closed: { type: "boolean", description: "Block when client IP cannot be determined" },
          response_status: { type: "integer", example: 403 },
          response_body: { type: "string", example: "Forbidden" },
          response_headers: { type: "object", additionalProperties: { type: "string" }, example: { "Content-Type": "text/plain", "X-Custom": "blocked" }, description: "Custom response headers (header name → value)" },
          redirect_url: { type: "string", description: "If set, 302 redirect instead of status/body" },
        },
      },
      WafConfig: {
        type: "object",
        description: "Web Application Firewall configuration",
        properties: {
          enabled: { type: "boolean" },
          mode: { type: "string", enum: ["Off", "On"] },
          load_owasp_crs: { type: "boolean", description: "Load OWASP Core Rule Set" },
          custom_directives: { type: "string", description: "Custom WAF directives" },
          excluded_rule_ids: { type: "array", items: { type: "integer" }, description: "Rule IDs to exclude" },
          waf_mode: { type: "string", enum: ["merge", "override"], description: "How per-host WAF merges with global" },
          request_body_limit: { type: "integer", minimum: 1024, maximum: 1073741824, description: "SecRequestBodyLimit in bytes. Coraza rejects values above 1 GiB. Unset inherits Coraza's default (12.5 MiB when the OWASP CRS is loaded, else 128 MiB)" },
          request_body_in_memory_limit: { type: "integer", minimum: 1024, maximum: 1073741824, description: "SecRequestBodyInMemoryLimit in bytes; must not exceed request_body_limit" },
          request_body_limit_action: { type: "string", enum: ["Reject", "ProcessPartial"], description: "SecRequestBodyLimitAction — reject oversized bodies or inspect the buffered part and forward the rest" },
        },
      },
      MtlsConfig: {
        type: "object",
        description: "Mutual TLS (client certificate) configuration",
        properties: {
          enabled: { type: "boolean" },
          ca_certificate_ids: { type: "array", items: { type: "integer" }, description: "CA certificate IDs to trust" },
        },
      },
      CpmForwardAuthConfig: {
        type: "object",
        description: "Built-in CPM forward-auth (replaces Authentik when enabled)",
        properties: {
          enabled: { type: "boolean" },
          protected_paths: { type: ["array", "null"], items: { type: "string" }, description: "Paths to protect (null = all)" },
          excluded_paths: { type: ["array", "null"], items: { type: "string" }, description: "Paths to exclude from auth" },
        },
      },
      RedirectRule: {
        type: "object",
        description: "HTTP redirect rule",
        properties: {
          from: { type: "string", example: "/.well-known/carddav", description: "Path pattern to match" },
          to: { type: "string", example: "/remote.php/dav/", description: "Redirect destination" },
          status: { type: "integer", enum: [301, 302, 307, 308], example: 301 },
        },
        required: ["from", "to", "status"],
      },
      RewriteConfig: {
        type: "object",
        description: "Path rewrite (strip prefix)",
        properties: {
          path_prefix: { type: "string", example: "/app", description: "Prefix to strip from request path" },
        },
        required: ["path_prefix"],
      },
      LocationRule: {
        type: "object",
        description: "Route a path pattern to specific upstream servers (like nginx location blocks)",
        properties: {
          path: { type: "string", example: "/ws/*", description: "Caddy path pattern to match" },
          upstreams: { type: "array", items: { type: "string" }, example: ["ws-backend:8080", "ws-backend2:8080"], description: "Upstream servers for this path" },
          loadBalancer: { oneOf: [{ $ref: "#/components/schemas/LoadBalancerConfig" }, { type: "null" }], description: "Optional per-rule load balancing and health checks for this path's upstreams" },
        },
        required: ["path", "upstreams"],
      },
      PathAllowRule: {
        type: "object",
        description: "Allow a request path to bypass any matching Path Block and reach the upstream. Evaluated before blocks.",
        properties: {
          path: { type: "string", example: "/secret", description: "Caddy path pattern to allow through" },
        },
        required: ["path"],
      },
      PathBlockRule: {
        type: "object",
        description: "Block a request path with a static response (no proxying)",
        properties: {
          path: { type: "string", example: "/dns-query", description: "Caddy path pattern to match" },
          status: { type: "integer", enum: [400, 401, 403, 404, 410, 418, 451, 500, 502, 503], example: 403 },
          body: { type: "string", example: "Forbidden", description: "Optional response body" },
        },
        required: ["path", "status"],
      },
      PathRewriteRule: {
        type: "object",
        description: "Internally rewrite the request URI before proxying (client URL is unchanged)",
        properties: {
          from: { type: "string", example: "/secretpath", description: "Caddy path pattern to match" },
          to: { type: "string", example: "/dns-query", description: "Internal target URI" },
        },
        required: ["from", "to"],
      },

      // ── Main resource schemas ───────────────────────────────────
      ProxyHost: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          domains: { type: "array", items: { type: "string" }, example: ["example.com", "www.example.com"] },
          upstreams: { type: "array", items: { type: "string" }, example: ["localhost:8080"] },
          certificateId: { type: ["integer", "null"] },
          accessListId: { type: ["integer", "null"] },
          sslForced: { type: "boolean" },
          hstsEnabled: { type: "boolean" },
          hstsSubdomains: { type: "boolean" },
          allowWebsocket: { type: "boolean" },
          preserveHostHeader: { type: "boolean" },
          skipHttpsHostnameValidation: { type: "boolean" },
          enabled: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          customReverseProxyJson: { type: ["string", "null"], description: "Raw Caddy JSON for reverse_proxy handler" },
          customPreHandlersJson: { type: ["string", "null"], description: "Raw Caddy JSON for handlers before reverse_proxy" },
          authentik: { oneOf: [{ $ref: "#/components/schemas/AuthentikConfig" }, { type: "null" }] },
          loadBalancer: { oneOf: [{ $ref: "#/components/schemas/LoadBalancerConfig" }, { type: "null" }] },
          dnsResolver: { oneOf: [{ $ref: "#/components/schemas/DnsResolverConfig" }, { type: "null" }] },
          upstreamDnsResolution: { oneOf: [{ $ref: "#/components/schemas/UpstreamDnsResolutionConfig" }, { type: "null" }] },
          geoblock: { oneOf: [{ $ref: "#/components/schemas/GeoBlockConfig" }, { type: "null" }] },
          geoblockMode: { type: "string", enum: ["merge", "override"], description: "How per-host geoblock merges with global" },
          waf: { oneOf: [{ $ref: "#/components/schemas/WafConfig" }, { type: "null" }] },
          mtls: { oneOf: [{ $ref: "#/components/schemas/MtlsConfig" }, { type: "null" }] },
          cpmForwardAuth: { oneOf: [{ $ref: "#/components/schemas/CpmForwardAuthConfig" }, { type: "null" }] },
          forwardAuth: { oneOf: [{ $ref: "#/components/schemas/ForwardAuthConfig" }, { type: "null" }] },
          redirects: { type: "array", items: { $ref: "#/components/schemas/RedirectRule" } },
          rewrite: { oneOf: [{ $ref: "#/components/schemas/RewriteConfig" }, { type: "null" }] },
          locationRules: { type: "array", items: { $ref: "#/components/schemas/LocationRule" }, description: "Path-based routing rules (routes specific paths to different upstreams)" },
          pathAllows: { type: "array", items: { $ref: "#/components/schemas/PathAllowRule" }, description: "Paths that bypass any matching Path Block and reach the upstream (evaluated first)" },
          pathBlocks: { type: "array", items: { $ref: "#/components/schemas/PathBlockRule" }, description: "Paths blocked with a static response" },
          pathRewrites: { type: "array", items: { $ref: "#/components/schemas/PathRewriteRule" }, description: "Internal URI rewrites applied before proxying" },
        },
        required: ["id", "name", "domains", "upstreams", "enabled", "createdAt", "updatedAt"],
      },
      ProxyHostInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "My App" },
          domains: { type: "array", items: { type: "string" }, example: ["app.example.com"] },
          upstreams: { type: "array", items: { type: "string" }, example: ["localhost:3000"] },
          certificateId: { type: ["integer", "null"] },
          accessListId: { type: ["integer", "null"] },
          sslForced: { type: "boolean" },
          hstsEnabled: { type: "boolean" },
          hstsSubdomains: { type: "boolean" },
          allowWebsocket: { type: "boolean" },
          preserveHostHeader: { type: "boolean" },
          skipHttpsHostnameValidation: { type: "boolean" },
          enabled: { type: "boolean" },
          customReverseProxyJson: { type: ["string", "null"] },
          customPreHandlersJson: { type: ["string", "null"] },
          authentik: { oneOf: [{ $ref: "#/components/schemas/AuthentikConfig" }, { type: "null" }] },
          loadBalancer: { oneOf: [{ $ref: "#/components/schemas/LoadBalancerConfig" }, { type: "null" }] },
          dnsResolver: { oneOf: [{ $ref: "#/components/schemas/DnsResolverConfig" }, { type: "null" }] },
          upstreamDnsResolution: { oneOf: [{ $ref: "#/components/schemas/UpstreamDnsResolutionConfig" }, { type: "null" }] },
          geoblock: { oneOf: [{ $ref: "#/components/schemas/GeoBlockConfig" }, { type: "null" }] },
          geoblockMode: { type: "string", enum: ["merge", "override"] },
          waf: { oneOf: [{ $ref: "#/components/schemas/WafConfig" }, { type: "null" }] },
          mtls: { oneOf: [{ $ref: "#/components/schemas/MtlsConfig" }, { type: "null" }] },
          cpmForwardAuth: { oneOf: [{ $ref: "#/components/schemas/CpmForwardAuthConfig" }, { type: "null" }] },
          forwardAuth: { oneOf: [{ $ref: "#/components/schemas/ForwardAuthConfig" }, { type: "null" }] },
          redirects: { type: "array", items: { $ref: "#/components/schemas/RedirectRule" } },
          rewrite: { oneOf: [{ $ref: "#/components/schemas/RewriteConfig" }, { type: "null" }] },
          locationRules: { type: "array", items: { $ref: "#/components/schemas/LocationRule" }, description: "Path-based routing rules (routes specific paths to different upstreams)" },
          pathAllows: { type: "array", items: { $ref: "#/components/schemas/PathAllowRule" }, description: "Paths that bypass any matching Path Block and reach the upstream (evaluated first)" },
          pathBlocks: { type: "array", items: { $ref: "#/components/schemas/PathBlockRule" }, description: "Paths blocked with a static response" },
          pathRewrites: { type: "array", items: { $ref: "#/components/schemas/PathRewriteRule" }, description: "Internal URI rewrites applied before proxying" },
        },
        required: ["name", "domains", "upstreams"],
      },
      L4ProxyHost: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          protocol: { type: "string", enum: ["tcp", "udp"] },
          listenAddress: { type: "string", example: ":5432", description: "Single host:port or :port to listen on. Ports 80, 443 and 2019 are reserved for Caddy's own listeners and are rejected." },
          upstreams: { type: "array", items: { type: "string" }, example: ["db-server:5432"] },
          matcherType: { type: "string", enum: ["none", "tls_sni", "http_host", "proxy_protocol"] },
          matcherValue: { type: "array", items: { type: "string" }, description: "Match values for tls_sni / http_host (empty otherwise)" },
          tlsTermination: { type: "boolean" },
          proxyProtocolVersion: { type: ["string", "null"], enum: ["v1", "v2", null] },
          proxyProtocolReceive: { type: "boolean", description: "Trust inbound PROXY protocol header from upstream LBs" },
          enabled: { type: "boolean" },
          loadBalancer: { oneOf: [{ $ref: "#/components/schemas/L4LoadBalancerConfig" }, { type: "null" }] },
          dnsResolver: { oneOf: [{ $ref: "#/components/schemas/DnsResolverConfig" }, { type: "null" }] },
          upstreamDnsResolution: { oneOf: [{ $ref: "#/components/schemas/UpstreamDnsResolutionConfig" }, { type: "null" }] },
          geoblock: { oneOf: [{ $ref: "#/components/schemas/GeoBlockConfig" }, { type: "null" }] },
          geoblockMode: { type: "string", enum: ["merge", "override"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "listenAddress", "upstreams", "protocol", "enabled", "createdAt", "updatedAt"],
      },
      L4ProxyHostInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "PostgreSQL Proxy" },
          protocol: { type: "string", enum: ["tcp", "udp"] },
          listenAddress: { type: "string", example: ":5432", description: "Single host:port or :port. Ports 80, 443 and 2019 are reserved and rejected." },
          upstreams: { type: "array", items: { type: "string" }, example: ["db:5432"] },
          matcherType: { type: "string", enum: ["none", "tls_sni", "http_host", "proxy_protocol"] },
          matcherValue: { type: "array", items: { type: "string" } },
          tlsTermination: { type: "boolean" },
          proxyProtocolVersion: { type: ["string", "null"], enum: ["v1", "v2", null] },
          proxyProtocolReceive: { type: "boolean" },
          enabled: { type: "boolean" },
          loadBalancer: { oneOf: [{ $ref: "#/components/schemas/L4LoadBalancerConfig" }, { type: "null" }] },
          dnsResolver: { oneOf: [{ $ref: "#/components/schemas/DnsResolverConfig" }, { type: "null" }] },
          upstreamDnsResolution: { oneOf: [{ $ref: "#/components/schemas/UpstreamDnsResolutionConfig" }, { type: "null" }] },
          geoblock: { oneOf: [{ $ref: "#/components/schemas/GeoBlockConfig" }, { type: "null" }] },
          geoblockMode: { type: "string", enum: ["merge", "override"] },
        },
        required: ["name", "listenAddress", "upstreams", "protocol"],
      },
      Certificate: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          type: { type: "string", enum: ["managed", "imported"] },
          domainNames: { type: "array", items: { type: "string" }, example: ["example.com", "*.example.com"] },
          autoRenew: { type: "boolean" },
          providerOptions: {
            type: ["object", "null"],
            description: "Optional reference to a centrally configured DNS provider. Credential values are never returned here.",
            properties: { provider: { type: "string" } },
            required: ["provider"],
            additionalProperties: false,
          },
          certificatePem: { type: ["string", "null"], description: "PEM-encoded certificate (imported type only)" },
          hasPrivateKey: { type: "boolean", description: "Whether write-only private key material is stored" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "type", "domainNames", "hasPrivateKey", "createdAt", "updatedAt"],
      },
      CertificateInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Wildcard Cert" },
          type: { type: "string", enum: ["managed", "imported"] },
          domainNames: { type: "array", items: { type: "string" } },
          autoRenew: { type: "boolean" },
          providerOptions: {
            type: ["object", "null"],
            properties: { provider: { type: "string" } },
            required: ["provider"],
            additionalProperties: false,
          },
          certificatePem: { type: ["string", "null"] },
          privateKeyPem: { type: ["string", "null"], writeOnly: true },
        },
        required: ["name", "type", "domainNames"],
      },
      CaCertificate: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          certificatePem: { type: "string", description: "PEM-encoded CA certificate" },
          hasPrivateKey: { type: "boolean", description: "Whether a private key is stored (for issuing client certs)" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "certificatePem", "hasPrivateKey", "createdAt", "updatedAt"],
      },
      CaCertificateInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Internal CA" },
          certificatePem: { type: "string", description: "PEM-encoded CA certificate" },
          privateKeyPem: { type: "string", description: "PEM-encoded private key (optional, needed for issuing client certs)" },
        },
        required: ["name", "certificatePem"],
      },
      ClientCertificate: {
        type: "object",
        properties: {
          id: { type: "integer" },
          caCertificateId: { type: "integer" },
          commonName: { type: "string", example: "client-device-01" },
          serialNumber: { type: "string" },
          fingerprintSha256: { type: "string" },
          certificatePem: { type: "string" },
          validFrom: { type: "string", format: "date-time" },
          validTo: { type: "string", format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "caCertificateId", "commonName", "serialNumber", "fingerprintSha256", "certificatePem", "validFrom", "validTo", "createdAt", "updatedAt"],
      },
      ClientCertificateInput: {
        type: "object",
        description: "Store a pre-issued client certificate. All PEM/serial/fingerprint/validity fields must be provided.",
        properties: {
          caCertificateId: { type: "integer", description: "ID of the CA certificate this cert was issued from" },
          commonName: { type: "string", example: "client-device-01" },
          serialNumber: { type: "string" },
          fingerprintSha256: { type: "string" },
          certificatePem: { type: "string" },
          validFrom: { type: "string", format: "date-time" },
          validTo: { type: "string", format: "date-time" },
        },
        required: ["caCertificateId", "commonName", "serialNumber", "fingerprintSha256", "certificatePem", "validFrom", "validTo"],
      },
      AccessList: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          entries: { type: "array", items: { $ref: "#/components/schemas/AccessListEntry" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "entries", "createdAt", "updatedAt"],
      },
      AccessListInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Internal Users" },
          description: { type: ["string", "null"] },
          users: {
            type: "array",
            description: "Seed members (only used during creation)",
            items: {
              type: "object",
              properties: {
                username: { type: "string" },
                password: { type: "string" },
              },
              required: ["username", "password"],
            },
          },
        },
        required: ["name"],
      },
      AccessListEntry: {
        type: "object",
        properties: {
          id: { type: "integer" },
          username: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "username", "createdAt", "updatedAt"],
      },
      AccessListEntryInput: {
        type: "object",
        properties: {
          username: { type: "string", example: "admin" },
          password: { type: "string", example: "secret123" },
        },
        required: ["username", "password"],
      },

      // ── Settings schemas ────────────────────────────────────────
      GeneralSettings: {
        type: "object",
        properties: {
          primaryDomain: { type: "string", example: "example.com" },
          acmeEmail: { type: "string", format: "email", example: "admin@example.com" },
        },
        required: ["primaryDomain"],
      },
      CloudflareSettings: {
        type: "object",
        description: "Write-only legacy Cloudflare settings. The API token is accepted on update but never returned by GET.",
        properties: {
          apiToken: { type: "string", description: "Cloudflare API token", writeOnly: true },
          zoneId: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["apiToken"],
      },
      CloudflareStatus: {
        type: "object",
        description: "Non-secret metadata for the legacy Cloudflare settings group.",
        properties: {
          hasApiToken: { type: "boolean" },
          zoneId: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["hasApiToken"],
      },
      DnsProviderSettings: {
        type: "object",
        description: "Write-only DNS provider configuration for ACME DNS-01 challenges. Credential values are accepted on update but never returned by GET.",
        properties: {
          providers: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: { type: "string", writeOnly: true },
              description: "Credential key-value pairs for this provider",
            },
            description: "Configured providers keyed by name (e.g. { cloudflare: { api_token: '...' }, route53: { ... } })",
          },
          default: {
            type: "string",
            nullable: true,
            description: "Name of the default provider used for DNS-01 challenges (null = HTTP-01 only)",
          },
        },
        required: ["providers", "default"],
      },
      DnsProviderStatus: {
        type: "object",
        description: "Non-secret metadata for configured DNS providers. Credential values are write-only.",
        properties: {
          providers: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                configuredFields: {
                  type: "array",
                  items: { type: "string" },
                  description: "Credential field names which have a stored, non-empty value",
                },
              },
              required: ["configuredFields"],
            },
            description: "Configured providers keyed by provider name; values contain metadata only",
          },
          default: {
            type: ["string", "null"],
            description: "Name of the default provider used for DNS-01 challenges",
          },
        },
        required: ["providers", "default"],
      },
      AuthentikSettings: {
        type: "object",
        properties: {
          outpostDomain: { type: "string", example: "auth.example.com" },
          outpostUpstream: { type: "string", example: "http://authentik:9000" },
          authEndpoint: { type: "string" },
        },
        required: ["outpostDomain", "outpostUpstream"],
      },
      MetricsSettings: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          port: { type: "integer", example: 9090, description: "Prometheus metrics port" },
        },
        required: ["enabled"],
      },
      LoggingSettings: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          format: { type: "string", enum: ["json", "console"] },
        },
        required: ["enabled"],
      },
      DefaultResponseSettings: {
        type: "object",
        description: "Catch-all behavior for requests that do not match a configured proxy host.",
        properties: {
          mode: {
            type: "string",
            enum: ["caddy", "respond", "redirect", "abort"],
            description: "caddy preserves native routing/automatic-HTTPS behavior; abort closes the connection without a response.",
          },
          status: {
            type: "integer",
            minimum: 200,
            maximum: 599,
            description: "HTTP response status, or one of 301/302/303/307/308 for redirect mode.",
          },
          body: { type: "string", description: "Body used by respond mode." },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Optional response headers. Values must not contain newlines.",
          },
          redirectUrl: { type: "string", description: "Target used by redirect mode." },
        },
        required: ["mode"],
      },
      DnsSettings: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          resolvers: { type: "array", items: { type: "string" }, example: ["1.1.1.1", "8.8.8.8"] },
          fallbacks: { type: "array", items: { type: "string" } },
          timeout: { type: "string", example: "5s" },
        },
        required: ["enabled", "resolvers"],
      },
      UpstreamDnsSettings: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          family: { type: "string", enum: ["ipv4", "ipv6", "both"] },
        },
        required: ["enabled", "family"],
      },
      WafSettings: {
        type: "object",
        description: "Global WAF settings",
        properties: {
          enabled: { type: "boolean" },
          mode: { type: "string", enum: ["Off", "On"] },
          load_owasp_crs: { type: "boolean" },
          custom_directives: { type: "string" },
          excluded_rule_ids: { type: "array", items: { type: "integer" } },
          request_body_limit: { type: "integer", minimum: 1024, maximum: 1073741824, description: "SecRequestBodyLimit in bytes. Coraza rejects values above 1 GiB. Unset inherits Coraza's default (12.5 MiB when the OWASP CRS is loaded, else 128 MiB)" },
          request_body_in_memory_limit: { type: "integer", minimum: 1024, maximum: 1073741824, description: "SecRequestBodyInMemoryLimit in bytes; must not exceed request_body_limit" },
          request_body_limit_action: { type: "string", enum: ["Reject", "ProcessPartial"], description: "SecRequestBodyLimitAction — reject oversized bodies or inspect the buffered part and forward the rest" },
        },
        required: ["enabled", "mode", "load_owasp_crs", "custom_directives"],
      },

      // ── Groups & Roles ─────────────────────────────────────────
      Group: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          members: { type: "array", items: { $ref: "#/components/schemas/GroupMember" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "members", "createdAt", "updatedAt"],
      },
      GroupMember: {
        type: "object",
        properties: {
          userId: { type: "integer" },
          email: { type: "string" },
          name: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["userId", "email", "createdAt"],
      },
      MtlsRole: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "createdAt", "updatedAt"],
      },

      // ── Other resources ─────────────────────────────────────────
      Instance: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          baseUrl: { type: "string", example: "https://slave.example.com:3000" },
          enabled: { type: "boolean" },
          hasToken: { type: "boolean" },
          lastSyncAt: { type: ["string", "null"], format: "date-time" },
          lastSyncError: { type: ["string", "null"] },
          syncKeyPin: {
            oneOf: [{ $ref: "#/components/schemas/SyncKeyPin" }, { type: "null" }],
            description: "The sync key pinned for the instance's base URL; null until a sync pins one",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "baseUrl", "enabled", "hasToken", "syncKeyPin", "createdAt", "updatedAt"],
      },
      SyncKeyPin: {
        type: "object",
        description: "A slave sync key pinned by this master (trust on first use, or set by an admin)",
        properties: {
          keyId: {
            type: "string",
            pattern: "^([0-9a-f]{16})?$",
            example: "3f9a1c0b7d2e4a65",
            description: "The first 16 hex characters of the SHA-256 of the public key; empty for an unreadable pin",
          },
          publicKey: {
            type: "string",
            description: "Raw 32-byte X25519 public key, base64; empty for an unreadable pin",
          },
          pinnedAt: { type: "string", description: "When the key was pinned (ISO 8601); empty or as stored for an unreadable pin" },
          source: {
            type: "string",
            examples: ["first-use", "rotation", "manual", "unreadable"],
            description:
              "first-use: the first key the slave presented; rotation: a new key the slave proved with the previously pinned one; " +
              "manual: set by an admin; unreadable: a stored pin this release cannot read (for example one written by a newer release), " +
              "which matches no key, so syncs to the slave fail until the pin is replaced or reset. Other values, from other releases, are kept as stored.",
          },
        },
        required: ["keyId", "publicKey", "pinnedAt", "source"],
      },
      SyncKeyPinInput: {
        type: "object",
        properties: {
          publicKey: {
            type: "string",
            pattern: "^[A-Za-z0-9+/]{43}=$",
            description: "The slave's sync public key (raw 32-byte X25519, base64), as the slave's Settings page and GET /api/v1/instances/sync-key show it",
          },
        },
        required: ["publicKey"],
      },
      SyncKeyPinListing: {
        allOf: [
          { $ref: "#/components/schemas/SyncKeyPin" },
          {
            type: "object",
            properties: {
              url: { type: "string", example: "https://replica.example.com", description: "Normalized slave base URL the pin is kept under" },
              slaves: {
                type: "array",
                description: "Instances and INSTANCE_SLAVES entries that sync to the URL",
                items: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["instance"] },
                        id: { type: "integer" },
                        name: { type: "string" },
                      },
                      required: ["type", "id", "name"],
                    },
                    {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["env"] },
                        name: { type: "string" },
                        syncKeyId: {
                          type: ["string", "null"],
                          description: "The entry's syncKeyId (derived from syncPublicKey when only that is set); when set, sync checks it instead of the stored pin",
                        },
                        syncPublicKey: {
                          type: ["string", "null"],
                          description: "The entry's syncPublicKey; when set, sync compares the full key instead of the stored pin",
                        },
                      },
                      required: ["type", "name", "syncKeyId", "syncPublicKey"],
                    },
                  ],
                },
              },
            },
            required: ["url", "slaves"],
          },
        ],
      },
      InstanceSyncKey: {
        type: "object",
        properties: {
          keyId: { type: "string", pattern: "^[0-9a-f]{16}$", example: "3f9a1c0b7d2e4a65" },
          publicKey: { type: "string", description: "Raw 32-byte X25519 public key, base64" },
        },
        required: ["keyId", "publicKey"],
      },
      InstanceUpdate: {
        type: "object",
        description: "Fields to change; the others are kept",
        properties: {
          name: { type: "string", minLength: 1, example: "Slave 1" },
          baseUrl: { type: "string", example: "https://slave.example.com:3000" },
          apiToken: {
            type: "string",
            minLength: 32,
            maxLength: 512,
            description: "New sync token for the slave instance",
          },
          enabled: { type: "boolean" },
        },
      },
      InstanceInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Slave 1" },
          baseUrl: { type: "string", example: "https://slave.example.com:3000" },
          apiToken: {
            type: "string",
            minLength: 32,
            maxLength: 512,
            description: "Random sync token for the slave instance (generate with: openssl rand -hex 32)",
          },
          enabled: { type: "boolean" },
        },
        required: ["name", "baseUrl", "apiToken"],
      },
      SyncResult: {
        type: "object",
        properties: {
          total: { type: "integer" },
          success: { type: "integer" },
          failed: { type: "integer" },
          skippedHttp: { type: "integer" },
        },
        required: ["total", "success", "failed", "skippedHttp"],
      },
      OauthProvider: {
        type: "object",
        description:
          "OAuth/OIDC provider. clientId is masked; the clientSecret is never exposed. callbackUrl is the exact redirect URI to register at the identity provider.",
        properties: {
          id: { type: "string", example: "authino" },
          name: { type: "string", example: "Authino" },
          type: { type: "string", enum: ["oidc", "oauth2"] },
          clientId: { type: "string", readOnly: true, example: "••••41ee" },
          hasClientSecret: { type: "boolean", readOnly: true },
          issuer: { type: ["string", "null"] },
          authorizationUrl: { type: ["string", "null"] },
          tokenUrl: { type: ["string", "null"] },
          userinfoUrl: { type: ["string", "null"] },
          scopes: { type: "string", example: "openid email profile" },
          autoLink: { type: "boolean" },
          enabled: { type: "boolean" },
          source: { type: "string", enum: ["env", "ui"], readOnly: true },
          callbackUrl: {
            type: "string",
            readOnly: true,
            example: "https://cpm.example.com/api/auth/callback/authino",
            description: "Register this URI as the redirect URI in the identity provider",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: [
          "id",
          "name",
          "type",
          "clientId",
          "hasClientSecret",
          "scopes",
          "autoLink",
          "enabled",
          "source",
          "callbackUrl",
          "createdAt",
          "updatedAt",
        ],
      },
      OauthProviderInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Keycloak" },
          type: { type: "string", enum: ["oidc", "oauth2"], default: "oidc" },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          issuer: { type: "string", example: "https://sso.example.com/realms/main" },
          authorizationUrl: { type: "string" },
          tokenUrl: { type: "string" },
          userinfoUrl: { type: "string" },
          scopes: { type: "string", default: "openid email profile" },
          autoLink: { type: "boolean", default: false },
          enabled: { type: "boolean", default: true },
        },
        required: ["name", "clientId", "clientSecret"],
      },
      OauthProviderUpdate: {
        type: "object",
        description: "All fields optional. Omitting clientSecret preserves the stored secret.",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["oidc", "oauth2"] },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          issuer: { type: ["string", "null"] },
          authorizationUrl: { type: ["string", "null"] },
          tokenUrl: { type: ["string", "null"] },
          userinfoUrl: { type: ["string", "null"] },
          scopes: { type: "string" },
          autoLink: { type: "boolean" },
          enabled: { type: "boolean" },
        },
      },
      User: {
        type: "object",
        description: "User account (passwordHash is never exposed)",
        properties: {
          id: { type: "integer" },
          email: { type: "string" },
          username: { type: ["string", "null"], description: "Stored login-page username. It can be set on an account that has no password yet; the Profile page shows whether password sign-in works" },
          name: { type: ["string", "null"] },
          role: { type: "string", enum: ["admin", "user", "viewer"] },
          provider: { type: "string", example: "credentials" },
          subject: { type: "string" },
          avatarUrl: { type: ["string", "null"] },
          status: { type: "string", enum: ["active", "inactive"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "email", "role", "provider", "subject", "status", "createdAt", "updatedAt"],
      },
      AuditLogEvent: {
        type: "object",
        properties: {
          id: { type: "integer" },
          userId: { type: ["integer", "null"] },
          action: { type: "string", example: "proxy_host_created" },
          entityType: { type: "string", example: "proxy_host" },
          entityId: { type: ["integer", "null"] },
          summary: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "action", "entityType", "createdAt"],
      },
      AuditLogResponse: {
        type: "object",
        properties: {
          events: { type: "array", items: { $ref: "#/components/schemas/AuditLogEvent" } },
          total: { type: "integer" },
          page: { type: "integer" },
          perPage: { type: "integer" },
        },
        required: ["events", "total", "page", "perPage"],
      },
    },
  },
};

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "private, max-age=3600",
    },
  });
}
