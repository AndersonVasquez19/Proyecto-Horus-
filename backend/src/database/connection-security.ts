// Shared with SQL scripts: no private keys or arbitrary filesystem paths.
export const { rsaPublicKey } = require('../../scripts/connection-security.cjs') as {
  rsaPublicKey(value: unknown): string | undefined;
};
