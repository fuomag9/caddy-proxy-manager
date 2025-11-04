#!/usr/bin/env node

/**
 * This script generates a minimal Prisma Client stub to allow building
 * when the Prisma engines cannot be downloaded (e.g., network restrictions).
 *
 * The actual Prisma engines must be available at runtime.
 */

const fs = require('fs');
const path = require('path');

const clientDir = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');

// Ensure directory exists
fs.mkdirSync(clientDir, { recursive: true });

// Generate minimal client files
const indexContent = `
// Auto-generated stub for build-time type checking
// Real Prisma Client will be generated at runtime

class PrismaClient {
  constructor(options = {}) {
    this.user = createModelProxy('User');
    this.session = createModelProxy('Session');
    this.oAuthState = createModelProxy('OAuthState');
    this.setting = createModelProxy('Setting');
    this.accessList = createModelProxy('AccessList');
    this.accessListEntry = createModelProxy('AccessListEntry');
    this.certificate = createModelProxy('Certificate');
    this.proxyHost = createModelProxy('ProxyHost');
    this.redirectHost = createModelProxy('RedirectHost');
    this.deadHost = createModelProxy('DeadHost');
    this.apiToken = createModelProxy('ApiToken');
    this.auditEvent = createModelProxy('AuditEvent');
  }

  async $connect() {
    throw new Error('Prisma Client stub - engines not available at build time');
  }

  async $disconnect() {
    return Promise.resolve();
  }

  async $executeRaw() {
    throw new Error('Prisma Client stub - engines not available at build time');
  }

  async $queryRaw() {
    throw new Error('Prisma Client stub - engines not available at build time');
  }

  async $transaction() {
    throw new Error('Prisma Client stub - engines not available at build time');
  }
}

function createModelProxy(modelName) {
  return new Proxy({}, {
    get() {
      throw new Error(\`Prisma Client stub - \${modelName} operations not available at build time\`);
    }
  });
}

exports.PrismaClient = PrismaClient;
exports.Prisma = {
  ModelName: {
    User: 'User',
    Session: 'Session',
    OAuthState: 'OAuthState',
    Setting: 'Setting',
    AccessList: 'AccessList',
    AccessListEntry: 'AccessListEntry',
    Certificate: 'Certificate',
    ProxyHost: 'ProxyHost',
    RedirectHost: 'RedirectHost',
    DeadHost: 'DeadHost',
    ApiToken: 'ApiToken',
    AuditEvent: 'AuditEvent'
  }
};
`;

const indexDtsContent = `
// Auto-generated stub for build-time type checking

export class PrismaClient {
  constructor(options?: any);
  user: any;
  session: any;
  oAuthState: any;
  setting: any;
  accessList: any;
  accessListEntry: any;
  certificate: any;
  proxyHost: any;
  redirectHost: any;
  deadHost: any;
  apiToken: any;
  auditEvent: any;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $executeRaw(query: any, ...values: any[]): Promise<any>;
  $queryRaw(query: any, ...values: any[]): Promise<any>;
  $transaction(fn: any): Promise<any>;
}

export namespace Prisma {
  export const ModelName: {
    User: 'User';
    Session: 'Session';
    OAuthState: 'OAuthState';
    Setting: 'Setting';
    AccessList: 'AccessList';
    AccessListEntry: 'AccessListEntry';
    Certificate: 'Certificate';
    ProxyHost: 'ProxyHost';
    RedirectHost: 'RedirectHost';
    DeadHost: 'DeadHost';
    ApiToken: 'ApiToken';
    AuditEvent: 'AuditEvent';
  };
}
`;

const defaultJsContent = indexContent;
const defaultDtsContent = indexDtsContent;

// Write files
fs.writeFileSync(path.join(clientDir, 'index.js'), indexContent);
fs.writeFileSync(path.join(clientDir, 'index.d.ts'), indexDtsContent);
fs.writeFileSync(path.join(clientDir, 'default.js'), defaultJsContent);
fs.writeFileSync(path.join(clientDir, 'default.d.ts'), defaultDtsContent);
fs.writeFileSync(path.join(clientDir, 'edge.js'), defaultJsContent);
fs.writeFileSync(path.join(clientDir, 'edge.d.ts'), defaultDtsContent);
fs.writeFileSync(path.join(clientDir, 'wasm.js'), defaultJsContent);
fs.writeFileSync(path.join(clientDir, 'wasm.d.ts'), defaultDtsContent);
fs.writeFileSync(path.join(clientDir, 'index-browser.js'), defaultJsContent);

console.log('✓ Generated Prisma Client stub for build');
console.log('⚠️  Note: Actual Prisma engines must be available at runtime');
