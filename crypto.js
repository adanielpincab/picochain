async function sha256Hex(messageHex) {
    const msg = Uint8Array.from(messageHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    const hashBuf = await crypto.subtle.digest("SHA-256", msg);
    return Array.from(new Uint8Array(hashBuf))
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

function roughSizeOfObject(object) {
  const objectList = [];
  const stack = [object];
  let bytes = 0;

  while (stack.length) {
    const value = stack.pop();

    switch (typeof value) {
      case 'boolean':
        bytes += 4;
        break;
      case 'string':
        bytes += value.length * 2;
        break;
      case 'number':
        bytes += 8;
        break;
      case 'object':
        if (!objectList.includes(value)) {
          objectList.push(value);
          for (const prop in value) {
            if (value.hasOwnProperty(prop)) {
              stack.push(value[prop]);
            }
          }
        }
        break;
    }
  }

  return bytes;
}

function generateKeyPairHex() {
  const ec = new elliptic.ec('secp256k1')
  if (!ec) throw new Error('elliptic not loaded');
  let pair = ec.genKeyPair();
  return {
    priv: pair.getPrivate('hex').padStart(64, '0'),
    pub: pair.getPublic('hex').padStart(130, '0')
  };
}

function signHash(privateKeyHex, hash) {
  const ec = new elliptic.ec('secp256k1')
  const key = ec.keyFromPrivate(privateKeyHex, 'hex');
  const signature = key.sign(hash);
  return {
    r: signature.r.toString('hex').padStart(64, '0'),
    s: signature.s.toString('hex').padStart(64, '0')
  };
}

function publicKeyHexFromPrivateKeyHex(privateKeyHex) {
  const ec = new elliptic.ec('secp256k1')
  const key = ec.keyFromPrivate(privateKeyHex, 'hex');
  return key.getPublic('hex').padStart(130, '0');
}

function verifySignature(publicKeyHex, hash, signature) {
  const ec = new elliptic.ec('secp256k1')
  const key = ec.keyFromPublic(publicKeyHex, 'hex');
  return key.verify(hash, signature);
}