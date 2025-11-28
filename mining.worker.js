importScripts('imports/sjcl.js');
importScripts('crypto.js');
importScripts('consensus.js');
importScripts('blockchain.js');

onmessage = async function(e) {
    let blockchain = Blockchain.fromJSON(e.data.blockchain);
    let block = await blockchain.getBlockTemplate();
    let start = Date.now();
    while (!await blockchain.validToInsert(block)) {
        await block.newNonce();
    }
    let end = Date.now();
    postMessage({block: block.toJSON(), time_secs: (end - start) / 1000, attempts: block.nonce});
}