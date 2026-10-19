const { createPublicKey } = require('node:crypto');
// Only a pinned PUBLIC key from the database administrator is accepted.
function rsaPublicKey(value) {
  if (value === undefined || value === '') return undefined;
  try {
    if (typeof value !== 'string') throw new Error();
    const pem = value.replace(/\\n/g, '\n').trim();
    if (!/^-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem)) throw new Error();
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error();
    return key.export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    throw new Error('DB_RSA_PUBLIC_KEY debe ser una clave pública RSA PEM válida.');
  }
}
module.exports = { rsaPublicKey };
