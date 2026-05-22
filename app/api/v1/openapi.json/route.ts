import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";

export const spec = {
  openapi: "3.1.0",
  info: {
    title: "Caddy Proxy Manager API",
    version: "1.0.0",
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
                "cloudflare",
                "dns-provider",
                "authentik",
                "metrics",
                "logging",
                "dns",
                "upstream-dns",
                "geoblock",
                "waf",
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
                    { $ref: "#/components/schemas/CloudflareSettings" },
                    { $ref: "#/components/schemas/DnsProviderSettings" },
                    { $ref: "#/components/schemas/AuthentikSettings" },
                    { $ref: "#/components/schemas/MetricsSettings" },
                    { $ref: "#/components/schemas/LoggingSettings" },
                    { $ref: "#/components/schemas/DnsSettings" },
                    { $ref: "#/components/schemas/UpstreamDnsSettings" },
                    { $ref: "#/components/schemas/GeoBlockConfig" },
                    { $ref: "#/components/schemas/WafSettings" },
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
                "cloudflare",
                "dns-provider",
                "authentik",
                "metrics",
                "logging",
                "dns",
                "upstream-dns",
                "geoblock",
                "waf",
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
                  { $ref: "#/components/schemas/UpstreamDnsSettings" },
                  { $ref: "#/components/schemas/GeoBlockConfig" },
                  { $ref: "#/components/schemas/WafSettings" },
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
      delete: {
        tags: ["Instances"],
        summary: "Delete an instance",
        operationId: "deleteInstance",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          "200": { $ref: "#/components/responses/Ok" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
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
        },
        required: ["path", "upstreams"],
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
          redirects: { type: "array", items: { $ref: "#/components/schemas/RedirectRule" } },
          rewrite: { oneOf: [{ $ref: "#/components/schemas/RewriteConfig" }, { type: "null" }] },
          locationRules: { type: "array", items: { $ref: "#/components/schemas/LocationRule" }, description: "Path-based routing rules (routes specific paths to different upstreams)" },
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
          redirects: { type: "array", items: { $ref: "#/components/schemas/RedirectRule" } },
          rewrite: { oneOf: [{ $ref: "#/components/schemas/RewriteConfig" }, { type: "null" }] },
          locationRules: { type: "array", items: { $ref: "#/components/schemas/LocationRule" }, description: "Path-based routing rules (routes specific paths to different upstreams)" },
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
          listenAddress: { type: "string", example: ":5432", description: "Single host:port or :port to listen on" },
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
          listenAddress: { type: "string", example: ":5432", description: "Single host:port or :port" },
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
            description: "Provider-specific options (e.g. Cloudflare API token). Free-form key/value object passed through to the DNS provider.",
            additionalProperties: true,
          },
          certificatePem: { type: ["string", "null"], description: "PEM-encoded certificate (imported type only)" },
          privateKeyPem: { type: ["string", "null"], description: "PEM-encoded private key (imported type only)" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "type", "domainNames", "createdAt", "updatedAt"],
      },
      CertificateInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Wildcard Cert" },
          type: { type: "string", enum: ["managed", "imported"] },
          domainNames: { type: "array", items: { type: "string" } },
          autoRenew: { type: "boolean" },
          providerOptions: { type: ["object", "null"], additionalProperties: true },
          certificatePem: { type: ["string", "null"] },
          privateKeyPem: { type: ["string", "null"] },
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
        properties: {
          apiToken: { type: "string", description: "Cloudflare API token" },
          zoneId: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["apiToken"],
      },
      DnsProviderSettings: {
        type: "object",
        description: "DNS provider configuration for ACME DNS-01 challenges. Supports multiple configured providers with a default.",
        properties: {
          providers: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: { type: "string" },
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
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "baseUrl", "enabled", "hasToken", "createdAt", "updatedAt"],
      },
      InstanceInput: {
        type: "object",
        properties: {
          name: { type: "string", example: "Slave 1" },
          baseUrl: { type: "string", example: "https://slave.example.com:3000" },
          apiToken: { type: "string", description: "Sync token for the slave instance" },
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
      User: {
        type: "object",
        description: "User account (passwordHash is never exposed)",
        properties: {
          id: { type: "integer" },
          email: { type: "string" },
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
